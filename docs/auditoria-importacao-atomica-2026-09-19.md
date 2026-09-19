# Substituição atômica de atlas por arquivo .ebgeo

## Problema e correção

A substituição apagava o atlas montado antes de gravar o arquivo inteiro. Falta de espaço, uma imagem ilegível ou o fechamento da página podiam deixar o destino incompleto e eliminar o conteúdo anterior. Além disso, erros nas seções opcionais podiam terminar apenas no console, seguidos de uma mensagem de sucesso.

A importação não aditiva agora prepara mapas, grupos, camadas, notas, cores, comentários, configurações temporais, grade, 3D, 360, briefings, ícones e imagens em bancos separados. Cada gravação é relida e comparada, inclusive os bytes e o MIME dos blobs. Só depois uma única gravação no registro global do IndexedDB publica o novo endereço do atlas.

No atlas local, o cartão mantém seu identificador e nome; não consome uma vaga adicional, mesmo no limite de dez atlas. Com um atlas remoto aberto, o resultado nasce como outro atlas local completo. Uma falha na preparação não desconecta nem modifica o remoto. A importação aditiva continua sendo um fluxo separado e não recebeu garantia de atomicidade.

## Interrupções e concorrência

- Antes da publicação: o registro continua apontando para o original. Um diário permite remover a preparação abandonada no próximo início, sob a trava do registro.
- Depois da publicação: o registro já aponta para todos os dados verificados. Uma falha ao redesenhar a tela não desfaz a publicação; a mensagem orienta reabrir o atlas salvo.
- Troca durante a leitura do ZIP ou perda do controle da aba: a importação recusa publicar no destino errado. A preparação integra a serialização das transições e aguarda as escritas anteriores.
- A limpeza dos bancos substituídos verifica referências e uma trava exclusiva de montagem. Bancos ainda montados, legados ou provenientes de resgate remoto são preservados. Preparações abandonadas e bancos substituídos elegíveis são limpos no início ou na importação seguinte.
- Mapas com identificadores repetidos não se sobrescrevem. Imagens e briefings com identificadores ambíguos são recusados antes da publicação.

Não há transação única atravessando todos os bancos. A atomicidade observável vem da publicação de um resultado isolado e completo, mantendo a origem até esse ponto. Isso exige espaço temporário para o original e a importação. A limpeza de resíduos entre abas depende de Web Locks; sem esse recurso, o sistema conserva os resíduos cuja exclusão não consegue arbitrar.

## Evidências

Os testes de preparação injetam falhas em mapas, grupos, camadas, comentários, imagens, briefings, configurações e registro do atlas, além de simular uma gravação que retorna sucesso mas produz conteúdo diferente na releitura. Os testes do registro cobrem falha de publicação, nova tentativa, destino obsoleto e limite de dez atlas.

Controle negativo executado: desativar temporariamente a verificação da releitura fez o caso de gravação corrompida reprovar (um vermelho e dez verdes). Restaurada a implementação, os onze casos passaram.

No Chromium com IndexedDB real, os ensaios cobrem recarga durante a preparação, falta de espaço ao importar uma imagem, nova tentativa e recarga após a publicação antes da montagem. O arquivo de teste usado nesses ensaios é descartável.

Os cinco arquivos fornecidos em `_ebgeo_dados_teste` foram importados pela interface, reabertos e examinados quanto a quantidade de mapas, feições, blobs e renderização. Os arquivos originais foram apenas lidos. Os defeitos existentes na origem continuam tratados conforme a [auditoria de imagens](auditoria-imagens-2026-09-19.md).

Regressões: `frontend/tests/unit/prepare-ebgeo-scope.test.js`, `frontend/tests/unit/local-atlas-api.test.js`, `frontend/tests/integration/import-ebgeo-atlas-local.test.js`, `frontend/tests/e2e-ui/atomic-import.spec.js` e `frontend/tests/e2e-ui/migration-external-data.scenario.js`.

A rodada final aprovou os 13.349 testes do frontend, os 5.298 do backend e os 249 de contrato. Lint e build também passaram. Os totais, os controles adicionais de diagnóstico e as observações da bancada estão no [resultado da validação conjunta](auditoria-logs-deslogados-2026-09-19.md#resultado-final-da-validação).

## Limites

A garantia cobre a substituição local por arquivo aceito, dentro das garantias de durabilidade do navegador. Não cobre apagar os dados do site, corrupção física do perfil/disco ou perda simultânea de todos os registros e suas cópias. A importação direta para o servidor ainda separa criação do atlas e upload de imagens; esse limite está na [auditoria de migração](auditoria-migracao-versoes-2026-09-19.md). A intranet não foi acessada, conforme o escopo solicitado.
