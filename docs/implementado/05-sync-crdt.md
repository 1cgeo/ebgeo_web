# 05 - Sync CRDT

Este documento cobre as operações CRDT, o push/pull HTTP, a resolução de conflitos e a
idempotência de operações reenviadas. Toda escrita de entidade colaborativa (feições, grupos,
camadas, mapas, briefings, slides, 3D, 360°) passa por aqui — não há rota REST de escrita separada
para essas entidades.

Para o pull inicial / snapshot, ver [03 - Sync Inicial](./03-sync-inicial.md). Para o canal
WebSocket em tempo real (`operation`/`operations`/`ack`), ver
[04 - WebSocket e Colaboração](./04-websocket-collab.md).

---

## Visão Geral

O sistema usa um log de operações com resolução **Last-Writer-Wins (LWW) por ordem de chegada ao
servidor**:

- Cada operação carrega `timestamp` e `clientId`, mas **o conflito NÃO é resolvido por timestamp**.
- O servidor aplica cada UPDATE **incondicionalmente, na ordem em que as operações chegam ao Postgres**
  (`version = version + 1`, `updated_at = NOW()`). A última operação a chegar vence.
- Delete é soft-delete; uma operação subsequente para a mesma entidade ainda altera a linha, mas a
  entidade permanece com `deleted_at` setado (delete vence na ordem de chegada).
- Operações são **idempotentes** por `op.id`: reenviar a mesma operação não duplica o log nem
  reaplica o efeito (ver seção 12).

> **Por que LWW por chegada e não por timestamp:** o módulo `src/crdt` (resolver/merger por
> timestamp+clientId) foi **removido** — era código morto. O caminho de escrita real (`applyOperation`)
> nunca compara `client_timestamp`. O `timestamp` e o `clientId` ainda viajam na operação (úteis para o
> log, para ordenação local no cliente e para o cliente ignorar o próprio broadcast), mas **não**
> governam a resolução do servidor.

---

## 1. Estrutura de Operação

O backend aceita **dois vocabulários** de operação (ambos válidos, normalizados automaticamente):

### Formato Frontend (recomendado)

```typescript
interface Operation {
  id: string;                // UUID da operação — chave de idempotência (obrigatório)
  entityType: string;        // Tipo da entidade (ver lista abaixo)
  operationType: 'create' | 'update' | 'delete';
  entityId: string;          // UUID da entidade
  mapId?: string | null;     // UUID do mapa (quando aplicável)
  timestamp: number;         // Milliseconds desde epoch
  clientId: string;          // ID do cliente (gerado no frontend)
  data?: object;             // Estado completo (para create)
  changes?: object;          // Campos alterados (para update)
}
```

### Formato Legacy (também suportado)

```typescript
interface Operation {
  id: string;
  type: 'create' | 'update' | 'delete';
  target: string;
  targetId: string;
  mapId?: string | null;
  timestamp: number;
  clientId: string;
  data?: object;
  changes?: object;
}
```

> O backend normaliza automaticamente entre os dois formatos. Você pode misturar campos dos dois
> vocabulários (ex.: `entityType` + `targetId`) — a validação exige apenas que **pelo menos um** de
> cada par esteja presente (`entityType` ou `target`; `operationType` ou `type`; `entityId` ou
> `targetId`).

> **Contrato congelado**: o campo `id` é **obrigatório** em toda operação e é a chave de
> idempotência. Os dois vocabulários (frontend e legacy) são aceitos e **não podem ser removidos** sem
> quebrar o frontend. Os campos `data` e `changes` são preservados verbatim (o middleware de validação
> não remove chaves desconhecidas dentro deles).

### Validação (Joi)

| Regra | Valor |
|-------|-------|
| Máximo de operações por push | **500** (`MAX_OPS_PER_PUSH`) |
| `id` | string, obrigatório |
| `operationType`/`type` | `create` \| `update` \| `delete` |
| `data`/`changes` | objeto (qualquer shape) ou `null` |
| `operations` | array, `.min(1)` |

Violar o schema retorna **422** (erro de validação) — ver seção 11 (Tratamento de erros).

---

