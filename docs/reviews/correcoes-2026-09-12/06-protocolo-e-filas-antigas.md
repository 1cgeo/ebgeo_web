# Protocolo de escrita e preservação de filas antigas

Commit conferido: `b26f4e66`. As atualizações de dependências no mesmo commit estão em [documento separado](07-dependencias.md).

## Problema e correção

Exigir base de edição somente dos clientes novos deixava uma aba antiga contornar as garantias. Converter uma pendência antiga usando a revisão atual também poderia sobrescrever trabalho sem uma observação válida.

Todas as novas operações da fábrica, individuais e em lote, recebem protocolo 2. O servidor exige compatibilidade em HTTP, WS simples, WS em lote e serviço. A recusa incremental usa HTTP 426, porque clientes anteriores podem retirar pendências ao tratar 400/422 como falhas terminais. O cliente negocia capacidades antes da conexão remota e também no caminho direto de envio.

Filas incompatíveis conservam envelope, ID e chave originais. Ficam fora do envio e da projeção automática; dependentes são bloqueados. Uma consulta somente leitura compara atlas, autor e hash do recibo. Apenas confirmação inequívoca permite retirar a intenção. Leitor que perdeu escrita pode confirmar sua própria entrega anterior dentro das regras de acesso; ausência ou ambiguidade conserva o trabalho. Resposta tardia de outra sessão não limpa a fila atual.

Entradas: `backend/src/modules/sync/sync-protocol.js`, `backend/src/modules/sync/sync.service.js`, `frontend/src/js/store/sync/legacy-queue.js`, `frontend/src/js/store/sync/sync-engine.js` e `frontend/src/js/store/sync/operation-factory.js`.

## Evidência e limites

O [registro de fechamento](../execucao-fechamento-lancamento.md) documenta testes de protocolo/recibos, versão futura, revogação, leitor rebaixado e envio direto. Retirar temporariamente os guardas tornou as regressões vermelhas. O navegador aprovou nove execuções em três repetições. A suíte frontend final deste checkpoint aprovou 12.231 testes; a raiz imediatamente anterior ao último guarda de envio direto aprovou 12.227 frontend, 5.050 backend e 201 contratos. A raiz completa foi aprovada novamente nos checkpoints seguintes.

Protocolo 2 em todas as entidades não significa conflitos implementados em todas elas. A interface de conciliação e a compatibilidade das quatro exceções estruturais REST continuam [pendentes](../fechamento/01-compatibilidade.md). Atlas locais não entram na quarentena remota.
