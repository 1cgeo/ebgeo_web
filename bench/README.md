# Bancada de desempenho do EBGeo Web

Duas bancadas, mesma doutrina: cada cenario devolve a PROVA do que fez, a bancada reprova a si
mesma antes de mostrar numero, as rodadas se intercalam e a primeira se descarta, e a celula sai
como mediana com amplitude. Nenhum caminho de maquina no codigo, e nenhum caminho absoluto gravado
em artefato.

- `desempenho-terreno.mjs` mede o custo do QUADRO DO MAPA sob variantes de estado, com terreno e
  sem. Nasceu da investigacao do engasgo com terreno ligado, em 2026-09-04. `autoteste.mjs` prova
  que ela reprova o insumo degenerado.
- `ferramentas.mjs` mede o custo de USAR uma ferramenta de desenho: o feedback enquanto o mouse
  anda, o passe de zoom com N feicoes e a latencia de concluir a feicao. Nasceu das seis sondas de
  uso unico que mediram a linha de coordenacao no mesmo dia.
  `autoteste-ferramentas.mjs` prova que ela reprova o insumo degenerado.

Rode o autoteste da bancada antes de confiar num numero dela.

# Bancada de terreno (`desempenho-terreno.mjs`)

## O que a bancada mede

Por variante e por cenario, com o mapa ja assentado:

- **Quadro**: `map._render` p50, p95 e max, em milissegundos. E o custo do trabalho sincrono do quadro.
- **Intervalo entre quadros**: p50, p95 e max. Diz a taxa que o usuario sente. 16,7 ms e 60 fps.
- **Fases do MapLibre por quadro**: `style._updateSources`, `style._updatePlacement`, `painter.render`
  e `renderToTexture.prepareForRender`, cada uma cronometrada por envolucro do metodo.
- **Contadores de GL por quadro**: `drawElements` mais `drawArrays` (draw calls), `bindFramebuffer`,
  `clear`, `texImage2D` mais `texSubImage2D`, `painter.renderLayer`, e os stamps do pool do
  render-to-texture (`renderToTexture.pool.stampObject`).
- **Estado**: numero de pilhas do render-to-texture (`painter.renderToTexture._stacks.length`),
  tiles de terreno renderizaveis, fontes, camadas, visibilidade do hillshade, projecao, pitch e zoom.

## O que a bancada NAO mede

- **Rede.** Nada de tempo de download de tile, latencia do servidor ou tamanho de resposta. Todo
  cenario comeca com o mapa assentado, e o custo de carga fica de fora de proposito.
- **O relogio em headless.** Com `--headless` o Chromium cai no SwiftShader, que e GPU emulada por
  CPU. A bancada detecta pelo `WEBGL_debug_renderer_info` e marca `relogio: INVALIDO (GPU emulada)`.
  Nesse modo so as CONTAGENS valem (pilhas, draw calls, stamps, fontes, camadas). Nenhum
  milissegundo medido em headless serve para comparar com o numero de referencia abaixo.
- **Memoria e VRAM.** Fora de escopo.
- **O primeiro quadro depois da carga.** A bancada mede o regime, nao a partida.

## Como rodar

O repositorio nao tem Playwright, e o npm pode nao alcancar o registry. A bancada importa o
Playwright de um diretorio dado pela variavel de ambiente `EBGEO_PLAYWRIGHT_DIR`, que aponta o
diretorio que CONTEM `node_modules/playwright`. Sem a variavel, ela tenta o `node_modules` da raiz
do repositorio e depois o de `bench/`. Nenhum caminho de maquina vive no codigo.

```sh
# o app tem de estar no ar (vite dev na 3007); a bancada nao sobe servidor
export EBGEO_PLAYWRIGHT_DIR=/caminho/para/o/projeto/que/tem/node_modules/playwright
node bench/desempenho-terreno.mjs
```

Chromium tem de estar instalado para essa versao do Playwright (`npx playwright install chromium`
naquele projeto). A bancada foi escrita e medida com Playwright 1.61.1 e Node 24.

Opcoes:

