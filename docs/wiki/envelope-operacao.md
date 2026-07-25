# Envelope de Operação

Unidade atômica de sincronização do EBGeo: o objeto criado por `createOperation` (`frontend/src/js/store/sync/operation-factory.js:140`) e aceito pelo backend em dois vocabulários. O shape está no próprio arquivo; esta página cobre o que ele não conta.

## Por que existe

Não há rota REST de escrita **incremental** para entidades colaborativas (feição, camada, grupo, mapa, briefing, slide, 3D, 360). Toda mutação sincronizável vira operação e viaja por push HTTP ou pelo canal WS. Isso concentra ordenação, idempotência e permissão em um único ponto, e é o que viabiliza o offline-first: a operação nasce no cliente, é persistida em IndexedDB e só depois sai pela rede ([[fila-operacoes-outbound]]).

## O envelope vai verbatim, e isso é intencional

`flush()` empurra os objetos da fila sem projeção (`frontend/src/js/store/sync/sync-engine.js:272`, `frontend/src/js/store/sync/api-client.js:841`). Logo `previousData`, `batchId`, `batchIndex` e `traceId` cruzam a rede mesmo sem uso servidor-side.

Isso só funciona porque o `.unknown(true)` no fim de `operationSchema` (`backend/src/modules/sync/sync.schemas.js:46`) vence o `stripUnknown: true` do middleware (`middleware/validate.js:5`). Verificado empiricamente no Joi 17.13.3 desta instalação: campos não declarados sobrevivem intactos. O comentário do próprio schema hesita nisso e declara `traceId` explicitamente "rather than relying on .unknown(true)". A hesitação é infundada, mas **remover o `.unknown(true)` apaga silenciosamente `previousData`, `batchId` e `batchIndex` sem erro de validação** e sem nenhum teste vermelho.

## Os campos que enganam

- **`timestamp`** é ordenação **local** apenas. Nunca ordena entre máquinas.
- **`lamportTimestamp`** avança em `max(local, remoto)+1` (`frontend/src/js/store/sync/operation-factory.js:85`, chamado em `frontend/src/js/store/sync/sync-gateway.js:48`), é persistido e ecoado no pull, mas o reducer de conflito nunca o consulta: quem vence é o `serverVersion`. O relógio existe e não decide nada. Ver [[modelo-conflito-lww]].
- **`serverVersion` não é campo do cliente.** É carimbado pelo servidor e volta no ack, no broadcast e no pull. É a única chave de ordenação correta ([[tabela-operations]]).
- **`mapId`** é contexto, não alvo. Ops de nível atlas (`map`, `briefing`, `setting`) passam `null`.
- **`previousData`** existe para undo **local**. Viaja porque o envelope vai verbatim, não porque o backend precise dele. Não construa merge servidor-side em cima disso.
- **`clientId`** não é credencial ([[client-id-estavel]]); **`traceId`** é best-effort e `null` nunca quebra o sync ([[syncledger]]).
- **`id`** é a âncora: sobrevive intacto por `push → INSERT → broadcast/pull → apply`, é a chave de `UNIQUE (atlas_id, op_id)` e a chave de junção do ledger. Ver [[idempotencia-e-convergence-guard]] e [[ack-idempotencia]].

## Armadilhas

**1. O cliente nunca emite `changes`.** `createOperation` só produz `data` (`frontend/src/js/store/sync/operation-factory.js:151`); não há uma única ocorrência de `changes` em `src/js/store/sync/`. O backend compensa: num `update` sem `changes`, usa `data` como `changes` (`backend/src/modules/sync/sync.service.js:216`). Quem lê a interface normativa e espera `changes` na saída procura um campo inexistente.

A documentação de origem apresentava o formato inverso (`changes` no update, sem `previousData`/`lamportTimestamp`/`batchId`) e é a fonte mais provável desse modelo mental errado. O envelope real sempre traz `previousData`, `lamportTimestamp` e `traceId` (`createOperation`, `frontend/src/js/store/sync/operation-factory.js`), mais `batchId` quando a op nasce em lote (`createBatchOperations`, mesmo arquivo).

**2. Uma op malformada não envenena mais o lote, e o guard pré-flush continua valendo.** Até 2026-07-25 o push rodava numa transação única e uma op recusada pelo Postgres revertia o batch inteiro; nada era dequeued e a fila re-peekava as mesmas ops para sempre — sync travado, não degradado. Hoje cada op corre num SAVEPOINT e a violação de dado (classe 22/23) volta recusada **por operação**, com motivo ([[tabela-operations]], [[ack-idempotencia]]). O dispatcher segue dropando **antes** de enfileirar (`frontend/src/js/store/sync/operation-dispatcher.js:105-139`) — logging desabilitado, `SETTING` com `entityId` não-UUID fora do sentinel `'atlas'`, e qualquer `mapId` não-UUID (mapa local nome-chaveado, ex. `Principal`) — porque o motivo dele nunca foi só o travamento: é impedir que feição local vaze para atlas do servidor. Ver [[dominio-local-vs-remoto]].

