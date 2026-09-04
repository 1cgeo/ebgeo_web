# Desempenho do terreno 3D com tiles vetoriais e hillshade: investigação de 2026-09-04

O chefe achava o MapLibre lento com o mapa base Topográfica, o terreno e o hillshade ligados, e esta é a investigação, na branch `main` do EBGeo Web (commit `75ffa4fa`). O mapa base são nove fontes vetoriais do Martin, com os PMTiles do Overture; o terreno é o `raster-dem` FathomDEM, e o hillshade sai da mesma fonte.

O client local rodou em `vite dev`, apontado ao servidor de produção do EBGeo pelo IP interno (chave `SERVIDOR_EBGEO_SSH_HOST` do `.env` do vault) pelo proxy do `vite.config.js`, com a configuração de produção copiada para a árvore de trabalho. Toda medida de tempo saiu de um Chromium com janela visível (Playwright 1.61.1, com os flags contra o estrangulamento de aba oculta), na GPU real desta estação, uma NVIDIA RTX A2000, numa viewport de 1600 por 900, na vista `[-50.87, -29.37]` em zoom 12,5, entre Gramado e Canela, com pitch 60 no terreno. Quatro auditores e três implementadores trabalharam em paralelo, cada um com log de evidência, e cada conclusão deles foi conferida no bundle e no código antes de entrar aqui.

## O que custava

Com terreno e hillshade, na ordem de camadas que a produção entrega, o quadro parado custava 26 a 27 ms. A rotação custava 38 a 41 ms por quadro, ou 25 fps. Em 2D os mesmos gestos custam 3 e 6 ms. Três mecanismos explicam a diferença, e os três foram medidos.

**Dezessete pilhas de render-to-texture sobre um pool de trinta texturas.** Com terreno, o MapLibre 5.18 drapeia sobre a malha as camadas `background`, `fill`, `line`, `raster`, `hillshade` e `color-relief`. As consecutivas formam uma pilha. Qualquer `symbol`, `circle`, `fill-extrusion` ou `heatmap` visível entre duas drapeáveis abre uma pilha nova. Cada pilha custa, por quadro, um passe de render-to-texture por tile de terreno visível, mais um desenho da malha. As texturas moram num pool de 30 objetos de 1024 por 1024 pixels, que é o `tileSize` do terreno vezes 2 vezes o `qualityFactor` 2. O cache só acerta com UMA pilha e no máximo 30 tiles. A razão está no código: `freeAllObjects` corre ao fim de cada pilha sem zerar os carimbos, e `getOrCreateFreeObject` recicla o objeto mais antigo antes de criar um novo, então a pilha seguinte sobrescreve as texturas da anterior no mesmo quadro. Medido: 17 pilhas vezes 20 tiles deram 340 texturas redesenhadas por quadro, com a câmera parada. Foram 358 `bindFramebuffer`, 341 `clear` e 2.513 draw calls por quadro. O estilo base forma uma pilha só do zoom 4 ao 13, e quatro a partir do 15. Quinze das dezessete pilhas vêm do aplicativo, que emite por tipo de feição um `fill` ou `line` seguido de `*-label-layer` (symbol) e `*-edit-handles-layer` (circle).

**Custo por fonte, vezes 103 fontes.** Durante o gesto, `style._updateSources` roda `coveringTiles` com elevação para cada fonte usada por camada visível. Com terreno, cada nó da árvore chama `getMinMaxElevation` e `getTerrainData`. E `renderToTexture.prepareForRender` computa `_getTerrainCoordsForRegularTile` por fonte com tile visível. Na rotação isso deu 14,4 a 14,7 ms por quadro no primeiro e 11,4 no segundo, com `getTerrainData` chamado 526 mil a 694 mil vezes em 3 s. O aplicativo registra 85 fontes GeoJSON de uma vez, uma por tipo de feição, mais feedback, alças de edição e rótulos. Numa sessão típica 67 delas estão vazias, mas as 82 camadas delas seguem visíveis. Camada visível marca a fonte como usada, e a fonte vazia entra nos dois laços com 20 tiles vazios cada.

