# Sincronização por operações e LWW

A colaboração é offline-first e server-authoritative: toda mutação vira uma operação enfileirada localmente (IndexedDB, com compactação e relógio de Lamport) que o servidor ordena e resolve por last-write-wins por ordem de chegada, com idempotência por `op_id`, não é um CRDT verdadeiro apesar do nome nas rotas.

## O caminho de uma mutação

1. **Escrita local primeiro.** A mutação passa por `runTransaction` (persistência no IndexedDB antes de qualquer efeito colateral). O log de sync roda no `deferAsync`, então quando a operação é criada o dado já é durável localmente.
2. **Log da operação.** `logFeatureOperation`/`logLayerOperation`/... (`src/js/store/sync/operation-dispatcher.js:278`+) chamam `logOperation`, que cria o envelope via `createOperation` (`operation-factory.js:140`) e o enfileira.
3. **Fila outbound.** `operationQueue.enqueue` grava em um store IndexedDB dedicado `ebgeo/operation_queue`, com chave `op_{timestamp}_{id}` para ordenação lexicográfica cronológica (`operation-queue.js:26,84`). Ver [[fila-operacoes-outbound]] e [[fila-operacoes-pendentes]].
4. **Flush.** `sync-flush.js` roda a cada 1500 ms e também por evento de mudança, com in-flight guard, e só transmite se `connectionState.isOnline()` (`sync-flush.js:65,126`). O `SyncEngine.flush()` empurra lotes de até 100 ops via `apiClient.pushOperations` e só faz `dequeue` depois do aceite do servidor (`sync-engine.js:51,262-291`).
5. **Servidor ordena e aplica.** `pushOperations` (backend `src/modules/sync/sync.service.js:630`) insere no log e aplica na tabela da entidade.
6. **Broadcast + apply remoto.** Os pares recebem pelo [[canal-collab-websocket]] e aplicam via [[aplicacao-operacoes-remotas]].

O envelope em si está em [[envelope-operacao]]; a lista de `entityType` em [[tipos-entidade-sync]]; a persistência do log em [[tabela-operations]].

## O envelope, na prática

`createOperation` produz `{ id, entityType, operationType, entityId, mapId, data, previousData, timestamp, lamportTimestamp, clientId, traceId }` (`operation-factory.js:151-163`). Pontos que costumam confundir:

- **`id` é o `op_id`**, gerado por `generateUUID()` no cliente. É a chave de idempotência no servidor e a chave de correlação do [[syncledger]].
- **`clientId` é estável e persistido** em `localStorage` sob `ebgeo_client_id` (`operation-factory.js:41-51`). É ele que faz o filtro de self-echo no WebSocket (`ws-client.js:397`), então o autor **nunca** aplica o próprio eco. Ver [[client-id-estavel]].
- **`data` carrega o payload inteiro**, mesmo em `update`. O frontend nunca emite `changes`; o backend faz o fallback `changes = data` quando o tipo é `update` (`sync.service.js:216-219`). Consequência direta: **o grão do LWW é a entidade inteira, não a propriedade**. Dois usuários editando propriedades diferentes da mesma feição não fazem merge, o último a chegar sobrescreve tudo.
- **`previousData`** existe para undo local e não é usado pelo servidor. Undo/redo nunca sincroniza.

## Compactação e purga da fila

`_compactEntityOps` (`operation-queue.js:324-350`) roda quando a fila passa de `MAX_QUEUE_SIZE = 10000` e agrupa por `entityType:entityId`:

- CREATE seguido de DELETE, remove as duas (a entidade nunca precisou existir no servidor).
- CREATE seguido de UPDATEs, funde num único CREATE com o `data` mais recente.
- UPDATEs seguidos de DELETE, mantém só o DELETE.
- Vários UPDATEs, mantém só o último.

Além disso há auto-purga de operações com mais de 7 dias, a cada 6 horas (`operation-queue.js:360,381`). **Armadilha:** a compactação quebra a simetria 1-para-1 entre op enfileirada e ack, e é exatamente por isso que existe o `reconcilePendingLocalEdits` (ver abaixo).

