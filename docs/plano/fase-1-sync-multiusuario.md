# Fase 1 — Sync multiusuário: modelo de conflito, idempotência e sub-entidades

> **✅ STATUS: IMPLEMENTADA** (T1 crdt removido; T2 idempotência [via Fase 0]; T3 gridStyle;
> T4 catalogLayer dual-mode [tabela `catalog_layers`]; T5 temporal_config [gated]; T6 merge atômico
> de mapas; T7 ack `results[]`; T9 monitor de qualidade; T10 vocabulário de papéis. T8 viewport =
> limitação documentada (bbox materializado sob demanda); T11 locked enforcement = **não** feito
> (advisory por design)). Migrações `007_map_grid_style`, `008_catalog_layers`, `009_map_temporal_config`.
> Suite verde (590 casos). Decisão D2: LWW-por-chegada + idempotência (CLAUDE.md corrigido; `src/crdt`
> e 4 testes removidos).
> **Depende de:** [fase-0 (Hardening)](fase-0-hardening.md) concluída.
> **Esforço:** Alto.
> **Leia antes:** [`_padroes.md`](_padroes.md) (template de módulo, migração, DoD) e
> [`00-visao-geral.md`](00-visao-geral.md) (decisão D2, glossário, princípios).

---

## 1. Objetivo e contexto

Fechar os gaps do **motor de sync** para uso multiusuário real. Hoje o motor:

- aplica operações **na ordem de chegada** ao Postgres (LWW por chegada), **não por timestamp**;
- **não tem idempotência** — reenviar a mesma op (reconexão WS / retry offline) duplica a escrita;
- tem **aliases mortos**: `gridStyle` é no-op silencioso, `catalogLayer` por-camada não bate em coluna;
- **não persiste** `op.id` do cliente, então os acks não permitem dedupe confiável;
- **não tem** merge atômico de mapas nem carregamento por viewport.

Esta fase decide o modelo de conflito (D2), implementa idempotência por `op.id`, conserta
`gridStyle`/`catalogLayer`, prepara `temporal_config` (gated), adiciona merge atômico de mapas,
ack por operação no batch, viewport loading (com caveat honesto sobre PostGIS), monitor de
qualidade adaptativo no WS e o alinhamento do vocabulário de papéis.

**Fatos verificados do código atual (fonte de verdade):**

- `src/crdt` (resolver/merger LWW por `timestamp`+`clientId`) é **código morto**: nenhum
  `import ... from '.../crdt'` existe em `src/` (só `tests/` e docs). `applyOperation`
  (`src/modules/sync/sync.service.js:815-1004`) nunca chama `resolveLWW`/`mergeUpdate`.
- `buildDynamicUpdate` (`sync.service.js:66-92`) sempre faz `version = version + 1`,
  `updated_at = NOW()` **incondicionalmente** (linha 87), sem comparar `client_timestamp`
  → LWW por ordem de chegada.
- CREATEs usam `ON CONFLICT (id) DO NOTHING` (ex. `sync.service.js:847`).
- `INSERT_OPERATION` (`sync.queries.js:3-7`) **não** insere `op.id` do cliente; a PK é
  `gen_random_uuid()` do servidor (`003_sync.sql:10`). Sem `UNIQUE` de idempotência.
- Acks usam `rawOp.id` (`sync.service.js:464-467`), que **nunca é persistido**.
- `ENTITY_TYPE_MAP` (`sync.service.js:10-22`): `gridStyle → {target:'map', subType:'grid'}`,
  `catalogLayer → {target:'map', subType:'catalog'}`. `mapPosition`/`baseLayer`/`mapNotes` funcionam.
- `MAP_UPDATE_FIELDS` (`sync.service.js:654-667`): `name, base_layer, center_lat, center_long,
  zoom, bearing, pitch, notes_title, notes_description, analysis_layers(jsonb),
  catalog_layers(jsonb), locked` — **sem** `grid_style` nem `temporal_config`.
- `gridStyle`: nenhuma chave de `{format,visible}` bate em `MAP_UPDATE_FIELDS` →
  `buildDynamicUpdate` retorna `null` (linha 85) = **no-op silencioso**. `maps` não tem coluna
  de grade (`002_atlas.sql:71-97`).
- `catalogLayer`: `MAP_UPDATE_FIELDS:665` espera o **array inteiro** `catalog_layers`, mas a op
  chega com `entityId = layerId` e `data` = um objeto único → no-op. Sem branch de merge por-id.
- `UPDATE_FIELDS.feature` (`sync.service.js:597-604`) inclui `map_id` → **mover feição entre
  mapas funciona** via update: `op.mapId = ORIGEM` (no `WHERE`), `changes.map_id = DESTINO`.
- WS handlers (`collab.handlers.js`) fazem broadcast das ops **cruas** recebidas.
- `operations.entity_type` **sem CHECK** (`003_sync.sql:15`) — aceita aliases.
- `permission` por-atlas resolvida em `collab.gateway.js:104` e exposta no `connected`
  (`collab.gateway.js:172-178`); `atlas_shares.permission CHECK IN ('read','write')`
  (`002_atlas.sql:58`).
- **Bug pré-existente** no controller: `sync.controller.js:15-19` faz broadcast de
  `result.applied`, mas `pushOperations` retorna `{ acks, serverVersion }` (`sync.service.js:478`)
  — `result.applied` é `undefined`, então cai no fallback `req.body.operations`. Corrigido na Tarefa 7.

---

## 2. Pré-requisitos / dependências de outras fases

- **fase-0** concluída: o `POST /sync` passa a ter `validate({ body: pushSchema })` (gap conhecido,
  ver `_padroes.md` §3). Esta fase **estende** esse schema (Tarefas 3, 4, 7). Confirme que a
  Tarefa de validação de `/sync` da fase-0 existe antes de começar a Tarefa 3 aqui.
- **fase-0 Tarefa 11 (idempotência) concluída — é a fonte canônica do schema de idempotência.**
  A fase-0 já criou a migração `006_operations_idempotency.sql` com a coluna `op_id TEXT`, o backfill
  `op_id = id::text` e o índice `UNIQUE (atlas_id, op_id)`, e já alterou `INSERT_OPERATION` para
  `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *`. **Esta fase NÃO cria nova migração de
  idempotência nem nova coluna** — a Tarefa 2 abaixo apenas **consome** `op_id` e detalha a
  semântica de ack/retry. Não introduza `client_operation_id` (coluna concorrente) nem índice parcial.
- Migração head após fase-0 = `006_operations_idempotency.sql`. As novas migrações desta fase começam
  em `007_` (grade) → `008_` (catalog_layers).

