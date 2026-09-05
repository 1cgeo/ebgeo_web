# Bancada de desempenho do EBGeo Web

Duas bancadas, mesma doutrina: cada cenário devolve a PROVA do que fez, a bancada reprova a si
mesma antes de mostrar número, as rodadas se intercalam e a primeira se descarta, e a célula sai
como mediana com amplitude. Nenhum caminho de máquina no código, e nenhum caminho absoluto gravado
em artefato.

- `desempenho-terreno.mjs` mede o custo do QUADRO DO MAPA sob variantes de estado, com terreno e
  sem, e o custo do PASSE DA CAIXA DE SELEÇÃO sob variantes do próprio passe.
  `autoteste.mjs` prova que ela reprova o insumo degenerado (330 casos, 21 eixos).
- `ferramentas.mjs` mede o custo de USAR uma ferramenta de desenho: o feedback enquanto o mouse
  anda, o passe de zoom com N feições e a latência de concluir a feição.
  `autoteste-ferramentas.mjs` prova que ela reprova o insumo degenerado (232 casos, 12 eixos).

Rode o autoteste da bancada antes de confiar num número dela:

```sh
node frontend/bench/autoteste.mjs
node frontend/bench/autoteste-ferramentas.mjs
```

A saída de terminal das duas é ASCII de propósito: o console do Windows abre em codepage 850 e
comeria os acentos das mensagens de veredito. A prosa acentuada vive nos comentários, neste arquivo
e no `resultado.md` gravado em disco, que são UTF-8.

## O que esta bancada precisa do ambiente

1. **O app tem de estar no ar, COM backend.** O boot do mapa é fail-fast em `GET /api/config`, e
   sem backend a página é a tela "EBGeo indisponível". O stack de desenvolvimento sobe pela raiz
   do monorepo:

   ```sh
   npm run dev          # backend na 8080 + Vite na 3000
   ```

   O `base` do Vite está comentado em `frontend/vite.config.js`, então a página do mapa é a raiz
   do servidor: `http://localhost:3000/`, que é o padrão de `--url` (e `EBGEO_URL` sobrepõe).
2. **Playwright vem do próprio pacote.** Ele é dependência declarada de `frontend/`
   (`@playwright/test`, que traz `playwright`), então não há variável de outro projeto a definir.
   `EBGEO_PLAYWRIGHT_DIR` continua existindo como escotilha, apontando o diretório que CONTÉM
   `node_modules/playwright`. Chromium tem de estar instalado para essa versão
   (`npx playwright install chromium` dentro de `frontend/`). Medido com Playwright 1.61.1 e Node 24.
3. **Rode com a árvore parada.** O `vite dev` serve o arquivo do disco, e outra sessão editando
   `frontend/src/` troca o app no meio da rodada. As duas bancadas carregam uma impressão digital
   `camadas/fontes` por carga e invalidam tudo quando ela muda.

### O proxy da máquina, sem diálogo

O Chromium com cabeça herda o proxy do sistema, e numa máquina atrás de proxy autenticado todo pedido a host de fora (demotiles, OSM, BDGEx) abre a janela de usuário e senha, que trava a rodada até alguém digitar; em headless a mesma situação vira 407 calado, e é por isso que a suíte de Playwright nunca viu o problema e a bancada viu. `--proxy ambiente` (padrão) lê `HTTPS_PROXY` ou `HTTP_PROXY` do ambiente, na forma `http://usuario:senha@host:porta`, e entrega servidor, usuário e senha ao Playwright, que autentica sem diálogo; `NO_PROXY` vira o bypass. Sem credencial na URL o modo cai para `sem-proxy` (`--no-proxy-server`: host de fora falha, nada abre diálogo), e `--proxy sistema` deixa o proxy como está. Valor de credencial e host nunca vão para log, JSON ou relatório: a bancada cita a CHAVE da variável. Casos de pior caso em `proxy-do-navegador.mjs` e no eixo 12 do `autoteste.mjs`.

## O que foi CONFERIDO contra este app, e não herdado

Esta bancada nasceu na branch `main` do repositório e foi reescrita para a `integracao_backend`.
O que segue foi medido aqui, não copiado.

- **MapLibre é o 6.7.0 do npm** desde 2026-09-04 (antes era o 5.18 vendorizado em
  `frontend/public/vendors/maplibre-gl.js`, apagado). Ele chega pelo ponto único
  `frontend/src/js/map/maplibre.js`, e o global `maplibregl` continua publicado ali.
  **O POOL DE TEXTURAS DO RTT NÃO EXISTE MAIS NA 6.x**, e por isso a coluna `stamps/q`
  sai vazia e `pool` sai `null`: a bancada já lia os dois atrás de uma guarda de
  existência, então ela mede sem inventar. `_stacks` e `prepareForRender` continuam,
  e são eles que a coluna de pilhas usa.
  Conferidos contra o bundle: `painter.renderToTexture._stacks`, `._renderableTiles`, `.pool`
  (com `stampObject` e `_objects`), `style._updateSources`, `style._updatePlacement`,
  `painter.render`, `painter.renderLayer`, `map.isSourceLoaded`, `map.triggerRepaint`.
  `rtt.pool._size` NÃO existe nesta versão e saiu da prova.
- **`map.style.sourceCaches` NÃO EXISTE na 5.18; o nome é `tileManagers`.** Zero ocorrências de
  `sourceCaches` no bundle, e a leitura confirmou em página: `temTileManagers: true`,
  `temSourceCaches: false`.
- **`getTile(chave)` é CEGO nesta versão, e só `getTileByID(chave)` lê o estado.** O corpo do
  primeiro é `getTile(e){return this.getTileByID(e.key)}`, ou seja, ele espera um tileID; passar a
  chave que `getIds()` devolve faz `e.key` numa string e retorna `undefined` para TODO tile.
  Medido em 2026-09-04 sobre o app no ar: **607 tiles, 607 cegos por `getTile`, ZERO cegos por
  `getTileByID`**. O efeito é pior que um erro: a assinatura de tiles fica constante, `assentar()`
  declara "tiles estáveis por 3 s" na primeira volta e a medida sai do mapa no meio da carga.
  A bancada usa `getTileByID` e conta os desconhecidos, e `validarLeituraDeTiles` reprova um
  leitor que não soube o estado de nenhum tile.
- **O `_data` da fonte GeoJSON É um envelope na 5.18**, ao contrário do que se supunha ao planejar
  o porte. O `serialize()` do bundle é
  `{... data: this._data.updateable ? {type:"FeatureCollection", features:[...]} : this._data.url || this._data.geojson}`.
  Ler `src._data` direto contaria TODA fonte como vazia; a bancada lê `serialize().data`, que é o
  único caminho correto aqui.

## As oito divergências do porte, e o motivo de cada uma

1. **URL e servidor.** Padrão `http://localhost:3000/` (a `main` usava `:3007/ebgeo/`). O app
   precisa do backend, e o stack sobe pela raiz.
2. **A fonte principal escreve por DIFF, não por `setData`.** As dezesseis fontes migradas passam
   pelo despachante `frontend/src/js/layers/geojson-dispatcher.js`, que chama `updateData`; as
   fontes de apoio (`-feedback`, `-edit-handles`, `selection-boxes`) continuam em `setData` cru.
   A bancada de ferramentas instrumenta os DOIS métodos, por fonte, e a tabela traz três colunas:
   `escritas alvo` (a soma, que é o que reprova o cenário inerte), `setData alvo` e `updData alvo`
   (que dizem por qual caminho a fonte recebeu dado). Uma bancada que contasse só `setData` diria
   ZERO no `zoom` e na `conclusao` de toda ferramenta migrada e reprovaria o app intacto: são 15
   casos do autoteste que a pegam.
