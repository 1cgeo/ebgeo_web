# Tabela operations (log append-only)

Log append-only no PostgreSQL onde `server_version` (sequência global `atlas_version_seq`) é a única chave de ordenação do LWW, e `UNIQUE(atlas_id, op_id)` a única garantia de idempotência.

DDL, colunas e índices em `backend/src/database/migrations/004_sync.sql`; o INSERT idempotente em `backend/src/modules/sync/sync.queries.js`. Esta página cobre só o que o DDL não conta.

## Por que ela é a única porta de escrita

Não existe rota REST de escrita para feature/layer/group/map/briefing/slide/3D/360: toda mutação vira uma linha aqui e, na mesma transação, um write na tabela de entidade (ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]]).

A tabela acumula duas funções distintas, e confundi-las é o erro clássico: **ordenação** (`server_version` decide quem vence, ver [[modelo-conflito-lww]]) e **replay incremental** (`WHERE server_version > $cursor` alimenta o pull, ver [[snapshot-e-pull-incremental]]).

## server_version: sequência global, serve só para ordenar

`atlas_version_seq` é **uma única sequência para todos os atlas**. Consequências:

- monotônica **dentro de um atlas**, mas **não contígua**: um atlas pode ir de 100 para 4712 porque outros consumiram a sequência no meio. Nunca conte ops por diferença de versão, nunca assuma `v+1`. Rollback também queima valores; buracos são esperados.
- `nextval` acontece no INSERT, mas a **visibilidade** acontece no COMMIT. Sem serialização, duas transações concorrentes podem comitar fora da ordem das versões e uma op fica **para sempre** invisível ao pull incremental. Por isso `pushOperations` (`backend/src/modules/sync/sync.service.js`) toma `pg_advisory_xact_lock` **antes do primeiro INSERT**.

> Não remova nem mova esse advisory lock para depois do INSERT. É ele que torna `server_version` um cursor de pull válido, e a falha que ele evita é silenciosa (op perdida, sem erro). O lock é transaction-scoped e chaveado por atlas, então pushes de atlas diferentes seguem paralelos.

Assimetria que confunde em debug: o push devolve `serverVersion` de um `MAX(server_version)` sobre `operations`, enquanto o pull devolve `atlas.current_version`, mantido pelo trigger `trg_update_atlas_version`. Fontes diferentes para o mesmo número, ver [[atlas-modelo-de-dados]].

> **Nota histórica.** O guia *arquitetura-sync* (absorvido) §8.1 diz que o trigger mantém `atlas.current_version = MAX(server_version)`; ele na verdade faz `SET current_version = NEW.server_version`, o valor da **última linha inserida**, sem `MAX`. Coincide na prática porque o advisory lock serializa os inserts por atlas. Quem inserir na tabela fora de `pushOperations` quebra a igualdade.

## Idempotência: onde ela não vale

Colisão em `(atlas_id, op_id)` faz `DO NOTHING`, e o ramo idempotente de `pushOperations` (`backend/src/modules/sync/sync.service.js`) devolve ack com `idempotent: true` e a `serverVersion` original, **pulando o apply**. Reenviar a fila inteira após reconexão é seguro por construção, ver [[idempotencia-e-convergence-guard]], [[ack-idempotencia]] e [[fila-operacoes-outbound]].

- **`op_id` é nullable e no Postgres NULLs são distintos entre si num índice UNIQUE.** Ops sem `id` não têm idempotência nenhuma e duplicam silenciosamente. Só o Joi de `backend/src/modules/sync/sync.schemas.js` segura isso, rejeitando com 422 antes do banco; o INSERT ainda passa `rawOp.id ?? null`. Qualquer chamada interna que pule a validação perde a garantia.
- O escopo do UNIQUE é **por atlas**: o mesmo `op_id` em atlas diferentes são duas linhas legítimas.
- Idempotência protege o **log e o efeito**, não a versão: o reenvio não ganha `server_version` nova.

## entity_type é o tipo normalizado, não o do cliente

Grava-se `op.target` depois de `normalizeOperation`, não o `entityType` enviado (`ENTITY_TYPE_MAP`, `backend/src/modules/sync/sync.service.js`). Os tipos 3D/360 colapsam em `cesium3d`/`streetview360` (o específico sobrevive só em `data.data_type`), e as cinco sub-entidades de mapa viram todas `entity_type = 'map'` com o `subType` **não persistido em coluna alguma**.

Armadilhas daí: consultar o log por `entity_type` não acha `gridStyle` nem `marker3d`; e `toFrontendOperation` só recupera o tipo específico quando `op.data.data_type` existe, então uma op de update que tenha usado `changes` volta do pull como o genérico `cesium3d`. Lista de tipos aceitos em [[tipos-entidade-sync]].

Como `entity_id` é `UUID NOT NULL`, ops de nível de atlas (settings, que chegam com o sentinela não-UUID `'atlas'`) são registradas contra o **próprio id do atlas**, e o ack devolve `entityId` como gravado para que broadcast e pull concordem.

## data vs changes: o contrato e o cliente real divergem

O contrato canônico é `data` no create e `changes` no update. O frontend deste repo **sempre usa `data`**, inclusive em update (`frontend/src/js/store/sync/operation-factory.js`), então na base real `changes` fica quase sempre NULL e o backend trata `data` como `changes` quando falta. `previousData`, que o factory emite, não tem coluna e é descartado. Ao consumir op vinda do pull, leia os dois campos (ver [[envelope-operacao]] e [[aplicacao-operacoes-remotas]]).