| opcao | padrao | o que faz |
|---|---|---|
| `--url` | `http://localhost:3007/ebgeo/` (ou `EBGEO_URL`) | endereco do app |
| `--vista` | `serra-gaucha` | `serra-gaucha`, `porto-alegre` ou `alegrete` |
| `--rodadas` | 2 | a rodada 1 e aquecimento e fica fora da tabela |
| `--variantes` | todas | lista separada por virgula |
| `--saida` | `bench/saida/<data-hora>/` | pasta dos artefatos |
| `--largura` / `--altura` | 1600 / 900 | viewport |
| `--headless` | false | ver a advertencia do relogio acima |
| `--perfil` | false | liga o profiler do CDP (ver armadilhas) |
| `--bases` | `atual` | ids de mapa base do app, separados por virgula (ver "Mapas base") |
| `--cpu` | 1 | estrangula a CPU pelo CDP (`4` = maquina quatro vezes mais lenta) |
| `--populado` | false | cria feicoes de 10 tipos pelas ferramentas do app antes das rodadas |

Vistas embutidas:

| nome | center | zoom |
|---|---|---|
| `serra-gaucha` | -50.87, -29.37 | 12.5 |
| `porto-alegre` | -51.23, -30.03 | 13.5 |
| `alegrete` | -55.79, -29.78 | 12 |

Exemplo:

```sh
node bench/desempenho-terreno.mjs --rodadas 2 --variantes 2d,terreno,terreno-vazias-escondidas
node bench/desempenho-terreno.mjs --vista alegrete --perfil
node bench/desempenho-terreno.mjs --bases osm-overture,carta-topografica,carta-topografica-raster --variantes 2d,terreno --rodadas 3
node bench/desempenho-terreno.mjs --bases osm-overture,carta-topografica-raster --variantes terreno --populado --cpu 4
node bench/autoteste.mjs
```

Artefatos na pasta de saida: `resultado.json` (tudo, inclusive as provas e os vereditos),
`resultado.md` (a tabela), `captura-<base>-<variante>.png` (uma por caso, tirada depois do cenario
`parado`) e, com `--perfil`, um `.cpuprofile` por cenario. A tabela tambem sai no stdout.
O `bench/.gitignore` mantem `saida/` fora do versionamento: uma rodada de tres variantes ja pesa
5 MB de PNG, e tudo ali se regenera.

## Mapas base

`--bases` cruza cada variante com cada mapa base do app. O caso `base x variante` parte de uma
recarga, le a impressao digital do app (a mesma para toda carga da bancada), troca a base pelo
caminho do painel (`BaseLayerControl.applySharedBasemap`, que nao persiste a escolha no mapa
salvo), leva a camera a vista e so entao aplica a variante. `atual` e a base com que o app abriu,
sem troca. A base tem de estar REGISTRADA no app que esta no ar (`STYLE_MAP` do controle e
`config.basemaps` com `enabled: true`); id desconhecido sai marcado com a lista das registradas.

A prova da troca sai do proprio app, nunca de constante repetida na bancada: o estilo registrado
no controle diz o nome, as fontes e as camadas que a base tem de mostrar. Depois da troca e com a
vista assentada, a bancada confere o nome do estilo, o id que o controle diz estar ativo, as fontes
e as camadas da base presentes, NENHUMA fonte da base anterior sobrando e pelo menos um tile da
base em estado `loaded`. O ultimo item existe por causa da porta 3009 em 2026-09-04: estilo
certo, mapa em branco. Caso que reprova sai `VARIANTE INVALIDA` na tabela e segue medindo os
outros. A conferencia contra a referencia so olha os casos na base com que o app abre; caso de
outra base fica de fora em vez de divergir por fator 2 e mentir sobre a causa.

Base por dentro e variante por fora, para os casos que se comparam ficarem vizinhos no tempo. A
base fica na primeira coluna da tabela e no nome da captura.

`--populado` cria, uma vez antes das rodadas, feicoes de 10 tipos em volta da vista pelo
`createFeature` de cada controle de desenho (linha, poligono, circulo, setor, elipse, retangulo,
seta, pincel, limite e linha de coordenacao). O store as persiste no contexto do navegador, e toda
recarga seguinte as traz de volta; cada caso confere que as feicoes voltaram (`feicoes` na prova)
e reprova se mediu o app vazio. O caso vazio mente sobre o custo das camadas do app: medido em
2026-09-04, a variante `terreno` com 56 feicoes custava o dobro da mesma variante sem nenhuma.

