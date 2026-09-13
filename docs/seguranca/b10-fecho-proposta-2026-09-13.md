# B10, o fecho: oito decisões para o dono

Medido em 2026-09-13, sobre o HEAD `ee3383e1` do branch `plano/b10vend`. O inventário de artefatos está em [`dependencias-lancamento-inventario.json`](dependencias-lancamento-inventario.json) e o método em [`../wiki/inventario-de-vendors.md`](../wiki/inventario-de-vendors.md).

Este documento não decide nada. Ele separa o que foi MEDIDO do que precisa de escolha, e para cada escolha põe as opções lado a lado com o preço de cada uma. A recomendação é uma leitura, não um voto.

**O que já está fechado e não precisa de decisão:** o inventário agora reproduz por comando (`node scripts/inventario-de-vendors.mjs --check`, zero divergências neste HEAD), e o `npm audit` dos três pacotes voltou zero na data, com os três lockfiles idênticos aos do commit `841e1539` que os auditou pela primeira vez. As duas medições viraram procedimento escrito, na seção "Fecho sobre o SHA candidato" da wiki.

---

## V1. O three revisão 164dev

**O que se determinou.** Os três arquivos declaram `REVISION = '164dev'`, um snapshot entre a r163 e a r164, e nenhuma release publicada bate por hash. Mas o diff ancora o snapshot muito mais perto do que "entre as duas" sugere: normalizado para LF, `three.module.js` está a **186 linhas da r163** (38 blocos, 129 linhas nossas a mais e 59 a menos, sobre 52 mil linhas), contra **540 da r164** e **1405 da r165**. O cabeçalho corrobora, dizendo "Copyright 2010-2023", que é o da r163; a r164 já traz 2024. Os dois controles em `addons/` são outra história: o `OrbitControls.js` é idêntico ao publicado (r163 e r164 trazem o mesmo arquivo) a menos da quebra de linha final, e o `DragControls.js` tem exatamente uma linha trocada, a do import, mais a quebra de linha final.

**E o risco atual é mensuravelmente zero.** Consultado o registro npm na mesma data, o pacote `three` tem **exatamente um aviso publicado em toda a sua história**: GHSA-fq6p-x6j3-cmmq, alto, negação de serviço, faixa `<0.125.0`. Não há nada a que este snapshot esteja exposto hoje. O que não existe é o canal: se um aviso sair amanhã, não há versão a que comparar sem refazer este diff.

**Quem depende.** Só `three.module.js` tem consumidor: quatro imports estáticos (`street_view_viewer.js`, `tile-loader.js`, e as duas montagens da calibração) mais seis `vi.mock` em testes. Os outros quatro arquivos não têm nenhum, e caem em V6.

**Opções.**

1. **Ficar.** Custo zero. Registra-se a ancoragem (r163 mais 186 linhas) no inventário, e a conferência de um aviso futuro passa a ser um diff que já está medido. Perde: continua sem upstream a que perguntar.
2. **Trocar por `three@0.164.0` do npm**, versão exata, num ponto único, no modelo de `frontend/src/js/map/maplibre.js` (a migração do MapLibre de `public/vendors/` para o npm, feita em 2026-09-04, é o precedente e a forma). Delta de comportamento medido: 540 linhas. É a primeira release publicada que está estritamente À FRENTE do snapshot no tempo do upstream.
3. **Trocar por `three@0.163.0`.** Delta menor, 186 linhas, mas na direção errada: reverteria as 129 linhas de trabalho que o snapshot já tem.

