# Persistência durável dos demais produtores

Status: pendente. Prioridade: bloqueia lançamento. Depende da [compatibilidade](01-compatibilidade.md).

## Estado e pontos de entrada

Feições e comentários já possuem diário; briefings/slides e catálogo foram ampliados e validados nesta execução. Não basta encontrar uma chamada de logging: ela precisa anteceder a gravação e ter falha propagada. A fronteira comum está em `frontend/src/js/store/store-transaction.js`, `frontend/src/js/store/sync/operation-dispatcher.js`, `frontend/src/js/store/sync/queue-journal.js` e `frontend/src/js/store/document-lock.js`.

| Família | Arquivos a revisar | Lacuna ou cuidado |
| --- | --- | --- |
| Mapas | `frontend/src/js/store/map.operations.js`, `frontend/src/js/store/repositories/index.js` | Criação, renomeação e remoção gravam antes do log; exclusão/renomeação abrangem documentos auxiliares |
| Posição e mapa-base | `frontend/src/js/store/map.operations.js` | Persistem antes do log; limpar posição legada sem ID pode não emitir exclusão; revisar também a permissão dessa limpeza |
| Camadas | `frontend/src/js/layers/layer.manager.js`, `frontend/src/js/store/layer.operations.js` | Debounce e memória podem anteceder a intenção durável |
| Grupos e membros | `frontend/src/js/tool_manager/group_manager.js`, `frontend/src/js/store/group.operations.js` | Registrar mudanças de membros e composição, não somente o documento do grupo |
| 3D e 360 | `frontend/src/js/store/cesium3d.operations.js`, `frontend/src/js/store/streetview360.operations.js` | Gravação anterior ao log, caminhos de importação/lote e callbacks sem cobertura uniforme |
| Configurações | `frontend/src/js/store/settings.operations.js`, `frontend/src/js/store/temporal.operations.js`, `frontend/src/js/store/atlas-appearance.service.js`, `frontend/src/js/store/customIcons.operations.js` | Notas, grade e temporal já usam transação em alguns caminhos; revisar serialização, entrada mutável e cobertura restante |
| Trava do mapa | `frontend/src/js/locking/map-lock.controller.js` | Conferir intenção durável e mapa de destino no caminho completo da UI |

## Implementação

1. Para cada produtor, listar criação/edição/exclusão, importação, cópia, lote, undo/redo e autosave. Verificar o debounce do editor de briefing, mesmo com o store já protegido.
2. Capturar escopo, época e IDs finais antes do primeiro await; ler e preparar sob a trava correta. Registrar a intenção completa antes de alterar a entidade. Evitar criar uma referência remota para um mapa inexistente pelo fallback de compatibilidade.
3. Publicar para envio somente após materialização confirmada. Recuperar a intenção preparada com os mesmos IDs; não duplicar undo, entidades ou efeitos visuais. Manter falha de quota visível e propagada.
4. Preservar dependências entre mapa, camada, grupo, recurso e entidade. Uma criação recusada bloqueia seus dependentes, sem travar trabalho independente. Tratar alterações de vários documentos junto aos [comandos compostos](04-comandos-compostos.md).

## Aceite

Por família, falhar antes/depois do diário, na gravação da entidade e na marca de materialização. Reabrir e comparar conteúdo completo, referências e IDs. Forçar concorrência na mesma entidade, mapas de destino diferentes e troca de escopo durante await. Nenhuma edição aceita pode ficar sem resultado confirmado ou intenção recuperável. Incluir posições antigas somente com campos planos. Usar como referência os testes reais de diário de briefing e catálogo, sem substituir asserções de disco por mocks de logging.