**O que não era.** Os eventos das feições custam quase nada. Com 56 feições de dez tipos desenhadas, o código do aplicativo consumiu 9 a 10 ms num gesto de zoom inteiro de 3 s, ou 0,05 ms por quadro. Desses, 16 ms foram da reconstrução por quadro da linha de limite e 13 ms da linha de coordenação, com 184 `setData`. Na rotação, 3 a 5 ms por gesto, só a bússola. Não há `map.on('render')`, `on('move')` nem `on('pitch')` permanentes. O painel de coordenadas só consulta a elevação quando o mouse para, e a grade é vetorial, sem ouvinte. A seleção muda a contagem de pilhas, porque alças e caixas de seleção são camadas `circle` e `line` que passam a ter dado: 11 pilhas com tudo selecionado, contra 2 sem seleção. Na 5.18 o tempo de quadro não muda, porque o estouro do pool domina os dois casos. A tela de alta densidade (`deviceScaleFactor` 2, canvas de 3200 por 1800) não mudou nada na RTX A2000.

## O que se mediu por variante

Caso VAZIO, o aplicativo recém-aberto e sem feição. MapLibre 5.18, duas rodadas com recarga, `map._render` p50 em ms:

| variante | pilhas | parado | rotação | `_updateSources` por quadro | `prepareForRender` por quadro |
|---|---|---|---|---|---|
| 2D, produção | | 2,9 a 3,2 | 5,6 a 5,9 | 2,3 a 2,5 | |
| terreno, produção | 17 | 26,6 a 27,3 | 38,3 a 39,0 | 14,4 a 14,7 | 11,4 |
| terreno, quebra-pilha no topo | 1 | 9,2 a 9,4 | 30,1 a 30,8 | 11,4 a 12,1 | 12,2 a 12,5 |
| terreno, 67 fontes vazias removidas, produção | 2 | 6,2 a 6,5 | 7,6 a 7,8 | 1,3 | 1,1 a 1,3 |
| terreno, camadas de fontes vazias escondidas, produção | 2 | 5,7 a 6,0 | 7,7 | 1,3 | 1,2 a 1,3 |
| terreno, escondidas e quebra-pilha no topo | 1 | 4,2 a 4,5 | 5,3 a 5,6 | 1,3 a 1,4 | 1,2 a 1,7 |

Esconder as 82 camadas das 67 fontes vazias com `visibility: none` vale o mesmo que remover as fontes. Camada escondida não abre pilha nem marca a fonte como usada. A rotação com terreno e hillshade volta a 60 fps.

Caso POPULADO: Gramado com 56 feições de dez tipos, criadas pelas ferramentas do próprio aplicativo, página recarregada, nada selecionado. MapLibre 5.18 com as vazias escondidas, `map._render` p50 em ms, amplitude de três rodadas:

| variante | pilhas | tiles de terreno | parado | rotação | zoom |
|---|---|---|---|---|---|
| terreno, como o código entrega | 2 | 14 a 20 | 10,0 a 24,9 | 14,6 a 31,9 | 18,9 a 29,9 |
| terreno, camadas do app agrupadas | 2 | 16 | 20,4 | 27,9 | 28,6 |
| terreno, tudo quebra-pilha no topo | 1 | 19 | 11,8 | 16,8 | 22,5 |

Com nove tipos populados, duas pilhas vezes 14 a 20 tiles já passam do pool de 30. A variante de duas pilhas oscila entre 10 e 25 ms conforme o rumo muda o número de tiles. Na 5.18 só uma pilha escapa. Mesmo ela fica em 12 a 22 ms, porque sobram 5 a 6 ms de `_updateSources` das fontes agora populadas, mais o redesenho do terreno.

## MapLibre 6.7.0

