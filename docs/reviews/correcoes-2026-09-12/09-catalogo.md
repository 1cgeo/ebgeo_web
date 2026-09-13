# Diário de catálogo e identidade no replay

Commit conferido: `d0c99dea`.

## Problemas e correções

O catálogo era persistido antes do diário e podia registrar o mapa ativo em vez do destino. Criar, editar e remover uma referência agora prepara a intenção sob a trava do mapa, antes de gravá-lo, usando a identidade do destino efetivamente lido. Destino remoto inexistente é recusado. Quota conserva a intenção; snapshot recupera a projeção com o mesmo ID. A revalidação local de disponibilidade permanece fora do envio remoto.

O ensaio de dois navegadores encontrou outro defeito: o histórico substituía IDs textuais, como hillshade, pelo UUID do atlas. O replay criava referências duplicadas e podia conservar o valor antigo no cliente. A coluna `operations.client_entity_id` preserva a identidade original. Registros antigos sem identidade suficiente obrigam snapshot autorizado, em vez de inventar o alvo de uma exclusão sem payload. O cliente usa o ID do envelope como autoridade.

Reconstruir recibo ausente exige comprovar também o alvo textual. Isso impede que uma exclusão antiga confirme outra apenas porque ambas têm payload vazio e o mesmo UUID substituto no histórico. O retry legítimo continua confirmado quando a identidade foi preservada.

Entradas: `frontend/src/js/store/catalog.operations.js`, `frontend/src/js/store/sync/remote-operation-handler.js`, `backend/src/modules/sync/sync.service.js` e `backend/src/modules/sync/sync.queries.js`.

## Evidência e atualização do banco

Sete testes de diário e quatro de replay/recibos foram acrescentados. Três controles negativos falharam ao retirar as respectivas proteções. O cenário de dois navegadores passou duas vezes após as mudanças finais, com F5, conferência no PostgreSQL e nos dois clientes e captura inspecionada.

Raiz aprovada: 12.247 testes frontend, 5.054 backend e 201 contratos, sem falhas/skips; lint/build aprovados. Uma rodada concorrente com build foi invalidada e repetida depois da compilação.

A coluna entra na base lógica de sync. Banco existente precisa da transição aditiva, após backup, descrita no [registro de fechamento](../execucao-fechamento-lancamento.md); isso não foi aplicado no servidor interno. Conflitos por revisão do catálogo continuam [pendentes](../fechamento/03-conflitos.md).