## Guardas pré-flush (o "poison pill")

Um único op inválido faz o **lote inteiro** falhar no `pushOperations` e trava toda a sincronização. Por isso o dispatcher descarta antes de enfileirar:

- **`mapId` de contexto que não é UUID** (`operation-dispatcher.js:133`). O mapa local padrão `Principal` é chaveado por nome, então ops desenhadas nele nunca vazam para um atlas do servidor, e o Postgres nunca recebe um `22P02`. Este é o mecanismo real de anti-vazamento entre [[dominio-local-vs-remoto]] e [[store-origin-local-remoto]].
- **`setting` com `entityId` que não é UUID nem o sentinela `'atlas'`** (`operation-dispatcher.js:120`). Chaves locais como `lastActiveMap` são estado de view por cliente e jamais podem subir.
- **Logger de map-setting** (`mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal`): descarta quando `mapId` não é UUID (`operation-dispatcher.js:266`).

Cada descarte grava um span `preflush.drop` com o motivo, então "editei e nada sincronizou" tem causa nomeada em vez de sumiço silencioso.

> [!CONTRADICAO 2026-07-18] `docs/visao-e-principios.md` §P1 diz que "o log de operações e o flush são gated por conexão (`operation-dispatcher.js`, `sync-flush.js`)". Só o **flush** é gated. O log é ligado incondicionalmente no boot, em `src/js/store/services.js:81` (`enableOperationLogging()`), e só é desligado em dois casos: conexão de visitante público anônimo (`sync-engine.js:227`) e logout (`sync-engine.js:375`). Deslogado, as ops continuam entrando na fila local; o que impede vazamento é o descarte por `mapId` não-UUID acima, mais a auto-purga de 7 dias.

## Ordenação no servidor: por que "ordem de chegada" e não timestamp

`pushOperations` abre uma transação e **toma um advisory lock por atlas antes do primeiro INSERT** (`sync.service.js:656-670`):

- `server_version` vem de `nextval('atlas_version_seq')` no INSERT, mas a visibilidade só acontece no COMMIT. Sem o lock, duas pushes concorrentes podem commitar fora de ordem: um puller vê a v101, guarda `lastVersion=101`, e a v100 que commitou depois nunca mais é devolvida pelo pull incremental (`WHERE server_version > $lastVersion`). Operação perdida para sempre.
- O lock é transaction-scoped (solta no COMMIT/ROLLBACK) e por atlas, então atlas distintos continuam paralelos.
- Há `SET LOCAL lock_timeout = '5s'` **antes** da espera: a conexão do pool fica retida enquanto bloqueia, e com `poolMax=10` dez pushes concorrentes no mesmo atlas esgotariam o pool inteiro, derrubando até `/health` e `/auth/login`. O timeout converte contenção em um 503 retentável.

Logo, `server_version` é simultaneamente o **cursor do pull incremental** ([[snapshot-e-pull-incremental]]) e a **verdade da ordenação LWW** ([[modelo-conflito-lww]]).

Timestamp de parede (`op.timestamp`) e `lamportTimestamp` são **gravados mas não decidem nada**. O relógio de Lamport avança em `advanceLamportClock` (`operation-factory.js:85`) e viaja no envelope, e só. Ver [[sintese-nao-e-crdt]].

## Idempotência por `op_id`

O INSERT no log é `ON CONFLICT (atlas_id, op_id) DO NOTHING` (`backend/src/modules/sync/sync.queries.js:6`). Quando não insere nada, o servidor busca a operação anterior e responde com `{ opId, serverVersion, idempotent: true, entityId }` **sem reaplicar o efeito** (`sync.service.js:700-722`). É isso que torna reenvio, replay de reconexão e retry de lote seguros. Ver [[idempotencia-e-convergence-guard]] e [[ack-idempotencia]].

