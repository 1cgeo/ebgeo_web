# Acervo 3D convertido (.3dtiles por modelo)

O acervo fotogramétrico servido como UM arquivo SQLite por modelo, com geometria Draco e textura KTX2. Absorvido do serviço `ebgeo_3d`, que era um processo à parte. Esta página cobre o que o código não conta: o porquê da conversão, o que o token de geração compra, e as armadilhas que já custaram tempo de máquina.

## Por que converter, com os números que decidiram

A árvore de origem tem **115 modelos, 2.261.536 arquivos e 96,8 GiB**, com textura JPEG ou WebP. Dois problemas medidos, e nenhum deles é tamanho de download:

- **Memória de vídeo.** Uma vista de 110 m sobre um dos modelos MENORES pede **1,4 GiB de VRAM só de textura**, porque o JPEG descomprime para RGBA8 na placa. Depois da conversão, 206 MiB: o KTX2/ETC1S fica comprimido em BC1 na memória da GPU.
- **Número de arquivos.** Backup, cópia para produção e varredura de antivírus cobram por arquivo, não por byte. O maior modelo tem 247.125 deles.

A conversão custa 8% de espaço em disco a mais e cerca de 12,6 h de máquina para o acervo inteiro. O que se ganha é a diferença entre um modelo que abre e um que trava a placa.

## O formato NÃO é da casa, e isso é deliberado

Um `.3dtiles` é uma tabela `media(key, content)` num SQLite: é o formato do `3d-tiles-tools` do Cesium. Um arquivo escrito aqui abre com `npx 3d-tiles-tools convert`, e um arquivo escrito por eles abre aqui. Trocar o nome das colunas por algo mais bonito custaria essa compatibilidade e não compraria nada.

Duas escolhas de armazenamento que têm número atrás e não se mexem sem remedir:

- **`page_size = 4096`**, e não os 65536 do 360. Lá o BLOB é uma foto de megabytes; aqui o tile médio tem 39,9 KiB, menor que uma página de 64 KB, e o resto vira desperdício. Medido no Ponte_Quatis: 4 KB custa +2,1% de disco e 64 KB custa +21,9%, com a diferença de leitura dentro da variação das medidas. Em 104 GiB de acervo isso são cerca de 20 GiB.
- **`journal_mode = DELETE` no fecho**, e não WAL. Em WAL o SQLite cria o `-shm` ao abrir, e num volume montado `:ro` isso derruba o serviço com um erro que não aponta a causa. Fora do WAL o modelo vira arquivo único, que é o que se copia para produção.

## O token de geração é o que autoriza o `immutable`

Todo tile sai com `Cache-Control: public, max-age=31536000, immutable`, e isso só é seguro porque a `uri` dentro dos `tileset.json` carrega o token daquela geração (`build_token`, `a3d.models`). Sem o token, reimportar troca os bytes sem trocar a URL, e o navegador passa um ano compondo tile velho dentro da árvore nova, sem erro nenhum. O 360 já pagou esse defeito.

Três consequências que não se adivinham:

1. **O `?v=` é ignorado pelo handler, de propósito.** Ele não é parâmetro: quem o consome é o cache. Uma validação de query que o recusasse responderia 400 no tile inteiro por causa do próprio token que o `tileset.json` publicou.
2. **O token de hoje NÃO se compara com o do pedido.** No instante seguinte a uma reimportação o cliente ainda segura o `tileset.json` anterior; recusar o token velho pintaria a cena de buraco em vez de servir o tile bom.
3. **O `tileset.json` é o único conteúdo desta rota que não é imutável.** Ele sai `no-cache` (guarde e revalide), porque uma reimportação troca a árvore inteira. O ETag é derivado de (modelo, chave, token), então a revalidação custa um 304 que nunca abre o arquivo. Ver [[sintese-cache-http-imutavel]].

## Catálogo em `tilesets`, produção em `a3d.models`

O serviço `ebgeo_3d` mantinha um `index.db` central que era catálogo E registro de produção. Aqui os dois se separam, e a divisão é a que decide quem responde o quê:

- **`public.tilesets`** é o catálogo: nome, `config` JSONB, `active`, e os dois eixos de acesso (`access_level`, `owner_org_id`). É o que o `/api/config` publica, o que a allowlist `available_3d_models` filtra por id e o que um briefing salvo referencia. Ver [[resources-catalogo]].
- **`a3d.models`** é o registro de produção: qual arquivo serve, com que token, quantos tiles, medido em quê. Ele NÃO repete `access_level` nem `owner_org_id`, e a ausência é a decisão: uma segunda cópia do eixo de acesso seria a lista fechada duplicada que a constituição proíbe, com a cópia desatualizada decidindo quem vê o quê.

Por que não colunas novas em `tilesets`: as quatro tabelas de catálogo são obrigadas a ter colunas idênticas (`catalog-tabelas-paridade.test.js`), porque `catalog.service.js` roda a mesma string de colunas contra as quatro. Uma coluna útil só a `tilesets` custaria três colunas mortas.

