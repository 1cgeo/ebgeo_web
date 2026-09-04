# Bancada de desempenho do EBGeo Web

Mede o custo do quadro do mapa sob variantes de estado, com terreno e sem, e diz quando a
propria medida nao vale. Nasceu da investigacao do engasgo com terreno ligado, em 2026-09-04.

Dois arquivos:

- `desempenho-terreno.mjs`: a bancada.
- `autoteste.mjs`: prova que a bancada reprova o insumo degenerado. Rode antes de confiar num numero.

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
