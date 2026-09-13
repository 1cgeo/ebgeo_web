# Inventário de vendors: o que se sabe de cada cópia

`npm audit` não olha um único dos artefatos versionados de `frontend/public/vendors/` e `frontend/src/vendor/`, então zero alerta nos três pacotes é zero num recorte que exclui justamente o código que este inventário existe para cobrir; e um punhado de componentes de runtime não tem versão determinável, o que significa que não há aviso de segurança a que consultá-los. A contagem exata mora na seção própria e não aqui, porque ela já envelheceu uma vez: dizia cinco, e a conferência seguinte fechou metade do que ela dava por perdido e derrubou duas versões que ela dava por sabidas.

O manifesto datado, arquivo por arquivo com bytes e hashes, é evidência viva e mora em [`docs/seguranca/dependencias-lancamento-inventario.json`](../seguranca/dependencias-lancamento-inventario.json). Esta página guarda o método, as armadilhas de medição e o que continua sem resposta, porque o manifesto responde "o que existe" e nunca "o que é seguro".

## A armadilha de medição: dois hashes por arquivo de texto

Os arquivos de TEXTO estão em CRLF na árvore de trabalho, efeito do checkout no Windows, então **o sha256 bruto deles não casa com nenhuma cópia publicada**. O manifesto guarda também o hash do mesmo conteúdo normalizado para LF, e é esse que se compara com o upstream.

Sem separar os dois a conferência dá o veredito errado, e deu: um dos wrappers do GDAL pareceu vir de outra versão só por causa disso. Quem repetir a conferência sobre um SHA candidato compara o hash normalizado, nunca o bruto.

**A normalização só quer dizer alguma coisa em arquivo de TEXTO, e a primeira medição não separou os dois.** Ela dizia "332 dos 408 em CRLF", e esse 332 conta todo arquivo em que o par de bytes 0D 0A aparece, inclusive 166 PNG, JPG, WASM e o pacote de dados do GDAL, que o carregam por coincidência dentro de conteúdo comprimido. A árvore se divide assim: **166 arquivos de texto em CRLF, 33 de texto em LF e 209 binários**, para os quais fim de linha não quer dizer nada. Pior que o contador: o `sha256Lf` daqueles 166 binários foi produzido por um ida e volta por string utf8, que devolve U+FFFD para todo byte inválido e nem preserva o tamanho do arquivo, de modo que ele não identifica conteúdo nenhum. A reprodução de 2026-09-13 confirmou a hipótese nos 166 casos, um a um; os valores continuam no manifesto, **rotulados** como artefato do instrumento, porque aquele arquivo é evidência datada e reescrevê-los apagaria a única prova de que a medição anterior tinha esse defeito.

Daí o eixo de identidade que vale daqui em diante, e o "se" é a lição inteira: **em arquivo de texto é o hash normalizado, em arquivo binário é o hash bruto**. Quem comparar tudo pelo bruto acusa 199 divergências fantasma na primeira máquina com outro fim de linha; quem comparar tudo pelo normalizado acusa 166 em arquivos que não mudaram um byte. Os dois erros já foram cometidos aqui.

## Versão declarada não é versão real, e as duas direções ocorreram

- **O milsymbol declara duas versões e as duas são verdade.** O banner do jsDelivr diz 3.0.3 e o objeto interno diz 3.0.2. `frontend/public/vendors/milsymbol.min.js`, normalizado para LF, é byte a byte igual ao dist publicado de milsymbol 3.0.3; o dist de 3.0.2 é outro arquivo e não casa. A divergência é do UPSTREAM: o próprio dist de 3.0.3 traz a constante interna 3.0.2. Ler a constante interna para identificar a versão devolve 3.0.2 em qualquer instalação de 3.0.3.
- **O Turf não declarava nenhuma.** Sem banner e sem string de versão, `frontend/public/vendors/turf.min.js` foi resolvido por hash contra as 80 versões estáveis publicadas: é a 7.0.0, com a ressalva de que o hash não a distingue de dois builds alpha que publicaram bytes idênticos.
- **O WebAssembly do GDAL tem três formas de string de versão e quatro strings que PARECEM versão e não são** (mensagens sobre outras versões do GDAL). Quem busca por texto e pega a primeira ocorrência lê a versão errada; por isso as sete foram registradas com o contexto de cada uma.

