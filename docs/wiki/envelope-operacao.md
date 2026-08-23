# Envelope de Operação

Unidade atômica de sincronização do EBGeo: o objeto que `createOperation` monta em `frontend/src/js/store/sync/operation-factory.js` e que o backend aceita em dois vocabulários. O shape está no próprio arquivo; esta página cobre o que ele não conta.

## Por que existe

Não há rota REST de escrita **incremental** para entidades colaborativas (feição, camada, grupo, mapa, briefing, slide, 3D, 360). Toda mutação sincronizável vira operação e viaja por push HTTP ou pelo canal WS. Isso concentra ordenação, idempotência e permissão em um único ponto, e é o que viabiliza o offline-first: a operação nasce no cliente, é persistida em IndexedDB e só depois sai pela rede ([[fila-operacoes-outbound]]).

## O envelope vai verbatim, e isso é intencional

`flush()` empurra os objetos da fila sem projeção (`frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/api-client.js`). Logo `previousData`, `batchId`, `batchIndex` e `traceId` cruzam a rede mesmo sem uso servidor-side.

Isso só funciona porque o `.unknown(true)` no fim de `operationSchema` (`backend/src/modules/sync/sync.schemas.js`) vence o `stripUnknown: true` do middleware (`middleware/validate.js`). Verificado empiricamente no Joi 17.13.x desta instalação: campos não declarados sobrevivem intactos. **Remover o `.unknown(true)` apaga silenciosamente `previousData`, `batchId` e `batchIndex` sem erro de validação** e sem nenhum teste vermelho.

Declarar um campo explicitamente (o schema faz isso com `traceId`, `atlasId` e `scopeSuffix`) não é redundância: o `.unknown(true)` transporta qualquer valor, e a declaração é o que impõe o TIPO. Sem ela um `atlasId` numérico atravessa intacto, e a guarda que o lê no servidor vê um não-string e cala. Medido pela recusa de tipo errado em `backend/tests/integration/sync-carimbo-de-atlas.test.js`, que é o controle negativo daquelas duas linhas do schema.

## Os campos que enganam

- **`timestamp`** é ordenação **local** apenas. Nunca ordena entre máquinas.
- **`lamportTimestamp`** avança em `max(local, remoto)+1` (`frontend/src/js/store/sync/operation-factory.js`, chamado em `frontend/src/js/store/sync/sync-gateway.js`), é persistido e ecoado no pull, mas o reducer de conflito nunca o consulta: quem vence é o `serverVersion`. O relógio existe e não decide nada. Ver [[modelo-conflito-lww]].
- **`serverVersion` não é campo do cliente.** É carimbado pelo servidor e volta no ack, no broadcast e no pull. É a única chave de ordenação correta ([[tabela-operations]]).
- **`mapId`** é contexto, não alvo. Ops de nível atlas (`map`, `briefing`, `setting`) passam `null`.
- **`previousData`** existe para undo **local**. Viaja porque o envelope vai verbatim, não porque o backend precise dele. Não construa merge servidor-side em cima disso.
- **`clientId`** não é credencial ([[client-id-estavel]]); **`traceId`** é best-effort e `null` nunca quebra o sync ([[syncledger]]).
- **`scopeSuffix` e `atlasId`** dizem onde a op NASCEU, e são a metade de identidade da fila por atlas ([[namespace-por-atlas]], [[fila-operacoes-outbound]]). `scopeSuffix` é o endereço do banco local (a string VAZIA é o slot legado, um endereço de verdade; `null` é "nenhum atlas montado"); `atlasId` é o atlas de servidor, `null` quando não há. Os dois divergem no slot adotado pelo resgate, que é local e mora nos bancos de um atlas de servidor. **Eles NÃO são persistidos**: o INSERT usa o atlas da ROTA e uma lista fixa de colunas, então o par viaja no rebroadcast e some no pull incremental (medido em `backend/tests/integration/sync-carimbo-de-atlas.test.js`). Logo, nunca construa guarda de cliente sobre a presença deles numa op RECEBIDA. No servidor eles têm um único uso legítimo: `foreignAtlasDenialReason` recusa por operação a op que declara pertencer a outro atlas.
- **`id`** é a âncora: sobrevive intacto por `push → INSERT → broadcast/pull → apply`, é a chave de `UNIQUE (atlas_id, op_id)` e a chave de junção do ledger. Ver [[idempotencia-e-convergence-guard]] e [[ack-idempotencia]].

## Armadilhas

**1. O cliente nunca emite `changes`.** `createOperation` só produz `data` (`frontend/src/js/store/sync/operation-factory.js`); não há uma única ocorrência de `changes` em `frontend/src/js/store/sync/`. O backend compensa: num `update` sem `changes`, usa `data` como `changes` (`backend/src/modules/sync/sync.service.js`). Quem espera `changes` na saída do cliente procura um campo inexistente, e o inverso também engana: o envelope real sempre traz `previousData`, `lamportTimestamp` e `traceId`, mais `batchId` quando a op nasce em lote (`createBatchOperations`, mesmo arquivo).

