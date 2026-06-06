# Análise de Lacunas — Tutorial EBGeo

> Documento de auditoria comparando o tutorial do usuário (`public/docs/README.md`,
> renderizado via docsify em `public/docs/doc.html`) com as funcionalidades realmente
> implementadas no código-fonte (`src/js/`).
>
> Objetivo: mapear **o que falta documentar** para guiar a expansão do tutorial.
> Gerado por varredura completa do código em junho/2026.

---

## Resumo executivo

O tutorial atual promete **8 módulos** na introdução, mas o texto **termina no Módulo 5**
(e este já incompleto). Estima-se que o README cobre apenas uma fração da funcionalidade real.

**Lacunas estruturais imediatas (visíveis no próprio README):**

| Item | Situação |
| --- | --- |
| Módulo 6 — Painel inferior de coordenadas | **Prometido, ausente** |
| Módulo 7 — Uso do Street View 360 | **Prometido, ausente** |
| Módulo 8 — Ferramentas no mapeamento 3D | **Prometido, ausente** |
| Seção "Seta" (calços militares) | **Cabeçalho vazio, sem conteúdo** |
| Seção "Linha de Limite" | **Cabeçalho vazio, sem conteúdo** |
| Seção "Frente Ocupada" | **Cabeçalho vazio, sem conteúdo** |

**Funcionalidades inteiras ausentes do tutorial (nem cabeçalho existe):**
Briefings/Story Maps, Processamento geoespacial, ferramenta Setor, ferramenta Declinação
Magnética, seletor de mapa base, grade UTM/Lat-Long, snapping, medições efêmeras
(distância/área/ângulo), Azimute & Distância, LOS, Viewshed, tabela de atributos avançada,
importação CSV, exportação Garmin KMZ, exportação QAN, menu de contexto completo, e o
layout mobile.

---

## Tabela mestra de atalhos de teclado

Compilada de `src/js/keyboard/keyboard-shortcuts.js`. O README só documenta os marcados ✅.

| Tecla | Ferramenta/Ação | Documentado? |
| --- | --- | --- |
| `P` | Ponto | ✅ |
| `L` | Linha | ✅ |
| `A` | Área / Polígono | ✅ |
| `R` | Retângulo | ✅ |
| `C` | Círculo | ✅ |
| `E` | Elipse | ✅ |
| `T` | Texto | ✅ |
| `I` | Imagem | ✅ |
| `B` | Pincel | ✅ |
| `U` | **Setor** | ❌ |
| `S` | **Seta** | ❌ |
| `D` | **Linha de Limite** | ❌ |
| `F` | **Frente Ocupada** | ❌ |
| `M` | **Simbologia Militar** | ⚠️ (só imagem) |
| `K` | **Medida de Coordenação** | ⚠️ (só imagem) |
| `W` | **Declinação Magnética** | ❌ |
| `Z` | **Azimute & Distância** | ❌ |
| `O` | **Linha de Visada (LOS)** — requer terreno | ❌ |
| `V` | **Visibilidade (Viewshed)** — requer terreno | ❌ |
| `J` | **Medir Distância** (efêmera) | ❌ |
| `H` | **Medir Área** (efêmera) | ❌ |
| `X` | **Medir Ângulo** (efêmera) | ❌ |
| `G` | **Alternar Snapping** (magnetismo) | ❌ |
| `Q` | **Seleção por Retângulo** | ❌ |
| `N` | **Informação de Vetor (EDGV)** | ❌ |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / Refazer | ✅ |
| `Ctrl+C` / `Ctrl+V` | Copiar / Colar | ✅ |
| `Delete` / `Backspace` | Excluir seleção | ❌ |
| `Escape` | Desselecionar / desativar ferramenta | ❌ |

> **Atalhos do modo Apresentação de Briefing** (`briefing/services/keyboard-service-briefing.js`):
> `→`/`D` próximo slide, `←`/`A` slide anterior, `Home`/`End` primeiro/último, `F` tela cheia,
> `Esc` sair. Totalmente ausentes do tutorial.

---

## Módulo 1 — Ferramentas Gerais (ampliar)