**Recomendação: opção 2.** O delta é maior que o da 3 e é o único que não perde trabalho do upstream. Ela traz três coisas de graça: um upstream a que consultar aviso, a poda dos quatro arquivos do three sem consumidor (V6), e a convergência do `tile-loader.js` com o `ebgeo_360`, cujo trecho de adaptação número 2 é exatamente a troca de `from 'three'` por um caminho relativo (os seis trechos declarados viram cinco). O preço a pagar com os olhos abertos: é uma troca de versão embaixo do visualizador 360 e do estúdio de calibração, que são justamente onde a fidelidade da projeção importa, então ela exige captura do Playwright dos dois, antes e depois, lida como imagem. Os seis `vi.mock` citam o especificador literal e mudam junto, e a regra de chunk do `vite.config.js` que hoje mantém `src/vendor/three/` fora do grupo `calibration` precisa ser repensada, porque o módulo passa a vir de `node_modules`.

---

## V2. `cesium-measure.js`: adotar o que já é nosso

**O que se determinou.** 27.183 bytes, 583 linhas, cerca de 433 efetivas. Legível: indentado, com JSDoc por método e nomes de variável reais. Único crédito no arquivo é `@author zhangti`, na linha 4. **Sem licença, sem URL, sem ano, sem versão.** Comentários em chinês, origem provável na comunidade Cesium chinesa, sem proveniência recuperável. Não usa nenhuma API privada do Cesium: os 21 símbolos que consome são todos públicos e estáveis. Não contém `eval`, `new Function`, `atob`, `fetch` nem `XMLHttpRequest`. Carregado por injeção dinâmica de script em `frontend/src/js/3d_models_viewer_tool/map_3d.js`, e consumido ali mesmo por `new Cesium.Measure(viewer)`.

**O que muda a natureza do caso: ele já é um fork nosso.** Cinco commits locais, e duas das mudanças são de comportamento visível (o separador decimal em vírgula, para pt-BR, e o cálculo de área passando a vir do turf), além da limpeza de handlers, do conserto do divisor de km² e da remoção de um `console.log` esquecido. "Trocar pelo upstream" não é uma saída disponível: não há upstream, e se houvesse, a troca perderia as cinco.

**Opções.**

1. **Adotar como código da casa**: mover para `frontend/src/js/3d_models_viewer_tool/`, traduzir os comentários, passar pelo ESLint da casa (hoje ele é marcado externo no `vite.config.js` e não passa por lint nenhum), e escrever um cabeçalho que declare a origem, o autor conhecido, a ausência de licença e as cinco correções locais.
2. **Manter como vendor** e só acrescentar o cabeçalho de proveniência.
3. **Reescrever do zero** sobre a API pública.

**Recomendação: opção 1.** É a única que converte um custo de auditoria recorrente num custo único de uma tarde: 433 linhas de JS idiomático, sem API privada, que uma pessoa que conheça Cesium lê inteiro. A barreira real é o idioma dos comentários, não a complexidade. **Mas há uma pergunta que é do dono e não do código, e ela vale para V2 e V3 igualmente: este repositório é PÚBLICO por decisão, e código de terceiro sem licença explícita é, por padrão, todos os direitos reservados.** Redistribuir os dois num repositório público é exposição jurídica, não técnica, e nenhuma quantidade de revisão de código a resolve.

---

## V3. `cesium-viewshed.js`: 154 kB ofuscados que ninguém leu

**O que se determinou, e é o achado mais desconfortável do bloco.** 154.710 bytes, 1.933 linhas, e **não há um único nome com significado no arquivo inteiro**: 3.474 ocorrências de identificadores hexadecimais (849 distintos), um dicionário de proxy que transforma até o operador `==` em chamada de função, e vinte blocos de fluxo achatado (`switch` sobre uma lista de índices em string). A linha 1 sozinha tem 9.213 caracteres: é o shader GLSL inteiro em escapes. **Sem autor, sem licença, sem URL, sem ano, sem versão.** Nada.

Ele entrou minificado numa linha só e, uma semana depois, alguém rodou um embelezador em cima; é daí que vem a indentação. **Embelezado não é desofuscado.** As pistas de origem que sobrevivem apontam para uma coleção de plugins Cesium chinesa (o global UMD é `space`), e metade do arquivo é um sensor retangular conhecido da comunidade, aqui sem nenhuma atribuição. Os nomes de uniform estão em pinyin.

