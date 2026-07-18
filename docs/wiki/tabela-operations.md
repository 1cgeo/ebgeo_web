# Tabela operations (log append-only)

Log append-only no PostgreSQL que registra toda operação de entidade, com `server_version` vindo da sequência global `atlas_version_seq`, a chave da ordenação LWW, e `UNIQUE(atlas_id, op_id)` como garantia de idempotência.

## Onde ela vive e por que existe

Criada no baseline `src/database/migrations/003_sync.sql:14` (backend `ebgeo_backend`). É a única porta de escrita das entidades colaborativas: não existe rota REST de escrita para feature/layer/group/map/briefing/slide/3D/360 (ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]]). Toda mutação vira uma linha aqui e, na mesma transação, um write nas tabelas de entidade.

Duas funções distintas na mesma tabela, e confundir as duas é o erro clássico:

1. **Ordenação** (`server_version`), que decide quem vence em conflito, ver [[modelo-conflito-lww]].
2. **Replay incremental** (`WHERE server_version > $cursor`), que alimenta o pull, ver [[snapshot-e-pull-incremental]].

## Colunas

| Coluna | Tipo | Papel |
|---|---|---|
| `id` | `UUID PK DEFAULT gen_random_uuid()` | id da **linha no servidor**, NÃO o id da op do cliente |
| `atlas_id` | `UUID FK→atlas ON DELETE CASCADE` | escopo; apagar o atlas apaga o log |
| `op_type` | `VARCHAR(20)` CHECK `create|update|delete` | |
| `entity_type` | `VARCHAR(50)` | tipo **genérico de backend**, já normalizado |
| `entity_id` | `UUID NOT NULL` | alvo |
| `map_id` | `UUID` nullable | contexto do mapa (nulo em map/briefing/slide/group_feature) |
| `changes` | `JSONB` | payload de update no vocabulário canônico |
| `data` | `JSONB` | payload de create (e, na prática, também de update) |
| `client_timestamp` | `BIGINT NOT NULL` | relógio de parede do cliente, **não decide nada** |
| `client_id` | `TEXT NOT NULL` | TEXT, não UUID; ver [[client-id-estavel]] |
| `server_version` | `BIGINT NOT NULL DEFAULT nextval('atlas_version_seq')` | **ordem de chegada = verdade do LWW** |
| `lamport_timestamp` | `BIGINT` nullable | ecoado no pull, nunca decide vencedor |
| `op_id` | `TEXT` nullable | chave de idempotência vinda do cliente |
| `user_id` | `UUID FK→users` | auditoria, ver [[auditoria]] |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` | base do cleanup por dias |

Índices (`003_sync.sql:47-52`): `(atlas_id, server_version)` para o pull incremental, `(entity_type, entity_id)` para inspeção por entidade, `(atlas_id, created_at)` para cleanup, e o índice `UNIQUE (atlas_id, op_id)`.

## server_version: sequência global, use só para ordenar

`atlas_version_seq` é **uma única sequência para todos os atlas** (`003_sync.sql:12`). Consequências que precisam estar na cabeça de quem mexe nisso:

- `server_version` é monotônico **dentro de um atlas**, mas **não contíguo**: um atlas pode ir de 100 para 4712 porque outros atlas consumiram a sequência no meio. Nunca conte ops por diferença de versão, nunca assuma `v+1`.
- Rollback de transação queima valores da sequência (comportamento normal do Postgres). Buracos são esperados.
- `nextval` acontece no INSERT, mas a **visibilidade** acontece no COMMIT. Sem serialização, duas transações concorrentes poderiam comitar fora da ordem das versões e uma op ficaria para sempre invisível ao pull incremental (`WHERE server_version > cursor`). Por isso `pushOperations` toma `pg_advisory_xact_lock(SYNC_PUSH_LOCK_NAMESPACE, hashtext(atlasId))` **antes do primeiro INSERT** (`src/modules/sync/sync.service.js:650`), tornando ordem de `nextval` igual a ordem de commit por atlas. O lock é transaction-scoped (some no COMMIT/ROLLBACK) e chaveado por atlas, então pushes de atlas diferentes seguem paralelos.

> Não remova nem mova esse advisory lock para depois do INSERT. Ele é o que faz `server_version` ser um cursor de pull válido, e a falha que ele evita é silenciosa (op perdida, sem erro).

O trigger `trg_update_atlas_version` (`003_sync.sql:55-69`) propaga a versão para `atlas.current_version` a cada INSERT, e é isso que o pull lê como `currentVersion` (`sync.service.js:778`), ver [[atlas-modelo-de-dados]].

> **Nota histórica.** guia *arquitetura-sync* (absorvido) §8.1 diz que o trigger "mantém `atlas.current_version = MAX(server_version)`"; o código em `003_sync.sql:59` faz `SET current_version = NEW.server_version`, ou seja, o valor da **última linha inserida**, sem `MAX`. Na prática coincide porque o advisory lock serializa os inserts por atlas; se alguém inserir na tabela fora de `pushOperations`, a igualdade com o máximo deixa de valer.

Detalhe assimétrico que confunde em debug: `pushOperations` devolve `serverVersion` calculado por `SELECT COALESCE(MAX(server_version),0) FROM operations WHERE atlas_id=$1` (`sync.queries.js:21-25`, usado em `sync.service.js:749`), enquanto o pull devolve `atlas.current_version`. Fontes diferentes para o mesmo número.

## Idempotência por (atlas_id, op_id)

O `id` que o cliente gera para a op vira `op_id` (TEXT, formato livre). O INSERT é `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *` (`sync.queries.js:3-8`). Quando o `RETURNING` vem vazio, o serviço busca a linha anterior por `op_id`, devolve ack com `idempotent: true` e a `serverVersion` originalmente registrada, e **pula o apply** (`sync.service.js:683-705`). Reenviar a fila inteira após reconexão é seguro por construção, ver [[idempotencia-e-convergence-guard]], [[ack-idempotencia]] e [[fila-operacoes-outbound]].

Armadilhas:

- **`op_id` é nullable e no Postgres NULLs são distintos entre si num índice UNIQUE.** Ou seja, ops sem `id` não têm idempotência nenhuma e podem duplicar. O caminho HTTP se protege pelo Joi `id: Joi.string().required()` (`sync.schemas.js:14`), que rejeita com 422 antes do banco, e o INSERT ainda passa `rawOp.id ?? null` (`sync.service.js:679`). Qualquer chamada interna que pule a validação perde a garantia.
- O escopo do UNIQUE é **por atlas**. O mesmo `op_id` em atlas diferentes são duas linhas legítimas.
- Idempotência protege o **log e o efeito**, não a versão: o reenvio não ganha uma `server_version` nova.

## entity_type é o tipo normalizado, não o do cliente

O que é gravado é `op.target` depois de `normalizeOperation`, não o `entityType` que o cliente enviou. Pelo `ENTITY_TYPE_MAP` (`sync.service.js:23-38`):

- `marker3d`/`measurement3d`/`viewshed3d`/`cameraPosition3d` viram `cesium3d`; `orientation360`/`marker360` viram `streetview360`. O tipo específico sobrevive só dentro de `data.data_type`.
- `mapPosition`/`baseLayer`/`mapNotes`/`gridStyle`/`mapTemporal` viram todos `entity_type = 'map'`. O `subType` **não é persistido em coluna alguma**.

Portanto, consultar o log por `entity_type` não acha `gridStyle` nem `marker3d`. E a reconversão de saída (`toFrontendOperation`, `sync.service.js:243-253`) só recupera o tipo específico quando `op.data.data_type` existe: uma op de update que tenha usado `changes` volta do pull como o tipo genérico `cesium3d`. Lista de tipos aceitos em [[tipos-entidade-sync]].

Outro ajuste de ingestão: `entity_id` é `UUID NOT NULL`, então ops de nível de atlas (settings, que chegam com o sentinela não-UUID `'atlas'`) são registradas contra o **próprio id do atlas** (`sync.service.js:672`), e o ack devolve `entityId` como gravado para que broadcast e pull concordem (`sync.service.js:717`).

## data vs changes: o que o cliente real manda

O contrato canônico é `data` no create e `changes` no update. O frontend deste repo **sempre usa `data`**, inclusive em update (`src/js/store/sync/operation-factory.js:151-163` e `:176-190`), então na base real a coluna `changes` fica praticamente sempre NULL e o backend trata `data` como `changes` quando `changes` falta no update. `previousData`, que o factory também emite, não tem coluna e é descartado no log. Ao consumir uma op vinda do pull, leia os dois campos (ver [[envelope-operacao]] e [[aplicacao-operacoes-remotas]]).

## O campo id do pull não é o op_id

`toFrontendOperation` devolve `id: op.id`, o **PK da linha no servidor** (`sync.service.js:256`). Já o broadcast WebSocket reenvia a op crua do cliente, apenas carimbada com `serverVersion` (`src/modules/collab/collab.handlers.js:197`). Ou seja, o mesmo evento chega com `id` diferente conforme o caminho: ao vivo vem o `op.id` do autor, por pull incremental vem o UUID da linha. Não use esse campo como chave de deduplicação entre os dois caminhos; a deduplicação de eco é por `clientId`. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]].

> **Nota histórica.** guia *05-sync-crdt* (absorvido) §6 mostra a resposta do pull incremental com `"id": "op-uuid"`, sugerindo o id da operação do cliente; o código em `sync.service.js:256` devolve `op.id`, o PK da linha em `operations`, e o `op_id` do cliente não é exposto nessa resposta.

## Escrita: uma transação por push

Todo o batch de `POST /api/v1/atlas/:atlasId/sync` roda numa transação só (`sync.service.js:633`). Falhou uma op, o lote inteiro reverte, log e entidades juntos. Por op: `normalizeOperation` → `assertOperationAllowed(op, permission)` ([[permissoes-atlas]], [[permissoes-atlas]]) → INSERT no log → `applyOperation` nas tabelas de entidade. O log é escrito **antes** do apply, então uma linha em `operations` prova recebimento, não efeito. Um update que casou zero linhas (mapId de outro atlas, guarda `EXISTS`) é acked com sucesso e mesmo assim não escreveu nada; é exatamente essa cegueira que o span `SERVER_APPLIED` com `rowsAffected` expõe ([[syncledger]], `sync.service.js:737-744`).

Limite de lote: `MAX_OPS_PER_PUSH = 500` (`sync.schemas.js:6`); estourar dá 422, ver [[erros-api]].

## Compactação (o log não cresce para sempre)

`cleanupOldOperations` (`sync.service.js:816`) apaga `server_version < corte` e sobe `atlas.min_version`. O corte vem de `keepFromVersion` ou da menor versão com `created_at >= hoje - keepDays` (default 7). Efeito colateral desejado: qualquer cliente cujo cursor seja menor que `min_version` deixa de receber incremental e passa a receber snapshot completo no pull (`sync.service.js:781`). Endpoints admin em [[sync-admin-operacoes]].

Consequência para quem depende do log: **operations não é arquivo histórico permanente**. Auditoria de longo prazo pertence a [[auditoria]], não a esta tabela.

## O que a tabela NÃO é

Não é um CRDT. O Lamport clock viaja e é persistido só para o cliente avançar o próprio relógio ao receber ops (`003_sync.sql:33-36`, eco em `sync.service.js:266`); ele nunca é comparado no servidor, nem o `client_timestamp`. O vencedor é sempre a última linha a chegar, ordenada por `server_version`. Ver [[sintese-nao-e-crdt]] e [[modelo-conflito-lww]].

## Fontes

- guia *arquitetura-sync* (absorvido): §8.1 (colunas, índices, sequência global não contígua), §8.2 (`applyOperation`), fluxo de push/pull e papel do `serverVersion` como única chave de ordenação.
- guia *05-sync-crdt* (absorvido): contrato do envelope de operação, dois vocabulários, idempotência por `op_id`, formato dos acks, pull híbrido, endpoints admin de cleanup.
- `ebgeo_backend/src/database/migrations/003_sync.sql`: DDL real da tabela, sequência, índices e trigger.
- `ebgeo_backend/src/modules/sync/sync.queries.js` e `sync.service.js`: INSERT idempotente, advisory lock por atlas, normalização de `entity_type`, sentinela de `entity_id`, cleanup.
- `ebgeo_backend/src/modules/sync/sync.schemas.js` e `src/modules/collab/collab.handlers.js`: validação do push e broadcast carimbado com `serverVersion`.
- `ebgeo_web/src/js/store/sync/operation-factory.js` e `remote-operation-handler.js`: shape real emitido pelo cliente (`data` em update) e consumo do `serverVersion`.