Detalhe fácil de errar: ops de nível atlas chegam com o sentinela `'atlas'` como `entityId`, mas `operations.entity_id` é `UUID NOT NULL`. O servidor grava essas contra o **id do próprio atlas** (`sync.service.js:689`) e devolve no ack o `entity_id` **como gravado** (`sync.service.js:734`), para que o par receba o mesmo `entityId` tanto ao vivo quanto via pull incremental.

## Convergência no cliente: o convergence guard

O LWW do servidor não basta, porque o autor filtra o próprio eco e edita de forma otimista antes do ack. `remote-operation-handler.js` implementa três peças:

1. **`CONVERGENCE_GUARDED`** (`remote-operation-handler.js:115-125`): `feature`, `layer`, `group`, os três tipos 3D, `cameraPosition3d`, e os dois de 360. São os tipos cujo UPDATE substitui em bloco.
2. **Defer enquanto há edição local não-ackada.** `markLocalEditPending` é chamado no caminho outbound (`operation-dispatcher.js:147`); enquanto o contador for maior que zero, um op remoto para a mesma entidade é bufferizado em vez de aplicado (`remote-operation-handler.js:266-272`), com teto de 200 por entidade.
3. **Version guard.** `shouldApplyVersion` descarta um op com `serverVersion` menor que o já aplicado (`remote-operation-handler.js:128`). Quando `serverVersion` é nulo (legado ou sem backend), não há guarda.

O autor **semeia sua própria versão a partir do ack de push**: `recordPushAcks` chama `recordLocalAppliedVersion(op.entityId, sv)` para todo tipo guardado (`sync-engine.js:60-79`). Sem isso, o autor nunca saberia a ordem servidor do próprio op e um op **mais antigo** de um par poderia sobrescrever o valor correto.

**Auto-cura obrigatória:** o contador por op vaza quando compactação, ops em lote, acks sem versão ou um lote envenenado quebram a simetria incremento/decremento, e um contador vazado deferiria os ops remotos daquela entidade para sempre (divergência silenciosa). Por isso `_reconcileConvergenceGuard` roda **depois de todo flush**, incluindo o caminho de erro, conferindo contra a fila (a fonte da verdade) e reproduzindo os ops deferidos (`sync-engine.js:281,289,298`; `remote-operation-handler.js:203`).

Caso irmão: um `feature/create` pode chegar antes do `map/create` do mapa que o contém (A cria um mapa e desenha nele em seguida). O handler **bufferiza por `mapId`** (teto de 1000) e reaplica quando o mapa chega, passando os ops reproduzidos pelo mesmo version guard (`remote-operation-handler.js:42-82`). Descartar ali seria perda de dado silenciosa no par.

## Delete vence update

O soft-delete marca `deleted_at`; o `buildUpdateQuery` de feature/layer/group **não** filtra `deleted_at IS NULL` (`sync.service.js:1063-1083`), mas também não limpa `deleted_at`. Resultado: um UPDATE que chega depois de um DELETE altera colunas de uma linha já morta e não a ressuscita, e o snapshot continua não a devolvendo. Delete apagar um layer também faz cascade nos features do layer, na mesma transação (`sync.service.js:1645`).

## Escrita colaborativa é só por sync

Não existe rota REST de escrita para feature, layer, group, map, briefing, slide, cesium3d ou streetview360. `maps` e `briefings` têm apenas GET. Toda mutação viaja como operação, seja por `POST /atlas/:id/sync` seja por mensagem `operation` no WebSocket. Ver [[sintese-rest-vs-sync]] e [[sintese-rest-vs-websocket]]. O gate de papel por atlas é aplicado em `assertOperationAllowed` antes do INSERT (`sync.service.js:677`); ver [[permissoes-atlas]] e [[permissao-vs-papel]].

## Armadilhas para não errar