## O que continua sem versão determinável

São seis, e a lista ENCOLHEU em conteúdo enquanto crescia em itens: a conferência de 2026-09-13 fechou por evidência boa parte do que a versão anterior dava por perdido, e achou errado o que ela dava por sabido (ver o item 3). Quatro dos seis são runtime, não build. Nenhum tem upstream a que consultar aviso, com uma exceção medida, que é o item 1.

1. **`frontend/src/vendor/three/`** (o módulo ES, o minificado e o CommonJS): os três declaram a revisão 164dev, um snapshot de desenvolvimento entre a r163 e a r164. Nem tamanho nem hash batem com three 0.163.0, 0.164.0 ou 0.165.0. **O diff foi medido em 2026-09-13 e ele ancora o snapshot bem mais perto do que "entre as duas" sugere**: normalizado para LF, `three.module.js` está a 186 linhas da r163 publicada (38 blocos, 129 linhas nossas a mais e 59 a menos, sobre 52 mil linhas), contra 540 da r164 e 1405 da r165. Ou seja, é a r163 mais um punhado de trabalho em direção à r164, e não um meio-termo. O cabeçalho corrobora: ele diz "Copyright 2010-2023", que é o da r163; a r164 já traz 2024. **E o banco de avisos está VAZIO para ele**: consultado na mesma data, o registro npm publica exatamente um aviso para o pacote `three`, GHSA-fq6p-x6j3-cmmq (alto, negação de serviço), com faixa `<0.125.0`, muito abaixo deste snapshot. Este é o three que o visualizador 360 e as duas montagens do estúdio de calibração usam em runtime.
2. **`frontend/public/vendors/cesium/cesium-measure.js` e `frontend/public/vendors/cesium/cesium-viewshed.js`**: os dois únicos arquivos da pasta sem par em cesium 1.138.0, e os dois únicos sem banner, sem versão e sem licença (o cabeçalho de um traz apenas o nome de um autor). Foram escritos para Cesium por volta da 1.100 e só se sustentam sobre a 1.138 por causa de remendos internos, e os dois são carregados em runtime pelo visualizador 3D.

   **Trata-los como UM caso é o erro, e a diferença não é tamanho: um é legível e o outro é OFUSCADO.** O measure são 27 kB, 583 linhas indentadas, com JSDoc, nomes de variável reais e nenhuma API privada do Cesium: revisável por uma pessoa numa tarde, e a barreira é que os comentários estão em chinês. O viewshed são 154 kB e 1933 linhas em que **não há um único nome com significado**: 849 identificadores hexadecimais, vinte máquinas de estado de fluxo achatado e um dicionário que transforma até o operador `==` em chamada de função. Ele entrou minificado numa linha só e uma semana depois alguém rodou um embelezador em cima, o que explica a indentação: embelezado não é desofuscado. Revisão humana linha a linha não é viável ali sem desofuscar antes.

   **Os dois são FORKS LOCAIS não marcados, e é isso que impede a saída fácil de "troque pelo upstream".** O measure levou cinco commits nossos, dois deles de comportamento visível (a vírgula decimal do pt-BR e a área passando a vir do turf); o viewshed levou quatro, editados DENTRO do código ofuscado, um deles em cima da string do shader GLSL escapado. E o acoplamento do viewshed com a versão do Cesium é profundo de um jeito que nada promete: ele lê onze campos privados de `ShadowMap` para alimentar o shader à mão. A prova viva disso é `frontend/src/js/3d_models_viewer_tool/services/cesium-compat.js`, que existe só para manter os dois de pé sobre a 1.138 com três remendos (o polyfill de `defaultValue`, removido do Cesium na 1.134; a reescrita automática de GLSL ES 1.0 para 3.0; e o `isDestroyed` injetado). Eles já quebraram uma vez numa atualização do Cesium, e o próximo bump repete o episódio.