`--cpu` manda `Emulation.setCPUThrottlingRate` ao CDP uma vez, e o fator vale para toda a
sessao, recargas inclusive. E a "maquina pior" de forma reproduzivel; a GPU pior se escolhe por
fora, com `--use-adapter-luid` no Chromium (ver a skill medir-desempenho-web do vault). Com `--cpu`
acima de 1 a cadencia ociosa do rAF acima de 25 ms vira AVISO no caso, e nao rodada invalida: o ocioso
lento e a condicao medida (4x deixa a Topografica populada em p95 33 ms e o raster da DSG em 17).

## Variantes

Cada variante parte de uma RECARGA da pagina, para nao herdar estado da anterior, e devolve a
PROVA de que aplicou o que prometeu. Prova que nao bate marca a variante INVALIDA na tabela, e a
bancada segue medindo as outras.

| variante | o que faz | prova que a valida |
|---|---|---|
| `2d` | estado base do app, pitch 0, sem terreno | `getTerrain()` nulo e pitch 0 |
| `terreno` | o botao do app (`TerrainControl._toggleTerrain()`): terreno, hillshade e pitch 60 | `getTerrain()` nao nulo, pitch >= 55, hillshade `visible`, pelo menos uma pilha |
| `terreno-sem-hillshade` | o mesmo, com `visibility: none` no hillshade | hillshade `none` |
| `terreno-quebra-pilha-topo` | move `symbol`, `circle`, `fill-extrusion` e `heatmap` para o topo, na ordem relativa | alguma camada movida E o numero de pilhas CAIU |
| `terreno-vazias-escondidas` | `visibility: none` nas camadas das fontes GeoJSON sem feicao | alguma camada MUDOU de visivel para none E a contagem de camadas intacta |
| `terreno-vazias-removidas` | `removeLayer` e `removeSource` nas mesmas | fontes e camadas cairam |
| `terreno-vazias-escondidas-quebra-pilha-topo` | as duas | as duas provas |

Fonte GeoJSON vazia e a que tem `_data` objeto com zero feicoes. Fonte cujo `_data` e uma URL nao
da para julgar do lado do cliente, entao ela sai contada a parte em `fontesUrlDesconhecidas` e a
bancada NAO mexe nela. Descarte silencioso costuma incluir justamente o que se procura.

## Cenarios

Nesta ordem, cada um esperando o mapa assentar antes (`map.loaded()`, ou estado dos tiles estavel
por 3 s; qual dos dois valeu fica registrado em `assentou`):

1. `parado`: 2 s de `triggerRepaint` a cada rAF.
2. `rotacao`: `easeTo` de bearing +90 em 3 s, easing linear.
3. `pan`: `easeTo` de center +0,02 grau de longitude em 3 s.
4. `zoom`: `easeTo` de zoom +1 em 1,5 s e a volta em 1,5 s.
5. `pitch`: `easeTo` de pitch 60 para 30 em 1,5 s e a volta em 1,5 s. Pulado na variante `2d`.

## Como a bancada reprova a si mesma

Antes de qualquer numero:

1. **Renderer.** Le `WEBGL_debug_renderer_info`. `SwiftShader` ou `llvmpipe` marca
   `relogio: INVALIDO (GPU emulada)` e o veredito de toda celula carrega a marca. As contagens
   continuam valendo.
2. **Aba visivel.** `document.visibilityState` diferente de `visible` invalida a rodada.
3. **Cadencia ociosa do rAF.** 60 quadros sem pedir repaint, DEPOIS de o app assentar e com o mapa
   parado. p95 acima de 25 ms invalida a rodada. A bancada mede duas vezes e guarda as duas:
   `cadenciaCarregando` (logo apos o `goto`, so registro) e `cadenciaAssentada` (o veredito). Em
   2026-09-04 a primeira deu p95 de 33 ms porque a pagina ainda carregava, e a segunda deu 16,9 ms.
   Medir no momento errado reprova a bancada boa.
4. **App inteiro.** O catalogo do app entra depois do estilo base. A bancada so mede quando o estilo
   passa de 159 camadas E a dupla (camadas, fontes) para de mudar por 3 s. O piloto de 2026-09-04
   mediu o app com 159 camadas e 9 fontes e deu 1,5 ms no `2d parado`; com o app inteiro (302
   camadas, 103 fontes) o mesmo cenario deu 3,9 ms. Numero bonito por app pela metade.
