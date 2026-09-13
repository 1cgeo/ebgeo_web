# Compatibilidade restante e filas antigas

Status: pendente. Prioridade: bloqueia lançamento. Contexto e ordem no [índice](README.md).

## O que já existe e a lacuna

O protocolo incremental 2 é exigido em HTTP, WS simples, WS em lote e serviço. O cliente negocia capacidades; operações antigas incompatíveis ficam preservadas, sem envio ou projeção automática. Recibos só retiram intenções comprovadamente confirmadas. Isso não cobre, por si só, as exceções estruturais de importação/clone de atlas e duplicação/merge de mapas, nem entrega a interface para revisar intenções incertas.

Pontos de entrada: `backend/src/modules/sync/sync-protocol.js`, `backend/src/modules/sync/sync-receipts.js`, `backend/src/modules/atlas/atlas.service.js`, `backend/src/modules/maps/maps.service.js`, `frontend/src/js/store/sync/legacy-queue.js`, `frontend/src/js/store/sync/sync-engine.js` e `frontend/src/js/store/sync/operation-queue-migration.js`.

## Correção a executar

1. Inventariar rotas, chamadores e serviços das quatro exceções. Definir a compatibilidade de cada comando no servidor, incluindo chamada direta ao serviço. Não pressupor que o protocolo incremental é aplicável sem adaptação.
2. Verificar a janela entre montagem do escopo remoto, negociação e habilitação do logging. Uma edição remota não pode persistir silenciosamente porque o dispatcher está desabilitado ou filtrou uma identidade inválida. Recusa deve chegar ao produtor e à UI; preferências locais continuam fora da fila.
3. Completar a matriz build/protocolo/schema local/schema do servidor e o aviso de incompatibilidade. Manter HTTP 426 para incompatibilidade incremental: clientes anteriores podem descartar operações ao receber 400/422.
4. Conferir retomada da migração de filas, marca de progresso e verificação do destino antes de limpar a origem. Concluir a revisão explícita com o [painel de conflitos](03-conflitos.md).

## Aceite e testes

Cobrir cliente antigo aberto durante atualização, backend sem capacidade, versão futura, F5 em cada etapa da migração, retry com mesmo ID, alteração de conteúdo sob o mesmo ID, leitor que perdeu escrita e revogação total de acesso. Cada exceção precisa de teste HTTP e de serviço. Ausência de recibo nunca prova ausência de aplicação. Fila incerta permanece recuperável; nenhuma base é atualizada automaticamente. Encerrar somente com a matriz completa, sem bloquear atlas locais e sem bypass conhecido.
