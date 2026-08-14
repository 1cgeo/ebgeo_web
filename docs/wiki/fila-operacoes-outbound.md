# Fluxo Outbound: Fila Durável, Compaction, Flush e Reconexão

O que o código do caminho outbound não conta sozinho: onde ops somem de propósito, o que a compaction não faz, o que trava a fila inteira e quais gestos de interface geram fan-out alto.

O caminho em si se lê seguindo as chamadas de `runTransaction` (`frontend/src/js/store/store-transaction.js`) até `flush` (`frontend/src/js/store/sync/sync-engine.js`), e os módulos do sync são densamente comentados: os porquês de baixo nível (poison pill, semente de versão no ack, filtro do próprio eco, buracos de `serverVersion`) já estão nos comentários. Esta página cobre só o que atravessa arquivos. Envelope em [[envelope-operacao]], lado servidor em [[tabela-operations]] e [[modelo-conflito-lww]].

## O flag de logging mente no comentário

`enabled` nasce `false` em `frontend/src/js/store/sync/operation-dispatcher.js` e um comentário logo abaixo diz que offline/anônimo não enfileira. **Isso está errado na prática:** `initServices()` chama `enableOperationLogging()` no boot (`frontend/src/js/store/services.js`), inclusive no boot anônimo. Um usuário offline enfileira ops normalmente para qualquer mapa com id UUID.

Quem realmente contém a fila offline é a guarda de `mapId` não-UUID (que dropa tudo do mapa local `Principal`, ver [[dominio-local-vs-remoto]]) e o auto-purge de 7 dias, não o flag. Só `connectPublic` e `logoutAndDisconnect` desligam o logging.

**Consequência que ninguém espera:** `disconnect()` puro (queda de rede) **não** desliga o logging. É por isso que as ops continuam se acumulando durante a desconexão, e é o comportamento desejado, mas não está escrito em lugar nenhum.

Projeto construído inteiramente offline e anônimo não sobe por esta fila, sobe por `POST /api/v1/atlas/import` ([[atlas-import-offline]], [[modos-operacao]]).

## Contratos congelados

- **Formato da chave da fila.** `op_{timestamp}_{id}` (`_buildKey`, `frontend/src/js/store/sync/operation-queue.js`) é ordenado por sort lexicográfico (`_getOrderedKeys`). Funciona porque epoch em ms tem 13 dígitos e terá até 2286. Mudar o formato quebra a ordem cronológica **em silêncio**, sem erro e sem teste vermelho óbvio.
- **`mapId` de op escopada em mapa tem que ser UUID.** Caso contrário é dropada pré-flush por design.
- **Log da op vai dentro do `deferAsync`**, nunca antes da persistência. É o que garante que não existe op sincronizada sem dado local correspondente.
- **Entidade nova precisa de entrada em `EntityType` e de um `logXxxOperation`**; sem isso a mutação é puramente local ([[tipos-entidade-sync]]).

## Armadilhas

**O `await` do store resolve antes de a op estar na fila.** `commit()` roda os efeitos assíncronos em fire-and-forget (`frontend/src/js/store/store-transaction.js`). Teste de integração que inspeciona a fila logo após uma mutação precisa aguardar a microtask; confiar no `await addFeature(...)` produz flake.

**Não presuma compaction.** Ela só roda acima de `MAX_QUEUE_SIZE` (10000, `frontend/src/js/store/sync/operation-queue.js`). É válvula de sobrecarga, não otimização do caminho normal: 40 arrastes de uma feição viram 40 `UPDATE`s empurrados um a um.

**Compaction não conserta o relógio.** No merge `CREATE + UPDATEs` só o campo `data` é trocado (`_compactEntityOps`); `timestamp`, `lamportTimestamp` e `id` continuam os do `CREATE`. Não corrompe a resolução de conflito (que é LWW por ordem de chegada, [[modelo-conflito-lww]]), mas invalida qualquer raciocínio baseado no Lamport da op.

**Ack com `rejected: true` ainda é dequeueado.** O dequeue usa os ids enviados, não os acks. A resposta só é lida para tracing e para semear versões. Uma operação recusada individualmente pelo servidor dentro de um HTTP 200 desaparece da fila e nunca é reenviada.

**Um lote reprovado bloqueia tudo atrás dele, exceto em dois status.** O `peek` é sempre da cabeça em ordem cronológica e o lote falho não é dequeueado, logo head-of-line blocking. A exceção é `PERMANENT_PUSH_REJECTIONS = {400, 422}`: aí o flush entra em **modo de isolamento**, reduz o lote a uma op para identificar a ofensora por construção (nunca por um id que o servidor mande), a descarta, avisa o usuário com um toast e segue. A lista é curta de propósito, e é a parte que importa reter: **401, 403, 409, 429 e 5xx ficam de fora**, porque a op ainda pode valer depois de um refresh, de uma permissão devolvida ou de o servidor voltar. Na dúvida a fila espera, já que descartar op boa é perda irreversível e fila travada não é. Então, antes de culpar a rede, confira o papel do usuário no atlas: sem permissão de escrita o push é recusado e a fila trava ([[permissoes-atlas]]). O gate fino é do servidor por operação; o dispatcher não checa papel.

**Perda silenciosa.** `purgeOldOperations` (7 dias, `frontend/src/js/store/sync/operation-queue.js`) remove ops antigas sem log por op e sem evento de erro. Troca de atlas e logout limpam a fila inteira (`operationQueue.clear()` em `frontend/src/js/store/store.js`, via `frontend/src/js/account/open-atlas.service.js`) por desenho: ops pendentes pertencem ao atlas abandonado e vazariam para o atlas errado. Nos dois casos a recuperação é snapshot ([[snapshot-e-pull-incremental]]), não replay da fila. Ver [[atlas-modelo-de-dados]].