Nenhuma dependência de fase-2/3/5. Esta fase pode correr em paralelo com elas.

---

## 3. Decisões de arquitetura aplicáveis

### D2 — Modelo de conflito (DECISÃO DESTA FASE)

**Recomendação: ramo (b) — assumir LWW-por-chegada + idempotência por `op.id`, e remover/arquivar
`src/crdt` morto.**

- **Ramo (a) — plugar `src/crdt`:** em `applyOperation`, antes de cada UPDATE, comparar o
  `client_timestamp` da op nova com o `updated_at`/`version` da linha-alvo via `resolveLWW`
  (`src/crdt`), descartando a op se for "mais velha". Justifica-se **só** se LWW-por-timestamp for
  requisito real de produto (ex.: ordenar edições concorrentes por relógio do cliente). Custo:
  reescrever `buildDynamicUpdate` para condicionar o UPDATE, lidar com clock skew entre clientes,
  e manter o módulo `crdt` vivo e testado no caminho quente.
- **Ramo (b) — recomendado:** manter LWW por ordem de chegada (a última escrita a tocar o Postgres
  vence). É **suficiente para feições** (objetos pequenos, edição concorrente rara na mesma feição;
  o protótipo chegou à mesma conclusão). **Remover** `src/crdt` e seus testes (ou movê-los para
  `docs/arquivado/`), e **corrigir o CLAUDE.md** que hoje afirma "Timestamp como comparador
  principal" — factualmente incorreto.

A idempotência por `op.id` (coluna `op_id`, schema criado na fase-0 Tarefa 11; semântica de ack/retry
detalhada na Tarefa 2) é **independente** do ramo escolhido e é obrigatória nos dois.

**Lib vs próprio (registrado, não reabrir):** MANTER o LWW + log append-only por `server_version`
do EBGeo. **NÃO** adotar Yjs/Automerge — brilham em texto colaborativo (merge caractere-a-caractere),
não em feição geográfica com atributos JSONB. Ressalva: um campo específico de **texto livre longo**
com merge fino justificaria um CRDT de texto isolado naquele campo — fora de escopo aqui.

### Locking advisory (princípio transversal §2 do `00-visao-geral.md`)

`locked` (mapa/camada/grupo/feição) é **advisory por design** — o servidor nunca rejeita escrita por
entidade travada. Há uma tarefa **opcional** (Tarefa 11) de enforcement server-side, marcada como
decisão consciente; o default permanece advisory.

### Vocabulário de papéis

O frontend usa `UserRole = {owner, admin, editor, viewer}`. O backend tem `role ∈ {user, admin}`
(global, no JWT) + permissão **por-atlas** `owner/write/read`. Mapeamento (camada de
serviço/WS, **sem migrar dados**): `owner→owner`, `write→editor`, `read→viewer`,
`role global admin→admin`. Exposto no campo `permission` do `connected` (Tarefa 10).

---

## 4. Tarefas

> Ordem de migrações: a idempotência (`006_operations_idempotency.sql`) **já foi criada na fase-0
> Tarefa 11** — não recriar aqui. As migrações novas desta fase são `007 grid_style` →
> `008 catalog_layers` (e a de `temporal_config`, se incluída, numerada após 008).

---

### Tarefa 1: Decidir D2 e remover o `crdt` morto + corrigir docs

**Objetivo:** Registrar a decisão D2 (ramo b), eliminar o código morto `src/crdt` e corrigir a
documentação que afirma comportamento inexistente.

**Arquivos afetados:**
- `src/crdt/` (remover, ou mover para `docs/arquivado/crdt-legado/`) — **4 arquivos**:
  `resolver.js`, `merger.js`, `operations.js`, `index.js`.
- **TODOS os 4 testes que importam de `src/crdt/`** (verificado por `grep`):
  - `tests/unit/crdt-merger.test.js` (importa `merger.js`)
  - `tests/unit/crdt-resolver.test.js` (importa `resolver.js`)
  - `tests/unit/crdt-edge-cases.test.js` (importa `resolver.js`, `merger.js`, `operations.js`)
  - `tests/unit/sync-operations.test.js` (importa `resolver.js`, `merger.js`, `operations.js` —
    inclui `VALID_OP_TYPES`, `VALID_TARGETS`, `validateOperation`, `createOperation`)
- `CLAUDE.md` (modificar — seção "## CRDT" + tabela de testes)
- `docs/plano/00-visao-geral.md` (já reflete; só confirme)

**Padrão de código:** N/A (remoção). Confirme zero imports em `src/` antes de remover.

**Decisão sobre `sync-operations.test.js`:** ele testa **dois grupos** de coisas — (a) LWW/merge
puro (`resolveLWW`/`mergeUpdate`), que morre com o `crdt`; e (b) a **validação/criação de operação**
(`validateOperation`/`createOperation`/`VALID_OP_TYPES`/`VALID_TARGETS`). O grupo (b) **não** reflete
o caminho real do sync — o service usa `normalizeOperation`/`pushSchema` (Joi, fase-0 Tarefa 4), não
`src/crdt/operations.js`. Portanto: **arquivar o arquivo inteiro junto com `src/crdt`** (sua
cobertura útil de validação é substituída pelo schema Joi `pushSchema` e pelos testes de
`tests/integration/sync*.test.js`). Não recriar `validateOperation`/`createOperation` — são código
morto do mesmo módulo.

**Implementação:**
1. Confirme que `src/crdt` é morto: `grep -rn "crdt" src/` deve achar matches **só** em
   `src/crdt/*` (autorreferência). Nenhum `src/modules/**` importa. Confirme também que nenhum teste
   além dos 4 listados importa de `src/crdt` (`grep -rn "from '.*crdt" tests/`).
2. Remova `src/crdt/` (4 arquivos, incluindo `operations.js`) e os **4 testes** acima.
3. Em `CLAUDE.md`, na seção `## CRDT`, substitua:
   - "Timestamp como comparador principal" / "ClientId como tiebreaker" →
     "**LWW por ordem de chegada** ao Postgres. Não há comparação de timestamp do cliente no
     caminho de escrita. Idempotência por `op.id` evita reaplicação de ops reenviadas."
4. Atualize a tabela de testes do `CLAUDE.md`: remove `crdt-merger`, `crdt-resolver` **e**
   `sync-operations` da categoria **Unit** (o `CLAUDE.md` lista `sync-operations` como unit) — passa
   de **4 para 1 arquivo unit** (resta `permission-resolver`). Ajuste a contagem de "25 arquivos de
   teste" no `CLAUDE.md` de acordo (remoção de 4 arquivos → 21).

