# Inventário de vendors: o que se sabe de cada cópia

`npm audit` não olha um único dos artefatos versionados de `frontend/public/vendors/` e `frontend/src/vendor/`, então zero alerta nos três pacotes é zero num recorte que exclui justamente o código que este inventário existe para cobrir; e cinco componentes de runtime não têm versão determinável, o que significa que não há aviso de segurança a que consultá-los.

O manifesto datado, arquivo por arquivo com bytes e hashes, é evidência viva e mora em [`docs/seguranca/dependencias-lancamento-inventario.json`](../seguranca/dependencias-lancamento-inventario.json). Esta página guarda o método, as armadilhas de medição e o que continua sem resposta, porque o manifesto responde "o que existe" e nunca "o que é seguro".

## A armadilha de medição: dois hashes por arquivo de texto

A árvore de trabalho está em CRLF (332 dos 408 arquivos), efeito do checkout no Windows, então **o sha256 bruto não casa com nenhuma cópia publicada**. O manifesto guarda também o hash do mesmo conteúdo normalizado para LF, e é esse que se compara com o upstream.

Sem separar os dois a conferência dá o veredito errado, e deu: um dos wrappers do GDAL pareceu vir de outra versão só por causa disso. Quem repetir a conferência sobre um SHA candidato compara o hash normalizado, nunca o bruto.

## Versão declarada não é versão real, e as duas direções ocorreram

- **O milsymbol declara duas versões e as duas são verdade.** O banner do jsDelivr diz 3.0.3 e o objeto interno diz 3.0.2. `frontend/public/vendors/milsymbol.min.js`, normalizado para LF, é byte a byte igual ao dist publicado de milsymbol 3.0.3; o dist de 3.0.2 é outro arquivo e não casa. A divergência é do UPSTREAM: o próprio dist de 3.0.3 traz a constante interna 3.0.2. Ler a constante interna para identificar a versão devolve 3.0.2 em qualquer instalação de 3.0.3.
- **O Turf não declarava nenhuma.** Sem banner e sem string de versão, `frontend/public/vendors/turf.min.js` foi resolvido por hash contra as 80 versões estáveis publicadas: é a 7.0.0, com a ressalva de que o hash não a distingue de dois builds alpha que publicaram bytes idênticos.
- **O WebAssembly do GDAL tem três formas de string de versão e quatro strings que PARECEM versão e não são** (mensagens sobre outras versões do GDAL). Quem busca por texto e pega a primeira ocorrência lê a versão errada; por isso as sete foram registradas com o contexto de cada uma.

## O que continua sem versão determinável

Nenhum destes cinco tem upstream a que consultar aviso, e três deles são runtime, não build:

1. **`frontend/src/vendor/three/`** (o módulo ES, o minificado e o CommonJS): os três declaram a revisão 164dev, um snapshot de desenvolvimento entre a r163 e a r164. Nem tamanho nem hash batem com three 0.163.0, 0.164.0 ou 0.165.0. Não dá para dizer se um aviso publicado sobre o three se aplica a este snapshot sem ler o diff, e este é o three que o visualizador 360 e as duas montagens do estúdio de calibração usam em runtime.
2. **`frontend/public/vendors/cesium/cesium-measure.js` e `frontend/public/vendors/cesium/cesium-viewshed.js`**: os dois únicos arquivos da pasta sem par em cesium 1.138.0, e os dois únicos sem banner, sem versão e sem licença (o cabeçalho de um traz apenas o nome de um autor). Foram escritos para Cesium por volta da 1.100 e só se sustentam sobre a 1.138 por causa de remendos internos, e os dois são carregados em runtime pelo visualizador 3D.
3. **As bibliotecas nativas dentro do WebAssembly do GDAL** além das três que se leem do binário (GDAL 3.8.4, libtiff 4.5.1, GEOS 3.8). PROJ, SQLite, libgeotiff, expat, zlib e o resto da cadeia não deixam string inequívoca ali.
4. **A imagem Docker efetivamente em execução no servidor interno.** O digest lido do registro não prova o que roda hoje.
5. **O sistema operacional da imagem.** Nenhuma varredura de pacote Debian foi feita, e nem o `npm audit` nem este inventário a alcançam.

A metade que a conferência por hash resolveu bem: os 394 arquivos de `frontend/public/vendors/cesium/` contra os 392 de cesium 1.138.0, pelos hashes que a API de metadados do jsDelivr publica por arquivo, deram 392 idênticos e zero divergentes (os dois que sobram são o item 2 acima); e os cinco artefatos do GDAL (wrapper em três builds, o WebAssembly e o pacote de dados) são idênticos aos de gdal3.js 2.8.1, o que torna a versão do wrapper determinável por hash mesmo sem ele declarar versão nenhuma.

## O digest a fixar é o do ÍNDICE, não o de amd64

`backend/Dockerfile` declara a base `node:22-bookworm-slim` nos dois estágios, sem digest nas duas ocorrências. **Fixar o digest do índice preserva o multiarch**, então o mesmo arquivo continua construindo em amd64 e em arm64; fixar o digest de uma plataforma amarra a imagem a ela e quebra a construção em qualquer outra. Não é preferência de estilo, é a diferença entre um Dockerfile portável e um que só funciona na máquina de quem o fixou.

O Dockerfile não foi alterado: ele é caminho de implantação, e a troca exige confirmação do dono e uma construção de prova. Ver [[deploy-backend]].

## Achado lateral: vendor sem consumidor

Quatro grupos não têm um único carregador no código: `frontend/public/vendors/cesium/index.js` e o irmão em CommonJS (8,6 MB publicados que nenhum HTML e nenhum módulo carregam), os dois builds auxiliares do wrapper do GDAL, e quatro dos cinco arquivos do three, incluindo os dois controles de `frontend/src/vendor/three/addons/controls/`.

Um deles carrega **delta local não declarado em lugar nenhum**: `frontend/src/vendor/three/addons/controls/DragControls.js` tem uma linha de import trocada para caminho relativo, e nada mais nas outras 281. Cópia de terceiro com delta que ninguém declarou é a forma de divergência que a conferência seguinte lê como "veio de outra versão".

Podar o que não tem consumidor encolhe a superfície a auditar sem tocar em comportamento, e é decisão do dono, porque `frontend/public/vendors/` é caminho frágil. Ver [[peso-do-pacote-web]].

## Ver também

[[deploy-backend]] para a imagem e as migrações; [[peso-do-pacote-web]] para o que cada cópia custa no payload; [[hardening-borda-api]] para a borda que não depende de vendor.
