# EntityTypes Sincronizáveis e seu Mapeamento

Catálogo dos tipos de entidade que viajam como operação (feature, layer, group, map, briefing, slide, comment, 3D/360, sub-entidades de mapa e catalogLayer) e as traduções que o backend aplica entre aliases do frontend, tabelas e `data_type`.

## O enum é a fonte da verdade

Os tipos aceitos vivem em `src/js/store/sync/operation-types.js:8-37`, congelados em `EntityType`:

`atlas`, `map`, `feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`, `mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal`, `catalogLayer`, `briefing`, `slide`, `comment`, `setting`.

`isValidEntityType()` (`operation-types.js:53`) valida contra esse conjunto. Adicionar um tipo exige tocar três lugares: o enum, um logger no dispatcher e um `case` no handler remoto. Faltar o `case` não quebra nada visivelmente, apenas dispara `console.warn('unknown entity type')` em `remote-operation-handler.js:341` e a op some silenciosamente no peer.

Duas armadilhas no enum:

- **`atlas` não é usado em lugar nenhum.** Nenhum `EntityType.ATLAS` aparece no código. Configuração de atlas viaja como `setting`, não como `atlas`.
- **`group_feature` não existe no frontend.** O backend tem a tabela `group_features` e o `tableMap` a suporta (`arquitetura-sync.md:279`), mas o cliente nunca emite esse tipo, associação feição/grupo vai embutida na própria feição ou no grupo.

## Como um tipo vira operação (outbound)

Toda emissão passa por `logOperation(entityType, operationType, entityId, mapId, data, previousData)` (`operation-dispatcher.js:105`). Sobre ele existem wrappers tipados, e a assinatura muda conforme a família:

| Família | Wrapper | Assinatura | `mapId` |
|---|---|---|---|
| Entidade de mapa | `logFeatureOperation`, `logLayerOperation`, `logGroupOperation`, `logCommentOperation`, `logCatalogLayerOperation`, os de 3D/360 | `(opType, entityId, mapId, data, prev)` | UUID do mapa |
| Nível-atlas | `logMapOperation`, `logBriefingOperation`, `logSettingOperation` | `(opType, entityId, data, prev)` | sempre `null` (`createEntityLogger(..., true)`, `operation-dispatcher.js:245`) |
| Sub-entidade de mapa | `logMapPositionOperation`, `logBaseLayerOperation`, `logMapNotesOperation`, `logGridStyleOperation`, `logMapTemporalOperation` | `(opType, mapId, data, prev)` | `entityId === mapId` |

A terceira família é a mais fácil de errar: `createMapSettingLogger` (`operation-dispatcher.js:260-275`) recebe **um único id** e o usa como `entityId` e como `mapId`. Passar o nome do mapa em vez do UUID faz a op ser descartada em silêncio.

O `slide` é a exceção que ninguém espera: `briefing.operations.js:302` chama `logOperation(EntityType.SLIDE, ..., slide.id, briefingId, slide)`, ou seja, **o slot `mapId` carrega o `briefingId`**. Funciona porque briefingId também é UUID e passa o guard, mas não trate `op.mapId` de um `slide` como mapa.

Detalhe do formato do envelope em [[envelope-operacao]]; a fila e a compactação em [[fila-operacoes-outbound]].

## Os dois guards que descartam ops antes do flush

Ambos em `logOperation` e replicados em `logBatchOperations` (`operation-dispatcher.js:120-139` e `192-198`). Existem por causa de um bug real: **uma única op inválida derruba o batch inteiro do flush e trava todo o sync**.

1. **`setting` com id não-UUID e diferente de `'atlas'`** (`operation-dispatcher.js:120`). Chaves locais como `lastActiveMap` são estado de visualização por cliente e o Postgres rejeitaria com 22P02. Motivo: `DropReason.NON_UUID_SETTING_ID`.
2. **Qualquer op com `mapId` presente e não-UUID** (`operation-dispatcher.js:133`). É o anti-vazamento do mapa local `Principal`, que é chaveado por nome. Motivo: `DropReason.NON_UUID_MAPID`. Ops de nível-atlas passam `mapId = null` e não são afetadas.

Os descartes viram spans `preflush.drop` no [[syncledger]]. Se algo "não sincronizou e não deu erro", esse é o primeiro lugar a olhar. A separação entre o que é local e o que é remoto está em [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]].

## Sub-entidades de mapa

Cinco tipos que não têm tabela própria, o backend os converte em `UPDATE` na linha de `maps`:

