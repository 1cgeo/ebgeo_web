# Tabela operations (log append-only)

Log append-only no PostgreSQL onde `server_version` (sequência global `atlas_version_seq`) é a única chave de ordenação do LWW, e `UNIQUE(atlas_id, op_id)` a única garantia de idempotência.

DDL, colunas e índices em `backend/src/database/migrations/003_sync.sql:12-52` (backend `ebgeo_backend`); o INSERT idempotente em `backend/src/modules/sync/sync.queries.js:3-8`. Esta página cobre só o que o DDL não conta.

## Por que ela é a única porta de escrita

Não existe rota REST de escrita para feature/layer/group/map/briefing/slide/3D/360: toda mutação vira uma linha aqui e, na mesma transação, um write na tabela de entidade (ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]]).

A tabela acumula duas funções distintas, e confundi-las é o erro clássico: **ordenação** (`server_version` decide quem vence, ver [[modelo-conflito-lww]]) e **replay incremental** (`WHERE server_version > $cursor` alimenta o pull, ver [[snapshot-e-pull-incremental]]).

## server_version: sequência global, serve só para ordenar

`atlas_version_seq` é **uma única sequência para todos os atlas**. Consequências:

- monotônica **dentro de um atlas**, mas **não contígua**: um atlas pode ir de 100 para 4712 porque outros consumiram a sequência no meio. Nunca conte ops por diferença de versão, nunca assuma `v+1`. Rollback também queima valores; buracos são esperados.
- `nextval` acontece no INSERT, mas a **visibilidade** acontece no COMMIT. Sem serialização, duas transações concorrentes podem comitar fora da ordem das versões e uma op fica **para sempre** invisível ao pull incremental. Por isso `pushOperations` toma `pg_advisory_xact_lock` **antes do primeiro INSERT** (`backend/src/modules/sync/sync.service.js:650`).

> Não remova nem mova esse advisory lock para depois do INSERT. É ele que torna `server_version` um cursor de pull válido, e a falha que ele evita é silenciosa (op perdida, sem erro). O lock é transaction-scoped e chaveado por atlas, então pushes de atlas diferentes seguem paralelos.

Assimetria que confunde em debug: o push devolve `serverVersion` de um `MAX(server_version)` sobre `operations` (`backend/src/modules/sync/sync.queries.js:21-25`), enquanto o pull devolve `atlas.current_version`, mantido pelo trigger `trg_update_atlas_version`. Fontes diferentes para o mesmo número, ver [[atlas-modelo-de-dados]].

> **Nota histórica.** O guia *arquitetura-sync* (absorvido) §8.1 diz que o trigger mantém `atlas.current_version = MAX(server_version)`; `backend/src/database/migrations/003_sync.sql:59` faz `SET current_version = NEW.server_version`, o valor da **última linha inserida**, sem `MAX`. Coincide na prática porque o advisory lock serializa os inserts por atlas. Quem inserir na tabela fora de `pushOperations` quebra a igualdade.

## Idempotência: onde ela não vale

Colisão em `(atlas_id, op_id)` faz `DO NOTHING`, e o serviço devolve ack com `idempotent: true` e a `serverVersion` original, **pulando o apply** (`backend/src/modules/sync/sync.service.js:683-705`). Reenviar a fila inteira após reconexão é seguro por construção, ver [[idempotencia-e-convergence-guard]], [[ack-idempotencia]] e [[fila-operacoes-outbound]].

- **`op_id` é nullable e no Postgres NULLs são distintos entre si num índice UNIQUE.** Ops sem `id` não têm idempotência nenhuma e duplicam silenciosamente. Só o Joi `id: Joi.string().required()` (`backend/src/modules/sync/sync.schemas.js:14`) segura isso, rejeitando com 422 antes do banco; o INSERT ainda passa `rawOp.id ?? null` (`backend/src/modules/sync/sync.service.js:679`). Qualquer chamada interna que pule a validação perde a garantia.
- O escopo do UNIQUE é **por atlas**: o mesmo `op_id` em atlas diferentes são duas linhas legítimas.
- Idempotência protege o **log e o efeito**, não a versão: o reenvio não ganha `server_version` nova.

## entity_type é o tipo normalizado, não o do cliente

Grava-se `op.target` depois de `normalizeOperation`, não o `entityType` enviado (`ENTITY_TYPE_MAP`, `backend/src/modules/sync/sync.service.js:23-38`). Os tipos 3D/360 colapsam em `cesium3d`/`streetview360` (o específico sobrevive só em `data.data_type`), e `mapPosition`/`baseLayer`/`mapNotes`/`gridStyle`/`mapTemporal` viram todos `entity_type = 'map'` com o `subType` **não persistido em coluna alguma**.

