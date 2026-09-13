# Compatibilidade restante e filas antigas

Status: pendente. Prioridade: bloqueia lançamento. Contexto e ordem no [índice](README.md).

## O que já existe e a lacuna

O protocolo incremental 2 é exigido em HTTP, WS simples, WS em lote e serviço. O cliente negocia capacidades; operações antigas incompatíveis ficam preservadas, sem envio ou projeção automática. Recibos só retiram intenções comprovadamente confirmadas. Isso não cobre, por si só, as exceções estruturais de importação/clone de atlas e duplicação/merge de mapas, nem entrega a interface para revisar intenções incertas.

Pontos de entrada: `backend/src/modules/sync/sync-protocol.js`, `backend/src/modules/sync/sync-receipts.js`, `backend/src/modules/atlas/atlas.service.js`, `backend/src/modules/maps/maps.service.js`, `frontend/src/js/store/sync/legacy-queue.js`, `frontend/src/js/store/sync/sync-engine.js` e `frontend/src/js/store/sync/operation-queue-migration.js`.

## Correção a executar

1. Inventariar rotas, chamadores e serviços das quatro exceções. Definir a compatibilidade de cada comando no servidor, incluindo chamada direta ao serviço. Não pressupor que o protocolo incremental é aplicável sem adaptação.
2. FEITO em 2026-09-13, no commit "dispatcher: edição remota com logging desligado é recusada, não silenciada" (bloco B3, item 3; achado F7). Verificar a janela entre montagem do escopo remoto, negociação e habilitação do logging. Uma edição remota não pode persistir silenciosamente porque o dispatcher está desabilitado ou filtrou uma identidade inválida. Recusa deve chegar ao produtor e à UI; preferências locais continuam fora da fila.

   O que mudou, e por quê a janela existia. `syncEngine.disconnect()` não desligava o registro de operações (só `logoutAndDisconnect` desligava), então o estado do registro dentro da janela `activateRemoteAtlas` → `markStoreRemote` → `connect` (em `frontend/src/js/account/open-atlas.service.js`) era o que tivesse sobrado da conexão anterior: às vezes ligado, às vezes não, e depois de um logout seguido de novo login, desligado. Com o registro desligado, `persistOperationIntents` abria com um `return` mudo e devolvia `undefined`, que `store-transaction.js` não distinguia de sucesso: a entidade gravava, nenhuma operação nascia, e o único rastro era um `preflush.drop` no trace, que sai desligado em produção.

   Três mudanças, e a divisão entre elas é o eixo local contra remoto. `disconnect()` passou a chamar `disableOperationLogging()`, o que torna a janela DETERMINISTICAMENTE fechada em vez de provável (quem religa é o próprio `connect`, depois do pull). Dentro da janela, `persistOperationIntents` num escopo REMOTO lança `OperationIntentRefusedError` (classe exportada, com `code` vindo de `DropReason`), e `runTransaction` já converte isso em rollback mais `STORE_PERSIST_ERROR` mais throw, de modo que nada é gravado e a recusa chega ao produtor. Em escopo LOCAL nada mudou, porque atlas local não tem fila de envio e um aviso por edição ali seria ruído. Os produtores antigos (`logOperation` e `logBatchOperations`, que rodam em `deferAsync`, depois de a entidade já ser durável, onde um throw só seria engolido) emitem `STORE_OPERATION_BLOCKED` com `reason: logging_disabled`, também só em escopo remoto.

   O filtro de identidade voltou a deixar rastro: cada descrição que cai registra `PREFLUSH_DROP` com `NON_UUID_MAPID` ou `NON_UUID_SETTING_ID`, como o caminho antigo sempre fez, e quando TODAS caem num escopo remoto isso é erro do chamador, então lança em vez de gravar a entidade e deixar o atlas divergente em silêncio.

   Guardas: `frontend/tests/integration/write-ahead-intent.test.js` (recusa em remoto, gravação normal em local), `frontend/tests/integration/operation-dispatcher.test.js` (os dois produtores antigos falando em remoto e calados em local, mais os dois motivos de descarte) e `frontend/tests/integration/sync-engine.test.js` (`disconnect` desliga, `connect` religa depois do pull).
3. Completar a matriz build/protocolo/schema local/schema do servidor e o aviso de incompatibilidade. Manter HTTP 426 para incompatibilidade incremental: clientes anteriores podem descartar operações ao receber 400/422.
4. Conferir retomada da migração de filas, marca de progresso e verificação do destino antes de limpar a origem. Concluir a revisão explícita com o [painel de conflitos](03-conflitos.md).

   A METADE DA REVISÃO EXPLÍCITA QUE ERA TELA FECHOU em 2026-09-13, no painel de pendências (`frontend/src/js/account/pendencias/pendencias-panel.js`, passo 5 do bloco B5). A intenção retida por protocolo incompatível deixou de ser um número na luz de sync: ela aparece como linha própria, com a classe "Quarentena de protocolo" (a classe `revisao` de `frontend/src/js/store/sync/issue-classes.js`, escrita por `legacyQueueIssue`), com o motivo, a data e o item, e com as duas únicas saídas que ela admite, exportar e descartar. Não há "reenviar": a op de um protocolo anterior não é reenviada nem reescrita para passar num schema novo, e o painel não oferece o botão em vez de oferecê-lo e recusar, porque isso é forma e não estado.

   Fica valendo, e o painel não muda: ausência de recibo continua não provando ausência de aplicação, e nenhuma base é atualizada automaticamente. O que a pessoa pode fazer é DECIDIR, e as duas decisões são explícitas e nomeiam o que somem.

   O que continua faltando do item 4 é a metade de MIGRAÇÃO (retomada, marca de progresso e verificação do destino antes de limpar a origem), que não é assunto de tela.

## Aceite e testes

Cobrir cliente antigo aberto durante atualização, backend sem capacidade, versão futura, F5 em cada etapa da migração, retry com mesmo ID, alteração de conteúdo sob o mesmo ID, leitor que perdeu escrita e revogação total de acesso. Cada exceção precisa de teste HTTP e de serviço. Ausência de recibo nunca prova ausência de aplicação. Fila incerta permanece recuperável; nenhuma base é atualizada automaticamente. Encerrar somente com a matriz completa, sem bloquear atlas locais e sem bypass conhecido.
