# Primeira etapa de recuperação do sincronismo

Commit conferido: `f8e109ea`. Este checkpoint era intermediário e terminou com falhas de contrato, resolvidas no [commit seguinte](05-contratos-descarte-e-camada.md).

## Problemas e correções

A fila podia perder trabalho por políticas de expiração/compactação, uma resposta perdida podia provocar reexecução ambígua, e o cursor podia avançar sem comprovar aplicação. Substituir um snapshot diretamente também expunha o estado local a interrupções.

O commit removeu expiração/compactação destrutiva da fila, introduziu sequência atômica e envelopes imutáveis, handles vinculados ao escopo e diário antes da persistência para feições/comentários. Intenções preparadas não são liberadas para envio antes da materialização.

Recibos de entrega ficaram independentes do histórico de replay, com autoria, hash e resultado durável. Recusas permanecem consultáveis; dependências recusadas bloqueiam descendentes sem parar trabalho independente. Feições ganharam patches/base observada, conflitos por campo e proteção contra recriação após exclusão.

Snapshot passou a ser preparado em geração separada, com ativação de ponteiro/cursor após preparação. Replay e operações adiadas mantêm aplicação e avanço de cursor coordenados; broadcast isolado com versão maior não comprova a entrega das versões anteriores. A rede ganhou limites de espera, cancelamento por sessão, trava de auto-flush antes do await e respeito a Retry-After.

Arquivos centrais: `frontend/src/js/store/sync/queue-journal.js`, `frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/remote-operation-handler.js`, `backend/src/modules/sync/sync-receipts.js` e `backend/src/modules/sync/feature-conflicts.js`.

## Evidência e limites

O [registro de execução](../execucao-correcao-atlas-remoto.md) conserva regressões de diário, snapshot, escopo, cursor, recibos, rede e controles negativos. No fechamento de `f8e109ea`, o teste da raiz terminou com código 1: 12.193 testes frontend e 5.027 backend aprovados, mas somente 177 de 201 contratos passaram. As 24 falhas não foram ocultadas.

Este commit não entregou todos os produtores, conflitos de todas as entidades, uploads, painel de resolução ou barreira entre abas. O protocolo obrigatório foi acrescentado posteriormente em [compatibilidade](06-protocolo-e-filas-antigas.md). A [lista de pendências](../fechamento/README.md) descreve o estado atual.