3. **Carga tardia das ferramentas.** Nesta branch quase toda ferramenta é carregada sob demanda
   (`frontend/src/js/tool_manager/tool-registry.js`), e `getControl('AddXControl')` devolve um
   STAND-IN até `ensureControl(<chave>)` rodar. O stand-in não desenha, não ativa e não cria
   feição, e mediria zero com o nome da ferramenta. A bancada resolve a chave pela TABELA DO
   PRÓPRIO APP (casando o nome da classe contra `FERRAMENTAS`), espera a carga, e as réguas dos
   três cenários reprovam um controle que ainda seja stand-in.
4. **O store.** `getCurrentMapFeatures()` continua existindo e é a prova por feição persistida,
   como na `main`. `getControl` vem de `store/control.registry.js`.
5. **Mapas base.** O controle não tem `styleUrls`: a lista vem do servidor (`config.basemaps`,
   hidratado por `GET /api/config`) e o estilo de cada id sai de `BaseLayerControl._styleFor(id)`,
   que é a mesma resolução que a troca usa. A troca continua sendo `applySharedBasemap`, que não
   persiste. Base cujo estilo resolve para uma URL (e não um objeto) sai reprovada dizendo isso,
   em vez de aprovada às cegas.
6. **Terreno.** As URLs vêm do servidor (`config.map2d.terrainSource` / `hillshadeSource`, das
   chaves `TERRAIN_URL` e `HILLSHADE_URL` do backend, cujo padrão é o demotiles do MapLibre). No
   stack de desenvolvimento medido em 2026-09-04 as duas apontavam o demotiles, então a rodada
   vale como FUMAÇA, e não como referência de produção.
7. **Playwright do próprio pacote** (ver acima).
8. **Lint.** `npm run lint --prefix frontend` roda `eslint . --max-warnings 0` e ALCANÇA
   `bench/**.mjs` (a config plana do ESLint 9 linta `.js`, `.mjs` e `.cjs`). A bancada entra limpa
   na lint da casa: nenhuma linha foi acrescentada à lista de ignorados.

### E mais três, que a rodada real obrigou

9. **O hillshade é OPCIONAL no servidor, e aqui ele está DESLIGADO.** `config.map2d.hillshade.enabled`
   vem falso do backend de desenvolvimento, então o `TerrainControl` sai de `_setHillshadeVisibility`
   na primeira linha e a camada `hillshade` nunca nasce. Cobrar `visible` ali mediria a
   configuração do servidor, e não a variante; calar deixaria a diferença invisível numa tabela em
   que ela vale muito (o passe de hillshade custa caro). A variante `terreno` passa a validar
   hillshade só quando o app declara tê-lo, a célula sai marcada `SEM HILLSHADE`, e a variante
   `terreno-sem-hillshade` REPROVA dizendo que não há o que esconder e que ela deixou de contrastar
   com `terreno`.
10. **O critério de "app inteiro" não é um número de camadas.** A `main` exigia 160 camadas. Este
    app, contra o backend de desenvolvimento, monta **85 camadas e 70 fontes**: o piso herdado
    teria bloqueado a bancada para sempre, e um absoluto que envelhece sozinho vira mentira com
    cara de medição. O critério aqui é a lista de fontes que o PRÓPRIO app declara
    (`FEATURE_SOURCES` de `layers/layer.constants.js`, 21 fontes) mais a dupla (camadas, fontes)
    parada por 3 s. Lista vazia REPROVA, em vez de aprovar por vacuidade.
11. **O `?t=` do HMR do Vite entrega OUTRA CÓPIA do módulo, e o mapa sozinho não denuncia.**
    Medido aqui na primeira rodada real: o app tinha carregado
    `/src/js/tool_manager/tool-registry.js?t=1788551638589`, o `import()` do caminho nu devolveu
    outro módulo, e `ensureControl` lançava `tool-registry usado antes de initToolRegistry()`.
    O detalhe que engana: `mesmoMapa` deu **true**, porque o estado do registro de controles mora
    em `store/control.registry.js`, que o HMR não havia invalidado, então as duas cópias de
    `store/index.js` reexportavam o MESMO registro. **A identidade se prova no módulo que guarda o
    estado que se vai usar, um por um.** A bancada agora (a) aumenta o buffer do Resource Timing
    num init script antes da página (o padrão de 250 entradas não cabe nos ~577 módulos do app em
    dev), (b) importa cada módulo pela URL que o PRÓPRIO app carregou, e (c) prova a identidade do
    registro exigindo que alguma ferramenta ANSIOSA (semeada por `map_sig.js`) esteja viva nele.

## Bancada de terreno (`desempenho-terreno.mjs`)

### O que a bancada mede

Por variante e por cenário, com o mapa já assentado:

- **Quadro**: `map._render` p50, p95 e max, em milissegundos.
- **Intervalo entre quadros**: p50, p95 e max. 16,7 ms é 60 fps.
- **Fases do MapLibre por quadro**: `style._updateSources`, `style._updatePlacement`,
  `painter.render` e `renderToTexture.prepareForRender`.
- **Contadores de GL por quadro**: draw calls, `bindFramebuffer`, `clear`, upload de textura,
  `painter.renderLayer` e os stamps do pool do render-to-texture.
- **Estado**: pilhas do render-to-texture, tiles de terreno renderizáveis, fontes, camadas,
  visibilidade do hillshade, projeção, pitch e zoom.
- **DEM, em TRÊS leituras**: `dem tiles` é o tile residente somado sobre todas as fontes
  `raster-dem` do estilo, `dem ok` é quantos daqueles chegaram de fato (estado `loaded`), e
  `dem rede` é o pedido de tile de DEM durante o cenário. As três falham por motivos diferentes, e
  é por isso que são três. A de rede cai sozinha da segunda carga em diante, porque o cache do
  navegador serve o mesmo tile sem pedir; a de residentes não cai, porque cada fonte que pede o
  tile ainda o decodifica; e a de carregados é a única que separa relevo de terreno plano, porque
  tile com erro também é residente.

### O que a bancada NÃO mede

- **Rede, salvo o tile de DEM.** Todo cenário começa com o mapa assentado, e o que ele pede
  depois disso não entra em nenhuma métrica, com uma exceção declarada: os pedidos de tile de
  DEM, que a variante `terreno-dem-unico` existe para reduzir. Os prefixos de URL que contam
  como DEM saem das fontes VIVAS do mapa (o template que a fonte resolveu do TileJSON), nunca de
  um endereço escrito na bancada.
- **O relógio em headless.** Com `--headless` o Chromium cai no SwiftShader (GPU emulada por CPU).
  A bancada detecta pelo `WEBGL_debug_renderer_info` e marca `relogio: INVALIDO (GPU emulada)`;
  nesse modo só as CONTAGENS valem.
- **Memória e VRAM.**
- **O primeiro quadro depois da carga.** Mede-se o regime, não a partida.

### Como rodar

```sh
node frontend/bench/desempenho-terreno.mjs --rodadas 2
node frontend/bench/desempenho-terreno.mjs --variantes 2d,terreno --vista alegrete
node frontend/bench/desempenho-terreno.mjs --bases osm,carta-ortoimagem --variantes 2d,terreno
node frontend/bench/desempenho-terreno.mjs --variantes terreno --populado --cpu 4
node frontend/bench/desempenho-terreno.mjs --populado --selecionadas 0,50 --rodadas 3 \
  --variantes terreno,terreno-hillshade-app,terreno-dem-unico,terreno-hillshade-baixo,terreno-camadas-agrupadas
```

