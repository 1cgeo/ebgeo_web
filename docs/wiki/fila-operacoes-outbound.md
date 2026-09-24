# Fluxo Outbound: Diário Durável, Flush e Reconexão

O que o código do caminho outbound não conta sozinho: onde ops somem de propósito, o que trava a fila inteira e quais gestos de interface geram fan-out alto.

**A fila é um DIÁRIO APPEND-ONLY desde 2026-09-12, e nada nela se funde, expira ou é purgado.** Esta página descreveu por meses uma compactação, um teto de 10000 e uma purga de 7 dias, e os três saíram do código no mesmo commit; as seções que os descreviam foram reescritas e o que sobrou delas está na seção "O que SAIU, e o que ficou no lugar". A intenção agora é gravada ANTES da entidade, em [[diario-write-ahead]].

O caminho em si se lê seguindo as chamadas de `runTransaction` (`frontend/src/js/store/store-transaction.js`) até `flush` (`frontend/src/js/store/sync/sync-engine.js`), e os módulos do sync são densamente comentados: os porquês de baixo nível (poison pill, semente de versão no ack, filtro do próprio eco, buracos de `serverVersion`) já estão nos comentários. Esta página cobre só o que atravessa arquivos. Envelope em [[envelope-operacao]], lado servidor em [[tabela-operations]] e [[modelo-conflito-lww]].

## O flag de logging mente no comentário

`enabled` nasce `false` em `frontend/src/js/store/sync/operation-dispatcher.js` e um comentário logo abaixo diz que offline/anônimo não enfileira. **Isso está errado na prática:** `initServices()` chama `enableOperationLogging()` no boot (`frontend/src/js/store/services.js`), inclusive no boot anônimo. Um usuário offline enfileira ops normalmente para qualquer mapa com id UUID.

Quem realmente contém a fila offline é a guarda de `mapId` não-UUID, que dropa tudo do mapa local `Principal` (ver [[dominio-local-vs-remoto]]), não o flag. `connectPublic`, `logoutAndDisconnect` e, **desde 2026-09-13, `syncEngine.disconnect()`** desligam o logging.

**A consequência que ninguém espera continua valendo, por outro caminho:** queda de rede **não** chama `syncEngine.disconnect()` (o `ws-client` reconecta por conta própria, e o estado vai para `RECONNECTING`), então as ops continuam se acumulando durante a desconexão, que é o comportamento desejado. Quem chama aquele método são gestos explícitos: logout, troca de atlas, o freio do tab lock e o `atlas_deleted` do servidor.

Desligar ali fechou uma janela que era pior que a acumulação: entre `activateRemoteAtlas` e `connect` o escopo já é remoto, e o estado do registro era o que tivesse sobrado da conexão anterior, de modo que uma edição nessa janela gravava a entidade e nenhuma op. Hoje a janela é DETERMINISTICAMENTE fechada e a edição é recusada em voz alta. Ver [[diario-write-ahead]].

Projeto construído inteiramente offline e anônimo não sobe por esta fila, sobe por `POST /api/v1/atlas/import` ([[atlas-import-offline]], [[modos-operacao]]).

## Contratos congelados

- **Formato da chave da fila.** A chave carrega uma SEQUÊNCIA monotônica persistida, sob prefixo `z`, e é ordenada por sort lexicográfico (`_getOrderedKeys`, `frontend/src/js/store/sync/operation-queue.js`). O `z` é o que põe toda chave nova depois de toda chave legada, que continua legível: as formas antigas (`op_{timestamp}_{id}` e `op_{timestamp}_{sequencia}_{id}`) convivem sem migração. **A ordem lexicográfica da chave é a ordem em que o servidor vai aplicar**, então mudar o formato quebra a ordem em silêncio, sem erro e sem teste vermelho óbvio. A chave é também a única fonte do id ao remover: o dequeue resolve `id` a partir dela, do DISCO, e nunca de um índice em memória (que ficava preso ao que ESTA aba tinha visto).
- **O envelope é IMUTÁVEL.** Reenfileirar o mesmo id com conteúdo diferente ABORTA a transação de IndexedDB (`ConfirmedOperationError`, `frontend/src/js/store/sync/queue-journal.js`) em vez de sobrescrever, porque aquele id pode já ter chegado ao servidor.
- **`mapId` de op escopada em mapa tem que ser UUID.** Caso contrário é dropada pré-flush por design, e o descarte deixa rastro (`PREFLUSH_DROP`); quando TODAS as descrições caem num escopo remoto, isso é erro do chamador e a transação lança, em vez de gravar a entidade e deixar o atlas divergente em silêncio.
- **A intenção é gravada ANTES da entidade**, por `tx.recordOperation` dentro de `runTransaction`, e não mais dentro do `deferAsync`. O que garante que não existe op sem dado local é a marca de materialização: até ela, a intenção existe e não é enviável. Ver [[diario-write-ahead]].
- **Chave de metadado não é operação.** O diário guarda, ao lado do envelope, a marca de preparo, o registro de problema e ponteiros por feição (`JournalKey`); quem varrer o object store contando chaves conta metadado como trabalho pendente.
- **Entidade nova precisa de entrada em `EntityType` e de um `logXxxOperation`**; sem isso a mutação é puramente local ([[tipos-entidade-sync]]).

