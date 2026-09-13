# Segurança e dependências restantes

Status: pendente. Prioridade: bloqueia lançamento. O inventário está feito; a conclusão continua exigindo o SHA candidato final.

## Estado comprovado

### Checkpoint de 2026-09-13 (inventário)

O [inventário datado](../../seguranca/dependencias-lancamento-inventario.json) ganhou uma seção 2026-09-13 ao lado da de 2026-09-12, que ficou intacta. O que ele passou a cobrir, medido sobre o commit 841e1539:

1. **Os 408 arquivos versionados de vendor, e não seis.** Cada um com caminho, bytes e sha256. Antes havia seis entradas escritas à mão; agora há um manifesto completo de `frontend/public/vendors/` e `frontend/src/vendor/`, mais dezenove fichas por artefato, com a versão declarada no próprio arquivo e como ela foi determinada.
2. **Dois hashes por arquivo de texto, e a razão é uma armadilha de medição.** A árvore de trabalho está em CRLF (332 dos 408 arquivos), efeito do checkout no Windows, então o sha256 bruto não casa com nenhuma cópia publicada. O manifesto guarda também o hash do mesmo conteúdo normalizado para LF, e é esse que se compara com o upstream. Sem separar os dois a conferência dá o veredito errado: um dos wrappers do GDAL pareceu vir de outra versão só por causa disso.
3. **A árvore Cesium inteira, arquivo a arquivo.** Os 394 arquivos de `frontend/public/vendors/cesium/` foram comparados com os 392 de cesium 1.138.0 usando os hashes que a API de metadados do jsDelivr publica por arquivo. Resultado: 392 idênticos, zero divergentes. Antes só `frontend/public/vendors/cesium/Cesium.js` estava no inventário, e as subárvores Assets, ThirdParty, Widgets e Workers, que são a maior parte do peso, nunca tinham sido conferidas.
4. **Os cinco artefatos do GDAL, e não um.** O wrapper (três builds), o WebAssembly e o pacote de dados de 11,6 MB. Os dois binários são byte a byte idênticos aos de gdal3.js 2.8.1, e os três de texto também, depois de normalizados, o que torna a versão do wrapper determinável por hash mesmo sem ele declarar versão nenhuma. O WebAssembly teve as três formas de string de versão registradas com o contexto de cada uma, junto com as quatro strings que parecem versão e não são (mensagens sobre outras versões do GDAL), porque quem busca por texto e pega a primeira ocorrência lê a versão errada.
5. **A pasta do three, que estava inteiramente fora.** Cinco arquivos, todos declarando a revisão 164dev.
6. **`frontend/public/vendors/vue.css`**, que também estava fora, resolvido junto com o `frontend/public/vendors/docsify.min.js` que ele acompanha.
7. **A divergência do milsymbol, resolvida.** O banner do jsDelivr diz 3.0.3 e o objeto diz 3.0.2. O arquivo normalizado para LF é byte a byte igual ao dist publicado de milsymbol 3.0.3, e o dist de 3.0.2 é outro arquivo, que não casa. A divergência é do upstream e não desta cópia: o próprio dist de 3.0.3 traz a constante interna 3.0.2, conferido no mesmo dia baixando os dois. Ler a constante interna para identificar a versão devolve 3.0.2 em qualquer instalação de 3.0.3.
8. **A versão do Turf, que era desconhecida.** Sem banner e sem string de versão no arquivo, foi resolvida por hash contra as 80 versões estáveis publicadas: é a 7.0.0. Com uma ressalva registrada, porque o hash não a distingue de dois builds alpha que publicaram bytes idênticos.
9. **npm audit datado nos três pacotes**, seis execuções (com e sem dependências de desenvolvimento), todas em 2026-09-13, com contagem por severidade e total de dependências auditadas em cada uma.
10. **O digest da imagem base do Docker**, lido do registro na mesma data, com o digest do índice e os digests por plataforma.

### npm audit de 2026-09-13

Zero alertas nos três pacotes, e o zero é o que a saída diz: as seis execuções voltaram com as cinco contagens de severidade em zero e o mapa de vulnerabilidades vazio. A lista de alertas do checkpoint está vazia por medição, não por omissão. A tabela dos 19 alertas anteriores continua no checkpoint de 2026-09-12, como registro do que foi remediado.

O que esse zero não prova, e precisa ser dito junto: npm audit só olha o lockfile. Nenhum dos 408 artefatos do inventário passa por ele, nem o WebAssembly do GDAL, nem a imagem Docker e o sistema operacional dela. Zero aqui é zero num recorte, e o recorte exclui justamente o que este inventário existe para cobrir.

### Imagem de runtime

`backend/Dockerfile` declara a base node:22-bookworm-slim nos dois estágios, sem digest nas duas ocorrências. O digest do índice foi lido do registro em 2026-09-13 e está no inventário, junto com os digests por plataforma e com a proposta de fixação.