5. **Prova por cenario.** Zero quadros medidos invalida o cenario. Fonte ou camada que muda no meio
   do cenario invalida o cenario, pelo mesmo motivo do item 4. Com terreno ligado, ausencia de
   stamps E de pilhas invalida o cenario.
6. **Assinatura do app.** Antes de aplicar a variante, a bancada anota `camadas/fontes/camadas
   visiveis`. Todas as cargas de uma mesma bancada tem de dar a mesma assinatura. Duas assinaturas
   diferentes significam que a arvore mudou embaixo da medida, e ai toda rodada sai INVALIDA com
   `APP MUDOU ENTRE AS CARGAS`. Em 2026-09-04 isso aconteceu de verdade: uma sessao paralela
   instalou `src/js/layers/empty-source-visibility.js` no meio da rodada, e o mesmo rotulo
   `terreno` passou de 17 pilhas e 27 ms na rodada 1 para 2 pilhas e 6,6 ms na rodada 2. Sem esta
   checagem a tabela teria comparado dois aplicativos com o mesmo nome.
7. **Conferencia contra a referencia.** A tabela abaixo esta codificada na constante `REFERENCIA`.
   Toda rodada na vista `serra-gaucha` compara o que mediu com ela e denuncia divergencia por fator
   2 ou mais. Com o relogio invalido, so as contagens sao conferidas.
8. **Autoteste.** `node bench/autoteste.mjs` monta o pior caso de cada eixo (renderer emulado, aba
   oculta, cadencia ruim, app trocado no meio, `terreno` sem `getTerrain()`, quebra-pilha que nao
   mudou o numero de pilhas, cenario sem quadro, medida fora do dobro, vista trocada, argumento
   invalido) e confirma que cada um sai marcado, e depois confirma que o insumo bom passa.

## Valores de referencia, 2026-09-04

Vista `serra-gaucha`, viewport 1600x900, Chromium com janela visivel, GPU NVIDIA RTX A2000 12GB
(ANGLE sobre Direct3D11), app em `vite dev` na 3007 com 302 camadas e 103 fontes.

| variante | cenario | render p50 | pilhas | tiles de terreno | draw/quadro |
|---|---|---|---|---|---|
| `2d` | parado | cerca de 3 ms | - | - | cerca de 1200 |
| `terreno` | parado | cerca de 27 ms | 17 | cerca de 20 | cerca de 2500 |
| `terreno-quebra-pilha-topo` | parado | cerca de 9 ms | 1 | cerca de 20 | - |
| `terreno-vazias-escondidas` | rotacao | cerca de 6 ms (60 fps) | 2 | cerca de 20 | cerca de 650 |
| `terreno-vazias-removidas` | rotacao | cerca de 6 ms (60 fps) | 2 | cerca de 20 | - |

Leitura: com terreno e hillshade ligados na Serra Gaucha, o render-to-texture forma 17 pilhas sobre
cerca de 20 tiles de terreno, e o quadro parado custa cerca de 27 ms com 2.500 draw calls. Mover as
camadas `symbol`, `circle` e `fill-extrusion` para o topo funde as pilhas em 1 e derruba o quadro
para cerca de 9 ms. Esconder ou remover as camadas das 67 fontes GeoJSON vazias do app derruba o
gesto de rotacao para cerca de 6 ms por quadro, ou seja, 60 fps. Em 2D o quadro parado custa 3 ms.

O numero de pilhas da linha `terreno-vazias-escondidas` (2, e nao 17) e o unico que a propria
bancada mediu, em 2026-09-04: esconder as 84 camadas das 67 fontes vazias derruba as pilhas de 17
para 2 e as draw calls de 2.383 para 687. Ou seja, as camadas das fontes vazias eram elas MESMAS as
quebra-pilha, e nao uma carga a mais sobre uma pilha ja quebrada.

**Estes numeros descrevem o app ANTES de `src/js/layers/empty-source-visibility.js`.** Esse modulo
esconde sozinho a camada de fonte GeoJSON vazia, e com ele instalado a variante `terreno` mede o
mesmo que `terreno-vazias-escondidas`: 2 pilhas e cerca de 6,6 ms parado. A conferencia vai marcar
`terreno / parado / render_p50`, `draw_por_quadro` e `pilhas` como DIVERGENTES, e a divergencia
esta certa: e a melhoria aparecendo. Quando a linha de referencia for atualizada para o app com o
modulo, troque a data e diga qual versao do app a tabela descreve.