## Armadilhas

**O `await` do store resolve antes de a op estar na fila.** `commit()` roda os efeitos assíncronos em fire-and-forget (`frontend/src/js/store/store-transaction.js`). Teste de integração que inspeciona a fila logo após uma mutação precisa aguardar a microtask; confiar no `await addFeature(...)` produz flake.

**Uma contagem agregada não responde por estado.** `count()` devolve só o ENVIÁVEL, que exclui a intenção preparada e a que carrega problema, e `countByState` é quem separa os três. Asserção ou tela que use o total para provar que algo foi PREPARADO lê zero sobre código correto, e isso já derrubou três suítes que nunca quiseram saber quanto sai no próximo envio. `hasWorkToFlush` também olha só o enviável, o que é o que impede o flush de acordar a cada 1,5 s para empurrar nada e relatar sucesso.

**Recusa não é mais dequeue, e isso INVERTEU o desenho anterior.** Até 2026-09-12 um ack com `rejected: true` desenfileirava a op, com o argumento de que a recusa é permanente e reenviar é garantir o mesmo não para sempre. O argumento continua verdadeiro e a conclusão estava errada: descartar era descartar o CONTEÚDO, que é a única cópia da intenção da pessoa. Hoje a recusa vira **problema durável** (`recordIssue`, lido por `getIssues`), a op fica no disco, as operações SEGUINTES da mesma entidade ficam bloqueadas atrás dela (em vez de passar por cima da que ficou para trás), e o que resolve é decisão explícita de quem editou, no painel de [[pendencias-de-sincronizacao]]. O conflito é classe própria desde então, separada da recusa e da dependência bloqueada.

O que continua de 2026-08-15: o dequeue é "os ids sobre os quais o servidor se pronunciou" (`acknowledgedOperationIds`, `frontend/src/js/store/sync/sync-engine.js`), e op que o servidor não mencionou fica na fila. Resposta que não identifica op nenhuma é o contrato antigo (2xx pelo lote) e ainda desenfileira tudo. **Membro de lote recusado nunca é desenfileirado**, mesmo acked como aplicado; ver [[lote-logico-de-gesto]].

**Um lote reprovado bloqueia tudo atrás dele, exceto em três status.** O `peek` é sempre da cabeça em ordem cronológica e o lote falho não é dequeueado, logo head-of-line blocking. A exceção é `PERMANENT_PUSH_REJECTIONS = {400, 413, 422}` (o 413 entrou em 2026-09-23: o corpo acima do limite do servidor, 10 MB no parser e o `client_max_body_size` de qualquer proxy, recebe a mesma resposta a cada reenvio, e antes segurava a fila para sempre; no 413 o recorte cai pela metade antes de isolar, porque o excesso pode ser só a SOMA do lote): aí o flush entra em **modo de isolamento**, reduz o lote a uma op para identificar a ofensora por construção (nunca por um id que o servidor mande), a descarta, avisa o usuário com um toast e segue. A lista é curta de propósito, e é a parte que importa reter: **401, 403, 409, 429 e 5xx ficam de fora**, porque a op ainda pode valer depois de um refresh, de uma permissão devolvida ou de o servidor voltar. Na dúvida a fila espera, já que descartar op boa é perda irreversível e fila travada não é. Fora da lista, e também terminal, há `ATLAS_GONE_STATUSES = {404, 410}`: o atlas sumiu do servidor, então isolar op a op não faria sentido nenhum e nada é descartado, mas a falha ganha classe própria no aviso ao usuário (`classifyFlushFailure`, `frontend/src/js/store/sync/sync-flush.js`) em vez de ser lida como queda de rede, que era a leitura que fazia a fila travar em silêncio. Então, antes de culpar a rede, confira o papel do usuário no atlas: sem permissão de escrita o push é recusado e a fila trava ([[permissoes-atlas]]). O gate fino é do servidor por operação; o dispatcher não checa papel.