**Critérios de aceitação:**
- [ ] `grep -rn "from '.*crdt" src/` retorna 0 linhas.
- [ ] `grep -rn "from '.*crdt" tests/` retorna 0 linhas (os 4 testes foram removidos/arquivados).
- [ ] `npm test` passa sem os testes de crdt (nenhum teste importa módulo inexistente).
- [ ] `CLAUDE.md` não afirma mais "Timestamp como comparador principal"; a tabela de testes lista 1
      arquivo unit e a contagem total foi ajustada.

**Testes:** nenhum novo; garantir que a suíte fica verde após a remoção (sem import órfão de
`src/crdt`).

**Dependências:** nenhuma (mas faça antes de mexer em `applyOperation` para evitar confusão).

---

### Tarefa 2: Idempotência por `op.id` — consumir `op_id` (schema da fase-0; sem nova migração)

**Objetivo:** Tornar o push idempotente: reenviar a mesma operação (mesmo `op.id` do cliente) não
duplica a linha em `operations` nem reaplica o efeito em `applyOperation`. Pré-requisito de
reconexão WS e retry offline.

> **Fonte canônica do schema (NÃO recriar):** a coluna `op_id TEXT`, o backfill `op_id = id::text`,
> o índice `UNIQUE (atlas_id, op_id)` e o `INSERT_OPERATION` com `ON CONFLICT (atlas_id, op_id) DO
> NOTHING RETURNING *` **já foram entregues na fase-0 Tarefa 11** (migração
> `006_operations_idempotency.sql`). Esta tarefa **não cria migração nem coluna nova**. **Não**
> introduza `client_operation_id` nem índice parcial — essa era uma especificação concorrente e foi
> descartada em favor do `op_id`/índice total da fase-0. Esta tarefa apenas **consome** `op_id`,
> estende a query `GET_OPERATION_BY_OP_ID` (já criada na fase-0) e define o contrato de ack
> idempotente que a Tarefa 7 (`results[]`) consome.

**Arquivos afetados:**
- `src/modules/sync/sync.service.js` (modificar `pushOperations`, `toFrontendOperation`)
- `src/modules/sync/sync.queries.js` (apenas se `GET_OPERATION_BY_OP_ID` ainda não existir — a
  fase-0 já a adiciona; não duplicar)

**Padrão de código:** `tx()` (§4); SQL nomeado (§1). Sem nova migração (a de idempotência é a `006`
da fase-0).

**Implementação:**

1. **Schema — já entregue pela fase-0** (não repetir). Confirme que existem:
   - coluna `operations.op_id TEXT` + índice `UNIQUE (atlas_id, op_id)` (migração `006`);
   - `INSERT_OPERATION` com `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *`;
   - query `GET_OPERATION_BY_OP_ID` em `sync.queries.js`.

   Forma do `INSERT_OPERATION` (referência — definido na fase-0, **não recriar**):

```sql
-- sync.queries.js (já definido na fase-0 Tarefa 11)
INSERT INTO operations
  (atlas_id, op_type, entity_type, entity_id, map_id, changes, data,
   client_timestamp, client_id, user_id, op_id)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
ON CONFLICT (atlas_id, op_id) DO NOTHING
RETURNING *
```

> O índice é **total** (não parcial). Ops legadas sem `op.id` recebem `op.id` do cliente como `$11`;
> se vier `null`, passe um id estável do servidor para `$11` (ou mantenha a tolerância da fase-0,
> que faz backfill `op_id = id::text`). Não reintroduza índice parcial nem coluna UUID.

2. **`pushOperations`** — usar `oneOrNone` (não `one`), persistir `rawOp.id` como `op_id`, e **pular
   `applyOperation`** quando nada retorna (duplicata). Quando duplicado, buscar a versão já
   registrada via `GET_OPERATION_BY_OP_ID` para o ack carregar a `server_version` correta:

```javascript
// sync.service.js — pushOperations (trecho do loop)
for (const rawOp of operations) {
  const op = normalizeOperation(rawOp);

  const inserted = await t.oneOrNone(Q.INSERT_OPERATION, [
    atlasId, op.type, op.target, op.targetId, op.mapId || null,
    op.changes ? JSON.stringify(op.changes) : null,
    op.data ? JSON.stringify(op.data) : null,
    op.timestamp, op.clientId, userId,
    rawOp.id || null,          // op_id (chave de idempotência; coluna da fase-0)
  ]);

  if (!inserted) {
    // Duplicata: já aplicada num envio anterior. Ack idempotente, sem reaplicar.
    const prev = await t.oneOrNone(Q.GET_OPERATION_BY_OP_ID, [atlasId, rawOp.id]);
    acks.push({ opId: rawOp.id, serverVersion: prev?.server_version, idempotent: true });
    continue;
  }

  acks.push({ opId: rawOp.id, serverVersion: inserted.server_version, idempotent: false });
  await applyOperation(t, atlasId, op);
}
```

3. Em `toFrontendOperation`, exponha `opId: op.op_id` (opcional, ajuda o cliente a casar ops no
   pull). Não quebra o contrato (campo aditivo).

**Critérios de aceitação:**
- [ ] Enviar a mesma op (`op.id` igual) duas vezes cria **uma** linha em `operations`.
- [ ] O segundo envio retorna `{ opId, idempotent: true }` e **não** incrementa `version` da
      entidade-alvo (não reaplica).
- [ ] Ops sem `op.id` (legado) ainda funcionam (backfill/`op_id` da fase-0, sem conflito).
- [ ] `server_version` continua monotônico; pull incremental inalterado.
- [ ] **Nenhuma migração nova de idempotência** é criada nesta fase (a `006` da fase-0 é a única).

**Testes:**
- `tests/integration/sync-idempotency.test.js`:
  - push de op de create → reenvio idêntico → contar linhas em `operations` (=1) e `version` da
    feição (não muda no 2º envio).
  - push de batch com uma op repetida no meio → só ela é dedupada, as outras aplicam.
  - op sem `id` ainda persiste.

**Dependências:** **fase-0 Tarefa 11 concluída** (schema de idempotência). Tarefa 1 recomendada
(não obrigatória).

---

### Tarefa 3: `gridStyle` — coluna `grid_style` + field map + snapshot

**Objetivo:** Persistir o estilo de grade UTM por mapa. Hoje a op `gridStyle` é no-op silencioso.

**Envelope do frontend (preservar verbatim — mesmo envelope do `baseLayer`):**
```javascript
{
  entityType: 'gridStyle',
  operationType: 'create' | 'update',
  entityId: <mapId>,           // == mapId (sub-entidade do mapa)
  mapId:    <mapId>,
  data: { format: 'latlong' | 'utm', visible: true }
}
```

