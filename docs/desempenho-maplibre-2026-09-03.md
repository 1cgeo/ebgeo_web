# Desempenho do mapa 2D (MapLibre): auditoria e consertos de 2026-09-03

Auditoria de desempenho do EBGeo Web na branch `main` (commit `bc812832`), voltada ao uso comum do MapLibre: mapa base raster, tiles vetoriais das molduras e dos dados, terreno 3D com hillshade, e as ferramentas enquanto o operador navega, desenha e edita. Seis auditores de código varreram o `src/js` por recorte (núcleo do mapa e terreno, passes de zoom, mousemove, análise de terreno, store e eventos, fontes de tiles), cada um com log de evidência, e uma bancada em Playwright mediu o antes e o depois com contadores de chamadas, mensagens ao worker e perfil de CPU. Os consertos estão na árvore de trabalho, sem commit, para revisão.

## O que custava, em ordem de peso

**A correção de zoom passava pelo worker a cada quadro.** Quinze controles registram `map.on('zoom')` para manter o tamanho visual das feições. Cada handler fazia `await source.getData()`, que no MapLibre 5.18 é uma ida ao worker com clone estruturado da coleção inteira, e isso a cada quadro do gesto, mesmo com o mapa vazio. A bancada contou 87 `getData` num gesto de zoom de 1,5 s sem nenhuma feição, 278 com 170 feições, e 272 num simples `panBy`, porque a projeção globo dispara `zoom` ao deslocar. O pincel ainda fazia `setData` da coleção inteira por quadro, inclusive vazia, e a flag de coalescência dele travava para sempre depois de uma troca de mapa base.

**Cada consulta de elevação percorria os tiles da vista duas vezes.** `getTerrainElevation` chamava `queryTerrainElevation` duas vezes por amostra, uma delas num ponto fixo em `[0,0]` para subtrair um deslocamento que não existe no 5.18 (o valor devolvido é `DEM * exagero`, sem termo de câmera). E cada chamada de `queryTerrainElevation` roda uma travessia completa de `coveringTiles` (frustum, plano de corte, sete cópias do mundo) só para descobrir o zoom do tile, antes de ler um pixel. Um viewshed padrão pede 10.187 amostras, isto é 20.374 travessias; um LOS, 258; uma linha desenhada ou importada, 52, com o perfil calculado e descartado porque o interruptor `profile` nasce desligado.

**A troca de mapa base derrubava e reconstruía a aplicação inteira.** `map.setStyle(novo)` diferencia o estilo atual contra o novo, e o atual carrega tudo que a aplicação adicionou: 85 fontes e 128 camadas em produção. O diff emitia um `removeSource` e um `removeLayer` para cada, e `setupMapFeatures` recriava tudo: cada GeoJSON re-tilado no worker, cada camada `symbol` re-posicionada, 16 TileJSON da grade e das molduras pedidos de novo. A bancada contou 1.088 mensagens `loadTile` numa troca com 170 feições.

**O painel de feições se reconstruía a cada tile carregado.** O `sourcedata` do MapLibre dispara por tile de cada fonte GeoJSON; o filtro do painel olhava só o `sourceId`, então bastava arrastar o mapa com a aba aberta para, 150 ms depois de cada parada, o painel refazer 19 leituras de worker e todo o DOM da lista.

**O parâmetro de nível de detalhe nunca valeu, e o de produção desligava o LOD.** `setSourceTileLodParams` escreve em cada fonte que existe naquele instante, e a única chamada ficava antes do primeiro `setStyle`, que troca todas as fontes: terreno, hillshade, grade e molduras jamais o recebiam, e depois da primeira troca de base o estilo inteiro voltava ao padrão do MapLibre. O par de produção, `[1, 10.0]`, tem coeficiente angular zero, ou seja um único zoom para a tela inteira com a câmera inclinada: pelo modelo, cerca de 12 vezes os tiles do padrão a 60 graus, o pitch que o botão de terreno impõe.