A 6.0.0 (2026-05-03, PR #7549) eliminou o pool de trinta. O autor mediu a mesma taxa de acerto de 0,2% que a bancada daqui reproduziu, e levou o cache a 94,6% guardando os objetos de RTT no próprio tile. As 6.x seguintes atacaram o `prepareForRender` por fonte (#7863, -53%), a reutilização da textura de DEM (#7813), as alocações do DEM (#7814) e a amostragem de elevação (#8025). A 6.7.0 é a `latest` do npm, publicada em 2026-09-02. O `loadTile` do `raster-dem` dela já finaliza tile em `reloading`, o que fecha o defeito que prendia o hillshade depois de `setProjection`.

O aplicativo SOBE na 6.7.0 com um shim de módulo ES no lugar do script global, medido antes de qualquer migração de código. Os mesmos cenários do caso vazio dão:

| variante | pilhas | parado 5.18 | parado 6.7 | rotação 5.18 | rotação 6.7 |
|---|---|---|---|---|---|
| terreno, produção | 17 | 26,6 a 27,3 | 11,9 a 12,3 | 38,3 a 39,0 | 20,7 a 21,0 |
| terreno, quebra-pilha no topo | 1 | 9,2 a 9,4 | 6,3 a 6,5 | 30,1 a 30,8 | 19,6 a 20,2 |
| terreno, escondidas, produção | 2 | 5,7 a 6,0 | 2,8 a 3,7 | 7,7 | 4,4 a 4,6 |
| terreno, escondidas e topo | 1 | 4,2 a 4,5 | 3,2 a 3,3 | 5,3 a 5,6 | 4,3 a 6,9 |

Sozinha, a 6.7.0 corta o pior caso pela metade e não chega a 60 fps, porque o custo por fonte continua. Com as camadas vazias escondidas, ela dá folga de quatro vezes sobre o orçamento de 16,7 ms.

No caso POPULADO, com a migração feita (npm, módulo de ponto único) e o conserto aplicado, a 6.7.0 fecha o assunto na RTX. Duas pilhas e 20 tiles: parado 5,2 ms, rotação 7,1 ms, zoom 7,8 ms, com 127 a 489 draw calls por quadro, contra 1.100 na 5.18. A vazia escondidas mais tudo no topo dá 4,7, 6,0 e 6,7 ms. O cache de RTT passa a acertar com duas pilhas, e a ordem das camadas deixa de decidir o quadro.

A migração tem quebras reais, todas no CHANGELOG e no guia `docs/guides/v5-to-v6-migration-guide.md` do MapLibre. A distribuição é só ESM, sem UMD, e o app carregava o global em 30 arquivos. O WebGL2 é obrigatório. O `map.transform` foi removido, e o app o usava num ponto, o preload de tiles do briefing. A style-spec passou a 25. O default de `zoomLevelsToOverscale` virou 4, o que muda `queryRenderedFeatures` e o rótulo de centro de polígono, e se reverte com `zoomLevelsToOverscale: undefined`. As propriedades aninhadas do GeoJSON chegam como objeto, então `JSON.parse` sobre `properties` passa a lançar onde não há guarda de tipo. E `styleimagemissing` deu lugar a `setMissingStyleImageResolver()`. O custo de memória é a textura de RTT por tile em vez do pool: 151 MB para 302 MB na medida do PR.

## Máquina pior, por eixo

Medido no código com o conserto, 5.18, separando cada eixo. Intervalo entre quadros p50 em ms, e a fração de quadros acima de 33 ms:

| eixo | estado | parado | rotação | zoom |
|---|---|---|---|---|
| GPU Intel UHD 770, a integrada desta estação, por `--use-adapter-luid` | vazio | 27,8 (1 de 72) | 26,9, p95 69,7 (25 de 101) | 24,1, p95 65,8 (18 de 107) |
| GPU Intel UHD 770 | populado | 33,0 (27 de 62) | 25,5, p95 93,9 (33 de 85) | 32,2, p95 63,9 (38 de 92) |
| CPU 4 vezes mais lenta (`Emulation.setCPUThrottlingRate`), RTX | vazio | 34,8 (41 de 58) | 63,6 (47 de 48) | 42,3 (63 de 67) |
| CPU 4 vezes mais lenta, RTX | populado | 440,8 (5 de 6) | 534,4 (7 de 8) | 89,8 (31 de 32) |
| tela 2x (`deviceScaleFactor` 2), RTX | populado | 16,7 (0 de 122) | 16,7 (1 de 180) | 16,7 (0 de 181) |

Na GPU integrada, que é o notebook de repartição, o terreno fica preso na GPU mesmo com o conserto. O `map._render` custa 8 a 16 ms de CPU, mas o quadro só fecha em 27 a 33 ms, porque 2 pilhas vezes 20 tiles redesenham 40 texturas de 1024 pixels por quadro. Com a CPU quatro vezes mais lenta, o caso populado desaba para dois quadros por segundo, com 450 ms em `painter.render`: é o custo dos draw calls e do laço por fonte. Nas duas máquinas piores a alavanca é a mesma, uma pilha só com o cache acertando, que é o que a 6.7.0 dá, e menos fontes usadas.

Os mesmos eixos, na 6.7.0 com o conserto:

| eixo | estado | parado | rotação | zoom |
|---|---|---|---|---|
| GPU Intel UHD 770 | vazio | 16,7 (0 de 120) | 16,7, máximo 26 (0 de 181) | 16,7, máximo 31 (0 de 182) |
| GPU Intel UHD 770 | populado | 16,7 (0 de 119) | 16,7, máximo 19 (0 de 181) | 16,7, p95 36,4 (16 de 155) |
| CPU 4 vezes mais lenta, RTX | vazio | 16,7 (0 de 119) | 30,2, p95 48,5 (36 de 96) | 21,1, p95 41,3 (14 de 131) |
| CPU 4 vezes mais lenta, RTX | populado | 24,5 (4 de 82) | 48,0, p95 76 (52 de 60) | 50,3, p95 87,8 (59 de 61) |

Na GPU integrada a 6.7.0 fecha a conta: 60 fps parado e na rotação, populado ou vazio, e o zoom populado só perde quadros enquanto recarrega tiles. Na CPU quatro vezes mais lenta, ela leva o caso populado de dois quadros por segundo para 20 a 40 ms por quadro, dez vezes melhor e ainda aquém de 60 fps. O que sobra ali é o laço por fonte das fontes agora populadas (10,6 ms de `_updateSources` e 9,3 de `prepareForRender` na rotação), e é o argumento para agrupar as camadas do aplicativo e reduzir fontes num passo seguinte.

## Rede pior, separada da máquina

Um proxy de estrangulamento na frente do vite, só nas rotas `/ebgeo/martin/`, com latência e banda por parâmetro. Cada passo devolve a prova de trabalho, os tiles carregados por fonte, e sem ela a medida sai inválida. Código com o conserto, 5.18, RTX A2000, cache do navegador frio a cada perfil:

| perfil | terreno ligado até assentar | tiles e bytes ao ligar o terreno | pan de 2 km com tiles chegando | assentar depois do pan |
|---|---|---|---|---|
| referência (LAN, IP interno) | 1,5 s | 119 tiles, 6,1 MB | inválido: a janela perdeu o compositor nessa rodada, 4 quadros em 3 s | |
| EBNet razoável, 60 ms e 20 Mbps | 2,0 s | 123 tiles, 7,1 MB | intervalo p50 16,7 ms, p95 16,9, máximo 21 | 1 ms |
| ruim, 150 ms e 5 Mbps | 5,7 s | 119 tiles, 7,1 MB | intervalo p50 16,7 ms, p95 16,8, máximo 17 | 1 ms |
| muito ruim, 300 ms e 2 Mbps | 12,6 s | 119 tiles, 7,1 MB | intervalo p50 16,7 ms, p95 16,9, máximo 17 | 1,5 s |

A rede muda quanto tempo o tile demora a CHEGAR, não a taxa de quadros. Nos três perfis válidos, o pan e o zoom com tiles entrando ficaram em 60 fps. O que o usuário vê na rede ruim é a área em branco ou em resolução baixa por segundos, e não o engasgo. Ligar o terreno pede cerca de 120 tiles e 7 MB: 20 de DEM para o terreno, 18 do mesmo DEM para o hillshade, e as nove fontes vetoriais na inclinação nova. A partida do aplicativo na vista do Brasil pede 80 tiles e 8,6 MB. Os dois pedidos do mesmo DEM, um por fonte, custam banda além de CPU.

## O que entrou na `main`

- **`src/js/layers/empty-source-visibility.js`** (novo, 308 linhas), ligado em `layers/layer_setup.js`. Um ouvinte de `sourcedata` com `sourceDataType === 'content'` cobre os 311 call sites de `setData` em 55 arquivos com uma mudança só. A camada de fonte GeoJSON sem feição recebe `visibility: none`, e volta quando a fonte ganha dado. O registro guarda só o que o módulo escondeu. Por isso ele não briga com a aba de camadas do atlas, que esconde por `setFilter` (`visibility-filter.js:150`), nem com as três fontes que o app governa por `visibility` (`3d-models-source`, `streetview-markers-source`, `saved-photos-markers-source`), que ficam numa lista de exclusão. Duas armadilhas do bundle moldaram o desenho. O `content` dispara sem consultar `used`, então esconder a camada não mata o gatilho que a traz de volta. E `getLayoutProperty('visibility')` devolve `undefined` em camada que nunca declarou a propriedade, então escrever `'visible'` numa camada já visível passa pelo deep-equal e marca a fonte para recarga, o que o módulo evita normalizando. Provado no app vivo: 142 de 302 camadas escondidas na partida, seis fontes usadas de 103. A primeira feição num tipo vazio aparece em 24 ms, e a última apagada volta a `none` em 11 ms. As 142 sobrevivem ao `setStyle` com `transformStyle`. Teste em `tests/unit/empty-source-visibility.test.js`, 21 casos, e oito mutantes aplicados um a um reprovaram todos. O `eslint` está limpo.
- **`bench/desempenho-terreno.mjs`, `bench/autoteste.mjs` e `bench/README.md`**, a bancada durável. Sete variantes, cinco cenários, saída em JSON, markdown e captura. Ela reprova a si mesma: GPU emulada invalida o relógio, aba oculta invalida a rodada, cadência ociosa de rAF acima de 25 ms invalida, variante que não mudou o que dizia mudar sai inválida, e app cuja assinatura mudou entre cargas invalida a comparação. `node bench/autoteste.mjs` passa 65 de 65. O Playwright vem de `EBGEO_PLAYWRIGHT_DIR`. Rodada no código consertado: terreno parado 6,1 ms, rotação 8,3, pan 7,8, zoom 7,1, pitch 6,0, duas pilhas, 38 stamps por quadro.
- **`vite.config.js` local.** O cabeçalho `accept-encoding: identity` do proxy passou de `proxyReq.setHeader` para a opção `headers`. Com socket keep-alive reaproveitado, o `setHeader` derrubou o vite inteiro com `ERR_HTTP_HEADERS_SENT`. Faz parte da configuração local de produção, que não vai para o git.
- **Migração para a 6.7.0**, no commit seguinte ao deste documento. `npm install maplibre-gl@6.7.0 --save-exact`; `src/js/map/maplibre.js` como ponto único, com `import * as maplibregl`, o CSS importado, o worker por `?worker&url` mais `setWorkerUrl`, e `window.maplibregl` publicado para os 30 arquivos que usam o global; `index.html` sem o script e o CSS de `public/vendors`; `zoomLevelsToOverscale: undefined` nos sete construtores de `Map`; `map._camera` no lugar de `map.transform` em `utilities/maplibre-preload.js`. Vitest: 2.857 verdes e 6 falhas que existem sem a migração, todas sobre valores da configuração local. Build em 40 s, bundle de 15,0 para 17,8 MB, sem ajuste no `manualChunks`. Prova no navegador em 28 passos, sem erro de página nem de console, no dev e no build servido por `vite preview`.

## O que fica para decidir

1. **Subir para a 6.7.0**, decidido pelo chefe em 2026-09-04 e feito na `main`. É o único jeito de o cache de RTT acertar com mais de uma pilha, e é o que resolve a GPU integrada.
2. **Agrupar as camadas do aplicativo**: todos os `fill` e `line` das ferramentas em bloco, e só depois os `*-label-layer` e `*-edit-handles-layer`. Leva de 20 para 5 pilhas no zoom 15 pela conta estática. O custo é de ordenação visual: um rótulo que hoje um preenchimento desenhado depois cobre passa a ficar por cima. Na 5.18 o ganho só aparece com uma pilha. Na 6.7.0 vale por reduzir draw calls.
3. **Descer o hillshade.** Hoje ele entra com `beforeId: 'analysis-separator'`, acima dos 36 rótulos do estilo base, e sombreia por cima dos topônimos, com `hillshade-exaggeration` 0,5 e sombra `rgba(0,0,0,0.5)`. Posto logo após as mantas de cobertura, funde na pilha do base e para de lavar o rótulo. Decisão cartográfica.
4. **Duas fontes de DEM com a mesma URL.** `terrainSource` e `hillshadeSource` pedem os mesmos tiles duas vezes, e o MapLibre avisa contra isso no `setTerrain`. O `minzoom: 8` do hillshade no config é declaração morta, porque `raster-dem` só herda `url`, `scheme` e `tileSize`. Separar com `maxzoom` diferente só compensa a partir da 6.x, onde #7863 pula a fonte usada só pelo terreno.
5. **`sourceTileLodParams` fica `null`.** O padrão `(9.314, 3)` já é o mais leve. Nunca se aplica à fonte de DEM: a issue #7699, aberta, mostra que o mesmo `calculateTileZoom` escolhe os tiles internos de RTT do terreno.
6. **Dois defeitos para o upstream.** O `_demMatrixCache` do 5.18 nunca acerta, porque a guarda lê a chave composta `dem + tile + e.key` e a escrita grava só `e.key`, alocando uma matriz por chamada em milhares de chamadas por quadro. E `terrain.tileManager.update` roda todo quadro, fora do gate de `_sourcesDirty`.
7. **Um erro de página alheio a isto**, que aparece em toda rodada: `TypeError: element?.removeEventListener is not a function` em `utilities/event-cleanup.js:160`, vindo de `ToolbarGroup.destroy`.

## Mapa base vetorial contra raster (2026-09-04, à tarde)

Pergunta do chefe: com terreno e hillshade ligados, o mapa base vetorial custa mais do que a mesma carta já renderizada? Três bases entraram na bancada, pela opção `--bases`: a Topográfica (carta sobre os PMTiles do Overture, 159 camadas em 9 fontes, 38 delas `symbol`), a DSG vetorial (EDGV do Postgres, 103 camadas em 5 fontes, 38 `symbol`) e a DSG raster (o mbtiles `carta_topografica_sul_webp`, uma camada `raster` mais o fundo). Vista `serra-gaucha` (Gramado, zoom 12,5), viewport 1600x900, RTX A2000, MapLibre 6.7.0 com a camada de fonte vazia escondida. Três rodadas, a primeira descartada; célula com `mediana (min..max)` quando as rodadas divergem. Cada caso parte de uma recarga, troca a base pelo caminho do painel (`BaseLayerControl.applySharedBasemap`, sem persistir) e só mede depois de provar, no mapa, o nome do estilo, as fontes e camadas da base, nenhuma fonte de outra base sobrando e tile da base carregado. Tabelas completas em `bench/saida/bases-*/resultado.md` de quem rodar.

### Estado vazio (nenhuma feição do app)

| base | variante | cenário | render p50 ms | draw/quadro | pilhas RTT |
|---|---|---|---|---|---|
| Topográfica | 2d | parado | 1,9 (1,9..2,0) | 190 | - |
| DSG vetorial | 2d | parado | 2,1 (1,8..2,4) | 127 | - |
| DSG raster | 2d | parado | 1,1 (1,0..1,1) | 29 | - |
| Topográfica | terreno | parado | 2,9 (2,8..3,0) | 127 | 2 |
| Topográfica | terreno | rotação | 4,9 (4,3..5,4) | 142 | 2 |
| Topográfica | terreno | pan | 4,4 (4,3..4,4) | 133 | 2 |
| Topográfica | terreno | zoom | 4,6 (4,5..4,6) | 132 | 2 |
| DSG vetorial | terreno | parado | 3,2 (3,1..3,2) | 231 | 11 |
| DSG vetorial | terreno | rotação | 4,3 (4,2..4,3) | 244 | 11 |
| DSG vetorial | terreno | pan | 4,3 | 244 | 11 |
| DSG vetorial | terreno | zoom | 4,8 (4,7..4,9) | 225 | 11 |
| DSG raster | terreno | parado | 1,9 (1,8..1,9) | 21 | 1 |
| DSG raster | terreno | rotação | 3,0 (2,7..3,2) | 38 | 1 |
| DSG raster | terreno | pan | 4,1 (3,4..4,7) | 31 | 1 |
| DSG raster | terreno | zoom | 3,9 (2,8..4,9) | 35 | 1 |

### Estado populado (56 feições de nove tipos criadas pelas ferramentas, sem seleção)

`--populado` cria 59 feições pelo `createFeature` dos controles de desenho; o store persistiu 56 (os três pincéis não persistem), e é contra as 56 que cada recarga se prova.

| base | cenário | render p50 ms | draw/quadro | pilhas RTT |
|---|---|---|---|---|
| Topográfica | parado | 4,6 (4,4..4,7) | 127 | 2 |
| Topográfica | rotação | 7,4 (7,1..7,7) | 153 | 2 |
| Topográfica | pan | 10,0 (7,0..13,0) | 133 | 2 |
| Topográfica | zoom | 12,1 (8,1..16,0) | 517 (490..543) | 2 |
| Topográfica | pitch | 5,7 (4,1..7,3) | 97 | 2 |
| DSG vetorial | parado | 4,3 (4,2..4,3) | 231 | 11 |
| DSG vetorial | rotação | 6,5 (6,5..6,6) | 254 | 11 |
| DSG vetorial | pan | 6,5 (6,4..6,6) | 245 | 11 |
| DSG vetorial | zoom | 8,1 (8,0..8,1) | 658 (650..665) | 11 |
| DSG vetorial | pitch | 3,9 (3,8..4,0) | 168 | 11 |
| DSG raster | parado | 2,9 (2,8..3,0) | 21 | 1 |
| DSG raster | rotação | 4,6 (4,5..4,7) | 46 | 1 |
| DSG raster | pan | 5,1 (5,0..5,2) | 32 | 1 |
| DSG raster | zoom | 5,8 (5,1..6,6) | 241 (231..250) | 1 |
| DSG raster | pitch | 3,5 (2,9..4,1) | 28 | 1 |

### CPU quatro vezes mais lenta (`--cpu 4`, populado, duas rodadas, a primeira descartada)

| base | cenário | render p50 ms | draw/quadro | pilhas RTT |
|---|---|---|---|---|
| Topográfica | parado | 33,7 | 127 | 2 |
| Topográfica | rotação | 54,6 | 241 | 2 |
| Topográfica | pan | 59,4 | 142 | 2 |
| Topográfica | zoom | 72,9 | 543 | 2 |
| Topográfica | pitch | 25,9 | 104 | 2 |
| DSG raster | parado | 19,0 | 21 | 1 |
| DSG raster | rotação | 38,6 | 75 | 1 |
| DSG raster | pan | 35,1 | 42 | 1 |
| DSG raster | zoom | 53,1 | 247 | 1 |
| DSG raster | pitch | 21,0 | 30 | 1 |

Com a CPU estrangulada a Topográfica populada não segura nem o ocioso a 60 fps (cadência do rAF com p95 de 33 a 67 ms), e o raster segura (p95 17 ms). A bancada registra isso como aviso do caso, não como rodada inválida, porque o ocioso lento é a condição medida.

### A DSG vetorial e as 11 pilhas

O estilo da DSG intercala `symbol` e `circle` entre fills e lines, e cada intercalação abre uma pilha de render-to-texture. A variante `terreno-quebra-pilha-topo` (move as 95 camadas desses tipos para o topo, na ordem relativa) mostra o que a reordenação do estilo compraria, no estado vazio, com uma rodada válida:

| variante | parado | rotação | pan | zoom | pitch | draw/quadro | pilhas |
|---|---|---|---|---|---|---|---|
| terreno | 4,3 | 6,4 | 4,9 | 4,9 | 3,5 | 162 a 244 | 11 |
| terreno-quebra-pilha-topo | 2,1 | 5,1 | 6,1 | 5,1 | 3,3 | 41 a 71 | 1 |

O ganho é grande parado (metade do quadro, um sexto dos draw calls) e pequeno ou nulo nos gestos, e a reordenação muda a sobreposição visual dos rótulos, então é decisão de cartografia, não só de desempenho.

### O que o olho vê

No raster os topônimos vêm gravados na imagem: drapejam sobre o relevo, deformam com a inclinação e não giram com o mapa. Nas duas bases vetoriais os rótulos ficam de pé e legíveis em qualquer bearing. Capturas em `captura-<base>-terreno.png` de cada rodada.

### O que o raster compra e o que cobra

Compra: metade a um terço do quadro da Topográfica com terreno, um sexto dos draw calls, uma pilha de render-to-texture só, e na máquina quatro vezes mais lenta 19 ms contra 34 ms parado. Nesta GPU as três bases já ficam abaixo dos 16,7 ms, então a diferença aparece como folga, e é na máquina fraca que ela vira taxa de quadros. Cobra: rótulos gravados na imagem (sem rotação, sem colisão, deformados no 3D), cobertura só do recorte sul do mbtiles (fora dele o mapa fica branco, do zoom 4 ao 18), nenhuma consulta por feição no mapa base, e nenhuma mudança de estilo sem regerar o mbtiles. O tamanho do tile é da mesma ordem (webp de 22 a 26 KB no zoom 12 e 13, contra 17 KB do EDGV e 57 KB do `overture_base` no zoom 12). Qual base abre por padrão com o terreno ligado é decisão do chefe.

### Defeito encontrado no caminho: o app não sabia com que base tinha nascido

O `map_sig.js` criava o mapa com um arquivo de estilo importado direto, e o `BaseLayerControl` assumia a base do seu `DEFAULT_LAYER` (e a crença persistida no store). Quando os dois divergem, a primeira troca separa base de conteúdo do app pelos ids da carta errada e preserva a base velha INTEIRA por cima da nova: medido no apontamento local, 9 fontes e 159 camadas da Topográfica por cima do raster, com o seletor dizendo outra coisa. Conserto na `main`: `initialBaseStyle()` é a fonte única do estilo com que o mapa nasce (`map_sig.js` a usa), e `switchLayer` decide pelo que está no mapa (`baseStyleAlreadyOnMap`: mesmo nome de estilo e todas as camadas da base presentes), nunca pela crença; isso também dispensa a espera de 10 s pelo `styledata` que nunca vem quando dois ids partilham um estilo. Quatro testes cobrem o pior caso em `tests/unit/style-transform.test.js`.

### Como conferir a comparação

```sh
node bench/desempenho-terreno.mjs --bases osm-overture,carta-topografica,carta-topografica-raster --variantes 2d,terreno --rodadas 3
node bench/desempenho-terreno.mjs --bases osm-overture,carta-topografica,carta-topografica-raster --variantes terreno --rodadas 3 --populado
node bench/desempenho-terreno.mjs --bases osm-overture,carta-topografica-raster --variantes terreno --rodadas 2 --cpu 4 --populado
node bench/desempenho-terreno.mjs --bases carta-topografica --variantes terreno,terreno-quebra-pilha-topo --rodadas 2
```

As três bases têm de estar habilitadas no `config.basemaps` do app que está no ar e registradas no `STYLE_MAP` do controle.

## Como conferir

```
node bench/autoteste.mjs
EBGEO_PLAYWRIGHT_DIR=<dir com node_modules/playwright> node bench/desempenho-terreno.mjs --url http://localhost:3007/ebgeo/ --rodadas 2
npx vitest run tests/unit/empty-source-visibility.test.js
```

A bancada mede em regime, com o mapa assentado. Ela não mede rede nem partida. Em headless o relógio não vale, porque cai no SwiftShader; só as contagens valem.