- **Não confie em merge por propriedade.** O `update` substitui a entidade inteira. Se um novo campo precisa sobreviver a edição concorrente, ou ele entra no mesmo payload, ou vira entidade própria (foi assim que resposta de comentário virou entidade separada, ver [[comentario-espacial]]).
- **Nunca deixe um op poder ter `mapId` ou `entityId` não-UUID chegar ao flush.** Um `22P02` derruba o lote inteiro e trava a sincronização de todos os tipos, não só do op ruim.
- **Ao adicionar um `entityType` que substitui em bloco, inclua-o em `CONVERGENCE_GUARDED`.** Sem isso ele não tem nem defer nem version guard, e edições concorrentes divergem entre os pares.
- **Ao adicionar campo persistido, cubra os dois caminhos** (`.ebgeo` e sync). Cobertura de sync tem que ser superconjunto do `.ebgeo`, ver [[atlas-modelo-de-dados]] e [[formato-ebgeo-roundtrip]].
- **O ack é a única fonte da ordem servidor para o autor.** Descartar a resposta de `pushOperations` (como já foi feito historicamente) quebra a convergência de forma silenciosa e só aparece em teste de dois usuários.
- **Deslogado, a fila continua acumulando** até a purga de 7 dias. Ao desconectar/deslogar, `disconnect`/`logoutAndDisconnect` desligam o log e zeram o atlas, ver [[sessao-boot-e-ciclo-de-vida]].

> [!CONTRADICAO 2026-07-18] `docs/acoes-interface-multiusuario.md:638` diz "resolução de conflito é last-write-wins com timestamp do servidor". O código resolve por **ordem de chegada**: `server_version` sai de `nextval('atlas_version_seq')` sob advisory lock por atlas (`backend/src/modules/sync/sync.service.js:636-661`) e o cliente compara `serverVersion` em `shouldApplyVersion` (`src/js/store/sync/remote-operation-handler.js:128`). Nenhum timestamp participa da decisão. O topo do mesmo documento (linha 6) e `docs/guias/00-visao-geral.md:86` estão corretos.

> [!CONTRADICAO 2026-07-18] `docs/guias/00-visao-geral.md:18,109` e as migrações `003_sync.sql` chamam o mecanismo de "CRDT" (log CRDT, guia "05 - Sync CRDT"). Não é CRDT: o servidor define ordem total e resolve por LWW, sem merge comutativo, e o módulo `src/crdt` (LWW por timestamp) foi removido do backend. `docs/ui-ux-ebgeo.md:161` já registra a correção. O nome sobrevive apenas em rotas, tabelas e títulos de guia. Ver [[sintese-nao-e-crdt]].

## Relacionados

[[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[envelope-operacao]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[websocket-collab]], [[presenca-colaborativa]], [[syncledger]], [[modos-operacao]], [[atlas]], [[sintese-limites-collab]].

## Fontes

- `docs/visao-e-principios.md`: P6 (offline-first, fila que drena), P8 (undo local), P10 (LWW sem locks), §7 (tabela de mecanismos de resiliência), §6 (isolamento por atlas e chaveamento UUID vs nome); contradição do P1 sobre o gating do log.
- `docs/guias/00-visao-geral.md`: decisão D2 (LWW por ordem de chegada, não por timestamp; delete vence updates subsequentes) e o uso residual do nome "CRDT".
- `docs/acoes-interface-multiusuario.md`: princípio de ausência de locks; contradição sobre "timestamp do servidor".
- `docs/ui-ux-ebgeo.md`: enquadramento "server-authoritative LWW por ordem de chegada, não é CRDT verdadeiro" e o ponto sobre respostas de comentário como entidades próprias.
- `src/js/store/sync/operation-factory.js`, `operation-queue.js`, `operation-dispatcher.js`, `sync-flush.js`, `sync-engine.js`, `remote-operation-handler.js`, `ws-client.js`, `src/js/store/services.js`: envelope, `clientId`, fila e compactação, guardas pré-flush, flush em lote, ack, convergence guard, filtro de self-echo.
- `backend/src/modules/sync/sync.service.js` e `sync.queries.js`: advisory lock por atlas, `server_version`, idempotência `ON CONFLICT (atlas_id, op_id)`, fallback `changes = data`, sentinela `'atlas'`, guardas IDOR e cascade de delete de layer.
- `backend/CLAUDE.md`: contrato "escrita colaborativa é só via sync", remoção do módulo `src/crdt`, hierarquia de permissão por atlas.