**Um defeito do MapLibre 5.18 que o aplicativo disparava, e que trava a captura de tela.** `setProjection` com a camada de hillshade visível marca a fonte `raster-dem` para recarga, e o `loadTile` desse tipo de fonte só finaliza tile sem actor ou expirado: um tile carregado que entra em `reloading` fica nesse estado para sempre, `map.loaded()` fica falso e `idle` nunca mais dispara. O botão de terreno troca globo por mercator exatamente com o hillshade visível, e a captura de tela espera o `idle`. Isolado por sonda passo a passo (visibilidade, terreno, inclinação e zoom não prendem; a troca de projeção prende; esconder e reexibir a camada em quadros distintos solta), e a mesma sonda mostrou que esconder e reexibir no MESMO quadro não basta, porque a marca de recarga é processada antes de os tiles serem soltos.

Custos menores, todos com mecanismo confirmado no código: o indicador de snapping fazia `setData` de coleção vazia por mousemove com o snap desligado; os rótulos de medição registravam cinco ouvintes de mapa por feição e os do mapa anterior nunca eram soltos; o fundo dos textos era recalculado por uma ida ao worker a cada escrita em `texts`, e o patch deixava de valer após a primeira troca de estilo; `applyLayerOpacities` lia até 258 propriedades de pintura por passagem, cerca de 170 delas terminando em exceção; as fontes de análise e de dados não recebiam os `bounds` validados no config, e pediam tile fora da cobertura; a compactação da fila de sync, ao passar de 10.000 operações de entidades distintas, reentrava em toda edição seguinte e lia as 10.001 operações do IndexedDB uma a uma; o hover das ferramentas consultava `queryRenderedFeatures` sem `layers` por mousemove com uma feição selecionada; o slider de opacidade emitia `LAYERS_CHANGED` e gravava na fila por quadro; o registro de uso de cor agendava um timer e uma escrita por cor por feição.

## O que foi consertado