## 2. Targets / EntityTypes Suportados

| Target/EntityType | Descrição | Requer mapId |
|-------------------|-----------|--------------|
| `feature` | Feição geoespacial (18 tipos) | Sim |
| `group` | Grupo de feições (hierarquia via `parent_id`) | Sim |
| `layer` | Camada | Sim |
| `group_feature` | Associação grupo-feição | Não |
| `map` | Mapa | Não |
| `briefing` | Briefing | Não |
| `slide` | Slide de briefing | Não |
| `cesium3d` | Dados 3D do Cesium | Sim |
| `streetview360` | Dados de panoramas 360° | Sim |
| `catalogLayer` | Camada do catálogo (por-camada) | Sim |

### Sub-entidades de Mapa

Estes EntityTypes são mapeados automaticamente para updates na tabela `maps` (ou em tabela
dedicada, no caso de `catalogLayer`). Para todos eles, use `mapId` com o ID do mapa a atualizar.

| EntityType | Persistência | Payload |
|------------|--------------|---------|
| `mapPosition` | colunas `center_lat`, `center_long`, `zoom`, `bearing`, `pitch` | campos do viewport |
| `baseLayer` | coluna `base_layer` | `{ baseLayer }` ou `{ base_layer }` |
| `mapNotes` | colunas `notes_title`, `notes_description` | `{ title, description }` ou `{ notes_title, notes_description }` |
| `gridStyle` | coluna `maps.grid_style` (JSONB) ✅ | `{ format, visible }` |
| `mapTemporal` | coluna `maps.temporal_config` (JSONB) ✅ **gated** | `{ ativo, unidade, inicio, fim, modo, origem }` |
| `catalogLayer` | tabela dedicada `catalog_layers` (por id) ✅ — **dual-mode** | ver seção 4 |

> **`gridStyle` e `catalogLayer` agora PERSISTEM.** Versões anteriores deste documento marcavam ambos
> como gaps (no-op / incompatível) — isso **não é mais verdade**. Ambos são gravados de fato (detalhes
> nas seções 3 e 4).

> **`mapTemporal` é "gated":** a coluna, a sub-entidade e o snapshot já existem e gravam o que o
> cliente enviar. O frontend, porém, ainda trata a config temporal por mapa como estado local
> (não emite a op de sync). Enquanto a op não for emitida, `temporal_config` permanece no default
> `{}`. **Nota:** dados temporais **por feição** (`temporalInicio`, `temporalFim`, `trajetoria`,
> `dateTimeGroup`, flags `autoDtg`/`autoDirection`/`autoSpeed`, etc.) **não** dependem disso — eles
> viajam verbatim dentro de `data.properties` numa op `feature` normal.

### Mapeamento de EntityTypes (3D/360)

O backend aceita aliases do frontend e converte automaticamente. Na ingestão, injeta o `data_type`
no objeto `data`; na resposta de pull incremental, converte de volta para o tipo específico.

| Frontend | Backend | data_type |
|----------|---------|-----------|
| `marker3d` | `cesium3d` | `marker` |
| `measurement3d` | `cesium3d` | `measurement` |
| `viewshed3d` | `cesium3d` | `viewshed` |
| `cameraPosition3d` | `cesium3d` | `camera_position` |
| `orientation360` | `streetview360` | `orientation` |
| `marker360` | `streetview360` | `marker` |

---

## 3. Exemplos de Operações