**Também é fork local**, com quatro commits nossos editados DENTRO do código ofuscado, um deles em cima da string do shader escapado.

**O acoplamento é o que torna isto uma dívida com juros.** Ele lê **onze campos privados de `ShadowMap`** do Cesium para alimentar o shader à mão. Nada no Cesium promete nenhum deles. A prova viva é `frontend/src/js/3d_models_viewer_tool/services/cesium-compat.js`, que existe só para manter os dois arquivos de pé sobre a 1.138 com três remendos: o polyfill de `defaultValue` (removido do Cesium na 1.134, e o viewshed o usa nove vezes), a reescrita automática de GLSL ES 1.0 para 3.0, e o `isDestroyed` injetado. Eles já quebraram uma vez numa atualização e foram remendados de fora; o próximo bump do Cesium repete o episódio.

O único atenuante que se pôde medir: o arquivo não contém `eval`, `new Function`, `atob`, `String.fromCharCode`, `fetch` nem `XMLHttpRequest`. Isso limita o pior cenário e **não prova ausência de comportamento indevido**, porque um ofuscador reconstrói nomes por concatenação.

**Opções.**

1. **Manter e declarar.** Custo zero de trabalho, e o estado passa a estar escrito: 154 kB de código ofuscado, sem autoria e sem licença, rodando com os privilégios da página do produto.
2. **Desofuscar, revisar e adotar.** Dias de trabalho, e o resultado é uma reconstrução, não o original.
3. **Reescrever o viewshed sobre a API pública de `ShadowMap`.** Elimina de uma vez os onze acoplamentos privados e os três remendos de `cesium-compat.js`.

**Recomendação: opção 3 como alvo, com a 1 declarada por escrito enquanto isso, e com prazo.** A opção 2 é a pior das três: paga o preço da 3 e entrega menos. E a decisão MÍNIMA para o lançamento, qualquer que seja o rumo, é a metade declaratória da 1: hoje o inventário descreve este arquivo e o `cesium-measure.js` como um caso só ("os dois sem upstream conhecido"), e eles não são um caso só. Um é revisável numa tarde; o outro nenhum ser humano deste projeto jamais leu, e não é por descuido, é porque não dá.

---

## V4. As bibliotecas nativas dentro do WebAssembly do GDAL

**O achado que muda o item, e é constrangedor.** O inventário avisa, por extenso, que o `.wasm` do GDAL tem strings que PARECEM versão e não são, e lista quatro delas. Ele então registrou **duas outras como fato**, e as duas são exatamente isso. A leitura foi refeita e conferida por caminho independente:

| o que o inventário dizia | de onde saiu | a versão real |
|---|---|---|
| `libtiff 4.5.1` | "H(ost) mode is deprecated. Since libtiff 4.5.1, it is an alias of..." (menção histórica) | **libtiff 4.6.0**, do banner próprio `LIBTIFF, Version 4.6.0` |
| `GEOS 3.8` | "-makevalid only supported for builds against GEOS 3.8 or later" (piso mínimo) | **GEOS 3.12.1, C API 1.18.1**, do bloco `GEOS_VERSION=` |

Só `GDAL 3.8.4` estava certo. **E a ressalva também estava errada na direção oposta**: ela dava PROJ, SQLite e o resto por indetermináveis, e são determináveis, cada uma por dois ou três caminhos independentes. **PROJ 9.3.1** (a constante de build, a string própria "Rel. 9.3.1, December 1st, 2023", e a tabela de metadados do `proj.db` empacotado no `.data`), **SQLite 3.45.1** (a constante de versão, e o identificador de fonte do FTS5, que é o do release), **SpatiaLite 5.1.0**, mais **zlib 1.3.1** e **libpng 1.6.37** por inferência estrutural declarada como tal. O `.data` publica ainda, em texto, PROJ_DATA 1.16, EPSG v10.098, ESRI ArcGIS Pro 3.2 e IGNF 3.1.0. Os offsets estão todos no inventário, sob a correção datada.