| opção | padrão | o que faz |
|---|---|---|
| `--url` | `http://localhost:3000/` (ou `EBGEO_URL`) | endereço do app |
| `--vista` | `serra-gaucha` | `serra-gaucha`, `porto-alegre` ou `alegrete` |
| `--rodadas` | 2 | a rodada 1 é aquecimento e fica fora da tabela |
| `--variantes` | todas | lista separada por vírgula |
| `--saida` | `frontend/bench/saida/<data-hora>/` | pasta dos artefatos |
| `--largura` / `--altura` | 1600 / 900 | viewport |
| `--headless` | false | ver a advertência do relógio |
| `--perfil` | false | liga o profiler do CDP (ele infla o quadro) |
| `--bases` | `atual` | ids de mapa base do app, separados por vírgula |
| `--cpu` | 1 | estrangula a CPU pelo CDP (`4` = máquina quatro vezes mais lenta) |
| `--populado` | false | cria feições de 10 tipos pelas ferramentas do app antes das rodadas |
| `--selecionadas` | `0` | quantas feições ficam SELECIONADAS durante a medida, pelo caminho do app. Lista: `0,50` mede as duas na mesma sessão |
| `--passes` | `selecao-quadro` | variantes do passe da caixa de seleção, por remendo em tempo de execução: `selecao-quadro`, `selecao-exata`, `selecao-zoomend` |

Artefatos na pasta de saída: `resultado.json` (tudo, provas e vereditos inclusive), `resultado.md`
(a tabela), `captura-<base>-<variante>.png` e, com `--perfil`, um `.cpuprofile` por cenário. O
`.gitignore` desta pasta mantém `saida/` fora do versionamento.

### Variantes

Cada variante parte de uma RECARGA da página e devolve a PROVA de que aplicou o que prometeu.
Prova que não bate marca a variante INVÁLIDA na tabela, e a bancada segue medindo as outras.

| variante | o que faz | prova que a valida |
|---|---|---|
| `2d` | estado base, pitch 0, sem terreno | `getTerrain()` nulo e pitch 0 |
| `terreno` | o botão do app (`TerrainControl._toggleTerrain()`) | `getTerrain()` não nulo, pitch >= 55, ao menos uma pilha, e hillshade `visible` SE o app o declarar habilitado |
| `terreno-sem-hillshade` | `visibility: none` no hillshade | hillshade `none`; reprova quando o servidor declara hillshade desligado, porque aí ela não contrasta com `terreno` |
| `terreno-hillshade-app` | o terreno mais o hillshade instalado pelo caminho do PRÓPRIO app | camada `visible` sobre `hillshadeSource`, DUAS fontes `raster-dem` no estilo e tile de DEM residente |
| `terreno-dem-unico` | o `hillshade` instalado sobre `terrainSource` e a fonte de DEM órfã fora do estilo | camada sobre a fonte do terreno lida do mapa, UMA fonte `raster-dem`, nenhuma fonte de DEM alheia com camada viva, a tinta igual à declarada |
| `terreno-hillshade-baixo` | o `hillshade` movido para logo acima da última cobertura da BASE e abaixo do primeiro `symbol` | a camada MUDOU de índice, caiu no alvo calculado e ficou abaixo do primeiro `symbol` |
| `terreno-camadas-agrupadas` | as camadas do app em dois blocos contíguos: as drapeáveis, depois as que quebram pilha | a ordem LIDA do mapa é a do plano, alguma camada trocou de posição, havia quebra-pilha VISÍVEL antes, e as pilhas CAÍRAM |
| `terreno-quebra-pilha-topo` | move `symbol`, `circle`, `fill-extrusion` e `heatmap` para o topo | alguma camada movida E o número de pilhas CAIU |
| `terreno-vazias-escondidas` | `visibility: none` nas camadas das fontes GeoJSON sem feição | alguma camada MUDOU de visível para none E a contagem de camadas intacta |
| `terreno-vazias-removidas` | `removeLayer` e `removeSource` nas mesmas | fontes e camadas caíram |
| `terreno-vazias-escondidas-quebra-pilha-topo` | as duas | as duas provas |

Fonte GeoJSON vazia é a que tem coleção com zero feições. Fonte cujo dado é uma URL não dá para
julgar do lado do cliente, então sai contada à parte em `fontesUrlDesconhecidas` e a bancada NÃO
mexe nela: descarte silencioso costuma incluir justamente o que se procura.

### As três propostas do relatório da `main`, medidas ANTES de existirem

O relatório `docs/desempenho-terreno-2026-09-04.md` da `main` deixou três mudanças "para
decidir" (itens 2, 3 e 4). As quatro variantes acima nascem daí, e nenhuma delas toca
`frontend/src/`: a decisão de adotá-las é do chefe depois dos números, então elas são remendo em
tempo de execução, como o `terreno-quebra-pilha-topo` já era.

**Item 4, duas fontes de DEM com a mesma URL.** `config.map2d.terrainSource` e
`config.map2d.hillshadeSource` apontam para o mesmo TileJSON, e o MapLibre pede os mesmos tiles
duas vezes. `terreno-dem-unico` troca a FONTE na definição que o config declara para a camada, e
deixa o app instalá-la: o estilo nasce com o `hillshade` sobre a fonte do terreno. Só depois a
bancada tira do estilo a fonte de DEM que ficou órfã. A ordem importa e foi corrigida por medida:
instalar a camada sobre a fonte própria e repontá-la depois mede outra coisa, porque a
`hillshadeSource` já baixou os tiles que a mudança existe para não baixar (67 pedidos contra 25 na
mesma vista). Do jeito certo, a fonte órfã nunca chega a pedir tile, porque o MapLibre não carrega
fonte que nenhuma camada usa; ela sai do estilo porque uma variante que se diz "uma fonte de DEM
só" com duas declaradas estaria mentindo pelo nome.

No fim a bancada chama `setTerrain` de novo, de propósito: é o ÚNICO ponto em que o MapLibre
percorre as camadas procurando um `hillshade` sobre a fonte do terreno para avisar contra a
partilha (`maplibre-gl-dev.mjs`, dentro de `setTerrain`, um `warnOnce` por carga). Sem essa chamada
o aviso nunca sairia, e a ausência dele seria lida como "não avisou". Ele sai, e vai para o
`resultado.json` da variante.

**Item 3, descer o hillshade.** `terreno-hillshade-baixo` move a camada para logo acima da última
cobertura DRAPEÁVEL da base e abaixo do primeiro `symbol` do mapa. O alvo se CALCULA
(`posicaoAlvoDoHillshade`), nunca se escreve: ele depende do estilo base que estiver montado, e um
índice fixo aqui envelheceria na primeira base nova. O cálculo recusa dois estilos em vez de
chutar um número: a base sem nenhuma cobertura drapeável (não existe "logo acima da cobertura", e
devolver 0 poria o hillshade debaixo do mapa inteiro com cara de acerto) e a base cujo primeiro
rótulo vem ANTES da última cobertura (as duas condições não se satisfazem juntas).

**Item 2, agrupar as camadas do aplicativo.** `terreno-camadas-agrupadas` põe as camadas do app em
dois blocos contíguos: primeiro as drapeáveis (`fill` e `line`), depois as que quebram pilha (os
`*-label-layer`, de tipo `symbol`, e os `*-edit-handles-layer`, de tipo `circle`), preservando a
ordem relativa dentro de cada bloco. O critério de corte é o TIPO, e não o sufixo do nome: é o
tipo que o render-to-texture usa para decidir se drapeia ou abre pilha nova, e uma lista de
sufixos deixaria de fora `boundary-handles-layer`, que é alça e não termina em
`-edit-handles-layer`.

#### O que a bancada NÃO repete do app