| código | conserto | arquivos |
|---|---|---|
| zoom | leitura síncrona da coleção pela API pública `serialize()`, saída antecipada com fonte vazia, pincel com `hasChanges` e flag que não trava | `utilities/geojson-source.js` (novo), 10 controles e `tool_manager/helpers/label-tab.helpers.js` |
| zoom na GPU (2026-09-04) | o tamanho visual constante (`base * 2^(zoom - âncora)`) vira expressão composta `['interpolate', ['exponential', 2], ['zoom'], ...]` com 25 stops inteiros, clamp dentro de cada stop e `case` para a correção desligada e a âncora ausente; onze propriedades de estilo deixam de ler `calculated*`; os passes em JavaScript passam a rodar no `zoomend`, uma vez por gesto, só para manter `calculated*` para exportação e cabeçalho, e por quadro só para as feições com a correção desligada (caixa de seleção em unidades geográficas) | `layers/styles/zoom-expression.js` (novo), `layers/styles/{point,content,symbol,polygon,shape,line}.layers.js`, 10 controles, `label-tab.helpers.js` |
| terreno | uma consulta por amostra; amostrador em lote que resolve o zoom uma vez e lê o DEM direto (`createTerrainSampler`), usado no LOS, no viewshed, no perfil de linha e na importação; viewshed cede a thread a cada cinco raios também ao colar; esperas artificiais de 50 ms viram um quadro; perfil só quando o interruptor está ligado | `terrain/terrain-elevation.js` (novo), `terrain/terrain.control.js`, `analysis_tools/*`, `draw_tools/line_tool/*`, `import_export/import.control.js` |
| troca de base | `setStyle` com `transformStyle` preservando fontes e camadas da aplicação por referência, com o terreno e a projeção; a base anterior sai, a nova entra por baixo. E `setupMapFeatures` em modo preservado quando o mapa do atlas é o mesmo: separadores, terreno, catálogo e grade são re-checados, e as coleções, filtros e opacidades ficam como estão | `baselayers/style-transform.js` (novo), `layers/setup-mode.js` (novo), `baselayers/base-layer.control.js`, `layers/layer_setup.js` |
| painel | `sourcedata` só reage a `sourceDataType === 'content'`, que é o `setData` | `features_tab/features_tab.js` |
| LOD | par validado (`null` mantém o padrão do MapLibre; primeiro valor abaixo de 2 é recusado com aviso) e reaplicado após cada `setStyle` | `map/tile-lod.js` (novo), `map_sig.js`, `baselayers/base-layer.control.js`, `config.js` |
| projeção | `setProjectionKeepingHillshade`: esconde o hillshade, espera um quadro, troca a projeção, espera outro e reexibe; `_toggleTerrain` passa a aguardar a troca antes de ligar o terreno | `terrain/terrain.control.js` |
| snapping | `hideIndicator` idempotente | `snapping/snapping.service.js` |
| medição | `clearAllMeasurementMarkers` solta os marcadores e seus ouvintes na troca de mapa | `draw_tools/line_tool/line_measurement.js`, `layers/layer_setup.js` |
| textos | fundo derivado da coleção recém-escrita, sem worker, com a marca na fonte | `layers/styles/content.layers.js` |
| opacidade | propriedades de pintura por tipo de camada, sem exceção por tentativa | `layers/layer-opacity-applier.js` |
| bounds | `bounds` do config chegam à fonte de análise e de dados; hint no config do terreno | `terrain/analysis-layers.manager.js`, `terrain/data-layers.manager.js`, `config.js` |
| fila | compactação rearma só após crescer 1.000 acima do tamanho pós-compactação | `store/sync/operation-queue.js` |
| hover | `queryRenderedFeatures` com a lista de camadas da ferramenta, por um helper que filtra ids inexistentes; medições coalescidas por rAF | `tool_manager/helpers/hover-query.helpers.js` (novo), controles, `measurement_tool/*` |
| store | catálogo lido uma vez por refresh; aba de mapas só recarrega visível; uso de cor coalescido; slider de opacidade grava no fim do gesto | `features_tab/*`, `sidebar/tabs/maps.tab.js`, `store/*` |

Cada conserto tem teste em `tests/unit` ou `tests/integration` quando a lógica é pura; a suíte passou de 2.605 para 2.736 testes verdes em 129 arquivos, com `npm run lint` limpo. A leitura síncrona foi provada no navegador: um ponto ancorado em `size` 10 no zoom 11,07 chegou a 28,28 no zoom 12,57 (o valor de `10 * 2^1,5`), no objeto da thread principal e no worker, com três `setData` no gesto e nenhum `getData`.

## O que fica para decidir

- **Correção de zoom na GPU: feita em 2026-09-04** (linha própria na tabela). `boundary` e `coordination_line` reconstroem geometria e seguem por quadro em JavaScript, e a `selection-highlight` também. O que muda de comportamento: um rótulo legado sem `labelCreatedAtZoom` só ganha âncora no fim do primeiro gesto (antes ganhava no primeiro quadro); durante esse gesto ele fica no tamanho nominal.
- **Hillshade e terreno em fontes separadas.** As duas fontes apontam para os mesmos tiles, mas o terreno pede tiles um zoom abaixo do hillshade, então unificar a fonte não reduz requisições; reduz uma TileJSON e um gerenciador. Fica como está.
- **Tiles raster de 256 px.** O servidor entrega 256; declarar 512 pediria tiles um zoom abaixo e esticaria a imagem. Reduzir de ~44 para ~15 tiles por vista pede retilar no servidor, e é decisão de acervo.
- **Config de produção.** O `sourceTileLodParams: [1, 10.0]` passa a ser recusado com aviso no console e o padrão do MapLibre vale, que é o que já valia na prática. Em 2026-09-04 a cópia local do config de produção passou a declarar terreno e hillshade por TileJSON (`url:` do Martin, com `maxzoom` mantido) em vez de `tiles:`, e os `bounds` chegam do próprio servidor; o backup ficou ao lado do arquivo.
- **Fila de sync offline.** Continua gravando `data` e `previousData` por edição, com as fotos em base64 dentro de `properties.images`. Podar as imagens da fila ou não ligar o log de operações enquanto o gateway for no-op é decisão de produto.