A proposta é fixar o digest do ÍNDICE, não o de amd64, e a razão não é estilo: o índice preserva o multiarch, então o mesmo arquivo continua construindo em amd64 e em arm64, enquanto o digest de uma plataforma amarra a imagem a ela e quebra a construção em qualquer outra.

O Dockerfile NÃO foi alterado neste lote. Ele é caminho de implantação, e a troca precisa da confirmação do dono e de uma construção de prova.

## O que continua sem versão determinável

1. **O three de `frontend/src/vendor/three/`** (o módulo ES, o minificado e o CommonJS). Os três declaram a revisão 164dev, um snapshot de desenvolvimento entre a r163 e a r164. Conferido: nem o tamanho nem o hash batem com three 0.163.0, 0.164.0 ou 0.165.0. A consequência prática é que não há versão a que consultar aviso de segurança, e não dá para dizer se um aviso publicado sobre o three se aplica a este snapshot sem ler o diff. E este é o three que o visualizador 360 e as duas montagens do estúdio de calibração usam em runtime, não um arquivo parado.
2. **`frontend/public/vendors/cesium/cesium-measure.js` e `frontend/public/vendors/cesium/cesium-viewshed.js`.** São os dois únicos arquivos da pasta sem par em cesium 1.138.0, e os dois únicos sem banner, sem versão e sem licença. O cabeçalho de um traz apenas o nome de um autor. Os dois são carregados em runtime pelo visualizador 3D, foram escritos para Cesium por volta da 1.100 e só se sustentam sobre a 1.138 por causa de remendos internos. Não há upstream conhecido a que consultar aviso.
3. **As bibliotecas nativas dentro do WebAssembly do GDAL, além das três que se leem do binário** (GDAL 3.8.4, libtiff 4.5.1 e GEOS 3.8). PROJ, SQLite, libgeotiff, expat, zlib e o resto da cadeia não deixam string de versão inequívoca ali, e nenhum aviso foi avaliado contra elas.
4. **A imagem Docker efetivamente em execução no servidor interno.** Sem acesso a ela nesta sessão, não dá para afirmar que o digest lido do registro é o que roda hoje. Fica para o ensaio de [homologação e migração](09-homologacao-e-migracao.md).
5. **O sistema operacional da imagem.** Nenhuma varredura de vulnerabilidade de pacote Debian foi feita, e nem o npm audit nem este inventário a alcançam.

## Achado lateral do inventário: vendor sem consumidor

Conferindo quem carrega cada artefato, quatro grupos não têm consumidor nenhum no código: `frontend/public/vendors/cesium/index.js` e o irmão em CommonJS (8,6 MB publicados que nenhum HTML e nenhum módulo carregam), os dois builds auxiliares do wrapper do GDAL, e quatro dos cinco arquivos do three, incluindo os dois controles em `frontend/src/vendor/three/addons/controls/`. Um deles, `frontend/src/vendor/three/addons/controls/DragControls.js`, carrega um delta local que não estava declarado em lugar nenhum: uma linha de import trocada para caminho relativo, e nada mais nas outras 281.

Podar o que não tem consumidor encolhe a superfície a auditar sem tocar em comportamento, mas é decisão do dono, porque `frontend/public/vendors/` é caminho frágil.

## Trabalho

1. Fixar o SHA candidato e refazer o inventário sobre ele. O manifesto de 408 linhas existe para que essa conferência seja um diff, e não uma busca.
2. Consultar avisos oficiais atuais e classificar versão afetada, exposição real, runtime/build/teste, correção disponível e impacto. Registrar data e fonte. Não repetir como atuais contagens históricas de alertas.
3. Resolver os cinco itens sem versão determinável acima, ou registrar decisão e responsável para cada um.
4. Atualizar ou substituir componentes afetados de forma controlada. Preservar instalação reproduzível; não executar correção forçada indiscriminada. Ausência de correção exige mitigação verificável e decisão explícita.
5. Levar a fixação do digest ao dono, com construção de prova, e registrar o digest da imagem que de fato roda no servidor interno.
6. Revisar autorização entre atlas, acesso a uploads/recibos/sockets após revogação, expiração e limites de recursos. Seguir `CONSTITUICAO.md`, sem criar papéis ou atalhos de permissão.
7. Registrar dependências da infraestrutura que não puderem ser verificadas localmente para a [liberação interna](10-liberacao-interna.md).

## Aceite

Nenhuma vulnerabilidade crítica/alta aplicável e explorável permanece sem correção ou mitigação demonstrada. Riscos restantes têm decisão e responsável. Instalação limpa, lint, testes, build e cenários dos componentes alterados passam. Zero alertas npm sozinho não encerra esta tarefa, e o inventário completo também não: ele descreve o que existe, não o que é seguro. Alterar vendors, lockfiles ou implantação exige respeitar o contexto de autorização e as instruções do repositório, sem modificar o servidor interno nesta sessão.
