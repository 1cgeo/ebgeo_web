# Desempenho do mapa 2D

Por que o mapa custava o que custava, o que foi medido antes de mexer, e os quatro mecanismos que continuam valendo depois do porte de 2026-09-04 (nove commits da `main`, portados por lotes na `integracao_backend`). O peso do pacote é outra página: [[peso-do-pacote-web]]. Aqui fica só o que a leitura do código não conta: o custo escondido, a armadilha e a régua que o prende.

## O custo estava no aplicativo, não no MapLibre

Medido na `main` em 2026-09-03 com bancada em Playwright e contadores nas funções do MapLibre, e reproduzido aqui. Cinco mecanismos do app respondiam pela conta:

- **A correção de zoom passava pelo worker a cada quadro.** Quinze controles registravam `zoom` e faziam `getData` da coleção inteira por quadro do gesto, mesmo com o mapa vazio (87 idas num gesto de 1,5 s sem feição; 278 com 170 feições). Nesta branch a bancada mediu o mesmo fenômeno pela porta do despachante: 90 `updateData` por gesto na linha de coordenação e no pincel, este reescrevendo a coleção VAZIA durante o gesto de outra ferramenta.
- **Cada consulta de elevação percorria os tiles da vista duas vezes**, uma delas num ponto fixo em `[0,0]` para cancelar um deslocamento que não existe no 5.18 (o valor devolvido é `DEM * exagero`). Um viewshed pedia 20.002 travessias de coveringTiles.
- **A troca de mapa base derrubava a aplicação inteira.** Aqui pior que na `main`: o console dizia em toda troca que não conseguia diffar o estilo e o remontava do zero, destruindo 74 fontes e 87 camadas por troca.
- **Camada de fonte GeoJSON vazia custava duas vezes por quadro com terreno**: entrava na consulta de elevação de coveringTiles e quebrava as pilhas de render-to-texture (16 pilhas e 1805 draw calls num mapa parado; 1 pilha e 21 com as camadas vazias escondidas).
- **O parâmetro de nível de detalhe nunca valia** depois da primeira troca de base, porque `setSourceTileLodParams` escreve em cada fonte que existe naquele instante.

## Os quatro mecanismos que ficam, e a régua de cada um

1. **Tamanho visual que depende do zoom é expressão na camada, nunca `setData` por quadro.** `zoomScaledExpression` (`frontend/src/js/layers/styles/zoom-expression.js`) reproduz `base * 2^(zoom - ancora)` exatamente entre stops inteiros, com clamp por stop e `case` para a correção desligada; o limite e a linha de coordenação têm as próprias expressões nos modelos de zoom em `frontend/src/js/tool_manager/helpers/`. O passe em JavaScript roda no `zoomend`, uma vez por gesto, só para manter `calculated*` na feição (a exportação e o cabeçalho leem de lá). A régua: `zoom-pass-events.test.js` reprova o controle cujo quadro chama `getData`.
2. **Nas 16 fontes migradas o desenho da `main` não vale.** Lá a coleção é lida por referência (`readGeoJSONSourceData`, `frontend/src/js/utilities/geojson-source.js`), mutada e devolvida por `setData`. Aqui as 16 fontes escrevem por `updateData` pelo despachante (`frontend/src/js/layers/geojson-dispatcher.js`): `serialize` reconstrói a coleção (é leitura, não referência) e um `setData` cru descarta o lote pendente. Todo passe de `zoomend` escreve pelo despachante. A bancada de ferramentas conta `setData` e `updateData` separados por fonte por gesto, e é por isso que uma bancada só-`setData` reprovaria a conclusão de toda ferramenta migrada com o app intacto.
3. **Uma consulta de elevação por amostra, e uma travessia por cálculo.** `createTerrainSampler` (`frontend/src/js/terrain/terrain-elevation.js`) resolve o zoom da câmera uma vez e lê o DEM direto: LOS de 202 consultas para 101 leituras, viewshed de cerca de 20.002 para 10.000, perfil de linha de 52 para 26. E `setProjectionKeepingHillshade` esconde o hillshade um quadro antes de trocar a projeção, porque no 5.18 o tile do `raster-dem` marcado para recarga com a camada visível fica preso e o `idle` nunca vem.
4. **A troca de base preserva o que a aplicação desenhou.** `mergeApplicationStyle` (`frontend/src/js/baselayers/style-transform.js`) mantém fontes e camadas do app por exclusão dos ids da base anterior, e `setupMapFeatures` em modo preservado NÃO passa por `writeWholeCollection`, senão a troca apagaria o que o usuário desenhou e ainda não sincronizou. Depois: uma fonte e uma camada removidas por troca. E a troca decide pelo mapa (`baseStyleAlreadyOnMap`), porque um id de base não determina um estilo: `basemapStyles` é mutado em execução pelo pacote de concessão, e a carta topográfica e o OSM partilham um estilo.

Mais dois de custo menor com a mesma forma: `installEmptySourceVisibility` esconde a camada cuja fonte está vazia e a reexibe pelo `sourcedata` de conteúdo, que o `updateData` do despachante também dispara; e `normalizeTileLodParams` recusa o par que desliga o LOD (primeiro valor abaixo de 2), com o padrão servido em `null` desde 2026-09-04 e a reaplicação depois de cada `setStyle`.

## Armadilhas

- **Régua portada de outra linha pode passar inteira contra o estado anterior daqui.** A régua da guarda de arrasto vinda da `main` só levantava a grafia morta da bandeira, e aqui a guarda era viva por outro nome. Portar régua exige vê-la reprovar o estado anterior DESTE ramo.
- **Camada nova que nasce com filtro estático fica fora da reescrita de filtros.** A camada de preenchimento do fosso anticarro nasceu fora de `FEATURE_LAYER_IDS` (`frontend/src/js/layers/layer.constants.js`): ocultar a camada apagava o contorno e deixava a faixa na tela. O recorte de geometria tem de viajar por `LAYER_ADDITIONAL_FILTERS`, senão a reescrita o perde.
- **A bancada com cabeça herda o proxy do sistema** e abre o diálogo de credencial em todo host de fora (em headless é 407 calado). Ela lê a credencial da variável de ambiente do proxy e a entrega ao navegador (`frontend/bench/proxy-do-navegador.mjs`); o valor nunca vai ao log.
- **Rodada de bancada com outro agente editando `frontend/src/` morre pelo HMR**, e a identidade do módulo se prova pelo registro de controles, não pelo mapa, porque o HMR não invalida o registro.
- **Número de subagente sobre desempenho é hipótese** até a sonda no navegador confirmar: medida de turf em node sem JIT mente por uma ordem de grandeza.

## Como medir

`frontend/bench/README.md`: `desempenho-terreno.mjs` (quadro, pilhas, draw calls, tiles, por variante e por mapa base) e `ferramentas.mjs` (escritas na fonte por gesto, latência do feedback, nove ferramentas). As duas provam a si mesmas antes de dar número, e os autotestes em node constroem o insumo degenerado de cada eixo. Uma rodada com o terreno de demonstração é fumaça, não referência.

## Histórico

- **2026-09-04.** Porte por lotes (ferramentas, base, bancada, linha de coordenação, zoom na GPU, terreno) com um agente por lote sobre a mesma árvore e commit por lote depois de amostragem com controle negativo reproduzido. Números desta branch: linha de coordenação de 40 escritas por gesto de zoom para 1 (num gesto de 30 linhas); pincel de 90 para 1; limite de 91 para 1; `getData` por quadro de 15 controles para zero; terreno parado de 19,9 ms para 1,7 ms.