**Arquivos afetados:**
- `src/database/migrations/007_map_grid_style.sql` (criar)
- `src/modules/sync/sync.service.js` (modificar `MAP_UPDATE_FIELDS`, `normalizeMapChanges`)
- `src/modules/sync/sync.queries.js` (modificar `GET_ATLAS_MAPS`)

**Padrão de código:** migração aditiva (§7); whitelist de coluna em SQL dinâmico (§8).

**Implementação:**

1. **Migração 007** (a `006` é a idempotência da fase-0):
```sql
-- Path: src/database/migrations/007_map_grid_style.sql
ALTER TABLE maps
  ADD COLUMN grid_style JSONB NOT NULL DEFAULT '{}';
```

2. **`MAP_UPDATE_FIELDS`** (`sync.service.js:654-667`) — adicionar a entrada. O `gridStyle` chega via
   `op.data` (`{format,visible}`); o objeto inteiro vai para a coluna JSONB. Como `op._subType ==
   'grid'`, o roteamento `target === 'map'` em `buildUpdateQuery` já usa `op.mapId`. Precisa-se de
   um alias em `normalizeMapChanges` que coloque o objeto `data` inteiro sob a chave `grid_style`:

```javascript
const MAP_UPDATE_FIELDS = [
  // ... campos existentes ...
  { column: 'locked' },
  { column: 'grid_style', jsonb: true },   // NOVO
];
```

```javascript
// normalizeMapChanges — adicionar, no fim, antes do return:
function normalizeMapChanges(changes, subType) {
  const normalized = { ...changes };
  // ... aliases existentes (base_layer, notes_title, notes_description) ...

  // gridStyle: o payload {format,visible} é o objeto da coluna grid_style.
  if (subType === 'grid' && normalized.grid_style === undefined) {
    normalized.grid_style = { format: changes.format, visible: changes.visible };
  }
  return normalized;
}
```

> O `subType` precisa chegar a `normalizeMapChanges`. Em `buildUpdateQuery` (`target === 'map'`),
> passe `op._subType`: `normalizeMapChanges(merged, op._subType)`. Como `merged = {...op.changes,
> ...op.data}`, `format`/`visible` já estão em `merged`.

3. **Snapshot** — incluir `grid_style` em `GET_ATLAS_MAPS` (`sync.queries.js:35-42`):
```sql
SELECT id, name, base_layer, center_lat, center_long, zoom, bearing, pitch,
       notes_title, notes_description, analysis_layers, catalog_layers,
       grid_style, locked, created_at, updated_at, version
FROM maps
WHERE atlas_id = $1 AND deleted_at IS NULL
ORDER BY created_at
```

4. **INSERT de map** em `applyOperation` (`sync.service.js:896-915`): adicionar `grid_style` ao
   INSERT (`data.grid_style || {}`), para que criação de mapa por op preserve a grade.

**Critérios de aceitação:**
- [ ] Op `gridStyle` com `data:{format:'utm',visible:true}` grava em `maps.grid_style` e incrementa
      `version`.
- [ ] O snapshot retorna `grid_style` no objeto do mapa.
- [ ] Op `gridStyle` em mapa inexistente não derruba o batch (UPDATE sem linha = no-op silencioso,
      como hoje).

**Testes:**
- `tests/integration/sync-map-ops.test.js` (estender): push `gridStyle` → pull snapshot → asserta
  `grid_style`. Caso `format:'latlong', visible:false`.

**Dependências:** Tarefa 2 (para que o ack reflita idempotência) — recomendado, não bloqueante.

---

### Tarefa 4: `catalogLayer` por-camada — tabela dedicada `catalog_layers`

**Objetivo:** Tratar `catalogLayer` como **entidade própria** com create/update/delete por id. Hoje
o backend espera o array inteiro em `maps.catalog_layers`, mas o frontend emite uma op **por
camada** → no-op.

**Envelope do frontend (preservar verbatim — op POR camada):**
```javascript
{
  entityType: 'catalogLayer',
  operationType: 'create' | 'update' | 'delete',
  entityId: <layerId UUID>,    // id da camada do catálogo
  mapId:    <mapId>,
  data: { id, type, name, visible, opacity, status, config, styleOverrides, sync }
}
```

**Decisão A vs B:**
- **Ramo A (merge no array JSONB):** manter `maps.catalog_layers` e fazer merge por `id` via
  `jsonb_set`/`||` (create/update = upsert no array; delete = filtra o id). Menos migração, mas SQL
  de array JSONB frágil e sem `version`/soft-delete por camada.
- **Ramo B — RECOMENDADO (tabela dedicada):** tabela `catalog_layers(id PK, map_id FK CASCADE,
  data JSONB, version, deleted_at)` com soft-delete e snapshot por id. Consistente com o resto do
  domínio (features/groups/layers seguem esse modelo).

**Arquivos afetados (ramo B):**
- `src/database/migrations/008_catalog_layers.sql` (criar)
- `src/modules/sync/sync.service.js` (`ENTITY_TYPE_MAP`, `applyOperation`, `UPDATE_FIELDS`,
  `buildUpdateQuery`, `buildSoftDeleteQuery`, `tableMap`, snapshot)
- `src/modules/sync/sync.queries.js` (query de snapshot por mapa)

**Padrão de código:** tabela mutável com soft-delete + `version` (§7); roteamento próprio em
`applyOperation` (modelo das outras entidades com `op.mapId`).

**Implementação (ramo B):**

1. **Migração 008:**
```sql
-- Path: src/database/migrations/008_catalog_layers.sql
CREATE TABLE catalog_layers (
    id          UUID PRIMARY KEY,           -- id da camada vem do cliente (não gerar no banco)
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    data        JSONB NOT NULL DEFAULT '{}',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_catalog_layers_map ON catalog_layers(map_id) WHERE deleted_at IS NULL;
```

2. **`ENTITY_TYPE_MAP`** — `catalogLayer` deixa de ser sub-entidade de `map` e vira target próprio:
```javascript
catalogLayer: { target: 'catalog_layer' },   // (remover o {target:'map', subType:'catalog'})
```

3. **`tableMap`** em `applyOperation` (`sync.service.js:820-832`): `catalog_layer: 'catalog_layers'`.