3. **Sete bibliotecas nativas dentro do WebAssembly do GDAL**: expat, json-c, libwebp, libjpeg (nem a versão nem o sabor, IJG contra turbo), libgeotiff, FreeXL e qhull. As sete estão linkadas, com mensagens internas próprias no binário, e nenhuma exporta string de versão. Fechar isso exigiria o receituário de build do gdal3.js, que a árvore de fontes embarcada nos caminhos de asserção denuncia e não empacota. Cinco outras (openjpeg, curl, netcdf, hdf5, xerces) não estão no binário por AUSÊNCIA, não por indeterminação: não foram compiladas neste build.

   **Esta linha dizia outra coisa até 2026-09-13, e o erro dela é o próprio assunto da seção anterior.** Ela contava "GDAL 3.8.4, libtiff 4.5.1, GEOS 3.8" como as três lidas do binário e dava PROJ e SQLite por indetermináveis. Só a primeira estava certa. `libtiff 4.5.1` saiu de "H(ost) mode is deprecated. Since libtiff 4.5.1, it is an alias of..." e `GEOS 3.8` saiu de "-makevalid only supported for builds against GEOS 3.8 or later": as duas são exatamente a armadilha que esta página descreve, uma menção histórica e um piso mínimo. Os banners reais dizem **libtiff 4.6.0** e **GEOS 3.12.1 (C API 1.18.1)**. E são determináveis, cada uma por dois ou três caminhos independentes, **PROJ 9.3.1**, **SQLite 3.45.1** e **SpatiaLite 5.1.0**, mais zlib 1.3.1 e libpng 1.6.37 por inferência estrutural (a macro de inicialização passa a constante de versão em todo sítio de chamada, e cada literal é a única ocorrência daquele formato no binário). O `.data` ainda publica em texto, dentro do `proj.db` empacotado, as versões de EPSG, ESRI e IGNF. Os offsets estão no inventário, sob a correção datada da entrada do `.wasm`. **A lição não é sobre GDAL: o aviso escrito não protege quem o escreveu**, e aqui ele foi escrito por extenso, para uma biblioteca, no mesmo objeto em que as outras duas caíram nele.

4. **Duas bibliotecas nativas dentro do visualizador de splat.** O `@manycore/aholo-viewer` (pinado em 1.8.1, versão exata) não distribui `.wasm` como arquivo: ele embute três módulos em base64 dentro dos `.js`, e o transcoder é 90,7% base64. O zstd tem seção `producers` e diz tudo (libzstd 1.5.7, via zstd-sys 2.0.16, com rustc 1.91.1 e wasm-bindgen 0.2.122); o **Draco** e o **transcoder Basis Universal / KTX2** tiveram as seções custom removidas e não deixam string de versão nenhuma. Só se fecham por hash contra os artefatos publicados de cada projeto, ou pedindo o manifesto ao fornecedor. As duas que o inventário registrava como ponto cego, `semver` e `fflate`, DEIXARAM de ser: o `dist` não é minificado e os comentários de caminho de módulo dizem `semver@7.8.5` e `fflate@0.8.3` em texto claro, confirmados pelos sourcemaps que o pacote publica. A armadilha ali é a constante de versão da especificação, igual a "2.0.0", que é a versão da ESPECIFICAÇÃO e não da biblioteca.
5. **A imagem Docker efetivamente em execução no servidor interno.** O digest lido do registro não prova o que roda hoje.
6. **O sistema operacional da imagem.** Nenhuma varredura de pacote Debian foi feita, e nem o `npm audit` nem este inventário a alcançam.

A metade que a conferência por hash resolveu bem: os 394 arquivos de `frontend/public/vendors/cesium/` contra os 392 de cesium 1.138.0, pelos hashes que a API de metadados do jsDelivr publica por arquivo, deram 392 idênticos e zero divergentes (os dois que sobram são o item 2 acima); e os cinco artefatos do GDAL (wrapper em três builds, o WebAssembly e o pacote de dados) são idênticos aos de gdal3.js 2.8.1, o que torna a versão do wrapper determinável por hash mesmo sem ele declarar versão nenhuma.

## O digest a fixar é o do ÍNDICE, não o de amd64

`backend/Dockerfile` declara a base `node:22-bookworm-slim` nos dois estágios, sem digest nas duas ocorrências. **Fixar o digest do índice preserva o multiarch**, então o mesmo arquivo continua construindo em amd64 e em arm64; fixar o digest de uma plataforma amarra a imagem a ela e quebra a construção em qualquer outra. Não é preferência de estilo, é a diferença entre um Dockerfile portável e um que só funciona na máquina de quem o fixou.