**2. Uma op malformada não envenena mais o lote, e o guard pré-flush continua valendo.** Até 2026-07-25 o push rodava numa transação única e uma op recusada pelo Postgres revertia o batch inteiro; nada era dequeued e a fila re-peekava as mesmas ops para sempre, ou seja sync travado, não degradado. Hoje cada op corre num SAVEPOINT e a violação de dado (classe 22/23) volta recusada **por operação**, com motivo ([[tabela-operations]], [[ack-idempotencia]]). O dispatcher segue dropando **antes** de enfileirar (`frontend/src/js/store/sync/operation-dispatcher.js`), a saber logging desabilitado, `SETTING` com `entityId` não-UUID fora do sentinel `'atlas'`, e qualquer `mapId` não-UUID (mapa local nome-chaveado, ex. `Principal`), porque o motivo dele nunca foi só o travamento: é impedir que feição local vaze para atlas do servidor. Ver [[dominio-local-vs-remoto]].

**2b. O gatilho não é só o id: qualquer valor que o Postgres recuse é uma op perdida.** Nove páginas descreveram esta classe citando um único gatilho, o id não-UUID (`22P02`). Há uma segunda porta que nenhum guard cobre: o **teto de `VARCHAR`**. O `operationSchema` não tem um único `.max()` e passa `data`/`changes` como objeto aberto (`backend/src/modules/sync/sync.schemas.js`), então um nome acima de 255 caracteres chega intacto às colunas de nome de `maps`/`layers`/`groups`/`briefings`, todas `VARCHAR(255)` (`backend/src/database/migrations/003_atlas.sql`), e o Postgres levanta `22001`. É alcançável só colando texto: o input de rename de camada não tem `maxLength` (`frontend/src/js/features_tab/layer-list.component.js`). O dispatcher pré-flush testa UUID-ness e não vê isso passar.

O que mudou é a consequência, e ela ficou mais silenciosa, não menos grave: `22001` é classe 22, então a op é recusada, o usuário vê um aviso genérico e **o rename é descartado** em vez de travar a fila. **A lição só fica codificada com teste**: `.max()` nos campos de nome do envelope (ou cap no cliente) mais uma regressão que empurre 300 caracteres e exija 422 antes do banco. Enquanto isso não existir, este parágrafo é só um aviso.

**3. O `entityId` que volta no ack pode não ser o que você mandou.** Ops de nível atlas carregam o sentinel `'atlas'`, mas `entity_id` é `UUID NOT NULL`, então o backend as grava sob o UUID do próprio atlas e devolve esse valor no ack (`backend/src/modules/sync/sync.service.js`). Sem esse restamp, o mesmo op chegava com `entityId` diferente conforme viesse por broadcast ou por pull incremental.

**4. Compactação quebra a correspondência gesto ↔ linha.** Acima de `MAX_QUEUE_SIZE`, `CREATE + DELETE` remove ambos e `CREATE + UPDATEs` vira um único `CREATE` com o `data` mais recente **preservando o `id` do CREATE** (`frontend/src/js/store/sync/operation-queue.js`). Os ids dos updates somem. Não assuma 1:1 entre gestos e linhas em `operations`.

**5. Os dois tetos de lote são independentes.** O cliente empurra de 100 em 100 (`frontend/src/js/store/sync/sync-engine.js`); o backend recusa acima de 500 (`backend/src/modules/sync/sync.schemas.js`). A folga esconde o acoplamento: subir `FLUSH_BATCH_SIZE` acima de 500 faz todo push virar 422. Isso travava o sync inteiro; desde a rede de segurança de 2026-07-25 o `flush` cai em modo de isolamento e passa a empurrar **uma op por requisição** indefinidamente, o que drena a fila mas é ordens de grandeza mais lento e não emite erro nenhum. Degradação silenciosa continua sendo defeito.

**6. O autor precisa semear a própria versão.** Como ele filtra o próprio eco WS, nunca saberia sua ordem de chegada; por isso `recordPushAcks` alimenta o guard de convergência com o `serverVersion` do ack (`frontend/src/js/store/sync/sync-engine.js`). Sem isso, a op **mais antiga** de um par sobrescreve a do autor.

## Contrato congelado

Os dois vocabulários (frontend `entityType`/`operationType`/`entityId` e legacy `target`/`type`/`targetId`) são normalizados no backend, com validação exigindo apenas um de cada par, o que torna **misturar campos legal**. Remover o legacy quebra clientes antigos; remover o frontend quebra este cliente. Ver [[sintese-contratos-congelados]].

## Relacionados

[[tipos-entidade-sync]], [[fila-operacoes-outbound]], [[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[snapshot-e-pull-incremental]], [[tabela-operations]], [[permissoes-atlas]], [[aplicacao-operacoes-remotas]], [[sintese-rest-vs-websocket]], [[canal-collab-websocket]], [[atlas-modelo-de-dados]].