**O que fica sem resposta, e agora é uma lista fechada de sete.** expat, json-c, libwebp, libjpeg (nem a versão nem o sabor, IJG contra turbo), libgeotiff, FreeXL e qhull: as sete estão linkadas, com mensagens internas próprias, e nenhuma exporta string de versão. Outras cinco não estão lá por AUSÊNCIA e não por indeterminação (openjpeg, curl, netcdf, hdf5, xerces): não foram compiladas neste build, o que é uma redução real de superfície e merece ficar escrito.

**Opções.**

1. **Aceitar e declarar** as sete, agora que a lista é fechada e o resto da cadeia tem versão escrita.
2. **Derivar do upstream**: abrir a receita de build do gdal3.js 2.8.1 e ler dali a versão fixada de cada uma das sete. O binário denuncia a árvore de build nos caminhos de asserção que ele carrega, mas não a empacota. Custo baixo, e o resultado é uma afirmação sobre o que o upstream DIZ ter compilado, não sobre o binário que temos.
3. **Trocar a superfície**: o GDAL aqui serve a UMA coisa, a conversão para PDF georreferenciado da folha única, e o mosaico já sai por jsPDF sem GDAL nenhum. Avaliar se a folha única pode sair pela mesma porta elimina 39,8 MB e a cadeia inteira.

**Recomendação: opção 1 para o fecho, opção 2 se sobrar tempo, opção 3 como pergunta de médio prazo.** A diferença em relação à versão anterior deste item é que a 1 deixou de ser uma capitulação: sete bibliotecas sem versão, nomeadas, com cinco outras provadas ausentes e sete determinadas, é um estado que se pode assinar. A 3 continua sendo a única que remove o problema em vez de descrevê-lo, e o argumento a favor dela é que a saída georreferenciada tem um consumidor e 39,8 MB de custo.

---

## V5. O `@manycore/aholo-viewer` e o que ele vendoriza

**O que se determinou.** Pinado em `1.8.1`, versão exata. **E as duas bibliotecas que o inventário registrava como ponto cego deixaram de ser**: o `dist` não é minificado, é bundle de esbuild com os comentários de caminho de módulo preservados, e eles dizem em texto claro `semver@7.8.5` e `fflate@0.8.3`, confirmados pelos sourcemaps que o pacote publica junto. Nenhuma comparação de hash foi necessária. A armadilha ali, para quem repetir a busca, é a constante de versão da especificação, igual a "2.0.0": essa é a versão da ESPECIFICAÇÃO SemVer, não da biblioteca, e quem a tomar pela versão erra por três ordens de grandeza.

A varredura completa dos quatro sourcemaps diz que essas são as ÚNICAS duas dependências vendorizadas com versão rastreável; todo o resto vem de código próprio do fornecedor.

**O que a mesma varredura ACRESCENTOU ao problema.** O pacote não distribui `.wasm` como arquivo: ele embute **três módulos nativos em base64 dentro dos `.js`** (o transcoder é 90,7% base64; sobre os quatro arquivos juntos, 37%). São eles: **zstd**, que tem seção `producers` e diz tudo (libzstd 1.5.7 via zstd-sys 2.0.16, rustc 1.91.1, wasm-bindgen 0.2.122); **Draco**; e o **transcoder Basis Universal / KTX2**. Os dois últimos tiveram as seções custom removidas e não deixam string de versão nenhuma. Ou seja, o ponto cego não sumiu, ele MUDOU DE LUGAR: saiu de duas bibliotecas JavaScript, que agora têm versão, para duas bibliotecas nativas de descompressão e transcodificação de textura, que processam bytes de arquivo vindos do servidor.