4. **CREATE** em `applyOperation` (novo branch, modelo do cesium3d em `sync.service.js:948-960`):
```javascript
} else if (target === 'catalog_layer' && op.data && op.mapId) {
  await t.none(`
    INSERT INTO catalog_layers (id, map_id, data)
    VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [op.targetId, op.mapId, JSON.stringify(op.data)]);
}
```

5. **UPDATE** — `UPDATE_FIELDS.catalog_layer = [{ column: 'data', jsonb: true }]` e branch em
   `buildUpdateQuery` (modelo do cesium3d, `sync.service.js:760-765`):
```javascript
if (target === 'catalog_layer' && op.changes && op.mapId) {
  // O frontend manda o objeto inteiro da camada; grave-o como data.
  return buildDynamicUpdate(
    'catalog_layers', { data: op.changes }, UPDATE_FIELDS.catalog_layer,
    [op.targetId, op.mapId], 'id = $1 AND map_id = $2',
  );
}
```
> Se o frontend enviar `data` (não `changes`) no update, normalize antes:
> `const changes = op.changes ?? op.data`. Documente o que o frontend manda e teste o caso real.

6. **DELETE** — `catalog_layer` entra na lista de soft-delete por `map_id` em
   `buildSoftDeleteQuery` (`sync.service.js:785`):
```javascript
if (['feature', 'group', 'layer', 'cesium3d', 'streetview360', 'catalog_layer'].includes(target) && op.mapId) {
```

7. **Snapshot** — nova query `GET_MAP_CATALOG_LAYERS` e inclusão no loop de `getAtlasSnapshot`
   (`sync.service.js:348-410`). Retorne array de `{ id, ...data, sync }`:
```sql
-- sync.queries.js
export const GET_MAP_CATALOG_LAYERS = `
  SELECT id, map_id, data, created_at, updated_at, version
  FROM catalog_layers
  WHERE map_id = $1 AND deleted_at IS NULL
`;
```
```javascript
// getAtlasSnapshot, dentro do for (const map of maps):
const rawCatalog = await t.query(Q.GET_MAP_CATALOG_LAYERS, [map.id]);
map.catalogLayers = rawCatalog.map((c) => ({ id: c.id, ...c.data, sync: buildSyncMetadata(c) }));
```
> **Cuidado de contrato:** `maps.catalog_layers` (coluna JSONB legada) ainda existe e ainda é
> retornada por `GET_ATLAS_MAPS`. Decida com o frontend se `catalogLayers` (novo, por-id) substitui
> `catalog_layers` (array legado) no snapshot, ou se coexistem durante a transição. **Não remova a
> coluna legada nesta fase** (migração destrutiva). Mantenha ambos até o frontend migrar.

**Critérios de aceitação:**
- [ ] Op `catalogLayer` create grava uma linha em `catalog_layers` com `id == entityId`.
- [ ] Update por id altera só aquela camada; delete faz soft-delete (some do snapshot).
- [ ] Snapshot expõe `map.catalogLayers` como array por-id.
- [ ] A coluna legada `maps.catalog_layers` continua existindo (não quebrar import/clone).

**Testes:**
- `tests/integration/sync-catalog-layer.test.js` (criar): create 2 camadas → update 1 → delete 1 →
  snapshot tem 1 ativa; idempotência de create (Tarefa 2) cobre reenvio.

**Dependências:** Tarefa 2 (idempotência). Pode rodar após a 3.

---

### Tarefa 5: `temporal_config` por mapa (GATED — sem urgência)

**Objetivo:** Preparar a persistência da config temporal por mapa **quando** o frontend passar a
emitir a op de sync. Hoje o frontend é **local-only** (emite só EventBus
`MAP_TEMPORAL_CHANGED`/`TEMPORAL_CONFIG_CHANGED`, sem op de sync) — implemente, mas marque como
gated/não-ativado.

**Payload (preservar verbatim — escopo `temporal_<mapa>`):**
```javascript
{
  ativo: false,
  unidade: 'MINUTO' | 'HORA' | 'DIA' | 'SEMANA',
  inicio: <epoch ms | null>,
  fim:    <epoch ms | null>,
  modo:   'absoluto' | 'relativo',
  origem: <epoch ms | null>
}
```

**Arquivos afetados:**
- `src/database/migrations/00X_map_temporal_config.sql` (criar — numerar após 008)
- `src/modules/sync/sync.service.js` (`ENTITY_TYPE_MAP`, `MAP_UPDATE_FIELDS`, `normalizeMapChanges`)
- `src/modules/sync/sync.queries.js` (`GET_ATLAS_MAPS`)

**Implementação:**
1. Migração: `ALTER TABLE maps ADD COLUMN temporal_config JSONB NOT NULL DEFAULT '{}';`
2. `ENTITY_TYPE_MAP`: `mapTemporal: { target: 'map', subType: 'temporal' }`.
3. `MAP_UPDATE_FIELDS`: `{ column: 'temporal_config', jsonb: true }`.
4. `normalizeMapChanges` (mesmo padrão da grade): se `subType === 'temporal'`, montar
   `normalized.temporal_config = { ativo, unidade, inicio, fim, modo, origem }` a partir de `data`.
5. Incluir `temporal_config` em `GET_ATLAS_MAPS` e no INSERT de map.

**Critérios de aceitação:**
- [ ] Op `mapTemporal` (quando emitida) grava em `maps.temporal_config` e aparece no snapshot.
- [ ] Sem op emitida, comportamento inalterado (coluna default `{}`).

**Dados temporais POR FEIÇÃO já funcionam de graça (não confundir com este gap):**
`temporalInicio`, `temporalFim`, `trajetoria [{t,lng,lat}]`, flags
`autoDtg`/`autoDirection`/`autoSpeed`, `dateTimeGroup`, `gdhIni`/`gdhFim` viajam dentro de
`data.properties.*` numa op `feature` normal e são gravados **verbatim** no JSONB. Nada a fazer.

**Testes:**
- `tests/integration/sync-map-ops.test.js` (estender): push `mapTemporal` → snapshot tem
  `temporal_config`.

**Dependências:** Tarefa 3 (mesmo padrão de sub-entidade de mapa). Prioridade P2 — pode ficar por
último.

---

### Tarefa 6: Merge atômico de mapas

**Objetivo:** Endpoint que move feições de **múltiplos** mapas-origem para um mapa-destino numa
**transação única**. Contorno atual (batch de ops `feature` com `map_id` novo) funciona mas **não é
atômico**.

**Contrato:**
```
POST /api/v1/atlas/:atlasId/maps/:mapId/merge
body: { sourceMapIds: [UUID, ...] }   // :mapId é o destino
→ 200 { data: { movedFeatures, movedGroups, movedLayers, ... } }
```
Permissão: `write`. Broadcast WS após a transação.

**Arquivos afetados:**
- `src/modules/maps/maps.routes.js` (modificar — add rota POST; o módulo hoje é só GET)
- `src/modules/maps/maps.controller.js` (add `mergeMaps`)
- `src/modules/maps/maps.service.js` (add `mergeMaps` com `tx()`)
- `src/modules/maps/maps.queries.js` (queries de move)
- `src/modules/maps/maps.schemas.js` (criar — `mergeMapsSchema`)

**Padrão de código:** controller com broadcast (`_padroes.md` §1, `atlas.controller.js` padrão de
mutação); `tx()` (§4). O módulo `maps` deixa de ser estritamente read-only para esta operação
estrutural (documentar no header do arquivo).

**Implementação:**
1. Schema Joi: `mergeMapsSchema = Joi.object({ sourceMapIds: Joi.array().items(Joi.string().uuid()).min(1).required() })`.
2. Rota: `router.post('/:mapId/merge', auth, requireAtlasPermission('write'), validate({ body: schemas.mergeMapsSchema }), ctrl.mergeMaps);`
3. Service (`tx`): para cada `sourceMapId` (validando que pertence ao `atlasId`), reatribuir
   `map_id = :mapId` em `features`, `groups`, `layers`, `cesium3d_data`, `streetview360_data`,
   `catalog_layers` (apenas linhas `deleted_at IS NULL`), incrementando `version` e `updated_at`.
   Opcionalmente soft-deletar os mapas-origem ao final (decidir com o frontend; default: **não**
   deletar origem, apenas mover).
```javascript
// maps.service.js
export async function mergeMaps(atlasId, destMapId, sourceMapIds) {
  return tx(async (t) => {
    // garante destino e origens no mesmo atlas
    const dest = await t.oneOrNone(Q.FIND_MAP_FOR_UPDATE, [destMapId, atlasId]);
    if (!dest) throw new NotFoundError('Map');

    const counts = {};
    for (const table of ['features', 'groups', 'layers', 'cesium3d_data', 'streetview360_data', 'catalog_layers']) {
      const r = await t.result(
        `UPDATE ${table} SET map_id = $1, updated_at = NOW(), version = version + 1
         WHERE map_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [destMapId, sourceMapIds]
      );
      counts[table] = r.rowCount;
    }
    return counts;
  });
}
```
> `${table}` vem de uma **whitelist literal** no código (não de input) — seguro (`_padroes.md` §8).
4. Controller: chama o service, faz `broadcastToRoom(req.atlasId, { type: 'maps_merged', destMapId,
   sourceMapIds })`, responde `res.json({ data })`.

**Critérios de aceitação:**
- [ ] Feições/grupos/camadas dos mapas-origem passam a ter `map_id == destino`.
- [ ] É atômico: erro no meio reverte tudo (testar forçando falha).
- [ ] `sourceMapIds` de outro atlas → 404/403 (não move dado de outro atlas).
- [ ] Broadcast `maps_merged` emitido.

**Testes:**
- `tests/integration/maps-merge.test.js` (criar): 2 mapas com feições → merge → destino soma as
  feições; caso negativo: `sourceMapId` de outro atlas não move nada.

**Dependências:** Tarefa 4 (para mover `catalog_layers`). Se a 4 não estiver pronta, omita
`catalog_layers` da lista e adicione depois.

---

### Tarefa 7: Batch transacional com ack por operação

**Objetivo:** O `pushOperations` deve retornar um `results[]` com ack **por operação**, para o
cliente fazer dequeue confiável da fila offline. Também corrige o bug do broadcast
`result.applied` undefined (ver §1, fatos verificados).

**Contrato de retorno (preservar verbatim — do protótipo):**
```javascript
// resposta de POST /sync e do ack_batch no WS
{
  results: [
    { success: true,  operationId: '<op.id>', idempotent: false, currentVersion: 42 },
    { success: true,  operationId: '<op.id>', idempotent: true },            // já aplicada
    { success: false, operationId: '<op.id>', error: 'CONFLICT', currentVersion: 41 }
  ],
  serverVersion: 42
}
```

**Arquivos afetados:**
- `src/modules/sync/sync.service.js` (`pushOperations` → retornar `results`)
- `src/modules/sync/sync.controller.js` (corrigir broadcast; usar `results`)
- `src/modules/sync/sync.schemas.js` (criar `pushSchema` se a fase-0 não criou — coordenar)
- `src/modules/collab/collab.handlers.js` (`handleOperations`/`handleOperation` → repassar `results`)

**Padrão de código:** `_padroes.md` §1 (mutação com broadcast), §3 (validação na borda).

**Implementação:**
1. `pushOperations` passa a montar `results` no lugar de `acks` (campo `acks` pode ser mantido como
   alias durante transição, ou renomeado — coordene com o frontend). Cada entrada:
   `{ success: true, operationId: rawOp.id, idempotent, currentVersion: inserted?.server_version }`.
2. **Corrigir o controller** (`sync.controller.js:14-20`): o broadcast deve usar as **ops aceitas**,
   não `result.applied` (inexistente). Use as ops do `req.body.operations` filtradas pelos
   `results` com `success && !idempotent`, ou simplesmente faça broadcast das ops cruas recebidas
   (como os handlers WS já fazem). Responda `res.json({ data: result })` com `result.results`.
3. `handleOperations` (`collab.handlers.js:92-130`): trocar `ack_batch` para enviar
   `{ type: 'ack_batch', results: result.results, serverVersion: result.serverVersion }`.
   `handleOperation` idem com `{ type: 'ack', ...result.results[0] }`.

**Critérios de aceitação:**
- [ ] `POST /sync` retorna `data.results[]` com um item por op, com `idempotent` e `currentVersion`.
- [ ] Reenvio de op já aplicada → `{ success: true, idempotent: true }` (sem reaplicar — Tarefa 2).
- [ ] Broadcast WS de `operations` não envia `undefined`.
- [ ] WS `ack_batch` carrega `results`.

**Testes:**
- `tests/integration/sync.test.js` (estender): asserta shape de `results`; caso idempotente.
- `tests/ws/collab.test.js` (estender): `ack_batch.results` presente.

**Dependências:** Tarefa 2 (idempotência fornece o flag `idempotent`).

---

### Tarefa 8: Viewport loading (GET incremental por bounds) — com caveat PostGIS

**Objetivo:** Permitir ao cliente puxar só as feições dentro de um retângulo de viewport, para mapas
grandes. **Caveat honesto:** as feições do atlas são **JSONB sem PostGIS**, então o filtro espacial
server-side `ST_Intersects`/`ST_MakeEnvelope` **não está disponível** sem mudança estrutural.

**Decisão (declarar explicitamente):**
- **Caminho recomendado nesta fase:** **não** implementar filtro espacial no schema do atlas
  (manter JSONB puro, princípio "atlas é JSONB por design"). Em vez disso, **documentar a
  limitação** e oferecer um **filtro por bbox materializado** opcional (ver abaixo) **somente se**
  houver demanda de performance medida. Sem demanda, **manter a limitação**.
- **Caminho alternativo (bbox materializado, aditivo):** adicionar colunas
  `bbox_min_lng/min_lat/max_lng/max_lat DOUBLE PRECISION` em `features`, preenchidas no
  create/update da feição a partir da geometria GeoJSON (cálculo em JS no `applyOperation`), com
  índice composto. O GET por bounds vira um `WHERE bbox_min_lng <= :maxLng AND bbox_max_lng >=
  :minLng AND ...` (interseção de retângulos), sem PostGIS. Custo: backfill das feições existentes.
- **Caminho PostGIS (NÃO recomendado aqui):** exigiria `geometry GEOMETRY` no schema atlas →
  contradiz a arquitetura (atlas é JSONB). Fica para o schema `ng` (fase-3), que é PostGIS por
  natureza — mas o atlas não.

**Arquivos afetados (se optar pelo bbox materializado):**
- `src/database/migrations/00X_features_bbox.sql` (criar)
- `src/modules/sync/sync.service.js` (`applyOperation` create/update de feature → calcular bbox)
- `src/modules/sync/sync.queries.js` + novo endpoint `GET .../maps/:mapId/features?bounds=...`

**Implementação (caminho bbox materializado, resumo):**
1. Migração: `ALTER TABLE features ADD COLUMN bbox_min_lng DOUBLE PRECISION, ...` + índice.
2. Helper `computeBbox(geometry)` em JS (varre coordenadas GeoJSON). Chamar no INSERT/UPDATE de
   feature em `applyOperation`.
3. Endpoint read-only no módulo `maps`/`sync` que aceita `?minLng&minLat&maxLng&maxLat&limit` e
   retorna feições intersectantes, transformadas pelo `transformFeaturesToFrontend`.
4. Backfill: script único que recalcula bbox das feições existentes.

**Critérios de aceitação:**
- [ ] A limitação está **documentada** no `CLAUDE.md`/header do módulo (mesmo se não implementar o
      filtro): "filtro espacial server-side indisponível no atlas JSONB".
- [ ] (Se implementar bbox) GET por bounds retorna apenas feições intersectantes; feição fora do
      retângulo não vem.

**Testes (se implementar):**
- `tests/integration/sync-viewport.test.js`: 3 feições, 2 dentro do bounds → GET retorna 2.

**Dependências:** Tarefa 2/3 (não bloqueante). **Recomendação:** documentar a limitação agora;
implementar o bbox materializado só sob demanda de performance (pode virar tarefa de fase-8).

---

### Tarefa 9: Monitor de qualidade adaptativo (WS)

**Objetivo:** Medir a qualidade da conexão WS (latência via ping/pong), classificar e emitir
`adaptive-settings` ao cliente para que ele ajuste intervalo de batch e compressão de geometria.

**Arquivos afetados:**
- `src/modules/collab/collab.handlers.js` (modificar `handlePing` → medir RTT)
- `src/modules/collab/collab.gateway.js` (anexar estado de qualidade ao `ws`)
- `src/modules/collab/collab.quality.js` (criar — classificação + emissão)

**Padrão de código:** handlers WS existentes (`collab.handlers.js`); broadcast direcionado ao
próprio `ws` (não à room).

**Implementação:**
1. No envio do `ping` do servidor (ou ao receber `ping` do cliente), registrar timestamp; no
   `pong`/`ping` correspondente, calcular `rtt = now - sentAt` e manter média móvel em `ws.rttMs`.
2. Classificar:
   - `excellent`: RTT < 100ms
   - `good`: 100–300ms
   - `poor`: 300–800ms
   - `critical`: > 800ms
3. Quando a classe mudar, enviar ao cliente:
```javascript
ws.send(JSON.stringify({
  type: 'adaptive-settings',
  quality: 'poor',
  batchIntervalMs: 1500,      // maior em rede ruim
  geometryPrecision: 5,        // casas decimais (truncamento)
  viewportOnly: true,          // só feições do viewport quando crítico
}));
```
4. **Compressão de geometria por precisão:** ao serializar ops/snapshot para um cliente em rede
   `poor`/`critical`, truncar coordenadas a **5 casas decimais** (~1.1 m no equador). Implementar um
   helper `truncateCoords(geometry, 5)` aplicado na saída (não no armazenamento — o JSONB persistido
   mantém a precisão original). Isto é **só transporte**.

**Critérios de aceitação:**
- [ ] `ws.rttMs` é atualizado a cada ciclo de heartbeat.
- [ ] Mudança de classe de qualidade emite `adaptive-settings` uma vez (não a cada ping).
- [ ] Truncamento a 5 casas afeta só a saída; o dado no banco mantém precisão.

**Testes:**
- `tests/ws/collab-quality.test.js` (criar): simular pings com atraso → asserta `adaptive-settings`
  com a classe esperada; asserta que coordenadas na saída têm ≤ 5 casas em modo `poor`.

**Dependências:** nenhuma (independente das tarefas de sync). Pode ser feita em paralelo.

---

### Tarefa 10: Alinhamento de vocabulário de papéis

**Objetivo:** Expor o vocabulário `owner/editor/viewer/admin` esperado pelo frontend, mapeando a
permissão por-atlas, **sem migrar dados** nem mudar `atlas_shares.permission` (que continua
`read`/`write`).

**Mapeamento:** `owner→owner`, `write→editor`, `read→viewer`, `role global admin→admin`.

**Arquivos afetados:**
- `src/modules/collab/collab.gateway.js` (modificar o `connected` em `:172-178`)
- `src/utils/roles.js` (criar — helper `toFrontendRole(permission, globalRole)`)
- (opcional) `src/middleware/permissions.js` se quiser expor `req.atlasRole` derivado

**Implementação:**
1. Helper:
```javascript
// src/utils/roles.js
export function toFrontendRole(permission, globalRole) {
  if (globalRole === 'admin') return 'admin';
  if (permission === 'owner') return 'owner';
  if (permission === 'write') return 'editor';
  return 'viewer'; // 'read' ou público
}
```
2. No `connected` (`collab.gateway.js`), incluir `role: toFrontendRole(permission, user.role)` ao
   lado do campo `permission` (mantido para compat). **Não remover** `permission` — campo congelado.

**Critérios de aceitação:**
- [ ] `connected` carrega `role: 'owner'|'editor'|'viewer'|'admin'` além de `permission`.
- [ ] `atlas_shares.permission` continua `read`/`write` (sem migração).
- [ ] Admin global → `role: 'admin'` mesmo com permissão por-atlas menor.

**Testes:**
- `tests/ws/collab.test.js` (estender): conectar como write → `role === 'editor'`; como read →
  `viewer`; admin global → `admin`.

**Dependências:** nenhuma.

---

### Tarefa 11 (OPCIONAL): Enforcement server-side de `locked`

**Objetivo:** Decisão **consciente** de tornar `locked` enforçável no servidor (rejeitar
UPDATE/soft-delete em entidade travada). **Default do projeto: NÃO implementar** — `locked` é
advisory por design (`00-visao-geral.md` §5). Esta tarefa documenta o como, caso o produto exija.

**Arquivos afetados:** `src/modules/sync/sync.service.js` (`applyOperation`).

**Implementação (se decidir ativar):**
1. Antes do UPDATE/soft-delete de `feature`/`group`/`layer`/`map`, `SELECT locked FROM <table>
   WHERE id = $1 ... FOR UPDATE`. Se `locked === true` e a op não vem de owner/admin, **pular** a
   op e devolver `{ success: false, operationId, error: 'LOCKED' }` no `results[]` (Tarefa 7).
2. Mapas/camadas/grupos respeitam o bloqueio; "admin do mapa" **não existe** — a permissão é
   por-atlas (`write`).

**Critérios de aceitação (se ativar):**
- [ ] UPDATE em feição `locked` por usuário `write` (não-owner) é rejeitado com `LOCKED`.
- [ ] Owner/admin ignoram o lock.

**Dependências:** Tarefa 7 (canal de erro por op). **Recomendação: não fazer nesta fase.**

---

## 5. Riscos e cuidados

- **Idempotência (Tarefa 2):** o schema de idempotência (`op_id TEXT` + índice **total** `UNIQUE
  (atlas_id, op_id)` + `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *`) é da **fase-0 Tarefa
  11** — **não recriar** aqui (nem como `client_operation_id`/índice parcial). A Tarefa 2 só consome
  `op_id` e o `GET_OPERATION_BY_OP_ID`. O backfill da fase-0 (`op_id = id::text`) cobre ops legadas;
  não remova essa tolerância.
- **`updated_at` vs `server_version` como gatilho de sync (do protótipo):** o pull incremental já
  usa `server_version` monotônico (`GET_OPERATIONS_SINCE_VERSION`), **correto**. NÃO migre o gatilho
  de sync para `updated_at` (wall-clock) — `server_version` dá replay determinístico. Mantenha.
- **Contrato de snapshot congelado (`_padroes.md` §4 do DoD):** ao adicionar `grid_style`,
  `catalogLayers`, `temporal_config` ao snapshot, **só adicione campos** — não remova/renomeie os
  existentes (incluindo a coluna legada `maps.catalog_layers`). Teste de regressão do snapshot
  obrigatório.
- **`catalogLayer` (Tarefa 4):** confirme com o frontend se o update manda `data` ou `changes`, e se
  o snapshot deve expor `catalogLayers` (novo) ou `catalog_layers` (legado) ou ambos. Migração da
  coluna legada (drop) é **destrutiva** — fora desta fase.
- **Viewport/PostGIS (Tarefa 8):** não introduza PostGIS no schema do atlas. O atlas é JSONB por
  decisão de arquitetura; PostGIS é exclusivo do schema `ng` (fase-3). Capture a limitação
  honestamente em vez de forçar.
- **Broadcast de ops cruas (Tarefa 7):** os handlers WS hoje fazem broadcast da op **crua** recebida.
  Após a normalização/idempotência, garanta que o peer recebe a op no formato que ele entende
  (`entityType` do frontend), não o `target` interno.
- **Bug do controller (`result.applied`):** já existe em produção como no-op de fallback; ao corrigir
  na Tarefa 7, não mude o tipo de mensagem `operations` que o cliente já espera.

---

## 6. Definition of Done da fase

Além do DoD universal (`_padroes.md` §10), a fase-1 está concluída quando:

- [ ] **D2 registrada e CLAUDE.md corrigido** (Tarefa 1): `src/crdt` (4 arquivos, incl.
      `operations.js`) removido/arquivado junto com os **4 testes** que o importam (`crdt-merger`,
      `crdt-resolver`, `crdt-edge-cases`, `sync-operations`); zero imports de `src/crdt` em `src/` e
      `tests/`; doc não afirma mais "Timestamp como comparador principal"; tabela/contagem de testes
      no CLAUDE.md ajustada.
- [ ] **Idempotência ativa** (Tarefa 2): reenvio de op não duplica nem reaplica; consome `op_id`
      (schema/migração `006` da fase-0 — **sem nova migração aqui**); ops sem `op.id` ainda funcionam.
- [ ] **`gridStyle` persiste** (Tarefa 3): grava em `maps.grid_style` e aparece no snapshot.
- [ ] **`catalogLayer` por-camada funciona** (Tarefa 4): create/update/delete por id; snapshot
      expõe `catalogLayers`; coluna legada intacta.
- [ ] **`temporal_config` pronto e gated** (Tarefa 5): coluna + sub-entidade `mapTemporal` +
      snapshot; sem ativação obrigatória do frontend.
- [ ] **Merge atômico** (Tarefa 6): `POST .../maps/:mapId/merge` move feições em transação única,
      com teste de atomicidade e teste negativo de cross-atlas.
- [ ] **Ack por operação** (Tarefa 7): `POST /sync` e `ack_batch` retornam `results[]`; bug
      `result.applied` corrigido.
- [ ] **Viewport** (Tarefa 8): limitação documentada (ou bbox materializado implementado sob demanda).
- [ ] **Monitor de qualidade** (Tarefa 9): `adaptive-settings` emitido por mudança de classe;
      truncamento de precisão só no transporte.
- [ ] **Papéis alinhados** (Tarefa 10): `connected` carrega `role` derivado sem migrar dados.
- [ ] **`locked` enforcement** (Tarefa 11): NÃO implementado (default), ou implementado como decisão
      explícita e documentada.
- [ ] Migrações novas desta fase — `007 grid_style`, `008 catalog_layers` (e a de temporal, se
      incluída, após 008) — numeradas, aditivas, aplicadas pelo runner. A idempotência usa a `006`
      da fase-0 (não recriada). `npm test` verde (unit/integration/ws), incluindo casos negativos.
- [ ] Contrato de frontend (snapshot, envelope de op) não regrediu; caminho anônimo intacto.