| EntityType | Coluna(s) em `maps` | Payload |
|---|---|---|
| `mapPosition` | `center_lat`, `center_long`, `zoom`, `bearing`, `pitch` | campos do viewport |
| `baseLayer` | `base_layer` | `{ baseLayer }` ou `{ base_layer }` |
| `mapNotes` | `notes_title`, `notes_description` | `{ title, description }` |
| `gridStyle` | `grid_style` (JSONB) | `{ format, visible }` |
| `mapTemporal` | `temporal_config` (JSONB) | `{ ativo, modo, unidade, inicio, fim, origem }` |

Na entrada, todos os cinco caem no mesmo `case` agrupado e vão para `applyRemoteMapSettingOp(entityType, mapId, data)` (`remote-operation-handler.js:320-326`, implementação em `:848`). Note que esse handler ignora `operationType`: sub-entidade de mapa só faz sentido como update.

> **Nota histórica.** guia *05-sync-crdt* (absorvido):122` e `:130-134` dizem que `mapTemporal` é "gated" e que "o frontend ainda não emite a op de sync", deixando `temporal_config` no default `{}`. O código emite: `src/js/store/temporal.operations.js:107` chama `logMapTemporalOperation(OperationType.UPDATE, mapManager.getMapId(target), next)` a cada `setMapTemporalConfig`, com o UUID resolvido justamente para passar o guard. A config temporal por mapa **sincroniza**. Continua verdade que dados temporais **por feição** (`temporalInicio`, `temporalFim`, `trajetoria`) viajam verbatim dentro de `data.properties` numa op `feature` normal, sem depender disso. Ver [[modulo-temporal]].

## Aliases 3D/360 e o `data_type`

O frontend usa seis tipos específicos; o backend guarda tudo em duas tabelas genéricas e discrimina por `data_type`. A tradução é automática nos dois sentidos (`ENTITY_TYPE_MAP` na ingestão, `REVERSE_ENTITY_TYPE_MAP` no pull):

| Frontend | Tabela backend | `data_type` |
|---|---|---|
| `marker3d` | `cesium3d_data` | `marker` |
| `measurement3d` | `cesium3d_data` | `measurement` |
| `viewshed3d` | `cesium3d_data` | `viewshed` |
| `cameraPosition3d` | `cesium3d_data` | `camera_position` |
| `orientation360` | `streetview360_data` | `orientation` |
| `marker360` | `streetview360_data` | `marker` |

Consequência prática: **o cliente nunca vê `cesium3d` nem `streetview360` como `entityType`**. No pull incremental e no broadcast o tipo volta específico, e é por isso que `remote-operation-handler.js:302-318` tem um `case` por alias, não um genérico. No snapshot, ao contrário, o formato é hierárquico (`cesium3d { markers, measurements, viewsheds, cameraPositions }`), reagrupado por `data_type` (`arquitetura-sync.md:576-578`). Ver [[snapshot-e-pull-incremental]], [[catalogo-3d]] e [[streetview-360]].

Também há tolerância de shape: o backend aceita o formato plano camelCase que o store real emite (`{ id, tilesetId | photoName, position, properties, style, sync }`) e reagrupa para `{ data_type, tileset_id | photo_name, data: {...} }`, sem conversão no cliente.

## `catalogLayer` é dual-mode

Único tipo com tabela dedicada (`catalog_layers`) **e** uma coluna legada (`maps.catalog_layers`), e o handler do backend decide qual usar pelo shape do payload:

- Se `data`/`changes` traz `catalog_layers` como **array**, grava o array inteiro na coluna legada do mapa (compat com clone e import).
- Caso contrário, opera **uma linha por camada** pelo `entityId`: `create` com `ON CONFLICT (id) DO NOTHING`, `update` mescla em `data`, `delete` é soft-delete.

No snapshot as duas formas coexistem: `map.catalogLayers[]` (por-camada, com `sync`) e a coluna legada. Não assuma que só uma está preenchida.

## `setting` é atlas-scoped, sempre

`logAtlasSetting(patch)` (`operation-dispatcher.js:346`) resolve o id do atlas best-effort e cai no sentinela `'atlas'` se não conseguir. Isso é seguro porque **o handler de `setting` do backend escopa pela rota (`:atlasId`) e ignora o `entityId`**. O merge em `atlas.settings` é whitelisted, chaves de disponibilidade de recurso nunca entram por aqui (`arquitetura-sync.md:283`), o que é a fronteira entre [[atlas-settings]] e edição colaborativa comum.

Chamadores reais: `mapOrder` e `mapBadgeColors` (`map.operations.js:161`, `:723`), `customIcons` (`customIcons.operations.js:131`), `colorUsage` (`repository.js:424`), `terrainExaggeration` (`modals/settings.modal.js:228`). Todos podem ser chamados incondicionalmente porque o logger é no-op quando o logging está desligado (offline). Ver [[atlas-modelo-de-dados]] e [[atlas-modelo-de-dados]].

## Nem todo tipo converge igual

`CONVERGENCE_GUARDED` (`remote-operation-handler.js:115-125`) lista os nove tipos cujo `update` substitui o objeto inteiro e que por isso recebem o guard de convergência (adiar a op remota enquanto há edição local sem ack, depois descartar o que for mais antigo por `serverVersion`):

`feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`.

**Ficam de fora, deliberadamente:** `map`, `briefing`, `slide`, `comment`, `setting`, `catalogLayer` e as cinco sub-entidades de mapa. Para elas vale apenas o último a chegar, sem defesa contra reordenação. Detalhe do mecanismo em [[idempotencia-e-convergence-guard]], modelo geral em [[modelo-conflito-lww]] e [[modelo-conflito-lww]], e o porquê disso não ser CRDT em [[sintese-nao-e-crdt]].

O mesmo conjunto governa o lado de saída: `logOperation` só chama `markLocalEditPending(entityId)` para tipos guardados (`operation-dispatcher.js:147`).

## `slide`: emitido, mas no-op na entrada

`slide` tem ops de saída (`briefing.operations.js:302/337/367`) e **nenhum efeito inbound**. O `case EntityType.SLIDE` em `remote-operation-handler.js:333-338` só marca `entityPersisted = false` e retorna, com o comentário explicando o motivo: slides convergem pela op do `briefing` pai, já que `updateBriefing` registra o array completo de slides e `applyRemoteBriefingOp` o aplica. O `case` existe apenas para não cair no `warn` de tipo desconhecido.

Isso significa que uma op `slide` isolada que chegue de um peer **não altera nada** no destino. Se você mexer em slides fora de `updateBriefing`, o peer não vê.

## `comment` e a fronteira de permissão

`comment` é map-scoped (carrega o UUID do mapa) e é o único tipo com um degrau de permissão próprio: `permission-guard.js:41-43` mapeia create/update/delete de comentário para `PermissionAction.COMMENT`, acessível a partir do papel Comentarista, enquanto as demais entidades exigem `write`. O backend repete a checagem por operação (`assertOperationAllowed`): um usuário `comment`-tier só escreve comentários. Ver [[comentario-espacial]], [[permissoes-atlas]] e [[permissoes-atlas]].

## Tabela de roteamento no backend

`tableMap` em `sync.service.js` (`arquitetura-sync.md:279`), depois de aplicado o `ENTITY_TYPE_MAP`:

`feature→features`, `layer→layers`, `group→groups`, `map`/`map_meta→maps`, `briefing→briefings`, `slide→slides`, `cesium3d→cesium3d_data`, `streetview360→streetview360_data`, `comment→comments`, `catalog_layer→catalog_layers`, `group_feature→group_features`.

Regras que dependem do tipo:

- **Lock gate:** só para alvos filhos com `mapId` (`feature`, `group`, `layer`, `cesium3d`, `streetview360`, `catalog_layer`, `group_feature`). Mapa travado devolve `ConflictError('Map is locked')`. Entidades de nível-atlas passam direto.
- **Delete:** soft-delete em tudo, **exceto `group_feature`** (hard delete). Delete de `layer` cascateia soft-delete às feições dela.
- **Create:** `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)`, guarda anti-IDOR cross-atlas, mais `ON CONFLICT (id) DO NOTHING`.

O log persistido é o mesmo para todos os tipos, ver [[tabela-operations]].

## Armadilhas em ordem de frequência

1. **Passar nome de mapa onde se espera UUID** em qualquer logger map-scoped ou de sub-entidade: op descartada sem erro visível. Sintoma no ledger: `preflush.drop{non_uuid_mapId}`.
2. **Usar `logSettingOperation` para estado local** (preferência por cliente): descartado pelo guard de `setting`. Estado por cliente não é sincronizável, por design.
3. **Assumir que `op.mapId` de um `slide` é um mapa.** É o `briefingId`.
4. **Esperar que uma op `slide` isolada apareça no peer.** Não aparece.
5. **Esperar `cesium3d`/`streetview360` como `entityType` no cliente.** Nunca chegam assim, sempre no alias específico.
6. **Adicionar tipo ao enum sem o `case` inbound.** Sai, chega e é ignorado com um `warn`.
7. **Contar com o guard de convergência em `map`/`briefing`/`comment`.** Eles não estão em `CONVERGENCE_GUARDED`.
8. **Compactação da fila agrupa por `entityType:entityId`** (`operation-queue.js:272`). Como as sub-entidades de mapa compartilham `entityId === mapId`, elas só não colidem porque o `entityType` difere, um tipo novo que reuse o id do mapa passa a competir por esse grupo.

Identidade do emissor em [[client-id-estavel]]; confirmação e dedupe em [[ack-idempotencia]]; transporte em [[canal-collab-websocket]]; aplicação no destino em [[aplicacao-operacoes-remotas]]; contratos que não podem mudar em [[sintese-contratos-congelados]].


## Payload de `create` por entityType (shape do `data`)

## Payload de `create` por entityType (shape do `data`)

O conteúdo de `data` é **snake_case, no vocabulário das colunas do backend**, não o camelCase do store local. O envelope em volta está em [[envelope-operacao]]; aqui só o miolo.

| entityType | Chaves esperadas em `data` |
|---|---|
| `feature` | `feature_type`, `geometry` (GeoJSON), `properties` (JSONB livre), `layer_id` (ou `null`) |
| `layer` | `name`, `visible`, `locked`, `sort_order`, `style` |
| `group` | `name`, `visible`, `locked`, `style`, `parent_id` (aninhamento) |
| `group_feature` | `group_id`, `feature_id` |
| `map` | `name`, `base_layer`, `center_lat`, `center_long`, `zoom`, `bearing`, `pitch`, `analysis_layers`, `catalog_layers` |
| `briefing` | `name`, `description`, `settings` (ex. `{ panelPosition, panelWidth }`) |
| `slide` | `briefing_id`, `title`, `content`, `mode` (`2d`/`3d`/`360`), `map_id`, `position`, `orientation`, `temporal_cursor` |
| `marker3d` e irmãos 3D | `tileset_id`, `position` (`{ longitude, latitude, height }`), `properties` |
| `catalogLayer` | shape livre da camada (`name`, `source`, `url`, `visible`, ...) — ver dual-mode acima |

Exemplo canônico (feature):

```json
{
  "id": "op-uuid",
  "entityType": "feature",
  "operationType": "create",
  "entityId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "feature_type": "point",
    "geometry": { "type": "Point", "coordinates": [-47.9, -15.7] },
    "properties": { "name": "Posto de Observação", "color": "#FF0000" },
    "layer_id": null
  }
}
```

### Tolerâncias de shape que o backend aceita sem conversão no cliente

O store real não emite exatamente o shape canônico, e o backend absorve a diferença:

1. **Feature como GeoJSON cru.** `{ "type": "Feature", "geometry": …, "properties": … }`, com o tipo em `properties.source` e a camada em `properties.layerId`. O backend deriva `feature_type` e `layer_id` quando eles não estão no topo de `data`.
2. **3D/360 no shape plano camelCase.** `{ id, tilesetId | photoName, position, properties, style, sync }` é reagrupado para `{ data_type, tileset_id | photo_name, data: { …resto } }`.
3. **`temporal_cursor` do slide (v2.2)** é persistido no create/update e devolvido no snapshot como `temporalCursor`, junto de `order` e `sync` por slide. Ver [[modulo-temporal]].
4. **`lamportTimestamp`** é persistido e **ecoado** no pull incremental — é dele que o cliente avança o relógio de Lamport em toda op de entrada.

> Armadilha: `slide` só tem efeito inbound pela op do `briefing` pai (ver seção acima), então essas chaves de `data` importam no que o servidor grava, não no que o peer aplica.


## Estado de UI: o que é compartilhado e o que é local por usuário

## Estado de UI: o que é compartilhado e o que é local por usuário

O enum de `EntityType` diz o que *pode* virar operação, mas não responde a pergunta que aparece toda vez que se mexe na interface: **este controle é preferência de quem clicou ou é estado do mapa que todos veem?** O inventário abaixo é a classificação canônica por superfície de UI. Errar o lado é o bug mais comum de feature nova: ou o usuário sobrescreve a visão dos pares sem querer, ou uma configuração que deveria ser do mapa morre no cliente.

### Compartilhado (vira operação, LWW por ordem de chegada)

| Controle na UI | Como viaja | Escopo |
|---|---|---|
| Seletor de camada base | `baseLayer` (sub-entidade de mapa) | mapa |
| Grade Lat/Long ou UTM, e desligar a grade | `gridStyle` → `{ format, visible }` | mapa |
| Salvar / limpar posição do mapa (centro, zoom, bearing, pitch) | `mapPosition` | mapa |
| Notas do mapa (rich text) | `mapNotes` → `{ title, description }` | mapa |
| Ativar controle temporal, unidade, modo, limites, origem | `mapTemporal` | mapa |
| Visibilidade e bloqueio de camada, ordem de renderização | op `layer` | mapa |
| Visibilidade (`visivel`) e bloqueio (`bloqueado`) de feição, inclusive em lote | op `feature` por feição | mapa |
| Visibilidade/remoção de camada do catálogo e de camada de análise | op `catalogLayer` (ou array legado em `maps.catalog_layers`) | mapa |
| Visibilidade e bloqueio de grupo (propaga às feições) | op `group` | mapa |
| Ordem dos mapas, cores de badge, ícones customizados, exagero de terreno | op `setting` (`mapOrder`, `mapBadgeColors`, `customIcons`, `terrainExaggeration`) | **atlas**, não mapa |

Duas armadilhas de escopo nessa tabela: **exagero de terreno é atlas-wide** (`atlas.settings.terrainExaggeration`), então mudá-lo em um mapa muda em todos; e **visibilidade de feição/camada não é preferência de visualização**, é propriedade persistida — esconder uma camada esconde para todo mundo no atlas.

### Local por usuário (nunca vira operação, por design)

| Controle na UI | Observação |
|---|---|
| Camada ativa (radio na aba Camadas) | cada usuário recebe suas feições novas na própria camada ativa |
| Seleção de feições, multi-seleção, zoom para seleção | espelhada como *awareness*, não como dado ([[presenca-colaborativa]]) |
| Ferramenta ativa, geometria em construção, cancelar com Escape | só o resultado ao concluir vira `feature` |
| Snap ligado/desligado (G) | preferência de desenho |
| Medições efêmeras de distância/área/ângulo (J/H/X) | só sincroniza se o usuário usar "Salvar como feição" |
| Cursor temporal, play/pause, velocidade, modo revelar | ver [[modulo-temporal]] |
| Toggle de terreno, de visualizador 3D e de visualizador 360 | modo de visualização; o *conteúdo* 3D/360 sincroniza, a exibição não |
| Formato de coordenadas (DD/DMS/MGRS/UTM), toggle de elevação e de zoom | display do canto inferior esquerdo |
| Expandir/colapsar camada, grupo, tileset, foto 360 | estado de árvore |
| Tabela de atributos: ordenação, busca, chips de tipo, "apenas selecionados", hover, tamanho do painel | filtro visual; edição de célula é que vira `feature` |
| Navegação da apresentação de briefing e o lock temporário (`setBriefingLockOverride`) | quem apresenta não trava o mapa dos outros |
| Configuração de exportação (PDF, DPI, escala, elementos cartográficos, bbox do Garmin KMZ) e deep-links copiados | nada disso toca o atlas |
| Pan, zoom, rotação, pitch, mapa ativo | navegação; o mapa ativo aparece só como presença |

Regra para código novo: se o controle responde "o que **eu** estou olhando", ele é local e não deve chamar nenhum `logXxxOperation`; se responde "como o mapa **é**", ele precisa de um `EntityType` e de um `case` inbound. Estado local que escapa para `logSettingOperation` é descartado no pré-flush pelo guard de `setting` não-UUID, silenciosamente.

## Fontes
- guia *05-sync-crdt* (absorvido): tabela de targets/EntityTypes, sub-entidades de mapa e colunas, mapeamento de aliases 3D/360 para `data_type`, dual-mode do `catalogLayer`, exemplos de payload por tipo, tolerância de shape do store real.
- guia *03-sync-inicial* (absorvido): formato do snapshot e o `getStoreForEntityType` de referência (inclui `group_feature` e `catalog_layer`, que o frontend não emite).
- guia *arquitetura-sync* (absorvido): lista canônica do `EntityType`, `ENTITY_TYPE_MAP`/`REVERSE_ENTITY_TYPE_MAP`, `tableMap` do backend, lock gate por alvo filho, regras de create/update/delete/setting, reagrupamento hierárquico 3D/360 no snapshot.
- `src/js/store/sync/operation-types.js`: enum congelado e validadores.
- `src/js/store/sync/operation-dispatcher.js`: guards de preflush, as três famílias de logger, `logAtlasSetting`.
- `src/js/store/sync/remote-operation-handler.js`: switch de roteamento inbound, `CONVERGENCE_GUARDED`, no-op do `slide`.
- `src/js/store/temporal.operations.js`: emissão real da op `mapTemporal` (contradiz o guia 05).
- `src/js/store/briefing.operations.js`: ops de `slide` com `briefingId` no slot `mapId`.
- `src/js/store/sync/permission-guard.js`: `comment` como única entidade com degrau de permissão próprio.
- `src/js/store/sync/operation-queue.js`: chave de compactação `entityType:entityId`.