Documentado: navegação por mouse, copiar/colar, desfazer/refazer.

**Faltando:**
- **Snapping (`G`)**: magnetismo a vértices/arestas/extremidades, com indicador visual.
  Funciona em todas as ferramentas de desenho e medição. (`src/js/snapping/`)
- **Seleção avançada**: multi-seleção (Shift adiciona, Ctrl remove), seleção por retângulo
  (`Q`), seleção de grupos. (`src/js/tool_manager/selection_manager.js`)
- **Copiar/colar detalhado**: cópia inclui imagens associadas; colagem com deslocamento
  automático; suporte a colar entre mapas distintos. (`tool_manager/clipboard_manager.js`)
- **Excluir (`Delete`/`Backspace`) e `Escape`** não estão documentados.
- **Edição de vértices** após criação (arrastar, inserir via midpoint, remover) — aplica-se
  a linhas, polígonos, elipses, setas, etc.
- **Seletor de mapa base** (canto inferior esquerdo): Carta Topográfica, OSM, Satélite,
  BDGEx, etc. (`src/js/base-layer-selector/`, `src/js/baselayers/`)

---

## Módulo 2 — Painel Lateral Esquerdo (ampliar)

Documentado: Mapas (Abrir/Importar/Salvar/Limpar, Notas, Salvar Posição, Duplicar,
Renomear, Puxar outros mapas, Deletar), Camadas (visibilidade/bloqueio/tabela/deletar),
Importar (GeoJSON/SHP/KML-KMZ/GPX), Exportar (imagem/PDF georreferenciado).

**Faltando:**
- **Aba "Briefings"** — não citada em lugar nenhum (ver Módulo dedicado abaixo).
  (`src/js/sidebar/tabs/briefings.tab.js`)
- **Travamento (lock) de mapa** e **reordenação por arrastar** de mapas e camadas.
- **Importação CSV/TSV/TXT**: detecção de separador e 6 formatos de coordenada
  (Lat/Lng, Lon/Lat, DMS, MGRS, UTM, Decimal), mapeamento de colunas para atributos.
  (`src/js/import_export/csv/`)
- **Importação por arrastar-e-soltar** arquivo no mapa. (`import_export/drag-drop.handler.js`)
- **Exportação Garmin KMZ**: seleção de bbox por 2 cliques, para GPS Garmin.
  (`import_export/garmin-kmz-export.js`)
- **Exportação QAN** (Quadro Auxiliar de Navegação) de linhas/polígonos.
  (`import_export/qan/qan-export.js`)
- **PDF avançado**: escala 1:1.000 a 1:1.000.000, DPI 150/200/300, orientação,
  elementos cartográficos (título, legenda, barra de escala, seta norte, grade Lat/Long
  e UTM) com pré-visualização no mapa. (`import_export/pdf-export.tab.js`,
  `pdf-cartographic-elements.js`)
- **Tabela de atributos avançada**: busca textual, filtros por tipo de feição (chips),
  "apenas selecionados", edição inline, menu de contexto de coluna, seleção em lote.
  (`src/js/attribute_table/`)
- **Camadas de catálogo na árvore**: Modelos 3D, Imagens 360°, camadas de análise
  aparecem integradas na árvore de camadas. (`features_tab/catalog-layers.component.js`)
- **Atributos customizados**: aba "Atributos" separada de "Estilo"; extração automática
  de propriedades do GeoJSON na importação; galeria de imagens por feição com compressão.
  (`src/js/user_data/`)

---

## Módulo 3 — Barra de Busca (ampliar)

Documentado: busca por nomes, modelos 3D, Street View, feições, coordenadas; Catálogo;
Tutorial; Informações; Atalhos.

**Faltando:**
- **Formatos de coordenada na busca**: Lat/Lng, Lon/Lat, DMS, MGRS, UTM, Decimal.
- **Resultados no painel lateral** com "Salvar como Feição" e marcador temporário.
- **Abas de resultado** (geral, coordenadas, API/Nominatim, feições, 3D, 360).
  (`src/js/search/`)
