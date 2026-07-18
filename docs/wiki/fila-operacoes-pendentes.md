# Fila de operações pendentes e reconexão

Enquanto o cliente está desconectado as operações são acumuladas no IndexedDB e, ao reconectar, o fluxo é pull das ops perdidas, merge com LWW, push das pendentes e reconexão do WebSocket com `sync_request`, não há replay de mensagens perdidas.

## Onde a fila vive de fato

A fila é uma instância dedicada de LocalForage, banco `ebgeo`, store `operation_queue` (`src/js/store/sync/operation-queue.js:17-20`). Cada entrada é gravada sob a chave `op_{timestamp}_{id}` (`operation-queue.js:26,83-85`), e a ordenação cronológica é obtida por ordenação lexicográfica dessas chaves (`operation-queue.js:224-229`). Isso só funciona porque timestamps em ms têm largura fixa (13 dígitos), qualquer chave com timestamp de largura diferente quebraria a ordem silenciosamente.

Há um índice reverso em memória `opId -> chave`, construído preguiçosamente, que dá dequeue O(1) (`operation-queue.js:64-75,142-155`). O conteúdo de cada entrada é o envelope descrito em [[envelope-operacao]]; a semântica de enfileiramento e compactação está em [[fila-operacoes-outbound]].

## O que entra na fila (e o que é descartado antes)

`logOperation` é o único portão de entrada (`operation-dispatcher.js:105-172`). Três descartes acontecem **antes** de enfileirar, e cada um é uma armadilha clássica de "editei e nada sincronizou":

1. **Logging desligado** (`operation-dispatcher.js:106-114`). O módulo nasce com `enabled = false`, mas `initServices()` chama `enableOperationLogging()` no boot (`store/services.js:81`), então na prática o logging fica ligado desde o início. Só `connectPublic` e `logoutAndDisconnect` o desligam (`sync-engine.js:227,375`). Consequência importante: **`disconnect()` puro (queda de rede) NÃO desliga o logging**, é exatamente por isso que as operações continuam se acumulando durante a desconexão.
2. **`SETTING` com id não-UUID** e diferente do sentinela `'atlas'` (`operation-dispatcher.js:120-126`).
3. **Op com `mapId` de contexto não-UUID** (`operation-dispatcher.js:133-139`). Edições feitas no mapa local `Principal` (chaveado por nome) nunca entram na fila. Ver [[store-origin-local-remoto]].

Os descartes 2 e 3 existem porque o Postgres rejeita o id não-UUID (erro 22P02) e **uma única op ruim reprova o lote inteiro**, travando todo o sync. Todos os descartes emitem um span `preflush.drop` com a razão nomeada ([[syncledger]]).

Um projeto construído inteiramente offline e anônimo não sobe por essa fila, ele sobe por `POST /api/v1/atlas/import`. Ver [[atlas-import-offline]] e [[modos-operacao]].

## O ciclo de drenagem

`startAutoFlush` roda um laço de 1500 ms, com guarda de reentrância e gate de trabalho (`sync-flush.js:126-136,64-87`). Ele só drena quando `connectionState.isOnline()` é verdadeiro (`sync-flush.js:65`, `connection-state.js:62-64`), ou seja, o estado `RECONNECTING` **não** libera flush. Além do intervalo, cada evento de mudança local ou remota (`FLUSH_TRIGGER_EVENTS`, `sync-flush.js:28-45`) dispara um flush oportunista, para as ops não esperarem um intervalo inteiro.

`SyncEngine.flush()` drena em lotes de 100 ops (`sync-engine.js:51,262-291`):

- faz `peek(100)`, envia via `apiClient.pushOperations`, e só então `dequeue(opIds)`;
- se o POST lança, o lote **não** é retirado da fila e o mesmo `peek` retorna as mesmas ops no próximo ciclo. Um lote envenenado, portanto, trava o sync indefinidamente, por isso o span `flush.push` com `outcome: FAILED` nomeia exatamente quais `opIds` estagnaram (`sync-engine.js:273-283`);
- **armadilha:** o dequeue usa os ids enviados, não os acks. Se o servidor responder HTTP 200 com `results[i].success === false` para alguma op, ela é retirada da fila mesmo assim, e a resposta só é lida para tracing e para semear `recordLocalAppliedVersion` (`sync-engine.js:60-80,284-285`). `idempotent: true` é tratado como sucesso, o que é correto, ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]].

Depois de cada flush o motor reconcilia o guard de edições locais pendentes contra o que sobrou na fila (`sync-engine.js:289,298-306`), evitando que um deferral vazado bloqueie ops remotas para sempre.

## Reconexão: a ordem real dos passos

O código não segue o diagrama do guia. Ordem efetiva:

1. O socket cai. `_onClose` transita para `RECONNECTING` e agenda o retry (`ws-client.js:436-452`). Como não está `ONLINE`, o auto-flush para de empurrar; as ops seguem se acumulando no IndexedDB.
2. Backoff exponencial `1000 * 2^tentativas`, teto de 30000 ms (`ws-client.js:32-33,462-476`), sempre com o **mesmo `clientId`** ([[client-id-estavel]]), o que preserva presença e idempotência e cancela o `away` dentro da janela de graça ([[presenca-away-vs-saida]]).
3. No frame `connected`, se o estado anterior era `RECONNECTING`, o cliente envia `sync_request(lastVersion)` (`ws-client.js:416-427,236-237`). O pull de recuperação portanto acontece **pelo WebSocket**, não por um GET REST.
4. O servidor responde `sync_response` com ops incrementais ou, se o cliente estiver muito defasado, um snapshot completo. O engine aplica um ou outro e avança `lastVersion` (`sync-engine.js:407-425`). Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].
5. Só quando a transição para `ONLINE` acontece o auto-flush volta a empurrar as pendentes. Conflitos com o que chegou do servidor são resolvidos por [[modelo-conflito-lww]] (ordem de chegada no servidor, não timestamp, ver [[sintese-nao-e-crdt]]).