| o que ela precisa | de onde ela tira | o que aconteceria com uma cópia local |
|---|---|---|
| quais camadas são da BASE e quais são do app | `BaseLayerControl._baseStyleIds`, que o próprio controle monta de `initialBaseStyle()` | uma lista escrita aqui chamaria de "camada do app" o que é da base na próxima base nova |
| a definição da camada `hillshade` e da fonte de DEM | o `config` que o servidor entregou (`config.map2d.hillshade.layer` e `.hillshadeSource`) | montar a camada aqui mediria a bancada, e não o app |
| a posição em que o app põe o hillshade | o próprio `TerrainControl.setHillshadeVisibility`, que chama `_addHillshadeLayerInCorrectPosition` | um `beforeId` copiado aprovaria uma descida que o app já fazia |
| para onde descer, e em que ordem agrupar | calculado da ordem LIDA do mapa | um índice fixo envelheceria a cada base nova |
| os prefixos de URL que contam como DEM | o template que a fonte VIVA resolveu do TileJSON | um endereço escrito aqui contaria zero pedido, e "não pediu" ficaria indistinguível de "não sei olhar" |

#### As duas armadilhas

**O servidor desta árvore declara `config.map2d.hillshade.enabled` FALSO.** O `TerrainControl` sai
de `setHillshadeVisibility` na primeira linha, e a camada nunca nasce. As duas variantes de
hillshade não teriam o que medir, então a bancada liga a bandeira no objeto de configuração VIVO e
deixa o app instalar a camada e a fonte que o servidor já descreve. A célula sai marcada com
`HILLSHADE LIGADO PELA BANCADA`, porque ela não se compara com a de um deploy que o liga por
configuração: lá a camada nasce no boot, aqui ela nasce depois de o mapa estar montado.

**`terreno` não serve de par para as duas variantes de hillshade nesta árvore**, e é por isso que
existe `terreno-hillshade-app`. Com o hillshade desligado no servidor, `terreno` mede um terreno
SEM o passe de hillshade, e a diferença contra `terreno-dem-unico` seria a existência da camada,
não a fonte partilhada. A linha de base das duas é a que tem o hillshade instalado pelo caminho do
app, com as duas fontes de DEM.

#### O DEM desta árvore não cobre a área medida (2026-09-05)

`config.map2d.terrainSource.url` e `hillshadeSource.url` apontam para
`demotiles.maplibre.org/terrain-tiles/tiles.json`. O TileJSON declara `bounds` do mundo inteiro e
`maxzoom` 12, mas o `name` dele é `jaxa_terrainrgb_N047E011`: é UM grau quadrado do AW3D30 da
JAXA, nos Alpes. Sobre a vista `serra-gaucha` (Gramado, RS) todo tile responde **404**, medido no
terminal e no navegador. O terreno liga, o `getTerrain()` não é nulo, o render-to-texture monta as
pilhas, os tiles ficam residentes, e o relevo é PLANO.

Duas consequências para quem lê a tabela. A comparação de RENDER entre `terreno` e
`terreno-hillshade-app` é vazia: o hillshade não tem o que sombrear e as capturas dos dois saem
byte a byte idênticas. A comparação de DEM continua valendo, e fica mais forte: os 42 tiles a mais
que a segunda fonte pede são 42 respostas 404 de cerca de 9 KB cada, e o custo é real mesmo sem um
pixel de relevo na tela.

#### Números medidos em 2026-09-05 (grade completa, 3 rodadas, a primeira descartada)

Vista `serra-gaucha`, base `carta-topografica`, `--populado` (56 feições persistidas),
`--selecionadas 0,50`, RTX A2000, janela visível. Cinquenta células por carga de CPU. Célula com
`mediana (min..max)`.

A pegada de DEM, que é o que o item 4 decide (igual nas duas cargas de CPU):

| variante | fontes `raster-dem` | dem tiles | dem ok | pedidos na montagem | na rotação | no zoom |
|---|---|---|---|---|---|---|
| `terreno` | 1 | 25 | 0 | 25 | 26 | 31,5 |
| `terreno-hillshade-app` | 2 | 67 | 0 | 67 | 63,5 | 44,5 |
| `terreno-dem-unico` | 1 | 25 | 0 | 25 | 26 | 32 |

O quadro, com 50 selecionadas. A segunda fonte de DEM custa 0,3 a 0,5 ms por quadro com a CPU
livre, e a coluna que se move junto é `_updateSources`, que é o laço que percorre toda fonte:

| CPU | cenário | render p50, duas fontes | uma fonte | `updSrc/q`, duas | uma |
|---|---|---|---|---|---|
| 1x | rotação | 9,9 (9,8..10) | 9,35 (9,3..9,4) | 4,46 (4,38..4,55) | 4,17 (4,16..4,17) |
| 1x | pan | 10,7 (10,6..10,8) | 10,2 | 5,14 (5,06..5,23) | 4,87 (4,83..4,91) |
| 1x | zoom | 9,6 (9,4..9,8) | 9,2 (9,1..9,3) | 4,46 (4,37..4,56) | 4,22 (4,17..4,28) |
| 4x | rotação | 52,85 (52,7..53) | 49,85 (47,9..51,8) | 22,98 | 21,66 (21,02..22,31) |
| 4x | zoom | 49,1 (48,9..49,3) | 52,2 (51,9..52,5) | 21,54 | 21,3 (20,94..21,67) |

Com a CPU livre as amplitudes não se sobrepõem em rotação, pan e zoom. Com `--cpu 4` o zoom
INVERTE, e por isso a conclusão do item 4 se apoia na contagem de DEM, que é inequívoca, e não no
quadro.

O agrupamento (item 2), com 50 selecionadas, é o oposto: quase não muda o quadro com a CPU livre e
muda muito com ela estrangulada, que é o esperado quando o que se corta é draw call.

| CPU | cenário | draw/q antes | depois | render p50 antes | depois | cadência p95 antes | depois |
|---|---|---|---|---|---|---|---|
| 1x | parado | 184 | 32 | 5,25 | 5,05 | 16,85 | 16,85 |
| 1x | zoom | 229 | 105 | 9,05 | 8,6 | 26,2 (25,2..27,2) | 27,65 (27,3..28) |
| 1x | pitch | 137,5 | 46 | 6,15 | 6,1 | 16,95 | 17 |
| 4x | pan | 191,5 | 50 | 46,45 (45,6..47,3) | 45 (44,5..45,5) | 74,1 (73,9..74,3) | 62,85 (61,6..64,1) |
| 4x | zoom | 393,5 | 239 | 49,25 (48,2..50,3) | 47,65 (47,5..47,8) | 201,9 (200,7..203,1) | 183,3 (175,5..191,1) |
| 4x | pitch | 150 | 55,5 | 28,8 (28,5..29,1) | 27,75 (27,4..28,1) | 65,1 (62,2..68) | 49,15 (46,7..51,6) |

Pilhas de render-to-texture: 9 para 1 nas duas cargas. Com zero selecionadas não há o que agrupar,
e a variante sai INVÁLIDA dizendo isso.

`terreno-camadas-agrupadas` e `terreno-quebra-pilha-topo` são **indistinguíveis nesta árvore**,
medidos na mesma sessão com 50 selecionadas (draw/quadro 33/64/41/103/46 contra 33/63/41/104/46,
uma pilha nos dois). Com uma base de UMA camada, e ela drapeável, o conjunto que a antiga manda
para o topo do estilo e o que a nova manda para o fim do bloco do app coincidem. Com a base
vetorial da `main` elas divergiriam, porque lá a base tem 38 camadas `symbol` próprias.

### O passe da caixa de seleção (`--selecionadas` e `--passes`)