O Dockerfile não foi alterado: ele é caminho de implantação, e a troca exige confirmação do dono e uma construção de prova. Ver [[deploy-backend]].

## Achado lateral: vendor sem consumidor

Seis arquivos não têm um único carregador no código, e a conferência de 2026-09-13 os mediu um a um, por busca do nome em `frontend/src`, nos quatro HTML, no `vite.config.js`, no `package.json`, em `backend/src` e nos scripts:

| arquivo | bytes |
|---|---|
| `frontend/public/vendors/cesium/index.cjs` | 4.548.070 |
| `frontend/public/vendors/cesium/index.js` | 4.495.137 |
| `frontend/src/vendor/three/three.cjs` | 1.335.804 |
| `frontend/src/vendor/three/three.min.js` | 673.123 |
| `frontend/src/vendor/three/addons/controls/OrbitControls.js` | 33.780 |
| `frontend/src/vendor/three/addons/controls/DragControls.js` | 6.270 |

São **11.092.184 bytes**, e os dois do Cesium sozinhos são 8,6 MB que `publicDir` copia verbatim para o `dist/`. Dos cinco arquivos do three, só `three.module.js` tem consumidor: quatro imports estáticos (o visualizador 360, o `tile-loader.js`, e as duas montagens da calibração) mais seis `vi.mock`. O `OrbitControls.js` nem funcionaria se importado, porque a linha de import dele pede o especificador nu `three`, que não resolve neste projeto.

A lista NÃO alcança dois builds auxiliares do wrapper do GDAL (`gdal3.dev.js`, 1,4 MB, e `gdal3.node.js`, 190 kB), que também não aparecem como literal em lugar nenhum. Eles ficam de fora por prudência e não por dúvida sobre o grep: a pasta inteira do GDAL é entregue ao wrapper como **diretório**, por caminho montado em runtime em `frontend/src/js/import_export/pdf-export.tab.js`, e é assim que os 39,8 MB de `.wasm` e `.data` chegam. Onde a resolução é dinâmica, o grep vazio não é prova de ausência de consumidor. A mesma ressalva vale, e em dobro, para os 389 arquivos internos da distribuição Cesium (`Assets/`, `Workers/`, `ThirdParty/`, `Widgets/`): o próprio `Cesium.js` deriva o base URL da tag de script e busca todos eles em runtime, de modo que apagar qualquer um quebra na tela sem quebrar build nem teste.

Um dos seis carrega **delta local não declarado em lugar nenhum**: `frontend/src/vendor/three/addons/controls/DragControls.js` tem uma linha de import trocada para caminho relativo, e nada mais nas outras 281 (conferido contra a r163 e a r164 publicadas, que trazem o arquivo idêntico entre si). O `OrbitControls.js` é igual ao das duas, a menos da quebra de linha final. Cópia de terceiro com delta que ninguém declarou é a forma de divergência que a conferência seguinte lê como "veio de outra versão".

**E o inventário tem um buraco de ESCOPO, achado pela mesma varredura.** Ele cobre duas pastas, e existe uma terceira: `frontend/public/street_view/build/` guarda uma segunda cópia dos cinco arquivos do three, **byte a byte idêntica** à de `frontend/src/vendor/three/` (mesma revisão 164dev), 3.373.610 bytes, também sem um único consumidor. Ela não está entre os 408 e não entra em nenhum dos números desta página, então "os 408 artefatos" nunca quis dizer "todo código de terceiro versionado". É o único caso: fora de `vendors/`, nenhum outro `.js`, `.css` ou `.wasm` de terceiro mora em `frontend/public/`.

Podar o que não tem consumidor encolhe a superfície a auditar sem tocar em comportamento, e é decisão do dono, porque `frontend/public/vendors/` é caminho frágil. Ver [[peso-do-pacote-web]].

## Fecho sobre o SHA candidato

O inventário responde "o que existe" numa data. O fecho do lançamento é repetir as três medições sobre o commit que vai ser publicado, e o que segue é o passo a passo, na ordem em que se roda. Ele só vale se a árvore de trabalho ESTIVER no candidato: as três leem o disco, não o commit, então confira o `HEAD` antes de acreditar em qualquer saída.