- **Catálogo**: filtros por categoria com contadores, busca interna, ativação de camada
  com zoom/pan automático. (`src/js/catalog/`)
- **Painel de Atalhos**: existe mas está incompleto vs. lista real (ver tabela mestra).

---

## Módulo 4 — Painel de Desenho (ampliar bastante)

Documentado: nome, descrição, fotos, estilos básicos, "Definir como padrão"; ponto, linha,
área, retângulo, círculo, elipse, texto, imagem, pincel (apenas atalhos e imagens).

**Faltando, recurso transversal (em várias ferramentas):**
- **Padrões de linha**: sólida, tracejada, pontilhada, traço-ponto (linha, polígono,
  círculo, elipse, retângulo, setor).
- **Preenchimento com hachura**: horizontal, vertical, diagonal 45°/315°, cruzada, onda —
  com espaçamento e espessura configuráveis (polígono, círculo, elipse, retângulo, setor).
- **Correção de zoom** (manter tamanho visual constante): ponto, texto, imagem, pincel,
  símbolos militares.
- **Etiquetas/labels** com abas "Símbolo/Etiqueta", texto, cor, contorno e correção de
  zoom própria (ponto, polígono, círculo, elipse, retângulo, setor).
- **Cálculo automático de área/comprimento** exibido no painel.