### Criar Feature (`data`)

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "feature_type": "point",
    "geometry": { "type": "Point", "coordinates": [-47.9, -15.7] },
    "properties": {
      "name": "Posto de Observação",
      "color": "#FF0000",
      "icon": "observation"
    },
    "layer_id": null
  }
}
```

### Atualizar Feature (`changes`)

> Em `update`, envie apenas os campos alterados em `changes`. Objetos aninhados (ex.: `properties`)
> são mesclados; o servidor sobrescreve a coluna JSONB com o objeto resultante.

```json
{
  "id": "op-uuid",
  "type": "update",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000000123,
  "clientId": "client-uuid",
  "changes": {
    "geometry": { "type": "Point", "coordinates": [-47.91, -15.71] },
    "properties": { "name": "Posto de Observação Alfa" }
  }
}
```

### Deletar Feature (soft-delete)

```json
{
  "id": "op-uuid",
  "type": "delete",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000001000,
  "clientId": "client-uuid"
}
```

### Compatibilidade com o store do frontend (ebgeo_web) — aceito as-built

O guia acima usa o vocabulário canônico (`changes` no update; 3D/360 no shape aninhado
`{ data_type, tileset_id, data }`). O backend também aceita, **sem conversão no cliente**, os shapes
que o store real do frontend emite (`src/js/store/*`):

- **Update com payload em `data`** — a fábrica de operações do frontend coloca o payload em `data`
  tanto no `create` quanto no `update`. Quando `changes` está ausente num `update`, o backend usa
  `data` como `changes` (deixa de ser no-op silencioso).
- **Feature como GeoJSON cru** — `{ "type": "Feature", "geometry": …, "properties": … }`, com o tipo
  em `properties.source` e a camada em `properties.layerId`. O backend deriva `feature_type`/`layer_id`
  quando ausentes no topo de `data`.
- **3D/360 no shape plano (camelCase)** — `{ id, tilesetId | photoName, position, properties, style,
  sync }`. O backend reagrupa para `{ data_type, tileset_id | photo_name, data: { …resto } }`.
- **`lamportTimestamp`** — persistido e **ecoado** no pull incremental (o frontend o usa para avançar
  o Lamport clock em toda op de entrada).
- **`temporal_cursor`** no slide (v2.2) — persistido no create/update e devolvido no snapshot como
  `temporalCursor` (além de `order` e `sync` por slide).

### Atualizar viewport do mapa (`mapPosition`)

```json
{
  "id": "op-uuid",
  "entityType": "mapPosition",
  "operationType": "update",
  "entityId": "map-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000002000,
  "clientId": "client-uuid",
  "changes": {
    "center_lat": -15.78,
    "center_long": -47.92,
    "zoom": 13,
    "bearing": 0,
    "pitch": 0
  }
}
```

### Estilo de grade (`gridStyle` → `maps.grid_style`)

O payload `{ format, visible }` **é** o objeto gravado em `maps.grid_style`.

```json
{
  "id": "op-uuid",
  "entityType": "gridStyle",
  "operationType": "update",
  "entityId": "map-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000003000,
  "clientId": "client-uuid",
  "changes": { "format": "MGRS", "visible": true }
}
```

### Config temporal do mapa (`mapTemporal` → `maps.temporal_config`, gated)

Monta `temporal_config` a partir das chaves presentes (`ativo`, `unidade`, `inicio`, `fim`, `modo`,
`origem`). Persiste, mas o frontend ainda não emite esta op por padrão.

```json
{
  "id": "op-uuid",
  "entityType": "mapTemporal",
  "operationType": "update",
  "entityId": "map-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000004000,
  "clientId": "client-uuid",
  "changes": {
    "ativo": true,
    "unidade": "hora",
    "inicio": 1700000000000,
    "fim": 1700100000000,
    "modo": "continuo",
    "origem": "manual"
  }
}
```

### Criar Mapa

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "map",
  "targetId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Área de Operações",
    "base_layer": "carta-topografica",
    "center_lat": -15.7,
    "center_long": -47.9,
    "zoom": 12,
    "bearing": 0,
    "pitch": 0,
    "analysis_layers": {},
    "catalog_layers": []
  }
}
```

### Criar Briefing

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "briefing",
  "targetId": "briefing-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Briefing Operacional",
    "description": "Situação atual da operação",
    "settings": { "panelPosition": "left", "panelWidth": 350 }
  }
}
```

### Criar Slide

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "slide",
  "targetId": "slide-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "briefing_id": "briefing-uuid",
    "title": "Situação Atual",
    "content": "Descrição da situação...",
    "mode": "2d",
    "map_id": "map-uuid",
    "position": { "center": [-47.9, -15.7], "zoom": 14 },
    "orientation": {}
  }
}
```

### Criar Layer

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "layer",
  "targetId": "layer-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Objetivos",
    "visible": true,
    "locked": false,
    "sort_order": 0,
    "style": { "color": "#FF0000" }
  }
}
```

### Criar Group

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "group",
  "targetId": "group-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Postos de Observação",
    "visible": true,
    "locked": false,
    "style": {},
    "parent_id": null
  }
}
```

### Associar Feature a Group

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "group_feature",
  "targetId": "gf-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": { "group_id": "group-uuid", "feature_id": "feat-uuid" }
}
```

### Criar Marcador 3D (Cesium)

O alias `marker3d` vira `cesium3d` com `data_type: "marker"` (injetado automaticamente).

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "marker3d",
  "targetId": "marker-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "tileset_id": "PCL",
    "position": { "longitude": -47.9, "latitude": -15.7, "height": 100 },
    "properties": { "name": "Marco 3D" }
  }
}
```

---

## 4. Camadas do Catálogo (`catalogLayer`) — dual-mode

`catalogLayer` é uma **entidade por-camada** persistida na tabela dedicada `catalog_layers`
(`id`/`map_id`/`data`/`version` + soft-delete via `deleted_at`). O handler é **dual-mode**:

- **Forma por-camada (recomendada):** `create`/`update`/`delete` operando numa linha pelo `targetId`
  (o id da camada). `create` usa `ON CONFLICT (id) DO NOTHING`; `update` mescla em `data`; `delete`
  é soft-delete.
- **Forma legada (array inteiro):** se `data.catalog_layers` (ou `changes.catalog_layers`) for um
  **array**, o handler grava esse array inteiro na coluna legada `maps.catalog_layers` (compat com
  clone/import). A coluna legada **não foi removida**.

No snapshot, as camadas por-camada aparecem em `map.catalogLayers` (array de `{ id, ...data, sync }`);
a coluna legada `maps.catalog_layers` continua sendo retornada para compatibilidade.

### Criar camada do catálogo (por id)

```json
{
  "id": "op-uuid",
  "entityType": "catalogLayer",
  "operationType": "create",
  "entityId": "catlayer-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000005000,
  "clientId": "client-uuid",
  "data": {
    "name": "Hidrografia",
    "source": "wms",
    "url": "https://...",
    "visible": true
  }
}
```

### Atualizar / deletar camada do catálogo

```json
{
  "id": "op-uuid",
  "entityType": "catalogLayer",
  "operationType": "update",
  "entityId": "catlayer-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000006000,
  "clientId": "client-uuid",
  "changes": { "visible": false }
}
```

`delete` segue o mesmo shape, sem `data`/`changes` (soft-delete por `targetId` + `mapId`).

---

## 5. Push de Operações (HTTP)

Usado para enviar operações pendentes (após reconexão / fila offline). Em tempo real, prefira o
canal WebSocket (doc 04); o push HTTP é o caminho de recuperação.

### Endpoint

`POST /api/v1/atlas/:atlasId/sync`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão

`write`

### Request

```json
{
  "operations": [
    {
      "id": "op-uuid-1",
      "type": "create",
      "target": "feature",
      "targetId": "feat-uuid",
      "mapId": "map-uuid",
      "timestamp": 1699999999999,
      "clientId": "client-uuid",
      "data": { }
    },
    {
      "id": "op-uuid-2",
      "type": "update",
      "target": "feature",
      "targetId": "feat-uuid-2",
      "mapId": "map-uuid",
      "timestamp": 1700000000000,
      "clientId": "client-uuid",
      "changes": { }
    }
  ]
}
```

### Response (200)

```json
{
  "data": {
    "results": [
      { "success": true, "operationId": "op-uuid-1", "idempotent": false, "currentVersion": 42 },
      { "success": true, "operationId": "op-uuid-2", "idempotent": false, "currentVersion": 43 }
    ],
    "acks": [
      { "opId": "op-uuid-1", "serverVersion": 42, "idempotent": false },
      { "opId": "op-uuid-2", "serverVersion": 43, "idempotent": false }
    ],
    "serverVersion": 43
  }
}
```

| Campo | Descrição |
|-------|-----------|
| `results[]` | Ack **por operação** (mesma ordem do request). Use para fazer dequeue confiante da fila offline. |
| `results[].success` | Sempre `true` para ops processadas (erros de validação abortam o request inteiro com 422). |
| `results[].operationId` | O `op.id` enviado. |
| `results[].idempotent` | `true` se a op já tinha sido aplicada antes (reenvio) — ver seção 12. |
| `results[].currentVersion` | Versão registrada para aquela op (ou a versão atual do atlas, se a versão prévia não pôde ser recuperada). |
| `acks[]` | Alias retrocompatível dos mesmos dados (`opId`/`serverVersion`/`idempotent`). |
| `serverVersion` | Maior `server_version` do atlas após o push. |

> **Toda a aplicação roda numa única transação.** Se qualquer operação do batch falhar, a transação
> inteira é revertida (atomicidade do batch).

---

## 6. Pull de Operações (HTTP)

Sistema híbrido: snapshot quando o cliente está desatualizado, operações incrementais caso contrário.
Detalhes do snapshot em [03 - Sync Inicial](./03-sync-inicial.md).

### Endpoint

`GET /api/v1/atlas/:atlasId/sync/:version`

### Permissão

`read`

### Comportamento

| Condição | Resposta |
|----------|----------|
| `version == 0` ou `version < min_version` | Snapshot (`isSnapshot: true`) |
| `version >= min_version` | Operações incrementais (`isSnapshot: false`) |

### Response (operações incrementais)

```json
{
  "data": {
    "operations": [
      {
        "id": "op-uuid",
        "entityType": "feature",
        "operationType": "create",
        "entityId": "feat-uuid",
        "mapId": "map-uuid",
        "data": { },
        "changes": null,
        "timestamp": 1699999999999,
        "clientId": "client-uuid",
        "serverVersion": 151
      },
      {
        "id": "op-uuid-2",
        "entityType": "marker3d",
        "operationType": "update",
        "entityId": "marker-uuid",
        "mapId": "map-uuid",
        "data": null,
        "changes": { "properties": { "name": "Novo nome" } },
        "timestamp": 1700000000123,
        "clientId": "client-uuid-2",
        "serverVersion": 152
      }
    ],
    "currentVersion": 152,
    "isSnapshot": false
  }
}
```

> **Nota:** na resposta, os nomes voltam ao vocabulário do frontend (`entityType`/`operationType`/
> `entityId`) e os tipos genéricos `cesium3d`/`streetview360` são reconvertidos para os tipos
> específicos (`marker3d`, `orientation360`, etc.) com base no `data_type`.

---

## 7. Fluxo de Sync HTTP

```
Cliente                          Backend
   |                                |
   [Reconectou após offline]        |
   |                                |
   |-- GET /atlas/:id/sync/150 ---->|  Pull operações perdidas
   |                                |
   |                                |  Backend verifica:
   |                                |  - Se 150 >= min_version → operações
   |                                |  - Se 150 < min_version → snapshot
   |                                |
   |<-- 200 -----------------------|
   |   { operations: [...],         |  (ou snapshot se muito desatualizado)
   |     currentVersion: 175,       |
   |     isSnapshot: false }        |
   |                                |
   [Aplica operações faltantes]     |
   |                                |
   |-- POST /atlas/:id/sync ------->|  Push operações pendentes (idempotente)
   |   { operations: [...] }        |
   |                                |
   |<-- 200 -----------------------|
   |   { results: [...],            |
   |     acks: [...],               |
   |     serverVersion: 180 }       |
   |                                |
   [Dequeue por results[].operationId]
```

---

## 8. Merge de Mapas

Operação estrutural **atômica** que move as sub-entidades de um ou mais mapas de origem para um mapa
de destino, em uma única transação. Os mapas de origem **não** são deletados — apenas o conteúdo é
movido. É a única rota REST de escrita do módulo de mapas (todo o resto é sync).

### Endpoint

`POST /api/v1/atlas/:atlasId/maps/:mapId/merge`

(`:mapId` é o mapa de **destino**.)

### Permissão

`write`

### Request

```json
{
  "sourceMapIds": ["map-origem-1", "map-origem-2"]
}
```

- `sourceMapIds`: array de UUIDs, `.min(1)`, obrigatório.
- Todos os mapas (destino e origens) devem pertencer ao **mesmo atlas** — origem de outro atlas
  retorna **404** (sem vazar existência).
- O próprio `:mapId` de destino é filtrado das origens automaticamente.

### Response (200)

```json
{
  "data": {
    "destMapId": "map-destino",
    "sourceMapIds": ["map-origem-1", "map-origem-2"],
    "moved": {
      "features": 12,
      "groups": 3,
      "layers": 2,
      "cesium3d_data": 1,
      "streetview360_data": 0,
      "catalog_layers": 4
    }
  }
}
```

`moved` traz a contagem de linhas movidas por tabela filha. As 6 tabelas filhas
(`features`, `groups`, `layers`, `cesium3d_data`, `streetview360_data`, `catalog_layers`) vêm de uma
whitelist literal no código (nunca de input).

### Broadcast WS

Após o commit, o servidor faz broadcast `maps_merged` para a sala do atlas:

```json
{ "type": "maps_merged", "destMapId": "map-destino", "sourceMapIds": ["map-origem-1", "map-origem-2"] }
```

O frontend deve recarregar/realocar as sub-entidades dos mapas afetados ao receber este evento.

### Tratamento de erros

| Status | Quando |
|--------|--------|
| `422` | `sourceMapIds` ausente / vazio / não-uuid |
| `404` | Mapa de destino inexistente, ou alguma origem fora do atlas / inexistente |
| `403` | Sem permissão `write` |

---

## 9. Endpoints Admin de Limpeza

Compactam o log de operações (sobe `min_version`; clientes muito antigos passam a receber snapshot no
pull). Requerem role **admin**.

### Estatísticas

`GET /api/v1/atlas/:atlasId/sync/admin/stats`

### Cleanup

`POST /api/v1/atlas/:atlasId/sync/admin/cleanup`

```json
{
  "keepFromVersion": 1000,
  "keepDays": 7
}
```

- `keepFromVersion` (opcional, inteiro ≥ 0): mantém operações a partir desta versão.
- `keepDays` (opcional, inteiro 1..365, default 7): mantém operações dos últimos N dias.
- Exige pelo menos um dos dois.

Após o cleanup, `min_version` sobe e o pull a partir de versões antigas passa a retornar snapshot.

---

## 10. Resolução de Conflitos (LWW por chegada)

O servidor **não** compara timestamps. A regra é:

```
Regras de resolução (servidor):
1. As operações são aplicadas na ORDEM em que chegam ao Postgres.
2. Cada UPDATE é aplicado incondicionalmente (version += 1, updated_at = NOW()).
3. A última operação a chegar para uma entidade é a que "vence".
4. Idempotência: reenviar a mesma op (mesmo op.id) NÃO reaplica o efeito.
```

> **Contrato congelado**: o servidor é a fonte de verdade da ordem. O cliente **não** deve assumir que
> a operação com maior `timestamp` vence — é a **última a chegar ao servidor** que vence. Em prática,
> isto raramente conflita: feições são objetos pequenos com edição concorrente rara na mesma feição.

O cliente pode aplicar operações remotas otimisticamente e, em caso de divergência, confiar no
estado do servidor (refazendo pull incremental):

```javascript
function applyRemote(op, localState) {
  // O cliente aplica o que o servidor mandou; a ordem do servidor é canônica.
  // Se quiser detectar conflito local, compare a version local com a do servidor
  // após o ack e refaça pull incremental se estiver atrás.
  return true;
}
```

---

## 11. Tratamento de Erros

| Status | Código | Quando |
|--------|--------|--------|
| `401` | — | Sem token / token inválido |
| `403` | `FORBIDDEN` | Sem permissão `write` no push (ou `read` no pull) — mensagem `Access denied` ou `Insufficient permissions` |
| `404` | `NOT_FOUND` | Atlas inexistente / deletado |
| `422` | validação | Schema do push inválido (sem `id`, `operationType` inválido, > 500 ops, array vazio) |

Formato de erro (envelope padrão da API):

```json
{ "error": { "code": "FORBIDDEN", "message": "Insufficient permissions" } }
```

No WebSocket, os mesmos erros chegam como mensagem `{ "type": "error", "code": "...", "message": "..." }`
(ver doc 04).

---

## 12. Idempotência por `op_id`

Toda operação carrega um `id` (UUID do cliente). O backend usa esse `id` como `op_id` e garante
idempotência via índice `UNIQUE (atlas_id, op_id)` + `INSERT ... ON CONFLICT (atlas_id, op_id) DO
NOTHING`. Reenviar a mesma operação (mesmo cenário de reconexão WS ou retry da fila offline):

1. **Não** cria uma segunda linha no log de operações.
2. **Não** reaplica o efeito na entidade.
3. Retorna ack com `idempotent: true` e a `serverVersion` originalmente registrada.

### Exemplo: 2º envio da mesma op

```json
{
  "data": {
    "results": [
      { "success": true, "operationId": "op-uuid-1", "idempotent": true, "currentVersion": 42 }
    ],
    "acks": [
      { "opId": "op-uuid-1", "serverVersion": 42, "idempotent": true }
    ],
    "serverVersion": 43
  }
}
```

> Implicação para o frontend: você pode **reenviar com segurança** operações cuja confirmação não
> chegou (timeout de rede, reconexão). Use `results[].idempotent` apenas como informação — em ambos os
> casos (`true`/`false`) a operação está garantidamente aplicada e pode sair da fila pendente.

### Operações sem `id`

No push HTTP o campo `id` é **obrigatório** (schema Joi `id.required()`): uma operação sem `id` é
rejeitada com **422** antes de chegar ao banco. Não existe, nesse caminho, o cenário de `op_id =
null`. Sempre gere um `id` único por operação — ele é a chave de idempotência.

---

## 13. Gerando `clientId`

O `clientId` identifica a origem das operações (usado pelo cliente para ignorar o próprio broadcast).
Deve ser estável por sessão/dispositivo:

```javascript
function getClientId() {
  let clientId = localStorage.getItem('ebgeo_client_id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem('ebgeo_client_id', clientId);
  }
  return clientId;
}
```

> O mesmo `clientId` pode ser passado no handshake WebSocket (`?clientId=`) para presença/idempotência
> estável na reconexão (ver doc 04).

---

## 14. Factory de Operações

Gere sempre um `id` único por operação (chave de idempotência) e use o vocabulário do frontend.

```javascript
class OperationFactory {
  constructor(clientId) {
    this.clientId = clientId;
  }

  create(entityType, entityId, data, mapId = null) {
    return {
      id: crypto.randomUUID(),
      entityType,
      operationType: 'create',
      entityId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId,
      data,
    };
  }

  update(entityType, entityId, changes, mapId = null) {
    return {
      id: crypto.randomUUID(),
      entityType,
      operationType: 'update',
      entityId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId,
      changes,
    };
  }

  delete(entityType, entityId, mapId = null) {
    return {
      id: crypto.randomUUID(),
      entityType,
      operationType: 'delete',
      entityId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId,
    };
  }
}

// Uso
const factory = new OperationFactory(getClientId());

const createOp = factory.create('feature', featureId, {
  feature_type: 'point',
  geometry: { type: 'Point', coordinates: [-47.9, -15.7] },
  properties: { name: 'Marco' },
}, mapId);

const updateOp = factory.update('feature', featureId, {
  properties: { name: 'Marco Atualizado' },
}, mapId);

const deleteOp = factory.delete('feature', featureId, mapId);
```

---

## 15. Dispatcher de Operações (fila offline + idempotência)

```javascript
class OperationDispatcher {
  constructor(ws, atlasId, token, clientId) {
    this.ws = ws;
    this.atlasId = atlasId;
    this.token = token;
    this.factory = new OperationFactory(clientId);
    this.pendingOps = new Map(); // opId -> operation
    this.enabled = false;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }

  async dispatch(operation) {
    // 1. Sempre persistir localmente (IndexedDB) e na fila pendente.
    await this.saveToIndexedDB(operation);
    this.pendingOps.set(operation.id, operation);
    await this.savePendingOperation(operation);

    // 2. Enviar em tempo real se possível; senão fica na fila para o push HTTP.
    if (this.enabled && this.ws?.isConnected) {
      this.ws.sendOperation(operation);
    }
  }

  // Ao receber ack (WS ou HTTP), tirar da fila — idempotente ou não, está aplicada.
  async onAck(opId /*, serverVersion, idempotent */) {
    this.pendingOps.delete(opId);
    await this.removePendingOperation(opId);
  }

  // Recuperação: enviar a fila inteira via push HTTP (reenvio é seguro).
  async syncPending() {
    const pending = await this.getPendingOperations();
    if (pending.length === 0) return;

    const response = await fetch(`/api/v1/atlas/${this.atlasId}/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operations: pending }),
    });

    const { data } = await response.json();
    // results[] está na mesma ordem do request; idempotent true/false: ambos OK.
    for (const r of data.results) {
      await this.onAck(r.operationId);
    }
  }

  // Helpers de persistência local
  async saveToIndexedDB(op) { /* ... */ }
  async savePendingOperation(op) { /* ... */ }
  async removePendingOperation(opId) { /* ... */ }
  async getPendingOperations() { /* ... */ }
}
```

> **Por que reenviar é seguro:** graças à idempotência por `op_id` (seção 12), reenviar a fila inteira
> após uma reconexão nunca duplica feições. Trate `results[].idempotent === true` como "já estava
> aplicada" e simplesmente faça o dequeue.

---

## 16. Aplicando Operações Remotas

```javascript
async function applyRemoteOperation(op, db) {
  const storeName = getStoreForEntityType(op.entityType);
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);

  switch (op.operationType) {
    case 'create':
      await store.put({ id: op.entityId, ...op.data, mapId: op.mapId });
      break;
    case 'update': {
      const existing = await store.get(op.entityId);
      if (existing) await store.put(mergeChanges(existing, op.changes));
      break;
    }
    case 'delete':
      await store.delete(op.entityId);
      break;
  }
  await tx.done;
}

function mergeChanges(existing, changes) {
  const result = { ...existing };
  for (const [key, value] of Object.entries(changes || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = { ...result[key], ...value }; // merge raso de objetos
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getStoreForEntityType(entityType) {
  return {
    feature: 'features',
    layer: 'layers',
    group: 'groups',
    group_feature: 'groupFeatures',
    map: 'maps',
    briefing: 'briefings',
    slide: 'slides',
    catalogLayer: 'catalogLayers',
    // Tipos específicos de 3D/360 (retornados como tipos frontend no pull)
    marker3d: 'cesium3dData',
    measurement3d: 'cesium3dData',
    viewshed3d: 'cesium3dData',
    cameraPosition3d: 'cesium3dData',
    orientation360: 'streetview360Data',
    marker360: 'streetview360Data',
  }[entityType];
}
```

> Lembre-se: ignore operações remotas cujo `clientId` seja o seu próprio (você já aplicou
> localmente). O push HTTP faz broadcast das ops cruas para a sala, e o emissor HTTP não tem socket
> para ser excluído — então o filtro por `clientId` é responsabilidade do cliente.

---

## Checklist de Implementação

- [ ] Geração de `id` único por operação (chave de idempotência)
- [ ] Geração de `clientId` estável (localStorage)
- [ ] Factory de operações (create/update/delete) no vocabulário do frontend
- [ ] Fila de operações pendentes em IndexedDB
- [ ] Envio em tempo real via WebSocket
- [ ] Push HTTP da fila na reconexão (reenvio seguro)
- [ ] Dequeue por `results[].operationId` (tratar `idempotent` true/false igual)
- [ ] Pull incremental via HTTP com fallback para snapshot
- [ ] Aplicação de operações remotas (filtrando o próprio `clientId`)
- [ ] Merge raso de `changes` em updates
- [ ] Tratamento de `maps_merged` (recarregar sub-entidades)
- [ ] Tratamento de erros (422 validação, 403 permissão)

---

## Próximo Documento

[06 - Presença e Imagens](./06-presenca-imagens.md) - Cursores, seleção e upload de imagens