`a3d.imports` guarda o histórico e NÃO tem FK para `models`, de propósito: a importação abre o registro ANTES de converter, e é isso que permite registrar as importações que não terminaram, que é a pergunta que o histórico existe para responder.

## Onde os bytes saem, e por que sob a rota que já existia

Os modelos são servidos pelo prefixo reservado `m/` de `/api/v1/assets3d` (`parsePedidoDeModelo`, `backend/src/modules/models3d/models3d.service.js`), e não por rota própria. A razão é o gate: o regime de acesso é indexado POR CAMINHO a partir de `config.url` do catálogo (`assets3d-regime.js`), então uma linha publicada como `/api/v1/assets3d/m/<slug>/tileset.json` é gateada sem mudança nenhuma. Uma rota própria teria exigido uma segunda inversão do mesmo catálogo, que é o tipo de segunda resposta que apodrece calada. Ver [[assets3d-distribuicao]] e [[acesso-a-recurso-privado]].

O armazém plano (`assets(rel_path, data)`) continua existindo e é a camada seguinte na mesma rota: ele guarda o que ainda não foi convertido (a árvore PCL) e a cena caminhável, ver [[primeira-pessoa-3d]].

## As armadilhas que já custaram tempo

- **`asset.gltfUpAxis: "Z"` não se apaga sem rotacionar a geometria.** O DJI Terra declara Z-up e o conteúdo dele está em Z-up. O campo não existe no esquema de 1.1 e a conversão o remove; removido sozinho, o Cesium lê o conteúdo como Y-up e **o modelo aparece deitado**. Aconteceu com o Silo Oreste Ceretta, e quem viu foi o chefe, na tela, depois de a documentação afirmar que a remoção era segura.
- **O ponto de navegação não se preenche à mão.** O tileset do DJI Terra não publica `properties` nem `boundingVolume.region`, só `box`, e o `box` de um tile é LOCAL ao `transform` acumulado, nunca ECEF. Lido direto, ele põe o modelo perto de (0, 0), no golfo da Guiné. Quando o importador avisava "preencha à mão", o operador chutava: o Silo Oreste Ceretta entrou **3.657 m ao sul** do lugar dele.
- **Modelo que flutua é falta de terreno no CLIENTE, não defeito do modelo.** Um Cesium que não carrega o terreno cai em silêncio para o `EllipsoidTerrainProvider`: o chão vira liso na altura 0 e todo modelo passa a flutuar a própria altura elipsoidal. O catálogo publica `heightOffset: 0` sempre, e guarda a medida (`groundHeight`, `minHeight`) para quem precisar do contorno. O contorno é `-minHeight`, a BASE, e **nunca** `-groundHeight`, a mediana: com a mediana a parte baixa do modelo desce abaixo do chão liso, o globo a corta por dentro e as duas superfícies brigam pelo mesmo pixel. Medido no Silo: base 39,5 m, mediana 62,3 m, e com -62,3 a base caía a -22,8 m.
- **No Windows, um handle aberto bloqueia a publicação.** Reimportar com o serviço no ar falha com `EBUSY`, e o sintoma não diz a causa. Quem publica no mesmo processo tem de segurar a janela de quarentena do pool (`blobPool.withEvicted`); quem publica de outro processo precisa parar o serviço. É por isso que o LRU de modelos abertos existe além da memória: ele solta handles.
- **Coluna nova no registro exige tocar TODOS os chamadores do upsert.** Já aconteceu: os passos de conversão passavam, o arquivo ficava no disco com o tamanho certo, a saída dizia "publicado", e o modelo não existia para o serviço. Quatro modelos, 40 minutos de conversão. O conserto sem reconverter é `npm run models3d:adotar`, que lê o cabeçalho `meta` do próprio arquivo.

## Adotar é registrar, nunca adivinhar

`scripts/models3d-adotar.js` registra um `.3dtiles` que já está em disco, lendo o cabeçalho `meta`. Ele **recusa** em vez de completar: cabeçalho incompleto, id do cabeçalho diferente do nome do arquivo (arquivo renomeado à mão publicaria o conteúdo de um modelo sob o id de outro) e contagem de tiles divergente (conversão interrompida no meio carrega em tela com buracos, sem erro).

Duas propriedades da readoção, que é o caso comum de uma reimportação: o `config` do catálogo é MESCLADO, então o que um operador acrescentou pela tela sobrevive; e os dois eixos de acesso ficam de fora do UPDATE, então um modelo que alguém fechou não volta a público por causa de uma reimportação.

## Relacionados

- [[assets3d-distribuicao]] - a rota, o gate e os outros dois modos de armazenamento.
- [[resources-catalogo]] - a tabela de catálogo e o que ela promete ao cliente.
- [[primeira-pessoa-3d]] - a cena caminhável, que é linha de `tilesets` e não vem daqui.
- [[streetview-360]] - o módulo irmão, de quem este desenho herda o metadado em Postgres com binário em SQLite por unidade.
- [[sintese-cache-http-imutavel]] - o quadro dos regimes de cache do backend.