**Por ferramenta — lacunas específicas:**
- **Ponto**: modo **Marcador** (símbolos: círculo, quadrado, diamante, triângulo, estrela,
  cruz, traço) vs. modo **Etiqueta/Callout** (texto no mapa, botão "preencher com
  coordenadas", linha-guia). (`draw_tools/point_tool/point_attributes_panel.js`)
- **Linha**: edição de vértices; **mostrar medição** (comprimento); **perfil de terreno**
  (gráfico de elevação, requer terreno). (`draw_tools/line_tool/`)
- **Polígono/Retângulo/Círculo/Elipse/Setor**: método de criação (nº de cliques), hachura,
  raio/eixos numéricos, rotação (bearing), arredondamento de cantos (retângulo).
- **Texto**: criação por clique único, abas Texto/Caixa de Fundo, alinhamento, rotação.
- **Imagem**: upload + compressão automática (máx. 800×800, qualidade 70%), tamanho,
  rotação, opacidade. (`draw_tools/image_tool/`)
- **Pincel**: desenho à mão livre (clique+arrasto), largura, suporte a toque.
- **⚠️ Ferramenta SETOR (`U`)**: **totalmente ausente** do tutorial. Cria setor angular
  (centro + raio + abertura 1–359°, padrão 60°), útil para setores de fogo/visada.
  (`draw_tools/sector_tool/`)

### Calços Militares (Módulo 4 — seção crítica)

- **Simbologia Militar (`M`)** — ampliar: modal de configuração SIDC 2.0 (afiliação,
  conjunto, ícone, modificadores, escalão, status), galeria, abas Forma/Texto/Engajamento,
  entrada manual de SIDC, extensões brasileiras, cor, tamanho, rotação, correção de zoom.
  (`military_tools/military_symbol_tool/`)
- **Medida de Coordenação (`K`)** — ampliar: catálogo de 100+ pontos em 13 categorias
  (gerais, movimento/manobra, passagens, fogos, proteção/obstáculos/fortificação/minas/QBRN,
  logística classes I–X, controle aéreo/marítimo), seleção de escalão, modificadores de texto
  dinâmicos. (`military_tools/coordination_measure_tool/`)
- **Seta (`S`)** — **seção vazia**: criar por clique+arrasto, largura adaptativa ao zoom,
  razão da ponta, mostrar ponta, modo aeromóvel (padrão cruzado), mesclar/separar setas.
  (`military_tools/arrow_tool/`)
- **Linha de Limite (`D`)** — **seção vazia**: demarcação entre unidades; clique múltiplo;
  símbolos de escalão (romanos XXXXXX…I e círculos •••/••/•) repetidos ao longo do traçado;
  rótulos acima/abaixo. (`military_tools/boundary_tool/`)
- **Frente Ocupada (`F`)** — **seção vazia**: posição defensiva em "V"; 3 cliques (centro +
  2 braços curvados); cor/espessura/opacidade. (`military_tools/occupied_front_tool/`)
- **Declinação Magnética (`W`)** — **ausente**: diagrama de norte magnético vs. geográfico,
  ângulo configurável. (`military_tools/declination_tool/`)

---

## Módulo 5 — Painel Auxiliar Direito (ampliar)

Documentado: zoom +/−, tela cheia, ir para localização, orientar ao norte, Modelos 3D,
Imagens 360°, Terreno.

**Faltando:**
- **Terreno**: ao ativar, habilita leitura de **elevação em tempo real** e é **pré-requisito**
  para LOS e Viewshed. (`src/js/terrain/`)
- Distinção clara entre os toggles que apenas **mostram marcadores** (3D/360) e os que
  **abrem visualizadores** (ao clicar no marcador).

### Ferramentas de análise e medição (sem módulo no tutorial)

- **Linha de Visada / LOS (`O`)** — requer terreno: 2 cliques (observador→alvo), trecho
  visível (verde) vs. obstruído (vermelho), altura do observador/alvo, pontos de amostragem,
  perfil de elevação, recálculo ao mover. (`analysis_tools/los_tool/`)
- **Visibilidade / Viewshed (`V`)** — requer terreno: setor (centro + raio + direção),
  modal de progresso, parâmetros raio/abertura/alturas, handles (vermelho=raio, azul=abertura),
  recálculo automático. (`analysis_tools/visibility_tool/`)
- **Medições efêmeras** (não persistentes, com "Salvar como feição"):
  - Distância (`J`): multi-vértice, unidades m/km/NM/ft, rótulos por segmento + total.
  - Área (`H`): área + perímetro, unidades m²/ha/km².
  - Ângulo (`X`): 3 pontos, unidades graus/milésimos/grados.
  (`src/js/measurement_tool/`)
- **Azimute & Distância (`Z`)** — persistente (caderneta digital): ponto de referência,
  tabela de azimute+distância, declinação magnética automática (WMM) ou manual, modo
  Rota (polígono) vs. Ponto, unidades graus/milésimos, bússola. (`azimuth_distance_tool/`)

---

## Módulo 6 — Painel Inferior de Coordenadas (CRIAR)

`src/js/coordinates/mouse-coordinates.control.js`, `src/js/grid/`, `utilities/coordinate_converter.js`

- Exibição das coordenadas do mouse em tempo real + zoom atual + elevação (com terreno).
- **4 formatos** alternáveis: Lat/Long decimal, Lat/Long GMS (convenção L/O brasileira),
  UTM WGS84, MGRS.
- **Grade overlay** (Lat/Long ou UTM) em escalas 250k/100k/50k/25k, com toggle e zoom
  mínimo; estado persistido por mapa.

---

## Módulo 7 — Street View 360 (CRIAR)

`src/js/street_view_tool/` (viewer Three.js)

- Ativar marcadores 360° → clicar → preview → entrar na cena panorâmica.
- **Navegação**: mouse (arrasto = girar, Ctrl+arrasto = inclinar), teclado (setas, WASD,
  +/− zoom/FOV, R reset), clicar em marcadores próximos para "andar".
- **Marcadores/POI** dentro da cena: nome, descrição, coordenadas esféricas, estilo de
  marcador e etiqueta, fotos.
- **Orientação salva** automaticamente por foto; **mini-mapa** sincronizado; **screenshot**.

---

## Módulo 8 — Mapeamento 3D / Cesium (CRIAR)

`src/js/3d_models_viewer_tool/` (viewer Cesium)

- Ativar Modelos 3D → clicar em tileset → abrir viewer; navegação por mouse/teclado.
- **Marcador 3D**: ponto na superfície, propriedades (id, localização em vários formatos,
  estilo de marcador/etiqueta, fotos), "voar para".
- **Medição 3D**: distância e área sobre o modelo, com resultado e estilo.
- **Viewshed 3D**: cone de visão (ângulo horizontal/vertical, distância, altura do
  observador), áreas visíveis/bloqueadas.
- **Posição de câmera salva/restaurada**, **screenshot**, e **sincronização com o mapa 2D**
  (marcadores/medições/viewsheds aparecem nos dois).

---

## Funcionalidades transversais ausentes (sem módulo definido)

### Briefings / Story Maps (CRIAR — alta prioridade)
`src/js/briefing/`, `src/js/sidebar/tabs/briefings.tab.js`, `src/js/mode/`

- Editor de apresentações em slides; cada slide pode ser 2D, 3D ou 360.
- Captura automática da posição/câmera atual ao criar slide; editor de texto rico (Quill).
- Importar notas/slides; reordenar; transições; exportar briefing como PDF.
- Modo Apresentação em tela cheia com navegação por teclado (ver tabela de atalhos).
- Modos da aplicação: `NORMAL`, `BRIEFING_EDIT`, `BRIEFING_PRESENT`.

### Processamento Geoespacial (CRIAR)
`src/js/processing/algorithms/`

- **Buffer** (zona de influência, distância em metros).
- **Voronoi** (proximidade; pontos/centroides; bbox).
- **Convex Hull** (envoltória convexa).
- Saída sempre em polígono; entrada por seleção ou camada inteira; execução assíncrona.

### Menu de Contexto (clique-direito) — ampliar muito
`src/js/context-menu/context-menu.control.js`

Documentado apenas: copiar coordenadas, orientar ao norte. **Faltando** ~13 ações:
criar/combinar/desfazer grupo, combinar/dividir setas, cortar linha, exportar QAN, mover
para camada, mover para mapa, zoom para seleção, duplicar seleção. Em toque: long-press
(500 ms) abre o menu.

### Layout Mobile / Celular (CRIAR)
`src/js/phone/`

- Ativado em telas ≤480px (ou paisagem curta com toque).
- Bottom sheet, drawer esquerdo, FABs (bússola/zoom/camada base), editor de feição móvel,
  modal de camada base, ações de movimento por toque.

### Informação de Vetor / EDGV (`N`)
`src/js/vector_info/vector-info.control.js` — identificar feições do mapa base (EDGV);
menu de desambiguação quando há sobreposição; painel de propriedades.

---

## Recomendações de priorização

1. **Crítico** — preencher os 3 módulos prometidos e ausentes (6, 7, 8) e as 3 seções
   militares vazias (Seta, Linha de Limite, Frente Ocupada).
2. **Alto** — documentar Briefings, Processamento, Setor, medições efêmeras, LOS/Viewshed,
   Azimute & Distância, e completar o Painel de Atalhos.
3. **Médio** — recursos de estilo transversais (hachura, padrões de linha, correção de
   zoom, etiquetas), tabela de atributos avançada, importação CSV, exportações
   Garmin/QAN/PDF avançado, menu de contexto completo, seletor de base e grade.
4. **Complementar** — layout mobile, Declinação Magnética, Vetor/EDGV, modos da aplicação.

---

## Referências de arquivos (índice rápido)

- Tutorial: `public/docs/README.md` · wrapper `public/docs/doc.html`
- Atalhos: `src/js/keyboard/keyboard-shortcuts.js`
- Desenho: `src/js/draw_tools/*` · Militares: `src/js/military_tools/*`
- Análise: `src/js/analysis_tools/*` · Medição: `src/js/measurement_tool/*` ·
  Azimute: `src/js/azimuth_distance_tool/*` · Snapping: `src/js/snapping/*`
- Sidebar/IO: `src/js/sidebar/*`, `src/js/import_export/*`, `src/js/attribute_table/*`,
  `src/js/user_data/*`, `src/js/catalog/*`, `src/js/search/*`
- Coordenadas/Grade: `src/js/coordinates/*`, `src/js/grid/*`
- 360: `src/js/street_view_tool/*` · 3D: `src/js/3d_models_viewer_tool/*`
- Briefing: `src/js/briefing/*` · Processing: `src/js/processing/*`
- Contexto: `src/js/context-menu/*` · Mobile: `src/js/phone/*` · Base: `src/js/base-layer-selector/*`
</content>
