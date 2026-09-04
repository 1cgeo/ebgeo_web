# Ferramentas: a linha de coordenação, medida e consertada (2026-09-04)

O chefe achava as ferramentas lentas, a linha de coordenação em especial. Antes de mexer, a ferramenta foi medida por eixo no app real (`localhost:3007`, `main` com os consertos do terreno e o MapLibre 6.7.0, vista de Gramado, RTX A2000), com sondas Playwright que embrulham `map._render`, o `setData` de cada fonte GeoJSON, `queryRenderedFeatures` e `map.project`, e com o profiler do CDP apontando as funções do app. Cada número abaixo saiu dessas sondas; o que não foi medido está dito como não medido.

## O que a medida disse

**Em 2D, nesta máquina, a ferramenta não é lenta.** Feedback do desenho a 1,7 ms por quadro, um `setData` da fonte de feedback por quadro (o app já coalesce o mouse: 1.448 `mousemove` sintéticos em 3 s viraram 180 escritas), latência do traço atrás do mouse de 10 ms (p50). O `generate()` da geometria custa 0,2 ms com 2 vértices e 1,4 ms com 100, para os dois símbolos mais caros. Snapping ligado dispara 17 mil `map.project()` em 3 s e ainda assim não aparece no relógio. Concluir a linha (botão direito) leva 26 a 49 ms até o store e 27 a 89 ms até o painel, o mesmo que a linha simples (23 a 105 ms). O clique fica retido 250 ms antes de virar vértice, mas o preview já desenha o ponto pendente, e não se sente.

**O custo estrutural era o passe de zoom.** A cada quadro de um gesto de zoom o controle reenviava a coleção INTEIRA de linhas de coordenação: 91 `setData` num gesto de 3 s com 30 linhas, 9.100 feições reenviadas com 100 linhas. A causa: `calculatedLineWidth = lineWidth * 2^(zoom - createdAtZoom)` muda em todo quadro, e a camada lia essa propriedade por um `coalesce` puro. Doze ferramentas já derivam o tamanho na GPU (`layers/styles/zoom-expression.js`) e só rodam o passe de JavaScript em `zoomend`; a linha de coordenação e a linha de limite tinham ficado de fora.

**Terreno e máquina fraca multiplicam tudo.** Com terreno, o feedback vai de 1,7 para 6 ms por quadro e a latência para 14 ms (p95 25). Com CPU quatro vezes mais lenta em 2D, a latência do traço chega a p95 67 a 141 ms. Com CPU 4x e terreno, 34 ms por quadro e 111 ms de latência p50: o traço fica visivelmente atrás do mouse. É isso que "ferramenta lenta" significa numa máquina modesta com terreno ligado, e o passe de zoom por quadro é o que a ferramenta somava por cima.

**Hipóteses que caíram, medidas na página viva antes de escrever código:** mover as camadas de feedback para o topo das pilhas de render-to-texture não muda nada (já estão numa pilha própria); a política "só um `setData` em voo" não ajuda na CPU lenta, porque o gargalo é o quadro, não a fila do worker; e a estimativa em node de 5 a 30 ms por `generate()` era do instrumento (turf dentro de `vm.createContext`, sem JIT), 25 vezes pessimista contra o navegador.

## O que mudou