**O gate de flush é estrito.** `connectionState.isOnline()` só aceita `ONLINE` (`frontend/src/js/store/sync/connection-state.js`); `RECONNECTING` **não** libera push, mesmo com socket em recuperação.

**Falta gatilho de evento para metade dos tipos.** `FLUSH_TRIGGER_EVENTS` (`frontend/src/js/store/sync/sync-flush.js`) cobre FEATURE/LAYER/GROUP/MAP/BRIEFING e `REMOTE_OPERATION_APPLIED`. Ficam de fora comentários espaciais, 3D/360, catálogo, temporal, notas e grid: dependem do tick de 1,5 s. Se a latência de um tipo novo importa, adicione o evento aqui.

## Por que HTTP e não WebSocket

`wsClient.sendOperation` / `sendOperations` existem (`frontend/src/js/store/sync/ws-client.js`) mas **não têm nenhum call site em `src/`**, só em `frontend/tests/integration/ws-client.test.js`. Toda op de entidade sai por `POST /api/v1/atlas/:id/sync`. O canal WS serve inbound de ops, presença, cursor, seleção e `sync_request` ([[canal-collab-websocket]]).

A consequência de projeto: como o broadcast do servidor não consegue excluir o autor num push HTTP, o autor recebe o próprio eco e o filtra por `clientId` ([[client-id-estavel]]). Isso, por sua vez, obriga `recordPushAcks` a semear a versão aplicada do próprio autor: sem essa semente ele nunca saberia a ordem de chegada da própria op e uma op concorrente mais antiga de um peer poderia sobrescrevê-la ([[idempotencia-e-convergence-guard]]). Trade-off completo em [[sintese-rest-vs-websocket]] e [[sintese-rest-vs-sync]].

A leitura oposta circula e é errada: "em tempo real prefira o WebSocket, o push HTTP é o caminho de recuperação". O backend suporta receber op pelo socket, mas **este cliente nunca envia por ali**, em nenhum estado de conexão. Contrato suportado não é comportamento implementado, e escrever código novo contra o primeiro produz um caminho que nada exercita.

## Reconexão: a ordem real

Reconecta o socket primeiro com backoff exponencial, só então pede o pull via `sync_request(lastVersion)` dentro do frame `connected` (`_onConnected`, `frontend/src/js/store/sync/ws-client.js`), e só libera o push depois da transição para `ONLINE` (`frontend/src/js/store/sync/sync-flush.js`). Ou seja, **o pull de recuperação acontece pelo WebSocket, não por um GET REST**, e quem desenhar o inverso (pull REST → merge → push → reconectar WS) escreve contra um fluxo que não existe.

**Não há replay por cliente desconectado** ([[canal-collab-websocket]]). Mensagens emitidas durante a queda não são reenviadas. A decisão evita estado durável por socket no servidor, hoje single-instance com salas, presença e timers de `away` em memória ([[sintese-limites-collab]]). O preço: o cliente **precisa** manter `lastVersion` correto; se zerar, o servidor devolve o snapshot inteiro em vez do incremento.

## Gestos de interface com fan-out alto

Nenhum destes é uma operação em lote: cada item vira N ops independentes, cada uma sujeita a LWW individual, todas competindo pelo mesmo flush.

| Ação na interface | Fan-out | Nota |
|---|---|---|
| Importar GeoJSON / SHP / KML / KMZ / GPX / CSV | 1 `layer` + 1 `feature` por feição | arquivo grande = milhares de ops de uma vez |
| Importar projeto `.ebgeo` no atlas atual | mapas + camadas + grupos + feições | merge; ids duplicados precisam de UUID novo antes de enfileirar |
| Pontos por coordenadas (modal em lote) | 1 `feature` por ponto | |
| Colar (Ctrl+V) e Duplicar seleção | 1 `feature` por cópia | |
| Deletar seleção múltipla | 1 `feature` delete por feição | |
| Ocultar/bloquear em lote na árvore | 1 `feature` update por feição | toggle de grupo grande é lote grande |
| Deletar camada | 1 `layer` delete | cascade nas feições é **no servidor**; não enfileire as filhas |
| Deletar feições de um tileset 3D ou foto 360 | 1 op por marcador, medição, viewshed e orientação | |
| Adicionar/deletar coluna de atributo | 1 `feature` update por feição da camada | altera todas as feições, não a camada |
| Reagendar (shift temporal em massa) | 1 `feature` update por feição do mapa | não desfazível; ver [[modulo-temporal]] |
| Algoritmo de processamento (Buffer, Voronoi, Convex Hull) | 1 `layer` + 1 `feature` por resultado | |

Três consequências: a compaction **não** salva lote de create (agrupa por `entityType:entityId`, e N feições novas são N entidades distintas); fan-out alto multiplica a chance de o gesto encontrar uma recusa por operação; e a atomicidade é só local, pois o `runTransaction` garante um persist no IndexedDB, mas os pares recebem ops independentes, possivelmente entremeadas com edições de terceiros.

Ao desenhar uma ação de lote nova, se a operação for estrutural e rara, prefira que o resultado seja alcançável por snapshot (escrita REST estrutural com broadcast de `serverResync`, [[sintese-rest-vs-sync]]) em vez de milhares de ops.

## Depuração

"Editei e nada sincronizou": siga os spans `action.origin → preflush.drop | enqueue → flush.push → push.ack`, mais `ws.inbound` / `conn.transition` ([[syncledger]]). Blobs de imagem não viajam nesta fila ([[imagens-atlas]]). Ciclo de sessão no boot e no F5 em [[sessao-boot-e-ciclo-de-vida]]. Aplicação do lado receptor em [[aplicacao-operacoes-remotas]] e [[ack-idempotencia]].