**Opções.**

1. **Registrar o que se determinou e declarar os dois wasm** como o ponto cego que resta.
2. **Fechar os dois por hash** contra os artefatos publicados de Draco e Basis Universal, que é o método que resolveu o Turf.
3. **Pedir ao fornecedor** o manifesto do módulo interno que ele empacota.
4. **Vigiar de fora**: declarar `semver` e `fflate` como dependências diretas do frontend, agora que se sabe a versão, só para que o `npm audit` passe a falar delas.

**Recomendação: opção 1 agora, com a 3 disparada em paralelo, e recusar explicitamente a 4.** A 4 é tentadora justamente porque a versão virou conhecida, e é o tipo de conserto que a constituição chama de cobertura vazia: o audit passaria a reportar sobre a versão DECLARADA no lockfile, não sobre a que está fundida no bundle, e no dia em que o fornecedor publicar 1.8.2 com outra `fflate` dentro, o verde continuaria verde. Um ponto cego declarado é melhor que um verde que não verifica nada. A 2 é o caminho honesto para os dois wasm e não precisa bloquear o lançamento.

---

## V6. Os seis vendors sem consumidor: podar ou não

**O que se determinou**, por busca do nome de cada arquivo em `frontend/src`, nos quatro HTML, no `vite.config.js`, no `package.json`, em `backend/src` e nos scripts:

| arquivo | bytes |
|---|---|
| `frontend/public/vendors/cesium/index.cjs` | 4.548.070 |
| `frontend/public/vendors/cesium/index.js` | 4.495.137 |
| `frontend/src/vendor/three/three.cjs` | 1.335.804 |
| `frontend/src/vendor/three/three.min.js` | 673.123 |
| `frontend/src/vendor/three/addons/controls/OrbitControls.js` | 33.780 |
| `frontend/src/vendor/three/addons/controls/DragControls.js` | 6.270 |

**11.092.184 bytes**, e os dois do Cesium são 8,6 MB que `publicDir` copia verbatim para o `dist/`. O `index.cjs` não tem sequer uma menção em prosa no repositório inteiro. O `OrbitControls.js` nem funcionaria se importado: a linha de import dele pede o especificador nu `three`, que não resolve aqui.

**A ressalva que não se pode perder.** Dois builds auxiliares do wrapper do GDAL (`gdal3.dev.js`, 1,4 MB, e `gdal3.node.js`, 190 kB) também não aparecem como literal, e **ficaram FORA da lista de propósito**: a pasta inteira do GDAL é entregue ao wrapper como diretório, por caminho montado em runtime, e é assim que os 39,8 MB de `.wasm` e `.data` chegam. Onde a resolução é dinâmica, grep vazio não é prova. A mesma ressalva vale, em dobro, para os 389 arquivos internos da distribuição Cesium, que o próprio `Cesium.js` busca pelo base URL derivado da tag de script: apagar qualquer um quebra na tela sem quebrar build nem teste.

**Opções.**

1. **Não podar.** Custo: 11 MB no repositório e no `dist/`, e seis arquivos que toda auditoria futura reexamina.
2. **Podar os dois do Cesium** (8,6 MB, os de evidência mais forte).
3. **Podar os seis**, com os quatro do three saindo de graça se V1 for aceito.

**Recomendação: opção 3, condicionada a V1, e num commit só que não faça mais nada.** `frontend/public/vendors/` é caminho frágil: a poda pede uma captura do Playwright do visualizador 3D e do 360 depois, lida como imagem, porque é exatamente o tipo de mudança cujo defeito não aparece em teste nenhum. Se V1 for recusado, a opção 2 sozinha já entrega 78% do byte.

---

## V7. O inventário tem um buraco de escopo