**A perda silenciosa por IDADE deixou de existir, e as duas que sobram são por DECISÃO.** `operationQueue.clear()` não é passo automático do wipe: esvaziar a fila é decisão do chamador (`clearQueue` em `clearAllDataStore`, `frontend/src/js/store/store.js`), e quem monta um atlas remoto em seguida NÃO a esvazia. E a fila morre junto com o banco dela quando o namespace é destruído, o que é o logout confirmado. A quarentena é a exceção: ela sai do banco por atlas ANTES da destruição, para um registro global (ver [[namespace-por-atlas]]). Quando a fila se perde, a recuperação é snapshot ([[snapshot-e-pull-incremental]]), não replay. Ver [[atlas-modelo-de-dados]].

**A fila é um banco POR ATLAS, e o carimbo virou asserção sobre isso.** O descritor é `perAtlas: true` (`frontend/src/js/store/atlas-namespace.js`): o atlas X escreve em `ebgeo__<sufixo de X>` e não enxerga, drena nem esvazia a fila de Y, porque nunca abre aquele banco. O sufixo legado mantém o nome `ebgeo`, então o slot local #1 e a fila pré-namespace são o mesmo banco e a instalação comum move zero bytes. O carimbo (`scopeSuffix`, ver [[envelope-operacao]]) continua e é reconferido em toda leitura (`operationBelongsToScope`), mas os papéis trocaram: a separação é estrutural e o filtro é asserção, porque filtro é regra que um chamador futuro esquece. Duas consequências não óbvias: op escrita por uma versão anterior não carrega endereço nenhum e é legível de QUALQUER escopo, porque recusá-la abandonaria trabalho real que ninguém consegue reendereçar (há uma geração só delas, roteada uma vez por `migratePendingOperationsToScopedQueues`); e a fila é alcançável ANTES de qualquer atlas ser montado (o boot liga o logging primeiro), caso em que ela cai no endereço legado em vez de lançar. Ver [[namespace-por-atlas]].

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

Cada item vira uma op, e a tabela continua valendo para o TAMANHO. O que mudou desde 2026-09-13 é a atomicidade: as ops nascidas na mesma transação, e as nascidas dentro do mesmo gesto ambiente, compartilham um `batchId` e o servidor as aplica ou recusa inteiras. Ver [[lote-logico-de-gesto]], inclusive para o teto de 200: acima dele o gesto COMPOSTO é recusado sem viajar, e o mesmo verbo sobre feições independentes (importar, colar, mover para camada, desfazer em massa) sobe em partes de até 200 desde a decisão do dono de 2026-09-24.

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

Duas consequências que o lote lógico não apaga: fan-out alto multiplica a chance de o gesto encontrar uma recusa (e agora a recusa de um membro leva o gesto inteiro, o que é o desenho, não um agravamento); e os PARES recebem ops independentes, possivelmente entremeadas com edições de terceiros, porque o lote é unidade de aplicação no servidor e não de entrega ao vivo.

Ao desenhar uma ação de lote nova, se a operação for estrutural e rara, prefira que o resultado seja alcançável por snapshot (escrita REST estrutural com broadcast de `serverResync`, [[sintese-rest-vs-sync]]) em vez de milhares de ops.

## O que SAIU, e o que ficou no lugar

Vale registrar porque os símbolos sobrevivem como shims vazios (`_compact`, `purgeOldOperations`, `startAutoPurge`) e quem os chamar esperando efeito não recebe nenhum:

- **A compactação** (fundir CREATE com UPDATE, cancelar CREATE com DELETE) saiu porque ela apaga conteúdo para economizar viagens, e o produto passou a precisar do conteúdo: é ele que a pessoa reaplica depois de um conflito. O que a substituiu como defesa contra rajada é o lote lógico, que reduz o custo por op sem apagar nada.
- **O teto de tamanho e a marca d'água** saíram com ela. A medição de 2026-09-02 com 12000 creates distintos (12,9 s contra 51 ms depois da marca d'água) é história da fase em que a fila ainda fundia, e está em [`decisions-2026.md`](../decisions/decisions-2026.md).
- **A purga de 7 dias** saiu porque idade não é evidência de que a intenção não vale mais. Ela também era a única perda que não passava por decisão de ninguém.

A guarda dessa fase, `frontend/tests/unit/fila-compacta-com-marca-dagua.test.js`, hoje afirma o CONTRÁRIO do que o nome dela sugere: nenhuma manutenção de fila inteira numa rajada de 12000, e CREATE, UPDATE e DELETE intactos depois de chamar os shims.

## Depuração

"Editei e nada sincronizou": siga os spans `action.origin → preflush.drop | enqueue → flush.push → push.ack`, mais `ws.inbound` / `conn.transition` ([[syncledger]]). Blobs de imagem não viajam nesta fila ([[imagens-atlas]]). Ciclo de sessão no boot e no F5 em [[sessao-boot-e-ciclo-de-vida]]. Aplicação do lado receptor em [[aplicacao-operacoes-remotas]] e [[ack-idempotencia]].
