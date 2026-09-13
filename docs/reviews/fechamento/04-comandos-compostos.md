# Comandos compostos e desfazer/refazer

Status: pendente. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [conflitos](03-conflitos.md).

## Problema e alcance

Os contratos normais de conversão, movimento e desfazer/refazer já foram corrigidos e aprovados. Isso não prova atomicidade quando a conexão cai ou o servidor falha no meio de um conjunto. O diário de um briefing com slides também não torna uma importação inteira atômica no servidor.

Inventariar `frontend/src/js/store/layer-transfer.operations.js`, `frontend/src/js/store/feature.operations.js`, `frontend/src/js/store/map.operations.js`, `frontend/src/js/import_export/export-import.service.js` e `frontend/src/js/tool_manager/group_manager.js`. No servidor: `backend/src/modules/sync/sync.service.js`, `backend/src/modules/maps/maps.service.js` e `backend/src/modules/atlas/atlas.service.js`.

## Correção

1. Classificar conversão, transferência de camada inteira, movimentações, agrupar/desagrupar, importação, cópia, duplicação, clone e merge. Registrar quais já usam transação real e quais emitem operações independentes. Abranger inversões de undo/redo e todos os documentos auxiliares de mapa.
2. Para conjuntos limitados, persistir o comando completo no diário local. Validar e gravar entidades, versões, recibo e resultado canônico na mesma transação PostgreSQL, incluindo permissão e bloqueio de todos os destinos.
3. Para conjuntos grandes, preparar dados duravelmente e ativar o resultado ao final, com estado retomável e identidade estável. Medir limites de tamanho/tempo; definir cancelamento. Não apresentar conjunto parcial como concluído.
4. Fazer undo/redo como novo comando contra o estado confirmado. Não restaurar um documento antigo inteiro sobre trabalho de outros usuários.
5. Conferir a compatibilidade das quatro exceções REST com o [documento 01](01-compatibilidade.md), sem criar novos atalhos de escrita incremental.

## Aceite

Injetar falha no primeiro, no intermediário e no último elemento; falhar após commit antes do ACK; repetir o comando após F5. Testar mapa/camada bloqueados, destino excluído, permissão alterada e edição concorrente antes do undo. Exigir conjunto inteiro confirmado ou estado explicitamente recuperável, sem duplicação, recursos inacessíveis ou referência órfã. Conservar os contratos já aprovados e acrescentar provas de falha parcial, não repetir somente o fluxo normal.