1. **Largura na GPU e passe em `zoomend`** (`coordination-line-zoom.model.js`, `add_coordination_line_control.js`). `buildCoordinationLineWidthExpression()` devolve um `interpolate` exponencial de base 2 sobre os 25 zooms inteiros que reproduz `computeCoordinationLineZoomSizes(...).calculatedLineWidth` para todo zoom, inclusive as regras estritas do modelo (largura só conta se positiva; âncora só conta se positiva; teto `MAX_LINE_WIDTH_PX` também nos ramos sem escala). O `zoom` por quadro faz só o que nenhuma expressão faz, regenerar a geometria das feições fixadas na tela, e não escreve a fonte quando não há nenhuma; o `zoomend` faz o passe completo uma vez por gesto. Teste `coordination-line-width-expression.test.js` compila a expressão com o avaliador do próprio MapLibre e compara com o modelo em 97 zooms por 14 casos; contra o `coalesce` antigo, 11 dos 21 reprovam. `zoom-pass-events.test.js` passa a listar a ferramenta entre as que têm os dois passes.
2. **Preview sem o timer de 8 ms e snapping uma vez por quadro** (mesmo controle). Os três `setTimeout(..., 8)` do preview só atrasavam o desenho (8 ms é menor que o quadro, então o timer sempre disparava antes do rAF seguinte). O `snapping.resolve()` e o indicador saíram do `mousemove` bruto para dentro do rAF, guardando do evento só `point` e `lngLat`; o indicador de antes do primeiro clique ganhou o mesmo gate. Medido com 4 `mousemove` por quadro e snapping ligado: `queryRenderedFeatures` de 1.440 para 909 e `map.project()` de 35.718 para 10.420 em 3 s.
3. **Geometria em O(G log V)** (`add_coordination_line_geometry.js`). `prepareSpine` calcula uma vez as distâncias acumuladas e os rumos de volta da espinha, e `alongPrepared`/`slicePrepared` acham o segmento por busca binária aplicando a MESMA aritmética de `turf.along` e `turf.lineSliceAlong`. Teste `coordination-line-geometry-prepared.test.js`: 4.000 comparações com o turf real para cada função, desvio zero, bit a bit; mais o `generate()` inteiro contra a implementação antiga em 30 combinações de símbolo e vértices. Ganho medido em node, 120 glifos: diamante 0,84 para 0,17 ms com 50 vértices, 5,2 para 0,26 ms com 400; concertina tripla 1,08 para 0,64 ms com 50.
4. **Snapping memoiza as 18 camadas** (`snapping.service.js`), por mapa, invalidando em `styledata`. Teste `snapping-available-layers.test.js`: 100 `resolve()` custam uma varredura em vez de 1.800.
5. **Atalho Y** para a ferramenta, a única letra livre das 26 (teclado, badge da barra e painel Atalhos), com `toolbar-shortcuts.test.js` cobrando que toda ferramenta da barra tenha atalho, que nenhuma letra se repita e que o painel documente todas; ele reprovava o estado anterior.

## Depois, na mesma bancada

| cenário | antes | depois |
|---|---|---|
| zoom, 30 linhas, 2D: `setData` por gesto | 91 (2.730 feições) | 1 |
| zoom, 100 linhas, 2D: `setData` por gesto | 91 (9.100 feições) | 1 |
| zoom, 30 linhas, terreno: quadro p50 | 6,5 ms | 5,0 ms |
| zoom, 100 linhas, terreno: quadro p50 | 6,9 ms | 5,2 ms |
| zoom, 30 linhas, CPU 4x, 2D: quadro p50 / p95 | 14,7 / 25,3 ms | 13,5 / 20,3 ms |
| zoom, 30 linhas, CPU 4x, terreno: quadro p50 / p95 | 40,8 / 86,9 ms | 27,6 / 47,8 ms |
| desenho, 4 mousemove por quadro, snapping ligado: `project()` em 3 s | 35.718 | 10.420 |

O quadro em 2D nesta GPU não muda (3 ms), porque o custo do reenvio nunca esteve no `_render` e sim no worker e no re-tiling; é na CPU lenta e com terreno que ele vira taxa de quadros. Suíte: 137 arquivos, 2.970 testes verdes.

## Ensinamentos para todas as ferramentas

- **Tamanho que depende do zoom vai para expressão na camada, nunca para `setData` por quadro.** A linha de limite (`boundary_tool`) tem hoje o mesmo defeito (92 `setData` por gesto com 10 limites, medido) e lê TRÊS fontes por passe; é o próximo alvo, com o mesmo desenho.
- **O feedback de desenho é um bloco copiado em seis ferramentas** (rAF com flag, o timer de 8 ms, uma fonte `*-feedback`, clique despachado pelo `SelectionManager`, botão direito por `contextmenu`). Vale um utilitário comum; o timer inútil e o snapping por evento bruto estão nas outras cinco.
- **Snapping por evento bruto custa em toda ferramenta que faz snap**; com a memoização das camadas o resto do custo é `map.project()` por vértice das feições candidatas, e a linha de coordenação é a mais densa (até 2.045 projeções por candidata).
- **Medida em node sem JIT mente por uma ordem de grandeza sobre o custo de turf.** Custo de função do app se mede no navegador, com o profiler do CDP, e o número em node vale só como razão entre casos.
- **"Ferramenta lenta" é um sintoma com eixos:** mouse de alta taxa, terreno, escala de feições, CPU. Medir cada eixo separado é o que separa a ferramenta (o passe de zoom) do resto (o terreno na máquina fraca).

## Os ensinamentos aplicados às demais ferramentas (mesmo dia, quatro agentes em arquivos disjuntos)