O eixo das variantes acima descreve o ESTADO DO MAPA. Este descreve o custo de manter a caixa de
seleção na tela enquanto o usuário dá zoom, e ele é ortogonal ao primeiro: uma célula é
`(base, variante de estado, variante do passe, quantas selecionadas, cenário)`.

O sujeito é `frontend/src/js/tool_manager/managers/selection-highlight.manager.js`, que desde
2026-09-05 refaz as caixas POR QUADRO de zoom. As três variantes nascem de um REMENDO EM TEMPO DE
EXECUÇÃO no gerente vivo, nunca de código no app:

| `--passes` | o que troca | como se prova |
|---|---|---|
| `selecao-quadro` | nada: o app como está, com o passe e o handler embrulhados por contadores | os contadores mexem na chamada direta, o ouvinte segue em `zoom`, e a chave de cache colapsa |
| `selecao-exata` | `getCacheKey` sem a quantização (o zoom inteiro na chave) | dez zooms a 0,01 de distância dão DEZ chaves distintas, e não uma |
| `selecao-zoomend` | o ouvinte de `zoom` desligado e um `zoomend` que chama a passada uma vez | o ouvinte saiu de `zoom` e entrou em `zoomend`, e o gesto medido mostra duas passadas, não noventa |

Nada aqui repete uma constante do app, e isso é o que mantém a bancada honesta quando o app mudar:

- **O caminho até o gerente** sai do registro de controles, por uma ferramenta ANSIOSA
  (`getControl('AddPointControl').toolManager.uiManager._selectionHighlight`). `map_sig.js` não
  registra o `UIManager` nem o `ToolManager` por nome, e a ferramenta tardia devolveria um
  stand-in, que não tem `toolManager`.
- **O id da fonte da caixa** sai da fonte que o gerente ESCREVE numa passada forçada, e não de uma
  string escrita aqui. Duas fontes escritas na mesma passada reprovam, porque aí a descoberta não
  é unívoca.
- **O passo da quantização** sai de quantas chaves distintas dez zooms vizinhos produzem. Um
  `0,5` copiado para cá envelheceria sozinho, e o modo de falha seria aprovar a variante exata que
  não pegou.
- **O tipo de cada feição** sai de `properties.source`, que É o tipo singular do registro de
  tipos. Nenhuma lista de tipos vive na bancada.

A seleção segue o caminho do usuário, o mesmo da seleção por caixa
(`selection_tools/rectangle_selection_control.js`): `toggleFeatureSelection` por feição e um
`updateUI()` no fim.

**O tempo de JS do handler é o PRÓPRIO dele.** O `zoomend` chama a passada por dentro, e somar os
dois brutos contaria o passe duas vezes na coluna. A coluna `js sel ms` é o handler exclusivo mais
a passada.

**A regra de decisão foi escrita ANTES de rodar**, e a bancada a aplica linha a linha no
`resultado.md`: se com N selecionadas o p95 da cadência de rAF e o render p50 não saem da
AMPLITUDE medida com zero selecionadas na mesma variante, o `zoomend` fecha como "não compensa";
se saem, o conserto é baratear o passe, e o `zoomend` é último recurso. Ela recusa três formas de
mentir: sem a célula de zero a linha sai `SEM BASE` (e não "dentro"), a amplitude de uma amostra
só sai marcada como largura zero, e célula que a bancada invalidou não entra na base.

Duas armadilhas que a grade mostrou:

- **Com zero selecionadas a fonte da caixa É uma fonte GeoJSON vazia.** As variantes
  `terreno-vazias-escondidas` e `terreno-vazias-removidas` mexem justamente nessas, então a
  combinação delas com `--selecionadas 0` esconde ou remove a camada da própria caixa. A bancada
  relê a fonte DEPOIS de aplicar a variante e reprova o caso; para medir o passe, use `terreno`.
- **`--selecionadas` sem `--populado` não tem o que selecionar**, e a rodada sai inválida dizendo
  quantas feições selecionáveis o app tinha.

#### Números medidos em 2026-09-05 (grade completa, 3 rodadas, a primeira descartada)

Vista `serra-gaucha`, viewport 1600x900, janela visível, GPU NVIDIA RTX A2000 12GB, `npm run dev`,
app com assinatura `86c/70f/22v`, terreno e hillshade no demotiles do MapLibre, **hillshade
DESLIGADO** na configuração do servidor. `--variantes terreno --populado` (56 feições persistidas
de 59 criadas), cenário `zoom` (dois `easeTo` de um nível, 1,5 s cada).

CPU livre (`--cpu 1`):

| passe | sel | render p50 | interv p50 | interv p95 | draw/quadro | passadas | js sel ms | escr caixa |
|---|---|---|---|---|---|---|---|---|
| `selecao-quadro` | 0 | 5,2 | 16,7 | 18,25 | 60 | 0 | 0,25 | 0 |
| `selecao-quadro` | 50 | 9,05 (9..9,1) | 16,7 | 25,4 (25,2..25,6) | 227 | 89,5 | 19,9 | **4** |
| `selecao-exata` | 50 | 9,9 | 16,7 | 26,35 (26,1..26,6) | **459** | 88,5 | 26,25 | **88,5** |
| `selecao-zoomend` | 50 | 9,0 | 16,7 | 24,95 (24,3..25,6) | 218 | 2 | 0,75 | 2 |

Com a CPU estrangulada em 4x o desenho é o mesmo: `selecao-quadro` a 50 selecionadas dá render p50
52,75 (52,5..53) e cadência p95 207,3 (203,8..210,8); `selecao-zoomend`, 50,75 (49,1..52,4) e
197,4 (186,7..208,1). As duas amplitudes se sobrepõem nas duas métricas.

**Três leituras, e a terceira é a que muda o que se faz:**

1. **O `zoomend` não compensa.** Com 50 selecionadas, `selecao-quadro` e `selecao-zoomend` não se
   separam em render p50 nem em cadência p95, nas duas cargas de CPU: as amplitudes se
   sobrepõem. O que o `zoomend` de fato economiza são 19 ms de JavaScript espalhados por ~90
   quadros de um gesto de 3 s, isto é 0,22 ms por quadro contra um orçamento de 16,7 ms.
2. **A chave de cache QUANTIZADA fica, e agora por dois motivos.** Tirar a quantização faz cada
   quadro montar caixas novas, e a guarda de identidade de `updateSelectionHighlight` deixa de
   pegar: as escritas na fonte da caixa vão de **4 para 88,5 por gesto** e as draw calls por
   quadro DOBRAM (227 para 459). O cabeçalho do gerente dizia que a caixa exata não move a
   cadência; com terreno LIGADO ela move (p95 26,1..26,6 contra 25,2..25,6, sem sobreposição).
3. **O que custa não é o passe, é a seleção existir.** Selecionar 50 feições leva o mapa de 22
   para 39 camadas visíveis (as alças de edição e a própria caixa deixam de ser fonte vazia), o
   render p50 do gesto de 5,2 para 9,05 ms e as draw calls de 60 para 227. A hipótese de que as
   PILHAS do render-to-texture explicariam isso foi TESTADA com
   `--variantes terreno,terreno-quebra-pilha-topo --selecionadas 50` e ela explica pouco: as
   pilhas caem de 9 para 1 e as draw calls de 231 para 106, e o render p50 sai de 9,3 para 8,7
   (15% da diferença). O que dobra junto com a diferença é a fase `_updateSources` (2,06 para
   4,14 ms por quadro), que é a primeira metade do custo descrito no `fileoverview` de
   `frontend/src/js/layers/empty-source-visibility.js`. Isto está MEDIDO, não testado: quem for
   atrás precisa de uma variante que tire o `used` da fonte sem esvaziá-la.

### Cenários