**1. O inventário reproduz?**

```bash
git rev-parse HEAD                      # anote: e este SHA que o fecho certifica
node scripts/inventario-de-vendors.mjs --check
```

Saída de sucesso é `faltando: 0  novos: 0  divergentes: 0  bytes diferentes: 0` e código de saída 0. O script lista os arquivos por `git ls-files` das duas pastas, mede cada um e compara com o manifesto versionado pelo eixo certo (normalizado para LF em texto, bruto em binário). As quatro classes querem ações diferentes: `faltando` é poda ou renomeação, `novo` é cópia de terceiro que entrou sem passar pelo inventário e é a que exige decisão, `divergente` é o único que significa que o mesmo caminho mudou de conteúdo, e `bytes diferentes` é o aviso mais fraco, porque tamanho em árvore CRLF depende do checkout. O `--json` cospe o manifesto no formato do arquivo, para quem for regravá-lo.

Quem for refazer o inventário inteiro numa data nova acrescenta um bloco datado ao JSON e aponta `lerManifestoVersionado` para a chave nova; hoje ela lê `vendorInventory2026_09_13`. Guarda: `frontend/tests/unit/inventario-de-vendors.test.js`, que roda em menos de um segundo e falha se o script e o arquivo se separarem.

**2. Os avisos oficiais, com data.**

```bash
npm audit --prefix frontend --json
npm audit --prefix backend --json
npm audit --json                        # a raiz
```

Leitura apenas: `npm audit fix` muda lockfile, que é caminho frágil. Registre a DATA da consulta junto com o número, porque o número é uma foto do banco de avisos naquele dia e não uma propriedade do código: o mesmo lockfile devolve outro resultado na semana seguinte. O atalho que evita a rodada inútil é comparar o lockfile com o do último registro (`git rev-parse <sha>:frontend/package-lock.json`); se os três blobs não mudaram, só o banco de avisos pode ter mudado, e é por isso que a consulta se refaz mesmo assim.

E toda vez que esse zero for anotado, anote ao lado o que ele não prova: `npm audit` só olha o lockfile, e nenhum dos 408 artefatos desta página passa por ele, nem os 5 do buraco de escopo, nem a imagem Docker, nem o sistema operacional dela.

**3. O digest da imagem.**

O digest a fixar é o do ÍNDICE, pela razão da seção acima, e o lugar em que ele entra é **`backend/Dockerfile`, nas DUAS ocorrências de `FROM node:22-bookworm-slim`** (o estágio `deps` e o estágio `runtime`), cada uma virando `FROM node:22-bookworm-slim@sha256:<digest do índice> AS <estágio>`. Não há outro lugar: `deploy/deploy.sh` não fala de Docker (ele troca o symlink do `dist/` do frontend) e `backend/docker-compose.yml` constrói por `build: .`, então herda o Dockerfile. O compose declara uma segunda imagem sem digest, `postgis/postgis:16-3.4`, que é do serviço de banco para desenvolvimento e teste e é decisão separada.

O digest observado em 2026-09-13 e a proposta estão em [`dependencias-lancamento-inventario.json`](../seguranca/dependencias-lancamento-inventario.json), sob `runtimeInventory2026_09_13`, com o digest por plataforma ao lado para conferência. Relê-lo é:

```bash
docker buildx imagetools inspect node:22-bookworm-slim
```

**O Dockerfile não se edita neste fecho.** Ele é caminho de implantação: a troca exige confirmação do dono e uma construção de prova, e sem essa construção o pino é uma linha que ninguém provou que constrói. Ver [[deploy-backend]].

**4. O que o fecho NÃO fecha.** As três medições acima certificam que o que está versionado é o que o manifesto diz, que o banco de avisos não tinha nada a dizer sobre os lockfiles naquele dia, e qual imagem base se pretende fixar. Nenhuma delas alcança a imagem em execução no servidor interno, o sistema operacional dela, ou a pergunta de exposição real dos cinco componentes sem versão determinável. Essas continuam abertas e são decisão, não medição.

## Ver também

[[deploy-backend]] para a imagem e as migrações; [[peso-do-pacote-web]] para o que cada cópia custa no payload; [[hardening-borda-api]] para a borda que não depende de vendor.
