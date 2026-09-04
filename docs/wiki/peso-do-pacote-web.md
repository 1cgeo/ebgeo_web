# Peso do pacote web

O que prende uma biblioteca no payload inicial de `index.html`, e por que a alavanca óbvia (tirar o `proj4`) não paga o que promete.

Estrutura dos grupos de chunk e a armadilha dos nomes gerados ficam em `.claude/rules/architecture.md`; publicação em [[deploy-web]]. O custo de EXECUÇÃO do mapa (o quadro, o worker, o terreno), que é outra conta, está em [[desempenho-do-mapa-2d]]. Aqui fica só o que a leitura do `vite.config.js` não conta.

## O aviso de tamanho de chunk deixou de ser sinal limpo, de propósito

Desde 2026-08-14 o `npm run build` emite o aviso de "chunks are larger than" para o grupo `first-person-3d`, que tem cerca de 1,9 MB minificados contra um `chunkSizeWarningLimit` de 1200 ([[primeira-pessoa-3d]]). Metade daquilo é WASM em base64 dentro do motor de splatting, que não minifica nem se divide. Subir o limite silenciaria o alarme para todo chunk presente e futuro, então o aviso ficou. **Consequência para quem usa "build limpo" como verificação: esse é o único aviso de TAMANHO esperado, e um segundo chunk acusado significa chunk novo passando do teto.** O que é UM é o chunk, não a linha de aviso: o mesmo build também emite o aviso de import dinâmico inefetivo e o sumário de tempos de plugin, e repete o conjunto inteiro na passada legacy, porque `frontend/vite.config.js` liga o `@vitejs/plugin-legacy`. Contar linhas de aviso, e não chunks acusados, é o que faz um build normal parecer regressão. A medição está em `.claude/rules/architecture.md`, §Páginas e chunks.

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

O diretório continua pesado depois daquela limpeza, e a série de duas medidas conta mais que qualquer uma delas sozinha: **156 MB em 2026-08-14, 185 MB em 2026-08-23**, com `public/docs` (78 MB) e `public/vendors` (65 MB) **inalterados** entre as duas. Ou seja, os 29 MB que entraram não passaram por nenhuma das pastas que a medida anterior vigiava: são os assets de primeira pessoa em `public/3d/primeira-pessoa` ([[primeira-pessoa-3d]]), que nasceram inteiros no intervalo.

É exatamente o modo de falha que esta seção existe para vigiar, e ele reincidiu: o peso não cresce nos lugares onde alguém já olhou, cresce numa pasta nova que ninguém pensou em medir. Por isso a instrução é medir o **diretório inteiro** antes de acrescentar dado pesado ali (`du -sm frontend/public/*`, ordenado por tamanho), e não conferir as pastas grandes conhecidas. E prefira servir dado pesado pelo backend ([[assets3d-distribuicao]], [[streetview-360]], [[acervo-3d-convertido]]).

## Histórico

- **2026-08-23.** Duas correções de leitura, e as duas eram da mesma família (um absoluto lido como propriedade). O aviso de tamanho de chunk era descrito como "o único aviso esperado", o que fazia um build normal parecer regressão: o build emite outros avisos que não são de tamanho, e repete tudo na passada legacy. E a medida de `frontend/public` foi refeita, subindo de 156 MB para 185 MB sem que nenhuma das duas pastas nomeadas na medida antiga mudasse.