Estes numeros descrevem UMA maquina, UM dia e UMA versao do app. Nao os edite para a medida bater:
eles existem para reprovar a medida nova, e divergencia por fator 2 e achado, nao ruido a calibrar.

## Armadilhas conhecidas

- **Aba oculta ou janela ocluida zera o rAF.** O Chromium desacelera ou para o `requestAnimationFrame`
  de aba de fundo, e a bancada mediria zero quadro ou intervalo de 1000 ms. Por isso ela sobe o
  navegador com `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` e
  `--disable-features=CalculateNativeWinOcclusion`, e ainda checa `document.visibilityState`. Nao
  minimize nem cubra a janela durante a medida.
- **`page.waitForFunction` com predicado async passa na hora.** A Promise devolvida ja e um valor
  verdadeiro, entao a espera termina no primeiro tick e a medida sai do app meio carregado. Toda
  espera da bancada e um laco de `page.evaluate` do lado do Node.
- **`tileManager.getTile(k)` pode devolver `undefined`.** A leitura do estado dos tiles guarda o
  retorno antes de ler `.state`, senao a rotina de assentamento explode no meio da medida.
- **O profiler do CDP infla o tempo de quadro.** `Profiler.start` com amostragem de 250 us custa
  caro, e o `render p50` sob perfil nao se compara com o de fora. Por isso a bancada NAO liga o
  profiler por padrao. `--perfil` liga, grava um `.cpuprofile` por cenario e agrega o top 20 de
  self time por funcao, mas os tempos dessa rodada servem so para comparar funcoes entre si.
- **O servidor de desenvolvimento reinicia sozinho** quando alguem toca a configuracao, e ai o
  `goto` estoura ou o contexto de execucao some no meio de um `evaluate`. A carga tem tres
  tentativas, com 4 s entre elas.
- **Outra sessao editando a mesma arvore troca o app no meio da bancada.** O `vite dev` serve o
  arquivo do disco, entao a rodada 2 pode medir um app diferente da rodada 1 sem que nada na
  bancada mude. E o que aconteceu em 2026-09-04. Rode a bancada com a arvore parada, e confie na
  assinatura base: assinatura distinta invalida tudo, com o nome das cargas de cada uma.
- **`_toggleTerrain()` faz `easeTo` de pitch com 500 ms.** Ler o pitch logo depois pega o valor no
  meio da animacao. A bancada espera 1200 ms, arma o render-to-texture e so entao le a prova.
- **`_stacks` e `_renderableTiles` so existem depois que o terreno liga**, e so ficam corretos
  depois de um quadro. A bancada forca tres quadros por `triggerRepaint` antes de ler a prova.
- **A prova do quebra-pilha e o numero de pilhas, nao o numero de camadas movidas.** Mover camada
  que ja estava no topo nao muda nada, e a variante sairia aprovada sem ter feito diferenca. Por
  isso a validacao exige que `pilhas` tenha CAIDO.
- **A prova do esconder e a camada que MUDOU, nao a camada mirada.** Com
  `empty-source-visibility.js` instalado, as 84 camadas ja nascem `none`, e reescrever `none` por
  cima nao muda nada. Contar o alvo aprovaria uma variante inerte. A bancada conta so a transicao
  de visivel para `none`, e quando o total e zero a variante sai INVALIDA dizendo que o app ja
  esconde sozinho. Nesse estado a variante deixou de contrastar com `terreno`, e a comparacao que
  interessa passa a ser contra uma versao do app sem o modulo.

# Bancada de ferramentas (`ferramentas.mjs`)

Mede o custo de USAR uma ferramenta de desenho, nao o custo do mapa parado. Nasceu das seis sondas
de uso unico que mediram a linha de coordenacao em 2026-09-04 (o achado esta em
`docs/ferramentas-linha-de-coordenacao-2026-09-04.md`); esta bancada e o que ficou delas.

## Ferramentas

O nome curto e o contrato da linha de comando. O resto sai do app, e o autoteste cobra que cada
entrada tenha as seis pecas.