1. **Linha de limite: largura, tamanho do texto e traço do círculo na GPU, passe em `zoomend`** (`boundary-zoom.model.js`, `add_boundary_control.js`). As três grandezas em pixels viraram `interpolate` exponencial de base 2 que reproduz `computeBoundaryZoomSizes` (teste `boundary-zoom-expressions.test.js`: 97 zooms por 14 casos por 3 grandezas contra o avaliador do MapLibre; as expressões antigas reprovam 27 de 42 casos e 9 de 9 checagens de forma). O `calculatedSymbolSize` fica em JavaScript de propósito: ele é quilômetro que vira GEOMETRIA (escalão, círculos e rótulos), e nenhuma expressão reescreve coordenadas; por isso o `zoom` por quadro fica, restrito às fronteiras fixadas na tela, e a ferramenta entra em `ZOOM_AND_ZOOMEND`. Achado colateral: o fallback do `text-size` era 14 na camada e 35 no modelo; alinhado ao modelo. A guarda de arrasto dos passes lia `this.uiManager`, que a classe nunca atribui; passou a ler `this.selectionManager?.uiManager`. Medido pela bancada nova, 10 limites: `setData` por gesto de zoom de **91 para 1**.
2. **Utilitário comum de preview em nove ferramentas** (`tool_manager/helpers/preview-scheduler.js`): um gate de rAF que guarda o ÚLTIMO ponteiro e entrega uma vez por quadro, sem timer, com `raf`/`caf` injetáveis para teste. Adotado no desenho, no arrasto de alça e no pré-clique de linha, polígono, seta, frente ocupada, limite, linha de coordenação (inclusive o arrasto, que ainda resolvia snap no evento bruto), LOS, visibilidade e pincel (no pincel o acúmulo de pontos fica no evento, porque o traço É a sequência de posições; só a escrita do feedback passa pelo gate). Duas réguas guardam o padrão: `preview-timer-regua.test.js` lê os nove controles como texto e reprova `setTimeout` em método de preview e `resolve(` em handler de movimento; `preview-frame-gate-driven.test.js` constrói cada controle com mapa falso, dispara 5 a 10 `mousemove` no mesmo quadro e cobra UMA resolução de snap, UMA geometria e UM `setData` com a ÚLTIMA posição. Contra o estado anterior as duas reprovaram todas as nove (por exemplo, o limite fazia 7 resoluções por quadro no desenho e 6 no arrasto; a visibilidade 10).
3. **Bancada durável `bench/ferramentas.mjs`** (com `bench/autoteste-ferramentas.mjs`, 118 autotestes, e seção no README): `--ferramenta`, cenários `desenho` (k `mousemove` por quadro, latência do feedback com cobertura e perdidos), `zoom` (`setData` da fonte principal por gesto) e `conclusao` (ms até o store e até o painel), com prova por cenário e os mesmos vereditos de instrumento da bancada de terreno. Contexto novo do navegador por rodada, porque o store persiste no IndexedDB do contexto.

Depois, uma rodada por ferramenta, 10 feições, nesta GPU:

| ferramenta | desenho k=1: quadro p50 / `setData` feedback | desenho k=4: `setData` feedback | zoom: `setData` principal por gesto | conclusão: até o store |
|---|---|---|---|---|
| linha de limite | 1,8 ms / 180 | 181 | **1** (era 91) | 37 ms |
| linha de coordenação | 2,2 ms / 180 | 181 | 1 | 43 ms |
| linha | 2,0 ms / 180 | 181 | 0 (não tem passe) | 32 ms |
| polígono | 2,4 ms / 180 | 181 | 0 (não tem passe) | 32 ms |

Suíte: 141 arquivos, 3.120 testes verdes.

## O que fica

- LOS, visibilidade e pincel receberam o utilitário mas a bancada ainda não os mapeia (`--ferramenta` cobre as seis de desenho e militares); as réguas de teste os cobrem.
- Nove controles leem `this.uiManager && this.uiManager.isDragging` em `_forceUpdateMainSourceUnlocked`, um campo que nunca é atribuído: a guarda está morta e corrigi-la muda comportamento (passaria a pular a escrita durante arrasto), então ficou para decisão.
- Um arrasto de alça que nasce e morre dentro do mesmo quadro não commita (a posição só é escrita no quadro); herdado do modelo e igual nas nove.
- O clique retido 250 ms (só limite e linha de coordenação): o preview esconde, mas o botão de concluir em toque atualiza tarde.
- `updateFeaturesProperty` e irmãos ainda leem a fonte por `getData()` a cada evento de slider do painel; no 6.7 o `getData` resolve sem round trip, então o custo é o `generate()` por feição selecionada por evento.