O `sync_response` é descartado se chegar depois de uma desconexão, para não persistir dados remotos em um store sendo destruído (`sync-engine.js:407-412`).

`lastVersion` avança monotonicamente a partir do `server_version` de cada op inbound (`ws-client.js:384-394`) e do `currentVersion` do `sync_response` (`ws-client.js:314-316`). O comentário no código é explícito: buracos de numeração **não** são tratados como perda (isso gerava tempestades de `sync_request`); perda real só ocorre atravessando uma desconexão, e é justamente o `sync_request` da reconexão que a recupera.

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §2.1 desenha o fluxo como `GET /atlas/:id/sync/:version` (pull REST) → merge → `POST /atlas/:id/sync` (push) → só então reconectar o WS. O código faz o inverso: `ws-client.js:462-476` reconecta o socket primeiro, `ws-client.js:424-427` só então pede o pull via `sync_request`, e `sync-flush.js:65` só libera o push depois da transição para `ONLINE`.

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §2.2 descreve um `PendingOperationsManager` sobre o object store `pendingOperations` com campo `pendingSince`, removendo entradas por `ack.opId`. O código usa a instância LocalForage `ebgeo/operation_queue` com chaves `op_{timestamp}_{id}` e sem `pendingSince` (`operation-queue.js:17-20,83-85`), e remove pelos ids enviados, não pelos acks (`sync-engine.js:285`). O trecho do guia é pseudocódigo ilustrativo, não o contrato.

## Sem replay, e por quê

O canal não guarda buffer por cliente desconectado ([[canal-collab-websocket]], [[websocket-collab]]). Mensagens emitidas durante a queda simplesmente não são reenviadas; a recuperação é sempre `sync_request(lastVersion)`. A decisão evita estado durável por socket no servidor, que hoje é single-instance e mantém salas, presença e timers de `away` em memória ([[sintese-limites-collab]]). O preço é que o cliente **precisa** manter `lastVersion` correto, se ele zerar, o servidor devolve snapshot inteiro em vez de incremento ([[sintese-rest-vs-websocket]]).

## Armadilhas de retenção e perda

- **Auto-purge de 7 dias.** `purgeOldOperations` roda a cada 6 horas e descarta ops mais velhas que 7 dias (`operation-queue.js:360-392`), ligado no boot em `services.js:82`. Um cliente que ficar mais de uma semana offline **perde silenciosamente** as edições mais antigas da fila.
- **Troca de atlas e logout limpam a fila.** `clearAllDataStore()` chama `operationQueue.clear()` (`store/store.js:202`, também em `store.js:154`), e `open-atlas.service.js:56-62` faz `stopAutoFlush()` + `disconnect()` + `clearAllDataStore()` antes de conectar no novo atlas. Ops pendentes não flushadas **morrem ali**, por desenho: elas pertencem ao atlas abandonado e vazariam para o atlas errado se sobrevivessem. Ver [[atlas]] e [[store-origin-local-remoto]].
- **Compactação só a partir de 10000 entradas** (`operation-queue.js:29,102-104,260-266`). Abaixo disso a fila cresce sem merge, então uma sessão offline longa empurra um lote enorme e sequencial no reconnect (100 por requisição HTTP).
- **Um lote reprovado bloqueia tudo o que vem depois**, já que o `peek` é sempre da cabeça da fila em ordem cronológica.
- Sem permissão de escrita no atlas o push é recusado pelo servidor e o lote fica preso; confira o papel antes de culpar a rede ([[permissoes-atlas]], [[permissao-vs-papel]]).

## Diagnóstico

A cadeia completa é observável por op: `preflush.drop` ou `enqueue` (dispatcher), `flush.push` e `push.ack` (engine), `ws.inbound` / `conn.transition` (ws-client). Detalhes em [[syncledger]]. Para o ciclo de vida de sessão que envolve esse fluxo no boot e no F5, ver [[sessao-boot-e-ciclo-de-vida]].

## Fontes
- `docs/guias/08-offline-import.md`: diagrama de reconexão (pull/merge/push/WS), gestão de operações pendentes, indicadores de status, modos anônimo/autenticado/público, import de atlas offline.
- `docs/guias/04-websocket-collab.md`: `sync_request`/`sync_response` (§3.6), recuperação após reconexão (§9), ausência de replay e escala single-instance (§10), `clientId` estável, janela de graça `away`.
- `src/js/store/sync/operation-queue.js`: store IndexedDB real, formato de chave, índice reverso, compactação, auto-purge.
- `src/js/store/sync/sync-flush.js`: laço de auto-flush, gate `isOnline()`, eventos gatilho.
- `src/js/store/sync/sync-engine.js`: `flush()` em lotes de 100, dequeue pós-aceite, `pull()`, handler de `syncResponse`, `logoutAndDisconnect`.
- `src/js/store/sync/ws-client.js`: backoff exponencial, `sync_request` no reconnect, avanço de `lastVersion`.
- `src/js/store/sync/operation-dispatcher.js`: descartes pré-fila (logging off, id/`mapId` não-UUID) e enfileiramento.
- `src/js/store/store.js`, `src/js/account/open-atlas.service.js`, `src/js/store/services.js`: limpeza da fila na troca de atlas/logout e ativação de logging/auto-purge no boot.