| `--ferramenta` | controle | tipo no store e fonte do mapa | fonte de feedback | conclusao |
|---|---|---|---|---|
| `line` | `AddLineControl` | `lines` | `line-feedback` | botao direito depois de 3 cliques |
| `polygon` | `AddPolygonControl` | `polygons` | `polygon-feedback` | botao direito depois de 3 cliques |
| `boundary` | `AddBoundaryControl` | `boundarys` | `boundary-feedback` | botao direito depois de 3 cliques |
| `arrow` | `AddArrowControl` | `arrows` | `arrow-feedback` | botao direito depois de 3 cliques |
| `occupied_front` | `AddOccupiedFrontControl` | `occupied_fronts` | `occupied-front-feedback` | o SEGUNDO clique |
| `coordination_line` | `AddCoordinationLineControl` | `coordination_lines` | `coordination-line-feedback` | botao direito depois de 3 cliques |

O controle vem do `CONTROL_REGISTRY` de `src/js/map_sig.js`, o tipo do `FEATURE_TYPE_MAPPINGS` de
`src/js/store/store.constants.js` (o balde que `getCurrentMapFeatures` devolve) e a fonte do
`FEATURE_SOURCES` de `src/js/layers/layer.constants.js`. A frente ocupada e de DOIS cliques: o
segundo ja cria a feicao e nao ha botao direito, entao o cenario `conclusao` cronometra o clique
final. O poligono cria por anel, porque menos de 3 pontos nao vira feicao.

## Cenarios, e a prova de cada um

Nesta ordem, num contexto de navegador NOVO por rodada:

1. **`desenho`**: a ferramenta ativa (`activate()`), UM ponto colocado por clique real, e `k`
   eventos `mousemove` sinteticos por quadro durante 3 s. Um caso por valor de `--k`.
   **Prova**: `setData` da fonte de feedback maior que zero E `drawPoints.length === 1` E a
   ferramenta `isActive`. **Metricas**: quadros, render p50/p95, intervalo p95, quadros acima de
   33 ms, `setData` por fonte, `queryRenderedFeatures`, `map.project()`, e a latencia do feedback.
2. **`zoom`**: `--feicoes N` criadas pelo caminho do proprio controle (`drawPoints` +
   `createFeature()`), depois `easeTo` de zoom +1 em 1,5 s e a volta em 1,5 s.
   **Prova**: N no store E pelo menos N na fonte do mapa. **Metrica principal**: `setData` da fonte
   principal POR GESTO. E ela que separa a ferramenta que deriva o tamanho na GPU (1 por gesto) da
   que reenvia a colecao a cada quadro (91 por gesto).
3. **`conclusao`**: os cliques do desenho e o gesto que fecha a feicao, pelo caminho do usuario.
   **Prova**: a contagem do store subiu, e os N cliques viraram vertice. **Metricas**: ms do gesto
   ate o store e ate o painel de atributos.

O cronometro da conclusao parte do PROPRIO evento do usuario, na fase de captura dentro da pagina.
Medi-lo do lado do Node somaria o tempo do canal do CDP a latencia da ferramenta.

## Como rodar

Mesmas regras da bancada de terreno: o app tem de estar no ar, e o Playwright vem de
`EBGEO_PLAYWRIGHT_DIR` (o diretorio que CONTEM `node_modules/playwright`). Nenhum caminho de
maquina vive no codigo.

```sh
export EBGEO_PLAYWRIGHT_DIR=/caminho/para/o/projeto/que/tem/node_modules/playwright
node bench/ferramentas.mjs --ferramenta coordination_line --k 1,4 --feicoes 30 --rodadas 1
node bench/ferramentas.mjs --ferramenta boundary --feicoes 10 --rodadas 1
node bench/ferramentas.mjs --ferramenta occupied_front --terreno --cpu 4 --snapping
node bench/autoteste-ferramentas.mjs
```

| opcao | padrao | o que faz |
|---|---|---|
| `--url` | `http://localhost:3007/ebgeo/` (ou `EBGEO_URL`) | endereco do app |
| `--ferramenta` | `coordination_line` | nome curto da tabela acima |
| `--k` | `1,4,8` | `mousemove` por quadro no cenario `desenho`, um caso por valor |
| `--feicoes` | 30 | feicoes criadas antes do cenario `zoom` |
| `--terreno` | false | liga o terreno pelo botao do app antes de medir |
| `--cpu` | 1 | estrangula a CPU pelo CDP (`4` = maquina quatro vezes mais lenta) |
| `--snapping` | false | liga `ui.snapping.enabled` antes de medir |
| `--rodadas` | 2 | a rodada 1 e aquecimento e fica fora da tabela |
| `--saida` | `bench/saida/<data-hora>/` | pasta dos artefatos |
| `--largura` / `--altura` | 1600 / 900 | viewport |
| `--headless` | false | ver a advertencia do relogio da bancada de terreno |

