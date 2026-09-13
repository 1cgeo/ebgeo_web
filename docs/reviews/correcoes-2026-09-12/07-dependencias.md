# Correções de dependências npm

Commit conferido: `b26f4e66`. Os resultados abaixo são datados de 12/09/2026, conforme o [inventário versionado](../dependencias-lancamento-inventario.json); não são uma nova consulta de alertas feita nesta retrospectiva.

## Problema e correção

A auditoria da integração encontrou alertas em dependências diretas e transitivas. O aviso do GitHub na branch padrão tem outro escopo e não poderia ser usado como a avaliação completa do candidato.

Foram atualizados fast-uri, js-yaml, Vitest e transitivas afetadas, Joi, Nodemailer, sharp/libvips, body-parser e qs, com manifests e lockfiles compatíveis. O Express 4 permaneceu na mesma versão principal; um override restrito instalou a versão corrigida de qs para esse caminho. Não foi usada atualização forçada indiscriminada. Também foi instalado o Chromium correspondente ao Playwright do lockfile para viabilizar os ensaios locais.

Arquivos versionados: `frontend/package.json`, `frontend/package-lock.json`, `backend/package.json` e `backend/package-lock.json`. A escolha de versões, os alertas anteriores e os hashes observados estão no inventário, evitando repetir aqui uma lista que envelhece.

## Evidência e limites

Instalações limpas por npm ci terminaram com sucesso. A auditoria posterior registrou zero alertas npm na raiz, frontend e backend. Build, lint e testes foram executados depois das atualizações, conforme o [registro de fechamento](../execucao-fechamento-lancamento.md). A primeira tentativa de navegador sem o binário correto falhou antes de abrir a aplicação; não foi tratada como aprovação.

Vendors distribuídos, bibliotecas WASM e imagem/runtime não são certificados por npm audit. Permanecem a confirmação de proveniência/versão de Turf e GDAL, a divergência de versão de milsymbol e a imagem efetiva da rede interna. O [trabalho de segurança restante](../fechamento/08-seguranca.md) continua bloqueando o lançamento. Nenhuma atualização do runtime do servidor interno foi executada.