Nesta ordem, cada um esperando o mapa assentar antes (`map.loaded()`, ou estado dos tiles estável
por 3 s; qual dos dois valeu fica registrado em `assentou`, junto com quantos tiles foram lidos e
quantos ficaram desconhecidos):

1. `parado`: 2 s de `triggerRepaint` a cada rAF.
2. `rotacao`: `easeTo` de bearing +90 em 3 s, easing linear.
3. `pan`: `easeTo` de center +0,02 grau de longitude em 3 s.
4. `zoom`: `easeTo` de zoom +1 em 1,5 s e a volta em 1,5 s.
5. `pitch`: `easeTo` de pitch 60 para 30 em 1,5 s e a volta. Pulado na variante `2d`.

### Como a bancada reprova a si mesma

1. **Renderer.** SwiftShader ou llvmpipe marca `relogio: INVALIDO (GPU emulada)`, e a marca entra
   no veredito de toda célula. As contagens continuam valendo.
2. **Aba visível.** `document.visibilityState` diferente de `visible` invalida a rodada.
3. **Cadência ociosa do rAF.** 60 quadros sem pedir repaint, com o mapa assentado. p95 acima de
   25 ms invalida a rodada. Com `--cpu` acima de 1 vira AVISO: o ocioso lento É a condição medida.
4. **App inteiro.** Todas as fontes que o app declara em `FEATURE_SOURCES`, mais a dupla
   (camadas, fontes) parada por 3 s. Lista de fontes vazia reprova.
5. **Identidade do módulo.** O mapa do registro tem de ser o `globalThis.__ebgeoMap`, E alguma
   ferramenta ansiosa tem de estar viva no `tool-registry` importado. Ver a divergência 11.
6. **Leitura do estado dos tiles.** Achar N tiles e não saber o estado de nenhum reprova.
7. **Prova por cenário.** Zero quadros invalida o cenário. Fonte ou camada que muda no meio do
   cenário invalida o cenário. Com terreno ligado, ausência de stamps E de pilhas invalida.
8. **Assinatura do app.** `camadas/fontes/camadas visíveis` por carga. Duas assinaturas diferentes
   significam que a árvore mudou embaixo da medida, e toda rodada sai INVÁLIDA com
   `APP MUDOU ENTRE AS CARGAS`.
9. **Conferência contra a referência.** Ver abaixo.
10. **O gerente da caixa de seleção existe.** Caminho que não chega ao gerente, ou objeto sem
    `updateSelectionHighlight`, `_handleZoomChange`, `getCacheKey` ou `selectionManager`, derruba o
    caso ANTES de medir.
11. **O remendo pegou.** Chamada direta a cada ponto remendado tem de mexer o contador; a chave de
    cache tem de mudar (ou não mudar) conforme a variante; o ouvinte tem de estar em `zoom` ou em
    `zoomend`, e não nos dois.
12. **A seleção está na FONTE.** N no estado E N caixas na fonte descoberta. Estado certo com a
    fonte vazia é o pior caso, porque a tela está vazia e o número bate.
13. **O gesto mostrou o comportamento prometido.** O passe por quadro que roda DUAS vezes em 92
    quadros está passando fome (foi defeito real nesta árvore); o `zoomend` que roda 47 vezes não
    desligou o ouvinte de `zoom`. E com zero selecionadas a passada não pode rodar, senão a linha
    de base não é a ausência do passe.
14. **A posição alvo do hillshade existe.** Base sem nenhuma cobertura drapeável não tem "logo
    acima da cobertura", e base cujo primeiro rótulo vem ANTES da última cobertura não tem posição
    que satisfaça as duas condições. Nos dois casos a variante sai INVÁLIDA em vez de escolher um
    índice qualquer.
15. **A variante de posição MOVEU alguma coisa.** `terreno-hillshade-baixo` cuja camada já estava
    no alvo, e `terreno-camadas-agrupadas` cujo bloco já estava agrupado, saem INVÁLIDAS com
    "não contrasta mais": duas linhas iguais com nomes diferentes são pior que uma linha a menos.
16. **A ordem é LIDA do mapa, nunca do retorno de quem moveu.** O agrupamento compara o bloco lido
    depois do remendo com o plano, camada a camada. Reordenar uma lista já ordenada move todas e
    não muda nada, então a contagem de `moveLayer` chamados não prova coisa alguma.
17. **Havia pilha a fundir.** Camada com `visibility: none` não entra em pilha de
    render-to-texture. Um agrupamento que só reordena camada escondida sai INVÁLIDO, porque a
    célula sairia igual à de `terreno` com outro nome. É o que acontece com `--selecionadas 0`
    nesta árvore: as 32 camadas quebra-pilha do app estão todas escondidas por fonte vazia.
18. **O leitor de DEM não está cego, e a cobertura do DEM não passa calada.** São duas perguntas
    diferentes, e juntá-las numa deixaria a segunda aprovada por omissão. Estilo sem fonte
    `raster-dem`, ou fonte de DEM sem tile RESIDENTE, é defeito da bancada e INVALIDA o caso.
    Tile residente que veio com ERRO é outra coisa: o servidor respondeu e a leitura funcionou, o
    que falta é dado, e isso vira `DEM SEM COBERTURA` no veredito de toda célula. A diferença
    importa porque a contagem de residentes APROVA um DEM que devolveu 404 inteiro: `getTerrain()`
    continua não nulo, o render-to-texture roda, as pilhas existem, e o relevo é PLANO. Só o
    ESTADO de cada tile separa os dois, e é por isso que a tabela tem `dem tiles` e `dem ok`.
    Na bancada INTEIRA, zero PEDIDO de tile de DEM em todas as cargas com terreno invalida o
    relógio, porque aí ou o prefixo de URL está errado ou o host não responde. Por carga isolada o
    zero é legítimo (o cache serve), e é por isso que o escopo dessa régua é a bancada, não o caso.
19. **Autoteste.** `node frontend/bench/autoteste.mjs`: 330 casos em 21 eixos.

### A tabela de referência está VAZIA, e isso é declarado

A tabela da `main` (2026-09-04) descreve OUTRO aplicativo: outra versão do MapLibre, outro conjunto
de camadas, outro servidor de tiles. Copiá-la produziria DIVERGENTE em toda linha, e a divergência
estaria certa pelo motivo errado. Enquanto a constante `REFERENCIA` estiver vazia,
`conferirReferencia` responde `NAO CONFERIDA` em voz alta, em vez de sair calada (o que se leria
como "nada divergiu"). A régua continua sendo exercitada: o autoteste passa uma tabela sintética.

Para preencher: rode duas vezes com a árvore parada, na vista `serra-gaucha`, janela visível e GPU
de verdade, e escreva o que as duas concordaram, com a data e a máquina aqui. Não edite os números
para a medida bater: eles existem para reprovar a medida nova.

### Números medidos em 2026-09-04 (FUMAÇA, uma rodada)

Vista `serra-gaucha`, viewport 1600x900, Chromium com janela visível, GPU NVIDIA RTX A2000 12GB
(ANGLE sobre Direct3D11), `npm run dev` com backend na 8080 e Vite na 3000, app com assinatura
`85c/70f/83v`, terreno e hillshade apontando o demotiles do MapLibre, **hillshade DESLIGADO** na
configuração do servidor. Uma rodada só, sem aquecimento descartado: isto é fumaça, não referência.

| variante | cenário | render p50 | pilhas | draw/quadro | stamps/quadro |
|---|---|---|---|---|---|
| `2d` | parado | 1,8 ms | - | 963 | 0 |
| `terreno` | parado | 19,9 ms | 16 | 1805 | 304 |
| `terreno` | rotacao | 28,1 ms | 16 | 1568 | 258 |
| `terreno-quebra-pilha-topo` | parado | 14,0 ms | 1 | 21 | 0 |
| `terreno-vazias-escondidas` | parado | 1,9 ms | 1 | 21 | 0 |
| `terreno-vazias-escondidas` | rotacao | 3,2 ms | 1 | 53 | 1 |
| `terreno-vazias-removidas` | rotacao | 2,7 ms | 1 | 53 | 1 |