Artefatos: `resultado.json` (tudo, provas e vereditos inclusive), `resultado.md` (a tabela
`ferramenta | cenario | k | metricas | veredito`) e uma captura por cenario. O `bench/.gitignore`
mantem `saida/` fora do versionamento.

**Contexto NOVO por rodada**, e nao so uma recarga: o store do app persiste no IndexedDB do
contexto, e a rodada 2 acharia as feicoes da rodada 1 e mediria 2N com o rotulo de N.

## Como a bancada reprova a si mesma

1. **Renderer.** `SwiftShader` ou `llvmpipe` marca `relogio: INVALIDO (GPU emulada)`, e a marca
   entra no veredito de toda celula. So as contagens continuam valendo.
2. **Aba visivel.** `document.visibilityState` diferente de `visible` invalida a rodada, e tambem
   reprova cada cenario.
3. **Cadencia ociosa do rAF.** 60 quadros sem pedir repaint, com o mapa assentado. p95 acima de
   25 ms invalida a rodada. Com `--cpu` acima de 1 vira AVISO, porque o ocioso lento E a condicao
   medida.
4. **App inteiro.** So mede com 160 camadas ou mais E a dupla (camadas, fontes) parada por 3 s.
5. **A ferramenta existe no app.** Controle ausente do registro, fonte principal ausente ou fonte
   de feedback ausente derrubam a rodada com o nome do que faltou, antes de qualquer medida.
6. **Desenho sem feedback e INVALIDO.** Zero `setData` da fonte de feedback significa que a
   ferramenta nao desenhou, e `setData` de OUTRA fonte nao substitui: o alvo sai contado a parte
   justamente para o cenario inerte nao passar pela soma do vizinho.
7. **Zoom sem feicao e INVALIDO.** Fonte vazia, fonte com menos feicoes que o pedido, ou store que
   nao bate com o pedido derrubam o cenario.
8. **Conclusao sem store e INVALIDA.** A contagem do store tem de SUBIR, e os N cliques tem de ter
   virado vertice. Painel que nao abriu nao reprova sozinho, porque nem toda ferramenta abre um.
9. **Assinatura do app.** `camadas/fontes` antes de mexer no mapa. Duas assinaturas diferentes
   entre as cargas significam que a arvore mudou embaixo da medida, e toda rodada sai INVALIDA com
   `APP MUDOU ENTRE AS CARGAS`.
10. **Autoteste.** `node bench/autoteste-ferramentas.mjs` monta o pior caso de cada eixo e confirma
    que sai marcado, e depois confirma que o insumo bom passa.

## Valores medidos em 2026-09-04

Vista da Serra Gaucha (`-50.87, -29.37`, zoom 12,5), viewport 1600x900, Chromium com janela
visivel, GPU NVIDIA RTX A2000 12GB (ANGLE sobre Direct3D11), app em `vite dev` na 3007, uma rodada,
sem terreno, sem snapping, CPU livre. App com assinatura `246c/99f` nas duas rodadas.

`node bench/ferramentas.mjs --ferramenta coordination_line --k 1,4 --feicoes 30 --rodadas 1`

| cenario | k | quadros | render p50 | render p95 | interv p95 | setData alvo | project | lat p50 | lat n | perdidos | store ms | painel ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desenho | 1 | 181 | 2,1 | 3,4 | 17,1 | 180 | 0 | 16,4 | 18 | 161 | - | - |
| desenho | 4 | 181 | 2,3 | 3,2 | 17,3 | 181 | 0 | - | - | 180 | - | - |
| zoom | - | 182 | 3,2 | 6,0 | 17,0 | **1** | 368 | - | - | 0 | - | - |
| conclusao | - | 21 | 3,5 | 4,7 | 17,0 | 1 | 2 | 39,7 | 1 | 3 | 37,7 | 12,4 |

`node bench/ferramentas.mjs --ferramenta boundary --feicoes 10 --rodadas 1`