## Medidas

Bancada: Chromium headless com SwiftShader sobre `vite dev`, Martin local servindo o terreno FABDEM do Rio Grande do Sul, fixture `01-completo.ebgeo` com as 170 feições do mapa "09 Lote" transladadas para dentro da cobertura do terreno. Duas rodadas antes (`bc812832`) e duas depois (a árvore de trabalho). Os contadores repetem entre rodadas; o tempo de script varia até 2x nos cenários que renderizam terreno, porque com SwiftShader a GPU emulada aparece como tempo de script (`checkFramebufferStatus`, `texImage2D`). Onde duas rodadas discordam, a tabela traz a faixa. `loadTile` e `reloadTile` são mensagens ao worker do MapLibre; "assentou" diz se o mapa chegou ao `idle` ou só a um estado estável de tiles.

### Contadores por cenário, antes (duas rodadas) e depois (duas rodadas)

| cenario | getData antes | depois | setData antes | depois | loadTile antes | depois | reloadTile antes | depois | script ms antes | depois | assentou antes | depois |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| zoom 1,5 s, mapa vazio | 87 a 109 | 0 | 5 a 7 | 0 | 768 | 576 a 768 | 43 a 64 | 0 | 627 a 669 | 373 a 582 | idle | idle a ja-ocioso |
| zoom 1,5 s, 170 feicoes | 278 a 288 | 0 | 17 a 18 | 0 | 832 a 896 | 512 | 108 a 111 | 0 | 782 a 1194 | 652 a 744 | idle | idle |
| pan 1,5 s, 170 feicoes, globo | 272 a 277 | 0 | 17 | 0 | 2 a 4 | 0 a 41 | 130 | 0 | 334 a 351 | 326 a 329 | estavel a ja-ocioso | idle a ja-ocioso |
| ligar terreno (pitch 60) | 0 | 0 | 0 | 0 | 448 a 640 | 704 a 832 | 384 | 384 | 1314 a 2890 | 1621 a 7554 | estavel | estavel a idle |
| zoom com terreno | 117 a 129 | 0 | 7 a 8 | 0 | 1667 a 1856 | 1600 | 96 a 116 | 0 | 821 a 857 | 985 a 1005 | estavel | estavel a idle |
| pan com terreno | 0 | 0 | 0 | 0 | 384 | 384 | 0 | 0 | 4833 a 5462 | 5467 a 5935 | estavel | estavel a idle |
| rotacao com terreno | 0 | 0 | 0 | 0 | 263 | 256 a 320 | 0 | 0 | 3388 a 5248 | 2250 a 5239 | estavel | estavel a idle |
| trocar mapa base | 0 | 0 | 7 | 30 | 1088 | 0 | 119 | 969 | 583 a 617 | 2800 a 3317 | idle | estavel a idle |
| trocar mapa base (volta) | 0 | 0 | 7 | 30 | 1088 | 0 | 85 a 119 | 969 | 590 a 703 | 607 a 710 | idle | estavel a idle |
| inserir 170 feicoes pelo store | 18 | 0 | 61 | 60 | 384 | 384 | 564 a 627 | 574 a 763 | 232 a 260 | 286 a 303 | idle | idle a ja-ocioso |

### Troca de mapa base: operações de estilo

| medida | antes | depois |
|---|---|---|
| removeLayer | 0 | 0 |
| addLayer | 86 | 0 |
| RMT | 3306 | 1015 a 1044 |
| LT | 1088 | 0 |
| removeSource | 0 | 0 |
| addSource | 69 | 0 |
| tempo do executeLayerChange (ms) | 66 a 72 | 220 a 269 |
| modo preservado (terceira rodada): mensagens ao worker | 4.600 | 1 |
| modo preservado (terceira rodada): tempo até assentar (ms) | 3.762 a 4.288 | 1.218 a 1.651 |