**2b. O gatilho não é só o id: qualquer valor que o Postgres recuse é uma op perdida.** Nove páginas descreveram esta classe citando um único gatilho, o id não-UUID (`22P02`). Há uma segunda porta que nenhum guard cobre: o **teto de `VARCHAR`**. O `operationSchema` não tem um único `.max()` e passa `data`/`changes` como objeto aberto (`backend/src/modules/sync/sync.schemas.js:13-46`), então um nome acima de 255 caracteres chega intacto às colunas de nome de `maps`/`layers`/`groups`/`briefings`, todas `VARCHAR(255)` (`backend/src/database/migrations/002_atlas.sql:81,118,142,330`), e o Postgres levanta `22001`. É alcançável só colando texto: o input de rename de camada não tem `maxLength` (`frontend/src/js/features_tab/layer-list.component.js:205-221`). O dispatcher pré-flush testa UUID-ness e não vê isso passar.

O que mudou é a consequência, e ela ficou mais silenciosa, não menos grave: `22001` é classe 22, então a op é recusada, o usuário vê um aviso genérico e **o rename é descartado** em vez de travar a fila. **A lição só fica codificada com teste**: `.max()` nos campos de nome do envelope (ou cap no cliente) mais uma regressão que empurre 300 caracteres e exija 422 antes do banco. Enquanto isso não existir, este parágrafo é só um aviso.

**3. O `entityId` que volta no ack pode não ser o que você mandou.** Ops de nível atlas carregam o sentinel `'atlas'`, mas `entity_id` é `UUID NOT NULL`, então o backend as grava sob o UUID do próprio atlas e devolve esse valor no ack (`backend/src/modules/sync/sync.service.js:672,717`). Sem esse restamp, o mesmo op chegava com `entityId` diferente conforme viesse por broadcast ou por pull incremental.

**4. Compactação quebra a correspondência gesto ↔ linha.** Acima de `MAX_QUEUE_SIZE`, `CREATE + DELETE` remove ambos e `CREATE + UPDATEs` vira um único `CREATE` com o `data` mais recente **preservando o `id` do CREATE** (`frontend/src/js/store/sync/operation-queue.js:324-345`). Os ids dos updates somem. Não assuma 1:1 entre gestos e linhas em `operations`.

**5. Os dois tetos de lote são independentes.** O cliente empurra de 100 em 100 (`frontend/src/js/store/sync/sync-engine.js:51`); o backend recusa acima de 500 (`backend/src/modules/sync/sync.schemas.js:6`). A folga esconde o acoplamento: subir `FLUSH_BATCH_SIZE` acima de 500 faz todo push virar 422. Isso travava o sync inteiro; desde a rede de segurança de 2026-07-25 o `flush` cai em modo de isolamento e passa a empurrar **uma op por requisição** indefinidamente, o que drena a fila mas é ordens de grandeza mais lento e não emite erro nenhum. Degradação silenciosa continua sendo defeito.

**6. O autor precisa semear a própria versão.** Como ele filtra o próprio eco WS, nunca saberia sua ordem de chegada; por isso `recordPushAcks` alimenta o guard de convergência com o `serverVersion` do ack (`frontend/src/js/store/sync/sync-engine.js:60-79`). Sem isso, a op **mais antiga** de um par sobrescreve a do autor.

## Contrato congelado

Os dois vocabulários (frontend `entityType`/`operationType`/`entityId` e legacy `target`/`type`/`targetId`) são normalizados no backend, com validação exigindo apenas um de cada par, o que torna **misturar campos legal**. Remover o legacy quebra clientes antigos; remover o frontend quebra este cliente. Ver [[sintese-contratos-congelados]].

## Relacionados

[[tipos-entidade-sync]], [[fila-operacoes-outbound]], [[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[snapshot-e-pull-incremental]], [[tabela-operations]], [[permissoes-atlas]], [[aplicacao-operacoes-remotas]], [[sintese-rest-vs-websocket]], [[canal-collab-websocket]], [[atlas-modelo-de-dados]].

## Fontes

- `src/js/store/sync/`: `frontend/src/js/store/sync/operation-factory.js` (shape as-built), `frontend/src/js/store/sync/operation-dispatcher.js` (gates de pré-flush), `frontend/src/js/store/sync/operation-queue.js` (chave `timestamp_id`, compactação), `frontend/src/js/store/sync/sync-engine.js` (flush verbatim, ack, semeadura do guard).
- `backend/src/modules/sync/`: `backend/src/modules/sync/sync.schemas.js` (dois vocabulários, `.unknown(true)`, teto 500), `backend/src/modules/sync/sync.service.js` (normalização, advisory lock, restamp de `entityId`).
- Guias absorvidos *05-sync-crdt* e *arquitetura-sync* §3 (ver contradição acima).
