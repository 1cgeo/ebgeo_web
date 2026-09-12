# Camada padrão dos atlas remotos

Correção de 12/09/2026, no branch integração backend.

## Comportamento

- Criar um atlas pela API grava o atlas, seu mapa inicial e uma camada “Padrão” com UUID na mesma transação. Abrir o atlas não precisa inventar essa camada.
- Criar um mapa por sincronismo grava também sua camada no servidor. O resultado confirmado leva a camada ao autor, aos demais clientes e ao replay. Reenviar a operação devolve o mesmo identificador.
- Excluir a última camada cria outra camada real na mesma transação. A camada excluída e suas feições continuam excluídas; a substituta recebe outro UUID. Exclusões concorrentes são serializadas pelo lock do atlas.
- Importação, cópia de mapa e clone de atlas completam mapas sem camadas e vinculam feições sem camada a uma camada do próprio mapa.
- O repositório e o gerenciador do navegador sintetizam `default` apenas para atlas locais. No atlas remoto, um mapa novo aguarda a camada confirmada pelo servidor; uma queda de conexão não produz uma camada independente no navegador.

## Respostas atrasadas e dados anteriores

O ACK de criação de mapa aplica as camadas sem regravar o documento do mapa, preservando feições editadas enquanto a resposta estava pendente. Versões de camada impedem que esse ACK ou a resposta de uma exclusão antiga recriem uma camada já excluída. A atualização de camada inclui sua linha completa, permitindo aplicar uma edição recebida antes do ACK de criação sem perder a configuração mais recente.

A [regularização de dados](../../backend/src/database/migrations/012_camadas_remotas.sql) cria camadas somente nos mapas vivos que não têm nenhuma. Preserva as configurações das camadas existentes e o conteúdo das feições sem camada, vinculando-as à primeira camada real do próprio mapa. Atualiza a revisão dessas feições e exige um snapshot para os cursores anteriores. A reaplicação não duplica camadas.

Clientes antigos que enviam uma feição com referência implícita à camada padrão recebem o UUID real no resultado confirmado. Uma referência explícita a uma camada excluída é recusada com motivo, sem mover a feição silenciosamente para a substituta.

A resolução da referência implícita usa uma cópia dos dados. O envelope original permanece intacto para o cálculo do recibo: repetir a mesma criação ou atualização antiga confirma a entrega anterior sem aplicar a alteração duas vezes.

A regularização do banco não recupera configurações que existiram apenas no navegador e já foram descartadas por uma reconciliação anterior. Não transforma uma edição antiga em uma edição contra uma versão atual inventada.

## Verificação

Regressões no [backend](../../backend/tests/integration/remote-default-layer.test.js), no [cliente](../../frontend/tests/integration/recovery-remote-operation-handler.test.js), no [repositório](../../frontend/tests/integration/repository-captured-scope.test.js) e no [navegador com dois clientes](../../frontend/tests/e2e-ui/browser-default-layer.spec.js). O cenário de [conversão com camada travada](../../frontend/tests/e2e-ui/browser-collab-conversao-linear.spec.js) usa a camada inicial criada pelo servidor.

Os resultados da execução completa são registrados em [execução da correção do atlas remoto](execucao-correcao-atlas-remoto.md).