| cenario | k | quadros | render p50 | render p95 | interv p95 | setData alvo | project | lat p50 | lat n | perdidos | store ms | painel ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desenho | 1 | 180 | 1,9 | 3,1 | 17,0 | 179 | 0 | 9,8 | 177 | 2 | - | - |
| desenho | 4 | 181 | 2,1 | 2,8 | 17,0 | 180 | 0 | 10,0 | 180 | 0 | - | - |
| desenho | 8 | 181 | 2,0 | 2,8 | 17,1 | 180 | 0 | 10,0 | 180 | 0 | - | - |
| zoom | - | 182 | 3,2 | 4,7 | 16,8 | **91** | 368 | - | - | 0 | - | - |
| conclusao | - | 20 | 2,5 | 3,7 | 16,9 | 1 | 2 | 13,0 | 1 | 1 | 31,9 | 11,0 |

Leitura: o passe de zoom separa as duas. A linha de coordenacao manda UM `setData` no gesto inteiro
(a largura ja e expressao na camada, e o passe de JavaScript so roda em `zoomend`); a linha de
limite manda 91 com dez feicoes, um por quadro. O quadro nesta GPU nao denuncia a diferenca (3,2 ms
nas duas), porque o custo do reenvio esta no worker e no re-tiling, nao no `_render`: e por isso
que a coluna `setData alvo` existe, e nao so o relogio. O desenho em 2D nesta maquina nao e lento
em nenhuma das duas (cerca de 2 ms por quadro, 60 fps cheios), com `k` de 1 a 8.

Os numeros descrevem UMA maquina, UM dia e UM estado da arvore, e vieram de UMA rodada. O estado
da arvore neste dia nao era o do commit `df457081`: as tres ferramentas de linha, o poligono, a
seta e a frente ocupada estavam modificadas no disco por trabalho em curso, e o `vite dev` serve o
disco. Nao os edite para a medida bater.

## Armadilhas conhecidas

- **`setData` que ninguem viu.** A latencia do feedback so vale para o `setData` que chegou a
  assentar. O anterior, que o seguinte substituiu antes disso, nunca chegou a tela; cronometra-lo
  ate o proximo quadro bom empilharia o atraso de todos no mesmo instante, e uma fila de 160
  pendentes drenada de uma vez sairia como 160 medidas iguais e falsas. Por isso so o `setData`
  mais recente conta, e o resto vai para a coluna `perdidos`. **Leia `lat p50` sempre com `lat n` e
  `perdidos` ao lado**: 19 medidas em 180 escritas descrevem os 19 quadros que assentaram, nao a
  ferramenta.
- **A latencia depende da FASE entre o preview e o `_render`.** Ferramenta que escreve o preview
  dentro do rAF, logo antes do quadro, quase nunca e vista com a fonte carregada, e a mesma
  ferramenta com o preview num `setTimeout` seria. A diferenca entre `lat n` 19 e 177 nas duas
  tabelas acima e disso, e nao necessariamente do custo. Nao chame de regressao sem testar a causa.
- **O clique nao vira vertice na hora.** A linha de coordenacao e a de limite retem o clique 250 ms.
  Ler `drawPoints` logo depois do clique acharia zero e reprovaria o app bom, entao a bancada
  espera o vertice entrar, com limite, e conta os cliques que pegaram.
- **`page.mouse.move` com `steps` nao alcanca o mouse de alta taxa.** A sonda 1 de 2026-09-04 mediu
  ZERO quadro com 240 movimentos do Playwright. O mousemove sintetico despachado no canvas dentro
  de um laco de rAF alcanca: 8 por quadro sao 1.448 eventos em 3 s.
- **`getControl('ToolManager')` nao existe.** O `CONTROL_REGISTRY` nao registra o gerente, e a
  sonda 1 leu `null` e concluiu que a ferramenta nao estava ativa. Quem responde e o proprio
  controle (`isActive`), que e tambem o que o `SelectionManager` consulta para rotear o clique.
- **`activate()` direto no controle nao passa pelo ToolManager.** Basta para medir, porque o
  `SelectionManager.getActiveTool()` varre os controles por `isActive`, mas a ferramenta anterior
  nao e desativada. A bancada ativa uma ferramenta por vez e desativa pelo `deactivate()`.
- **Outra sessao editando a mesma arvore troca o app no meio da bancada.** O `vite dev` serve o
  arquivo do disco. A assinatura `camadas/fontes` pega a mudanca de estilo, mas NAO pega mudanca
  de comportamento em JavaScript: rode com a arvore parada, e anote o `git status` junto do numero.
