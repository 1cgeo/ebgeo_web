# Peso do pacote web

O que prende uma biblioteca no payload inicial de `index.html`, e por que a alavanca óbvia (tirar o `proj4`) não paga o que promete.

Estrutura dos grupos de chunk e a armadilha dos nomes gerados ficam em `.claude/rules/architecture.md`; publicação em [[deploy-web]]. Aqui fica só o que a leitura do `vite.config.js` não conta.

## O que decide o payload é o import estático, não o grupo de chunk

`frontend/src/js/map_sig.js` importa o stack de import/export por módulo, e não pelo barril, com um comentário no próprio arquivo explicando o porquê (o barril arrasta o exportador de KMZ que já é carregado por `await import()`). O efeito colateral não está no comentário: como esses cinco imports são **estáticos**, tudo que eles alcançam entra no payload eager da página do mapa, inclusive o `shpjs` (importador de shapefile, usado só quando alguém arrasta um arquivo) e `frontend/src/js/import_export/pdf-cartographic-elements.js` (usado só na aba de exportação em PDF).

Medido em 2026-08-14: tornar esses imports dinâmicos vale **123,5 kB** (42,0 kB gzip) no eager de `index.html`. É trabalho não feito, e o número existe para que a próxima pessoa decida com dado em vez de intuição.

## A armadilha: o `proj4` não sai junto

A leitura natural é "o `proj4` está no boot só por causa da conversão de UTM, então troque a conversão por 2 kB de matemática direta". Ela erra por metade, e a auditoria de 2026-08-14 errou exatamente assim. São **duas** entradas independentes:

- pelo stack acima (`shpjs` e os elementos cartográficos do PDF);
- por `frontend/src/js/utilities/coordinate_converter.js`, que a barra de busca alcança estaticamente (`frontend/src/js/search/search-bar.component.js` importa `frontend/src/js/search/search-bar.search-providers.js`, que o importa) e o painel de ponto também.

Fechar uma ponta não tira um byte de `proj4` do bundle, porque a outra continua alcançável. Quem quiser mesmo remover a dependência precisa das duas ao mesmo tempo, e essa é a razão de o ganho medido acima ser atribuído ao stack de import/export, não ao `proj4`.

## Custo escondido: `public/` é publicado inteiro, a cada release

Tudo em `frontend/public/` é copiado verbatim para `dist/` e vai para o servidor a cada publicação, e o deploy retém as três últimas releases ([[deploy-web]]). Dado de amostra deixado ali não aparece em nenhum import, não é acusado por nenhum guarda de código morto e multiplica o custo de toda publicação: foi assim que 828 MB de panorâmicas de exemplo passaram a viajar em cada deploy até 2026-08-14.

O diretório continua pesado depois daquela limpeza (156 MB em 2026-08-14, dos quais 78 MB em `public/docs` e 65 MB em `public/vendors`), então a armadilha segue viva. Antes de acrescentar dado pesado ali, meça o diretório, e prefira servi-lo pelo backend ([[assets3d-distribuicao]], [[streetview-360]]).