### LOD: tiles retidos a zoom 11 e pitch 60 (segunda rodada de cada par)

| par | tiles raster | tiles de terreno | tiles por fonte GeoJSON | script ms |
|---|---|---|---|---|
| (9.314, 3) | 47 | 24 | 17 | 147 a 177 |
| (5, 6) | 128 a 129 | 38 | 27 | 257 a 350 |
| (1, 10) | 382 a 392 | 49 | 35 | 1211 a 15342 |

**Correção de zoom na GPU, provada no navegador (2026-09-04).** Um ponto ancorado em `size` 10 no zoom 11,07, levado a 12,57 por `easeTo`: `queryRenderedFeatures` devolve `circle-radius` avaliado em 28,284271247461902, que é `10 * 2^1,5` dígito a dígito; durante os 8 quadros do gesto houve zero `setData` na fonte `points`, e um só no `zoomend`, que deixou `calculatedSize` em 28,28 na thread principal e no worker para os consumidores. Numa rodada só desses cenários com 170 feições, zoom, zoom de volta e pan fecharam com zero `setData`, zero `getData` e zero `reloadTile`.

**Dois defeitos vindos da `integracao_backend` (2026-09-04).** Aplicados na `main` a pedido da sessão que portou o lote para lá: dois cliques a menos de 250 ms perdiam o primeiro vértice na Linha de Limite e na Linha de Coordenação (`_commitPendingClick` nos dois controles), e a conversão Ponto para Medida de Coordenação saía quatro vezes maior por deixar o `pixelRatio` do gerador de fora (`feature-header.helpers.js`, com guarda em `tests/unit/conversao-ponto-medida-razao-de-pixel.test.js`).

**Como ler.** O gesto de zoom e o pan deixaram de ir ao worker: zero `getData`, zero `setData` inútil e zero `reloadTile`, com o tempo de script igual ou menor. O terreno e a troca de base passaram a assentar em `idle` nas quatro situações da segunda rodada (ligar, trocar, trocar de volta, desligar), o que antes só acontecia sem terreno; o custo é reler os tiles do hillshade uma vez a cada troca de projeção. A troca de mapa base é a medida com a troca mais visível. Só com o `transformStyle` (rodadas depois-A e depois-B da tabela) somem os 86 `addLayer`, 69 `addSource` e 1.088 `loadTile`, e as feições desenhadas não desaparecem durante a troca; em compensação `setupMapFeatures` ainda fazia 30 `setData`, 43 `setFilter` e 44 `setPaintProperty` sobre fontes vivas, o que recarregava os tiles delas (969 `reloadTile`), e o `executeLayerChange` síncrono subia de 66 a 72 ms para 220 a 269 ms. Com o modo preservado, medido numa terceira rodada só desse cenário: **uma única mensagem ao worker** (`updateLayers`) contra 4.600 antes, `executeLayerChange` em 179 ms (o que sobra é o diff do MapLibre comparando as 128 camadas e 85 fontes preservadas) e o mapa assentado em 1,2 a 1,7 s contra 3,8 a 4,3 s antes. O LOD confirma a ordem do modelo do auditor: o par de produção retém oito vezes os tiles raster do padrão e o dobro dos de terreno.

## Como conferir

```
npm run lint
npm test
```

A bancada que produziu as medidas vive fora do repositório (Playwright sobre `vite --port 3005`, Martin local com o terreno FABDEM, contadores em `GeoJSONSource.setData/getData`, `Map.queryTerrainElevation/queryRenderedFeatures`, mensagens ao worker e perfil de CPU por cenário). O navegador era headless com SwiftShader, então tempo de quadro não vale como medida; contagens e tempo de script valem.