Armadilhas daí: consultar o log por `entity_type` não acha `gridStyle` nem `marker3d`; e `toFrontendOperation` (`backend/src/modules/sync/sync.service.js:243-253`) só recupera o tipo específico quando `op.data.data_type` existe, então uma op de update que tenha usado `changes` volta do pull como o genérico `cesium3d`. Lista de tipos aceitos em [[tipos-entidade-sync]].

Como `entity_id` é `UUID NOT NULL`, ops de nível de atlas (settings, que chegam com o sentinela não-UUID `'atlas'`) são registradas contra o **próprio id do atlas** (`backend/src/modules/sync/sync.service.js:672`), e o ack devolve `entityId` como gravado para que broadcast e pull concordem (`backend/src/modules/sync/sync.service.js:717`).

## data vs changes: o contrato e o cliente real divergem

O contrato canônico é `data` no create e `changes` no update. O frontend deste repo **sempre usa `data`**, inclusive em update (`frontend/src/js/store/sync/operation-factory.js:151-163`), então na base real `changes` fica quase sempre NULL e o backend trata `data` como `changes` quando falta. `previousData`, que o factory emite, não tem coluna e é descartado. Ao consumir op vinda do pull, leia os dois campos (ver [[envelope-operacao]] e [[aplicacao-operacoes-remotas]]).

## O campo id do pull não é o op_id

`toFrontendOperation` devolve `id: op.id`, o **PK da linha no servidor** (`backend/src/modules/sync/sync.service.js:256`), enquanto o broadcast WebSocket reenvia a op crua do cliente apenas carimbada com `serverVersion` (`backend/src/modules/collab/collab.handlers.js:197`). O mesmo evento chega com `id` diferente conforme o caminho. Não use esse campo como chave de deduplicação entre os dois; a deduplicação de eco é por `clientId`, ver [[canal-collab-websocket]] e [[client-id-estavel]].

> **Nota histórica.** O guia *05-sync-crdt* (absorvido) §6 mostra o pull incremental com `"id": "op-uuid"`, sugerindo o id da op do cliente; `backend/src/modules/sync/sync.service.js:256` devolve o PK da linha, e o `op_id` do cliente não é exposto nessa resposta.

## Uma linha aqui prova recebimento, não efeito

Todo o batch roda numa transação só (`backend/src/modules/sync/sync.service.js:633`): falhou uma op, o lote inteiro reverte, log e entidades juntos. Mas o log é escrito **antes** do apply. Um update que casou zero linhas (mapId de outro atlas, guarda `EXISTS`) é acked com sucesso e mesmo assim não escreveu nada. Essa cegueira é exatamente o que o span `SERVER_APPLIED` com `rowsAffected` existe para expor (`backend/src/modules/sync/sync.service.js:737-744`, ver [[syncledger]]). Autorização por op via `assertOperationAllowed`, ver [[permissoes-atlas]]. Lote acima de `MAX_OPS_PER_PUSH = 500` dá 422, ver [[erros-api]].

## Não é arquivo histórico permanente

`cleanupOldOperations` (`backend/src/modules/sync/sync.service.js:816`) apaga `server_version < corte` e sobe `atlas.min_version` (corte por `keepFromVersion` ou pelos últimos `keepDays`, default 7). Efeito colateral desejado: cliente com cursor abaixo de `min_version` deixa de receber incremental e cai no snapshot completo. Auditoria de longo prazo pertence a [[auditoria]], não a esta tabela; endpoints admin em [[sync-admin-operacoes]].

## O que a tabela NÃO é

Não é um CRDT. O Lamport clock é persistido só para ecoar no pull e deixar o cliente avançar o próprio relógio; nunca é comparado no servidor, nem o `client_timestamp`. O vencedor é sempre a última linha a chegar. Ver [[sintese-nao-e-crdt]].

## Fontes

- guias *arquitetura-sync* e *05-sync-crdt* (absorvidos): §8.1/§8.2 e contrato do envelope, idempotência, acks, pull híbrido.
- `ebgeo_backend`: `backend/src/database/migrations/003_sync.sql`, `src/modules/sync/{sync.queries,sync.service,sync.schemas}.js`, `backend/src/modules/collab/collab.handlers.js`.
- `ebgeo_web`: `src/js/store/sync/{operation-factory,remote-operation-handler}.js`.