## O id da operação é o mesmo nos dois caminhos

`toFrontendOperation` devolve `id: op.op_id ?? op.id`, ou seja, o **`op_id` do cliente**, exatamente o mesmo que o broadcast WebSocket reenvia carimbado com `serverVersion` (`backend/src/modules/collab/collab.handlers.js`). A identidade da operação não depende do caminho de entrega. O `op.id` (PK da linha) só aparece como reserva para linha gravada sem `op_id`, que a coluna nullable permite ([[idempotencia-e-convergence-guard]]).

Ainda assim, **a deduplicação de eco é por `clientId`, não por esse id** ([[canal-collab-websocket]], [[client-id-estavel]]): o que o id unificado garante é que os dois caminhos falem da mesma operação, inclusive para o ledger, que junta spans por `op.id` ([[syncledger]]).

## Uma linha aqui prova recebimento, não efeito

Todo o batch roda numa transação só, dentro de `pushOperations` (`backend/src/modules/sync/sync.service.js`), mas **cada op corre num SAVEPOINT próprio**: uma violação de dado reverte só ela, log e entidade juntos. Mas o log é escrito **antes** do apply. Um update que casou zero linhas (mapId de outro atlas, guarda `EXISTS`) é acked com sucesso e mesmo assim não escreveu nada. Essa cegueira é exatamente o que o span `SERVER_APPLIED` com `rowsAffected` existe para expor (ver [[syncledger]]). Lote acima de `MAX_OPS_PER_PUSH = 500` dá 422, ver [[erros-api]].

**Falha não é o mesmo que recusa, e essa distinção é recente.** Uma violação de *nível* (principal `read` ou `comment` empurrando escrita) segue lançando de `assertOperationAllowed` e derrubando o lote inteiro com 403, porque um lote assim é inteiramente suspeito. Já a recusa **por operação** não aborta nada e hoje tem três famílias, com a mesma forma de ack (`rejected: true` + `reason`, 200 no lote):

- *política* (`operationDenialReason`, `lockedMapDenialReason`): excluir mapa sem `manage`, travar/destravar sem ser dono, escrever em mapa bloqueado;
- *violação de dado*: SQLSTATE classe 22/23 (CHECK, FK, `22P02`, NOT NULL), classificada por `integrityRejectionReason` e traduzida num motivo genérico em pt-BR, porque o texto do driver carrega nome de constraint e depende do locale;
- *alvo desconhecido* (`unknownTargetDenialReason`): `entityType` que o `applyOperation` não sabe aplicar. É a única das três recusada **antes** do INSERT, porque uma op que ninguém consegue aplicar não pode consumir `server_version` nem ser replicada. Até 2026-07-25 ela era gravada aqui e acked como sucesso, o que fazia esta tabela guardar a única cópia de um dado que o cliente já tinha descartado.

As três compartilham o motivo de existir, e vale reter: enquanto isso lançava, uma única recusa congelava a fila outbound daquele usuário **para sempre**, porque o cliente não faz dequeue de lote que o servidor rejeitou. O que **continua** abortando o lote é só o que pode dar certo na retentativa (403 de nível, `40001`, `55P03`, queda de conexão), porque descartar op boa é irreversível e fila travada não é. Ver [[ack-idempotencia]], [[permissoes-atlas]] e [[sintese-contrato-erros-http]].

## Não é arquivo histórico permanente

`cleanupOldOperations` (`backend/src/modules/sync/sync.service.js`) apaga `server_version < corte` e sobe `atlas.min_version` (corte por `keepFromVersion` ou pelos últimos `keepDays`, default 7). Efeito colateral desejado: cliente com cursor abaixo de `min_version` deixa de receber incremental e cai no snapshot completo. Auditoria de longo prazo pertence a [[auditoria]], não a esta tabela; endpoints admin em [[sync-admin-operacoes]].

## O que a tabela NÃO é

Não é um CRDT. O Lamport clock é persistido só para ecoar no pull e deixar o cliente avançar o próprio relógio; nunca é comparado no servidor, nem o `client_timestamp`. O vencedor é sempre a última linha a chegar. Ver [[modelo-conflito-lww]].

## Histórico

- 2026-07-25: a seção "Uma linha aqui prova recebimento, não efeito" dizia que qualquer op recusada revertia o lote inteiro. Isso valeu até `1d23ac9` (2026-07-19) e `aec63f8` (2026-07-24), que converteram as recusas de política (delete de mapa, lock/unlock, mapa bloqueado) em ack por op sem abortar a transação. A violação de nível continua abortando.
- 2026-07-25: fechada a última porta do poison batch. A violação de **dado** (classe 22/23) também abortava o lote e devolvia um 400 genérico que não dizia QUAL op ofendeu, então o cliente reenviava o mesmo lote indefinidamente. Cada op passou a rodar num SAVEPOINT e a recusa virou por operação, com motivo genérico. Medido em `backend/tests/integration/sync-check-constraint-poison.test.js`, que até este dia pinava o defeito como comportamento aceito.
- 2026-07-25: a seção "O campo id do pull não é o op_id" descrevia uma assimetria real (o pull identificava a op pelo PK da linha, o broadcast pelo `op_id` do cliente) que foi eliminada no mesmo dia. `toFrontendOperation` passou a devolver `op.op_id ?? op.id`. O gap estava pinado com `assert.notEqual` em `backend/tests/ws/collab-broadcast-stamping.test.js`, hoje invertido para igualdade.
