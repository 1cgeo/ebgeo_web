# Conflitos de todas as entidades e resolução persistente

Status: pendente. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [compatibilidade](01-compatibilidade.md).

## Lacuna

O tratamento de base/revisão está implementado para feições v2 em `backend/src/modules/sync/feature-conflicts.js`. Não há garantia equivalente para todas as entidades colaborativas. A fila possui resultados duráveis e consulta de problemas em `frontend/src/js/store/sync/operation-queue.js`, mas ainda falta a interface que permita ao usuário resolver esses casos de forma persistente.

Revisar também `backend/src/modules/sync/sync.service.js`, `backend/src/modules/sync/sync-receipts.js`, `frontend/src/js/store/sync/remote-operation-handler.js` e `frontend/src/js/store/sync/legacy-queue.js`.

## Correção

1. Definir a unidade de disputa por entidade: campos independentes, geometria inteira, ordem, hierarquia, membros, slides e referências. Não fundir arrays genericamente.
2. Expandir revisões, bases observadas e tombstones para mapas, camadas, grupos, comentários, slides, catálogo, 3D/360 e configurações compartilhadas. Incluir aliases de metadados aceitos pelo backend. Autorização e detecção de conflito não podem depender da retenção do log de replay.
3. Distinguir aplicado, recusado, conflito e dependência bloqueada. Uma exclusão confirmada não pode ser revertida por edição antiga. Conservar o conteúdo da tentativa e sua identidade.
4. Entregar painel com item, motivo e dependentes, conteúdo local e estado atual permitido. Aceitar servidor remove a tentativa por decisão explícita; reaplicar uma escolha cria nova operação, com nova base observada. Conciliação de geometria requer comparação visual.
5. Incluir filas antigas sem recibo inequívoco. F5, outra aba ou fechamento do toast não podem apagar a pendência. Acesso revogado impede buscar ou mostrar novos dados do servidor.

## Aceite

Dois e três clientes editando campos distintos, o mesmo campo, geometria, ordem e membros; edição versus exclusão; nova edição remota durante resolução; permissão revogada. Repetir após F5 e entre abas. Comparar servidor, fila e projeção. Nenhuma sobrescrita silenciosa e nenhum retry reaproveitando ID com conteúdo diferente. Remover temporariamente o guarda deve tornar a regressão vermelha. Pendências só desaparecem por confirmação comprovada ou decisão autorizada.
