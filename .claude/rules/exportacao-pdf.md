---
paths:
  - "frontend/src/js/import_export/pdf-*.js"
  - "frontend/src/js/vendor/gdal.js"
---

# Exportação em PDF

**São DUAS saídas de PDF, por DOIS motores, no mesmo painel**, e essa é a coisa que a aba
não anuncia. `isMosaic` (`rows * cols > 1`) decide qual roda:

- **Folha única: GDAL.** O mapa vira PNG e `gdal_translate` o converte com `-a_ullr` e
  `-a_srs`, então a saída é PDF **georreferenciado**. A biblioteca vem do npm
  (`gdal3.js` 2.8.1) por um ponto único que a carrega sob demanda,
  `frontend/src/js/vendor/gdal.js`; `frontend/public/vendors/gdal/` foi apagada em
  2026-09-14, e nem o `.wasm` nem o `.data` são mais estáticos de `public/`. O GDAL NÃO é
  pré-inicializado ao abrir a aba: `_preInitGdal` só roda a partir de `show()`, e o
  caminho normal da interface nunca chama `show()`, porque
  `sidebar/tabs/export.tab.js:_renderPdfContent` inlina o corpo dele. Medido por sonda de
  navegador em 2026-08-25: abrir a aba de PDF não dispara um pedido de GDAL. O ponto em que
  a biblioteca de fato carrega é o CLIQUE em Exportar, dentro de `handleExport`.

- **Mosaico R×C: jsPDF, sem GDAL nenhum.** `pdf-export.tab.js` faz `import()` dinâmico de
  `frontend/src/js/import_export/pdf-mosaic-export.js`, que monta folhas A4 full-bleed a
  partir de um único mapa oculto reusado por tile, todas no MESMO zoom e com os centros
  espaçados pela extensão Mercator exata de uma página (é o que faz a costura ser contínua).
  O documento sai como capa, visão geral e um par (mapa, verso) por tile, nessa ordem,
  para que cada par caia numa folha física duplex. A saída **não** é georreferenciada:
  jsPDF não faz GeoPDF.

Duas armadilhas do mosaico que não se deduzem lendo o vizinho: a sobreposição de costura
(`MOSAIC_OVERLAP_MM`) é DERIVADA, não escolhida, do dobro da soma entre a margem não
imprimível assumida e a folga de corte, e o valor anterior usava o orçamento errado e
deixava uma tira branca em toda costura; e a grade impressa no verso já sai ESPELHADA
(`mirrorAssemblyPosition`), porque o operador monta as folhas de face para baixo e vira o
bloco colado no fim.

Os arquivos: `pdf-export.tab.js` (painel, modal de progresso, caminho GDAL),
`pdf-cartographic-elements.js` (grades, legenda, escala, rosa dos ventos, e o
`composeLayout` que assa as margens na tela), `pdf-export.constants.js` (o que os dois
motores compartilham), e o trio do mosaico: `pdf-mosaic-export.js` (orquestração),
`pdf-mosaic-geometry.js` (matemática pura, node-testável) e `pdf-mosaic-pages.js`
(desenho vetorial de capa, visão geral e verso).

DPI 150/200/300; elementos cartográficos escalam por `uiScale = dpi / 200`.