**O que se determinou.** O inventário cobre duas pastas, e existe uma terceira: **`frontend/public/street_view/build/` guarda uma segunda cópia dos cinco arquivos do three, byte a byte idêntica à de `frontend/src/vendor/three/`** (mesma revisão 164dev), somando **3.373.610 bytes**, também sem um único consumidor. Ela não está entre os 408 e não entra em nenhum número do inventário, então "os 408 artefatos" nunca quis dizer "todo código de terceiro versionado". Conferido: é o único caso, porque fora de `vendors/` nenhum outro `.js`, `.css` ou `.wasm` de terceiro mora em `frontend/public/`.

**Opções.**

1. **Podar a pasta e deixar o escopo como está.** Resolve o caso e não o padrão: a próxima cópia de terceiro que nascer fora das duas pastas some do inventário do mesmo jeito.
2. **Ampliar o escopo do inventário** para todo `.js`, `.css` e `.wasm` de terceiro em `frontend/public/`, e fazer o script acusar arquivo de terceiro fora das pastas conhecidas.
3. **As duas.**

**Recomendação: opção 3.** A poda é a limpeza, e o escopo é o que impede a recorrência. Um inventário cujo alcance é uma lista de pastas escrita à mão tem o mesmo defeito das listas fechadas que a constituição proíbe: falha ABERTO, em silêncio, para o arquivo que nascer fora dela. A forma que o repositório já usa para isso é o censo varrido por `git ls-files` que reprova o sítio não classificado.

---

## V8. O digest da imagem, e o sistema operacional que ninguém varreu

**O que se determinou.** `backend/Dockerfile` declara `node:22-bookworm-slim` nos dois estágios, sem digest nas duas ocorrências. O digest do índice foi lido em 2026-09-13 e está registrado no inventário sob `runtimeInventory2026_09_13`, com o digest por plataforma ao lado. **Fixar o digest do ÍNDICE preserva o multiarch**; fixar o de uma plataforma amarra a imagem a ela e quebra a construção em qualquer outra. Não é estilo, é a diferença entre um Dockerfile portável e um que só funciona na máquina de quem o fixou.

Não há outro lugar onde o digest entre: `deploy/deploy.sh` não fala de Docker (ele troca o symlink do `dist/` do frontend) e `backend/docker-compose.yml` constrói por `build: .`, herdando o Dockerfile. O compose declara uma segunda imagem sem digest, `postgis/postgis:16-3.4`, do serviço de banco de desenvolvimento e teste; é decisão separada e de risco menor, porque não vai para produção.

**O que continua sem resposta**, e é o único item do bloco que nenhuma medição feita aqui alcança: a imagem efetivamente em execução no servidor interno (o digest lido do registro não prova o que roda hoje), a versão exata de Node dentro dela, e qualquer varredura de vulnerabilidade do sistema operacional da imagem. O `npm audit` não chega a nenhuma das três.

**Opções.**

1. **Fixar o digest do índice** nas duas linhas, no commit de lançamento, com uma construção de prova antes de publicar.
2. **Não fixar** e aceitar que "a mesma tag" signifique imagens diferentes entre duas construções.
3. **Fixar e acrescentar uma varredura do sistema operacional** da imagem construída, uma vez, cujo resultado entra no inventário com data.

**Recomendação: opção 3, com a varredura podendo vir depois do lançamento se custar prazo.** A opção 1 sozinha já é a parte que importa e é barata. **O Dockerfile não foi alterado e não deve ser alterado sem o dono**: é caminho de implantação, e um pino que ninguém provou que constrói é uma linha de texto, não uma garantia.

---

## O que este documento não cobre

A pergunta de EXPOSIÇÃO real de cada componente sem versão determinável (o que um atacante faria com ela, por qual superfície) não foi respondida aqui e não é medição: é análise, e ela depende das decisões acima, porque metade dos componentes pode simplesmente deixar de existir. As três medições reproduzíveis do fecho estão na wiki e rodam em menos de um minuto somadas.