Leitura: o achado da `main` se repete aqui, e com margem maior. Com terreno ligado o
render-to-texture forma 16 pilhas e o quadro parado custa 19,9 ms; esconder as camadas das fontes
GeoJSON vazias derruba as pilhas para 1, as draw calls de 1805 para 21 e o quadro parado para
1,9 ms. Ou seja, **as camadas das fontes vazias são elas mesmas as quebra-pilha**, e não uma carga
a mais sobre uma pilha já quebrada. Estes números descrevem UMA máquina, UM dia e UMA versão do
app, com terreno de demonstração e sem hillshade.

## Bancada de ferramentas (`ferramentas.mjs`)

Mede o custo de USAR uma ferramenta de desenho, não o custo do mapa parado.

### Ferramentas

O nome curto é o contrato da linha de comando. O resto sai do app, e `normalizarFerramenta()` cobra
que cada entrada diga controle, tipo, fonte, feedback, painel e como conclui.

| `--ferramenta` | controle | tipo no store e fonte do mapa | fonte de feedback | conclusão |
|---|---|---|---|---|
| `line` | `AddLineControl` | `lines` | `line-feedback` | botão direito depois de 3 cliques |
| `polygon` | `AddPolygonControl` | `polygons` | `polygon-feedback` | botão direito depois de 3 cliques |
| `boundary` | `AddBoundaryControl` | `boundarys` | `boundary-feedback` | botão direito depois de 3 cliques |
| `arrow` | `AddArrowControl` | `arrows` | `arrow-feedback` | botão direito depois de 3 cliques |
| `occupied_front` | `AddOccupiedFrontControl` | `occupied_fronts` | `occupied-front-feedback` | o SEGUNDO clique |
| `coordination_line` | `AddCoordinationLineControl` | `coordination_lines` | `coordination-line-feedback` | botão direito depois de 3 cliques |
| `los` | `AddLOSControl` | `los` | `los-feedback` | o SEGUNDO clique (exige terreno) |
| `visibility` | `AddVisibilityControl` | `visibility` | `visibility-feedback` | o SEGUNDO clique (exige terreno) |
| `brush` | `AddBrushControl` | `brushes` | `brush-feedback` | o `pointerup` do arrasto |

A CHAVE de cada uma no carregador tardio NÃO mora no descritor: ela é casada pelo nome da classe
contra a tabela `FERRAMENTAS` do próprio app, dentro da página. Escrita aqui, envelheceria sozinha,
e o modo de falha seria medir o stand-in.

### O que muda no gesto das três últimas

- **`los` e `visibility` são de dois cliques e EXIGEM terreno.** Sem terreno, `activate()` devolve
  falso e `handleMapClick` sai na primeira linha, então o cenário sai INVÁLIDO com `--terreno` na
  mensagem, em vez de medir uma ferramenta parada.
- **A análise não para na feição.** LOS e visibilidade derivam o trecho visível e o obstruído, que
  são OUTRAS feições, em `processed-los` e `processed-visibility`. O cenário `conclusao` cronometra
  as duas coisas à parte: `store ms` até a feição entrar no store, e `proc ms` até o resultado
  derivado entrar na fonte que a tela desenha.
- **O pincel desenha por ARRASTO.** Não há clique que vire vértice, e o `pointerup` já cria a
  feição. A prova do desenho troca o ponto colocado pelos pontos acumulados, que têm de ser um por
  evento de movimento mais o do `pointerdown`: um traço É a sequência de posições por onde o
  ponteiro passou, e ponto a menos é curva serrilhada.

### Cenários, e a prova de cada um

Nesta ordem, num contexto de navegador NOVO por rodada (o store persiste no IndexedDB do contexto,
e a rodada 2 acharia as feições da rodada 1 e mediria 2N com o rótulo de N):

1. **`desenho`**: ferramenta ativa, UM ponto colocado por clique real, e `k` eventos `mousemove`
   sintéticos por quadro durante 3 s. **Prova**: escrita na fonte de feedback maior que zero E um
   ponto colocado E a ferramenta `isActive` E o controle não sendo um stand-in.
2. **`zoom`**: `--feicoes N` criadas pelo caminho do próprio controle (`createFeature()`), depois
   `easeTo` de zoom +1 e a volta. **Prova**: o store tem o que já tinha MAIS N, e a fonte do mapa
   mostra ao menos isso. **Métrica principal**: as escritas na fonte principal POR GESTO, separadas
   por método. É ela que distingue a ferramenta que deriva o tamanho na GPU da que reenvia a
   coleção a cada quadro.
3. **`conclusao`**: os cliques do desenho e o gesto que fecha a feição, pelo caminho do usuário.
   **Prova**: a contagem do store subiu, os N cliques viraram vértice, a fonte do mapa RECEBEU
   escrita (feição gravada que não chega à fonte é tela vazia com store certo), o traço do pincel
   tinha ao menos 2 pontos, e a fonte processada cresceu quando a ferramenta declara uma.

O cronômetro da conclusão parte do PRÓPRIO evento do usuário, na fase de captura dentro da página.
Medi-lo do lado do Node somaria o tempo do canal do CDP à latência da ferramenta.

### Como rodar

```sh
node frontend/bench/ferramentas.mjs --ferramenta coordination_line --k 1,4 --feicoes 30 --rodadas 1
node frontend/bench/ferramentas.mjs --ferramenta boundary --feicoes 10 --rodadas 1
node frontend/bench/ferramentas.mjs --ferramenta brush --rodadas 1
node frontend/bench/ferramentas.mjs --ferramenta los --terreno --rodadas 1
node frontend/bench/ferramentas.mjs --ferramenta visibility --terreno --rodadas 1
```

| opção | padrão | o que faz |
|---|---|---|
| `--url` | `http://localhost:3000/` (ou `EBGEO_URL`) | endereço do app |
| `--ferramenta` | `coordination_line` | nome curto da tabela acima |
| `--k` | `1,4,8` | `mousemove` por quadro no cenário `desenho`, um caso por valor |
| `--feicoes` | 30 (los 15, visibility 8) | feições criadas antes do cenário `zoom` |
| `--terreno` | false | liga o terreno pelo botão do app; OBRIGATÓRIO em `los` e `visibility` |
| `--cpu` | 1 | estrangula a CPU pelo CDP |
| `--snapping` | false | liga `ui.snapping.enabled` antes de medir |
| `--rodadas` | 2 | a rodada 1 é aquecimento |
| `--saida` | `frontend/bench/saida/<data-hora>/` | pasta dos artefatos |
| `--largura` / `--altura` | 1600 / 900 | viewport |
| `--headless` | false | ver a advertência do relógio |

### Como a bancada reprova a si mesma

Os itens 1 a 6 e o 8 são os mesmos da bancada de terreno (renderer, aba visível, cadência, app
inteiro, identidade do módulo, leitura dos tiles, assinatura do app). Além deles:

7. **A ferramenta existe no app.** Controle ausente do registro, fonte principal ausente ou fonte
   de feedback ausente derrubam a rodada com o nome do que faltou, antes de qualquer medida.
8. **O controle não é um STAND-IN.** A carga tardia tem de ter terminado; um stand-in mediria zero
   com o nome da ferramenta.
9. **O descritor diz o que a bancada sabe medir.** `normalizarFerramenta()` roda na leitura da
   linha de comando e lança no descritor sem `conclusao`, com `modoDesenho`, `semeadura`, forma de
   ponto ou gesto de conclusão desconhecidos, ou sem controle, fonte, feedback ou painel.
