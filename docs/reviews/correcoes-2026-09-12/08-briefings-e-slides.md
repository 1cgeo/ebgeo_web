# Diário completo de briefings e slides

Commit conferido: `d2f6c516`.

## Problema e correção

Gravar o briefing antes da intenção podia deixar uma edição local sem operação recuperável. Slides presentes no documento do pai também não substituíam suas operações individuais: o servidor persiste os filhos separadamente.

Criação, atualização, exclusão e edição/reordenação de slides passaram a ler e preparar o conjunto sob a mesma trava do briefing. O diário registra pai e diferenças de todos os filhos antes de persistir a entidade. Criação com slides e importação/cópia geram as operações necessárias; cópias e importações remotas novas recebem identidades novas sem modificar o objeto de entrada. Sobrescrita conserva o destino existente.

As marcas de preparação são removidas numa única transação IndexedDB, evitando liberar somente parte do conjunto para envio. A recuperação de snapshot projeta intenções preparadas com os mesmos IDs, inclusive slide cujo pai já recebeu ACK. Mudança de atlas durante leitura interrompe a escrita. Falha de quota conserva a intenção e rejeita a confirmação; o rastro de persistência é emitido após a materialização.

Entradas: `frontend/src/js/store/briefing.operations.js`, `frontend/src/js/store/sync/queue-journal.js`, `frontend/src/js/store/sync/operation-dispatcher.js` e `frontend/src/js/store/sync/remote-operation-handler.js`.

## Evidência e limites

Nove regressões em `frontend/tests/integration/briefing-write-ahead.test.js` cobrem diário, quota, concorrência, materialização atômica, escopo e identidade. O cenário `frontend/tests/e2e-ui/browser-briefing-write-ahead.spec.js` cobre offline/F5, cópia com slides e quota seguida de recuperação; os três casos passaram duas vezes, com inspeção adicional da captura. Controles negativos retirando diário e materialização atômica falharam.

Raiz aprovada com 12.240 testes frontend, 5.050 backend e 201 contratos; lint/build aprovados. Registro completo no [fechamento](../execucao-fechamento-lancamento.md).

Isso não torna a importação inteira atômica no servidor, nem resolve disputas de conteúdo/ordem entre usuários. A revisão dos produtores com autosave/debounce da UI continua no [trabalho de persistência](../fechamento/02-persistencia.md).
