# Contratos, descarte remoto e camada padrão no servidor

Commit conferido: `e70ccf3c`. Complementa `f8e109ea`; evidências no [registro de sincronismo](../execucao-correcao-atlas-remoto.md).

## Correções de perda e contratos

Callbacks antigos podiam voltar a escrever ou excluir dados depois de logout e novo login. A época de descarte passou a ser capturada por montagens, repositórios, filas, transações e aplicações de sync. Handles protegidos verificam a época dentro do callback nativo do IndexedDB. Entrar novamente não revalida o escritor antigo. O diário clona envelopes e o retry conserva ID, conteúdo e escopo.

Antes do aviso de saída, a aba pausa escritores coordenados e novos auto-flushes, aguarda o trabalho iniciado e usa contagem desconhecida se não estabilizar. Cancelar libera as pausas. O aviso explica que requisição já recebida pelo servidor ainda pode concluir.

As 24 falhas de contrato foram resolvidas com bases confirmadas e comandos explícitos de movimento/restauração. Operação antiga exige revisão correspondente; criação comum não pode sobrescrever entidade viva ou ressuscitar exclusão. Undo/redo conserva a referência necessária ao recibo após ACK. Movimento verifica origem e trava e informa a remoção da origem aos clientes.

## Camada padrão

O navegador usava uma camada sintética default sem UUID válido no servidor; sua trava podia desaparecer na reconciliação. A camada passou a nascer no servidor junto do mapa, inclusive no atlas novo e na substituição da última camada excluída. ACK, broadcast e replay preservam a mesma identidade. Importação/cópia e regularização tratam mapas sem camada. A camada sintética permanece apenas nos atlas locais. Ver [camadas remotas](../camadas-remotas.md).

Entradas: `frontend/src/js/store/remote-write-fence.js`, `frontend/src/js/store/fenced-store.js`, `frontend/src/js/session/confirm-logout.js`, `backend/src/modules/sync/feature-conflicts.js` e `backend/src/modules/maps/default-layer.js`.

## Evidência e limites

Rodada final: 12.219 testes frontend, 5.039 backend e 201 contratos aprovados, lint/build aprovados. Os cenários de camada remota passaram em nove execuções, três repetições, sem retries/skips, com captura inspecionada. Controles negativos demonstraram exclusão tardia indevida, movimento/restauração obsoletos e ausência da camada no servidor.

A pausa do diálogo ainda não é barreira transacional entre todas as abas. Comandos compostos inteiros, conflitos além de feições e demais produtores continuam pendentes. Não houve implantação na rede interna.