10. **Ferramenta que exige terreno, medida sem terreno, é INVÁLIDA.**
11. **Desenho sem escrita de feedback é INVÁLIDO.** Escrita de OUTRA fonte não substitui: o alvo
    sai contado à parte justamente para o cenário inerte não passar pela soma do vizinho.
12. **Zoom sem feição é INVÁLIDO.**
13. **Conclusão sem store, ou sem escrita na fonte, é INVÁLIDA.**
14. **Autoteste.** `node frontend/bench/autoteste-ferramentas.mjs`: 232 casos em 12 eixos.

### Números medidos em 2026-09-04 (FUMAÇA, uma rodada)

Mesma máquina e mesmo stack da bancada de terreno. Sem terreno, sem snapping, CPU livre. App com
assinatura `85c/70f` nas duas cargas.

`node frontend/bench/ferramentas.mjs --ferramenta line --rodadas 1`

| cenário | k | quadros | render p50 | interv p95 | escritas alvo | setData | updData | escritas outras | lat p50 | lat n | perdidos | store ms | painel ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desenho | 1 | 181 | 4,1 | 17,1 | 180 | 180 | 0 | 180 | 16,3 | 13 | 166 | - | - |
| desenho | 4 | 181 | 4,0 | 17,0 | 181 | 181 | 0 | 181 | 16,9 | 3 | 177 | - | - |
| desenho | 8 | 181 | 3,9 | 17,0 | 181 | 181 | 0 | 181 | 16,7 | 8 | 172 | - | - |
| zoom | - | 182 | 4,5 | 16,9 | **0** | 0 | 0 | 90 | - | - | 0 | - | - |
| conclusao | - | 20 | 2,1 | 17,6 | 1 | 0 | **1** | 8 | 24,2 | 1 | 2 | 36,1 | 12,3 |

`node frontend/bench/ferramentas.mjs --ferramenta coordination_line --k 1,4 --feicoes 30 --rodadas 1`

| cenário | k | quadros | render p50 | interv p95 | escritas alvo | setData | updData | escritas outras | lat p50 | lat n | perdidos | store ms | painel ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desenho | 1 | 181 | 4,0 | 17,0 | 180 | 180 | 0 | 180 | 16,4 | 13 | 166 | - | - |
| desenho | 4 | 181 | 3,9 | 17,0 | 181 | 181 | 0 | 181 | 17,0 | 4 | 176 | - | - |
| zoom | - | 182 | 4,5 | 16,8 | **90** | 0 | **90** | 90 | - | - | 0 | - | - |
| conclusao | - | 20 | 2,4 | 18,1 | 1 | 0 | 1 | 10 | 21,8 | 1 | 3 | 38,0 | 13,1 |

**Leitura, e é para isto que a coluna existe.** O passe de zoom separa as duas ferramentas: a linha
comum manda ZERO escrita na fonte `lines` no gesto inteiro; a linha de coordenação manda **90**,
uma por quadro, cada uma reescrevendo as 30 feições (`coordination_lines: 0s/90u/2700f` no
`porFonte`). O relógio desta GPU não denuncia a diferença (4,5 ms nas duas), porque o custo do
reenvio está no worker e no re-tiling, não no `_render`. Na `main` essa ferramenta já manda UMA
escrita por gesto, com a largura virada expressão de camada e o passe de JavaScript rodando só em
`zoomend`; nesta branch essa divisão ainda não entrou.

**E as duas ferramentas medidas mostraram um terceiro escritor.** `escritas outras` é 90 nos dois
gestos de zoom, e o `porFonte` diz de quem: `brushes: 90s/0u/0f`. O `performZoomUpdate` do pincel
(`frontend/src/js/draw_tools/brush_tool/add_brush_control.js:499`) reescreve a coleção inteira uma
vez por quadro de zoom **mesmo quando ela está VAZIA**, e o pincel é uma das seis ferramentas
ansiosas, então isso roda para todo usuário que der um zoom, tenha ele desenhado um traço ou não.

## Armadilhas conhecidas

- **Aba oculta ou janela ocluída zera o rAF.** O Chromium desacelera ou para o
  `requestAnimationFrame` de aba de fundo. As duas bancadas sobem o navegador com
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` e
  `--disable-features=CalculateNativeWinOcclusion`, e ainda conferem `document.visibilityState`.
  Não minimize nem cubra a janela durante a medida.
- **`page.waitForFunction` com predicado async passa na hora.** A Promise devolvida já é um valor
  verdadeiro. Toda espera destas bancadas é um laço de `page.evaluate` do lado do Node.
- **`setData` que ninguém viu.** A latência do feedback só vale para a escrita que chegou a
  assentar. Leia `lat p50` sempre com `lat n` e `perdidos` ao lado: 13 medidas em 180 escritas
  descrevem os 13 quadros que assentaram, não a ferramenta.
- **A latência depende da FASE entre o preview e o `_render`.** Ferramenta que escreve o preview
  dentro do rAF, logo antes do quadro, quase nunca é vista com a fonte carregada. Não chame de
  regressão sem testar a causa.
- **`page.mouse.move` com `steps` não alcança o mouse de alta taxa.** O mousemove sintético
  despachado no canvas dentro de um laço de rAF alcança: 8 por quadro são cerca de 1.450 eventos
  em 3 s.
- **Ponteiro sintético não se captura.** `_onPointerDown` do pincel faz
  `setPointerCapture(e.pointerId)`, e capturar um ponteiro que nunca existiu lança `NotFoundError`
  DENTRO do ouvinte. Por isso o `pointerdown` e o `pointerup` do arrasto passam pelo mouse do
  Playwright, e só os `pointermove` do meio são sintéticos, com `buttons: 1`.
- **O ouvinte do cronômetro fica no CONTAINER do canvas, não no canvas.** A captura do ponteiro
  redireciona o `pointerup` para o container, e um ouvinte no canvas nunca veria o evento.
- **O piso de 3 px do pincel descarta o passo do laço de desenho.** No modo arrasto o passo angular
  é quatro vezes maior, acima do piso em toda a volta.
- **`painel ms` pode estar medindo um painel que já estava aberto.** O cenário `zoom` cria feições
  pelo `createFeature()` do controle, e vários controles selecionam a última criada. Leia
  `store ms` e `proc ms`, que partem do gesto.
- **`serialize()` de fonte migrada monta um vetor a cada chamada.** Na 5.18 ele faz
  `Array.from(this._data.updateable.values())`. É o único caminho correto para contar feições, mas
  não o chame por quadro sobre coleções grandes: o cronômetro da conclusão só o faz nas duas
  ferramentas de análise, cujas fontes processadas são pequenas.
- **`map.isSourceLoaded` de fonte inexistente DISPARA um evento de erro** no mapa (não lança), o
  que sujaria os erros da página. A bancada pergunta por `getSource` antes.
- **O servidor de desenvolvimento reinicia sozinho** quando alguém toca a configuração. A carga
  tem três tentativas, com 4 s entre elas.
- **Outra sessão editando a mesma árvore troca o app no meio da bancada.** A assinatura
  `camadas/fontes` pega a mudança de estilo, mas NÃO pega mudança de comportamento em JavaScript:
  rode com a árvore parada, e anote o `git status` junto do número.
- **As duas bancadas duplicam de propósito o carregador de módulos, a sonda de prontidão, o leitor
  de tiles e as réguas do instrumento.** Elas são executáveis independentes, e as funções que vão
  para dentro da página são serializadas por `fn.toString()`, então não podem fechar sobre escopo
  de módulo. Ao mexer numa, mexa na gêmea.
