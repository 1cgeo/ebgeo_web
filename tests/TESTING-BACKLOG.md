# TESTING-BACKLOG.md — EBGeo Web (Lógica Pura)

## Status

**Lote 1 — CONCLUÍDO** (9 suítes, +491 testes, 10 bugs corrigidos). Suíte total: 1336 testes, lint limpo.
Suítes criadas: `measurement-geometry`, `circle-geometry`, `polygon-geometry`, `line-geometry`,
`csv-import`, `state-manager`, `military-symbol-generator`, `zoom-correction-helpers`, `ellipse-geometry`.
Bugs corrigidos (classe "validate aceita NaN/Infinity" + outros): circle/line/polygon/ellipse `validate`
(rejeitam não-finito), polygon `insertVertexAtIndex` (bounds), `generateArcCoordinates` (numPoints=0→NaN),
csv `_parseNumber` (vírgula), line-split `canSplitLine` (bloqueado string), mil `validateSIDC`.
~25 comportamentos ambíguos foram **fixados por teste mas NÃO alterados** (ver `documentedOnly` — candidatos a decisão futura, ex.: `state_manager` escopo `mouse.*` largo, formatadores emitindo `NaN`).

## Sumário Executivo

- **Candidatos brutos coletados:** 375 símbolos em 40 domínios (41 agentes).
- **Após deduplicação e remoção do já-coberto:** **~118 suítes-alvo** únicas.
  - **P1 (risco alto × coupling `pure`/`turf`/`stubbable`):** **52**
  - **P2 (risco médio OU coupling `mixed` que exige extração):** **44**
  - **P3 (baixo/cosmético):** **22**
- **Fase 2 (precisa jsdom/canvas/MapLibre):** ~30 itens listados como "não recomendar agora".
- **Estimativa de esforço P1+P2:** ~96 suítes (≈ 55 S, 33 M, 8 L).

### Padrão de teste (já provado no repo)
`tests/unit/sector-geometry.test.js` é o template: `vi.mock('@tools', () => ({ BaseGeometry: class { constructor(p={}){this.properties=p;} } }))` + dynamic import. Para turf (global via script tag, **não** npm): `globalThis.turf = {...}` em `beforeAll` / `delete` em `afterAll` (ver `tests/unit/azimuth-distance-geometry.test.js`). Ambiente `node`, sem jsdom; `mgrs`/`proj4` são deps npm reais e rodam direto.

### Ordem de execução sugerida (Top 10 — comece aqui)

| # | Alvo | Domínio | Por quê (ROI) |
|---|------|---------|---------------|
| 1 | `measurement-geometry.js` 5 formatadores (`formatDistanceAuto`/`formatAreaAuto`/`formatAngle`/`formatDistance`/`formatArea`) | measurement | Puro, zero deps, fronteiras 1000m/10000m²/1e6m², fatores mil/gon/NM/ft. Maior ROI absoluto. |
| 2 | `add_circle_geometry.validate` + `generateCircleGeometry` | draw-circle | Bug real: `validate` aceita NaN/Infinity radius; singularidade polar cosLat→0. |
| 3 | `add_polygon_geometry.js` (validate, generate/isPolygonClosed, perimeter, applyOffset, midpoint) | draw-polygon | Núcleo puro grande; bugs documentados (Infinity, antimeridiano, midpoint wrap). |
| 4 | `csv-coordinate-converter.convertRowToLatLng` (+ `_parseUTMZone`/`_parseSingleDMS`) | ie-csv | Hemisférios PT-BR (O/L), banda MGRS, bug `_parseNumber` replace(',') só 1ª vírgula. |
| 5 | `state_manager.js` (set/get round-trip, `_pathMatches`, batchUpdate, mútua exclusão sidebar/painel) | state | 1102 linhas puras, zero teste, invariantes fortes. |
| 6 | `add_line_geometry.js` (validate, normalize, updateFromHandle, createLineStringGeometry, validateMinimumDistances) | draw-line | Corpo puro grande e limpo; bug Infinity em validate. |
| 7 | `military_symbol_generator` (buildSIDC/parseSIDC round-trip, validateSIDC) | mil-symbol | String/regex puro, round-trip property-based, separado do já-coberto SIDC ext. |
| 8 | `zoom-correction.helpers.js` (3 fns) — compartilhado por point/text/image/military | toolmgr | Duplicado 4×; bug NaN (`?? Infinity` não protege). Mata duplicação. |
| 9 | `add_circle_geometry` restantes + `add_ellipse_geometry.validate`/`getBoundingBox` | draw-circle/ellipse | Mesmo padrão, mesmo bug NaN em validate, singularidade polar. |
| 10 | `parseCSV`/`detectSeparator`/`csvToGeoJSON` | ie-csv | RFC-4180 quoting, round-trip property, ordem [lng,lat], off-by-one nº linha. |

---

## P1 — Risco Alto × Coupling Pure/Turf (ALTO ROI — COMECE AQUI)

### Domínio: measurement
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `measurement_tool/measurement-geometry.js` | `formatDistanceAuto` | alto | Fronteira `>=1000` exata; 999.999→'1000.0 m' (toFixed); NaN/Infinity sem guarda | 999→'999.0 m', 1000→'1.00 km'; sufixo `m` iff <1000 | sim | S |
| idem | `formatAreaAuto` | alto | Fronteiras 10000 (ha) e 1e6 (km²); km² vence ha (top-down); char ² U+00B2 | 9999→m², 10000→'1.00 ha', 1e6→'1.000 km²' | sim | S |
| idem | `formatAngle` | alto | mil 6400/360, gon 400/360, ° sem espaço antes do sufixo; 1°→18mil arredonda | 360→'6400mil', 90gon→'100.00gon' | sim | S |
| idem | `calculateAngle` | alto | Wrap `+360` em diff negativo; ângulo dirigido vs interior; p1==p3→0 | stub turf.bearing; b1=90,b2=0→270; soma(a,b)=360 | sim | M |
| idem | `generateArcCoordinates` | médio | Retorna numPoints+1; numPoints=0→NaN; wrap sweep | stub turf.destination; len===numPoints+1 | sim | M |

### Domínio: draw-circle
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/circle_tool/add_circle_geometry.js` | `generateCircleGeometry` | alto | radius=0 degenera; cosLat→0 nos polos→Infinity; sem wrap antimeridiano; 65 pts anel fechado; modelo 111320 vs haversine | center[0,0] r1000 ponto leste; ratio leste/norte=1/cos(lat); polo→lng não-finito | sim | M |
| idem | `validate` | alto | **BUG: NaN/Infinity radius passam** (`NaN<10`/`Inf<10`=false); r=10 inclusivo; center `['a','b']` aceito | validate([0,0],NaN)→true (fixar+flag); 9.99→false | não | S |
| idem | `getBoundingBox` | médio | Simétrico ao centro; leste/oeste escala 1/cosLat; polo→não-finito | bbox(0,0,1000) simétrico; lat60 lng-span 2× | sim | M |
| idem | `updateFromHandle`/`calculatePreview` | médio | newRadius<10→null; mismatch haversine vs flat 111320 | dist 0→null; radius≈haversine com tolerância | sim | M |

### Domínio: draw-polygon
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/polygon_tool/add_polygon_geometry.js` | `validate` | alto | **Infinity aceito** (`!isNaN(Inf)`); <3 pts→false; coord string→false | validate Infinity→true (fixar/flag) | não | S |
| idem | `createPolygonGeometry`/`generate`/`isPolygonClosed` | alto | Auto-fecha; `===` estrito p/ fechamento→float quase-igual reabre; sem mutar input | gera 4º pt = 1º; já-fechado não duplica | sim | S |
| idem | `updateFromHandle` | alto | **midpoint `(i+1)%length` no último segmento insere no índice 0** (front); legacy strings; <MIN_POINTS→null | inserção último segmento na posição 0 (flag bug) | não | M |
| idem | `validateMinimumDistances`/`isPointTooClose` | alto | Circular (last→first); `isPointTooClose` só compara último pt; fronteira 1m | segmento de fechamento curto→false | não | M |
| idem | `removeVertexAtIndex`/`insertVertexAtIndex` | alto | remove<MIN_POINTS→null; **insert sem validação de bounds** (splice negativo/clamp) | remove p/ <3→null; insert(-1) splice-from-end | não | M |
| idem | `calculatePerimeter` | médio | Haversine puro (inclui fechamento); inválido→0; independente de winding | reverso==original; >= maior aresta | sim | S |

### Domínio: draw-line
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/line_tool/add_line_geometry.js` | `validate` | alto | **Infinity aceito**; coord string→false; 3D permitido | [[0,0],[Inf,1]]→true (flag) | sim | S |
| idem | `normalizeBaseCoordinates` | alto | JSON malformado→null; `'5'`/`'{}'`→null; `'[]'`→[] | round-trip JSON; `'[[0,0'`→null | sim | S |
| idem | `updateFromHandle` | alto | vertex out-of-range no-op; midpoint insert; legacy `vertex-N`; sub-1m→null | `midpoint-9` fora de range→inalterado | não | M |
| idem | `removeVertexAtIndex` | alto | <2 pts→null; não muta input; idx 0/last | remove de linha 2-pt→null | não | S |
| idem | `createLineStringGeometry` | médio | inválido→throw exato; coordinates é cópia (spread) | throw msg exata; output.coords !== input | não | S |
| `line_tool/line-split.js` | `canSplitLine` | alto | null→false; source≠'line'; bloqueado `'true'` string não bloqueia (`===true`) | bloqueado:'true'→canSplit:true (documenta gap) | não | S |
| `line_tool/line_profile.js` | `getTotalElevationGain`/`Loss` | médio | Descida→ganho 0; Math.abs perda≥0; NaN propaga; identidade ganho-perda=Δnet | gain-loss===last-first (property) | sim | S |
| idem | `getElevationRange` | médio | Vazio→{0,0} hard-coded (não derivado); all-negative; primeiro NaN persiste | all-negative→min/max negativos | sim | S |
| idem | `getMaxSlope`/`getAverageSlope` | médio | Vazio→0 (evita -Infinity); abs-fold; divide por N (não N-1) | [3,-45,10]→45; abs-fold | não | S |

### Domínio: draw-brush
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/brush_tool/add_brush_geometry.js` | `simplifyLine` | alto | <=2 pts identidade; **Reumann-Witkam** (âncora em vizinhos originais, não último mantido)→curva suave colapsa; NaN dropa silenciosamente | linha reta→[first,last]; subsequência; monotônico em tolerância | sim | M |
| idem | `calculatePointLineDistance` | alto | Segmento degenerado lenSq=0; clamp t∈[0,1]; sem wrap antimeridiano | foot perpendicular; param<0→start; >=0 e finito | sim | M |
| idem | `validate` | médio | **Infinity aceito**; <2→false; string coords→false | [[0,0],[Inf,1]]→true (flag) | sim | S |
| idem | `getBoundingBox` | médio | Spread `Math.min(...lngs)` estoura pilha em arrays grandes; sem wrap | stress 200k pts; todo pt dentro do bbox | sim | S |
| idem | `applyOffset` | médio | Inválido→input inalterado; dropa componente z; round-trip | round-trip +d/-d; z perdido | sim | S |

### Domínio: draw-text
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/text_tool/add_text_geometry.js` | `calculateRotationFromHandle` | alto | **Wrap `>=360` roda ANTES de Math.round→Math.round pode reintroduzir 360**; bearing -90→0 | stub turf.bearing; intervalo [0,360]; round-trip | sim | M |
| idem | `calculateZoomAdjustedSize` | médio | diff=0→base; clamp 255; NaN não protegido; baseSize 0→0 | (16,10,11)→32; clamp 255; NaN→NaN | sim | S |
| `tool_manager/managers/selection-highlight.manager.js` | `calculateExpandedDimensions` | alto | rot=0 early-return exato; 90→swap; 45→(w+h)/√2; ±r simétrico; 360 não early | (10,20,90)≈{20,10}; bbox nunca encolhe | sim | M |

### Domínio: draw-image
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/image_tool/add_image_geometry.js` | `calculateZoomAdjustedSize` | alto | Clamp 10 (não 255 como text!); 2^-Inf→0; NaN; base>10 clampa mesmo diff 0 | (1,15,16)→2; (1,0,20)→10; <=10 sempre | sim | S |

### Domínio: draw-point
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/point_tool/add_point_geometry.js` | `calculateSelectionBoxGeometry` | alto | **BUG: callsite `createPointAtCoordinates` passa 4 args (5 esperados)→effectiveZoom=null**; cosLat polos; anel fechado 5 pts | fixar geometria com assinatura 5-arg; anel[0]===anel[4] | sim | M |
| `tool_manager/helpers/label-tab.helpers.js` | `computeShapeCentroid` | médio | Anel fechado exclui vértice de fechamento; <3→null; antimeridiano errado; holes ignorados | quadrado fechado→[1,1]; centroid dentro do anel | sim | S |

### Domínio: mil-symbol
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_symbol_generator.js` | `buildSIDC` | alto | `{}`→30-dígitos default + tail `'0760000000'`; `mainIconExtension:0` ativa ext; `specialModifier:'abc'`→NaN p/ encode | buildSIDC({}) string exata len 30; isCommand→ext | sim | M |
| idem | `parseSIDC` (+round-trip) | alto | 20 vs 30 dígitos; slices exatos; inválido→throw; whitespace inconsistente validate vs parse | round-trip buildSIDC(parseSIDC(x))===x | sim | M |
| idem | `validateSIDC` | médio | null→msg; whitespace stripado; len 20/30 ok; `\d` rejeita dígitos Árabe/full-width | len 19→false; Árabe→inválido | não | S |
| `brazilian_svg_postprocessing.js` | `hexToRgb` (+`applyBrazilianModifications`) | alto | **3-dígitos `#fff`→`rgb(255,NaN,NaN)`**; lowercase; sem `#` | `#fff`→NaN (flag bug); 4 cores engagement substituídas | não | M |
| `engagement-bar.section.js` | `encode`/`decode` (extrair) | alto | `'STAGE-WEAPON'`; `R:` prefix; desambiguação stage-vs-weapon; round-trip com valores contendo `<` | extrair pure; round-trip stage×weapon×remote | sim | M |

### Domínio: mil-arrow
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_tools/arrow_tool/add_arrow_geometry.js` | `normalizeBaseCoordinates` | alto | JSON malformado→[]; `'null'`/`'42'`→retorna null/42 (shape ruim); array passa por ref | round-trip; `'42'`→documenta bug | sim | S |
| idem | `removeVertexAtIndex` | alto | <2→null; out-of-range→null; não muta | remove p/ 1 pt→null; input intacto | sim | S |
| idem | `validate` | médio | <2→false; haversine real; fronteira 10m estrito `<`; string normalize | exatamente 10m→documentar | não | S |
| `arrow_tool/arrow-merge.js` | `extractBranches` | alto | **width=0/false/airmobilePosition=0 (falsy-mas-definido) DEVEM ser copiados**; baseCoordinates deep-copy | width:0 preservado; mutação isolada | não | M |
| idem | `canMergeArrows`/`canSplitArrows` | médio | <2→false; source≠arrow; layerId ausente→'default' bucket; isMerged+branches | 2 arrows sem layerId→mergeable | não | S |
| idem | `_applyWidthFromHandle` (extrair sideSign) | alto | Cross-product esquerda(>0)/direita; colinear `>0` estrito→não inverte | extrair `sideSign(a,b,p)`; esquerda→>0 | sim | M |

### Domínio: mil-boundary
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_tools/boundary_tool/add_boundary_geometry.js` | `normalizeBaseCoordinates` | alto | null→null; JSON→array; **all-or-nothing** (1 NaN rejeita tudo, diverge de validate); `'[]'`→[] | round-trip; um NaN→null | sim | S |
| idem | `removeVertexAtIndex` | alto | <0/>=len→null; <2→null; não muta | remove p/ <2→null; imutabilidade | sim | S |
| idem | `getBoundingBox` | médio | Vazio→[0,0,0,0]; all-NaN filtrado; antimeridiano naive | antimeridiano→spans globo (documentar) | sim | S |
| idem | `generateBoundaryGeometry`/`createEchelonSymbol`/`updateFromHandle` | alto | Fallback LineString; **`updateFromHandle` midpoint usa `<=` (vertex usa `<`)→off-by-one**; clamps | stub turf; #linhas=2·X+I, #polys=o; `<=` append | sim/não | M |
| idem | `generateBoundaryTexts` | médio | **`text_distance_ratio===0` cai p/ 0.9** (falsy-zero); rotação seam 0/180 | ratio 0→fallback 0.9 (flag) | não | M |

### Domínio: mil-occupied
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `occupied_front_tool/add_occupied_front_geometry.js` | `createOccupiedFrontGeometry`/`createRay` | alto | 3 pts→MultiLineString 10 segmentos; ratios 60/10/10; turn ±225, head ±150; dist<1→[] | coords.length===10; arm omitido se p2==p1 | sim | M |
| idem | `calculateBearing` (local, distinto de utils) | médio | Norte→0, leste→90; normalizado [0,360); **antimeridiano NÃO tratado** (bug) | norte≈0; sempre [0,360); round-trip destination | sim | S |
| idem | `updateFromHandle`/`calculatePreview` | alto | **p3 NÃO validado por distância** (pode colapsar em p1); **calculatePreview sem allowlist de handleType**; imutabilidade | p3 anyPos sucesso (flag); handleType bogus→geometria | não | M |

### Domínio: mil-coordmeasure
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `coordination_measure_generator.js` | `hexToRgb` | alto | `/i`; sem `#`; 3-dígito→null; 8-dígito→null; `#000000`/`#FFFFFF` | `#FFF`→null; `''`→null | sim | S |
| idem | `applyCustomColor` | alto | `'none'` só fill; hex válido fill+stroke (assimétrico); hex inválido→no-op silencioso | none preserva stroke branco; inválido inalterado | não | S |
| idem | `extractDimensions` | alto | Sem viewBox→default {0,0,40,40}; **espaço inicial→token vazio→fallback**; negativos | `" 0 0 40 40"`→default (documenta) | não | M |
| idem | `calculateDynamicViewBox` | alto | Anchor start/end/middle; **valor 0 conta** (≠ ''); MARGIN 5; floor/ceil inteiros | numero===0 expande; ''não | sim | M |
| idem | `validate` | alto | pointCode desconhecido→early; supply/echelon/concentração | ECHELON_16 {}→2 erros | não | M |
| `add_coordination_measure_geometry.js` | `calculateZoomAdjustedSize` | alto | diff=0→base; clamp 10; 2^-n; base 0→0 | (2,10,11)→4; (5,0,20)→10 | sim | S |
| `coordination_points_catalog.js` | invariantes catálogo + `getTextFieldsConfig` | médio | ECHELON_/SUPPLY_ gerados; code===key; svg string | cada code→Array; counts batem | sim | M |

### Domínio: analysis (los + visibility)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `visibility_tool/add_visibility_geometry.js` | `calculateBearing`/`pointAtBearing` (cópias próprias) | alto | Norte/leste/sul/oeste; [0,360); radius 0→center; cosLat polo; antimeridiano | round-trip bearing/destination; norte=0 | sim | S |
| idem | `validate` | médio | **NaN radius/aperture passam** (comparações NaN false); aperture 1/359 inclusivo | validate([0,0],NaN,60)→true deveria ser false (flag) | não | S |
| idem | `calculateDistanceStep` | alto | Múltiplo de 30 e >=30; radius pequeno→30; aperture guard | result%30===0 sempre | sim | S |
| idem | `updateFromHandle` | alto | radius<10→null; aperture wrap +360 e espelho; clamp [1,359] | aperture clamp extremos; bogus→null | não | M |
| idem | `generateProcessedFeatures` | alto | non-MultiPolygon→[]; **cellData[index] assume alinhamento**→mismatch throw | cellData curto→throw (documentar invariante) | não | M |
| `visibility_tool` | `calculateViewshed` (extrair `classifyRay`) | alto | FOCO: classificação max-angle; barreira terrain-only vs visível terrain+target; primeiro pt sempre visível; `>` estrito | extrair pure; ridge crescente→[v,v,obstruído] | não | M |
| `los_tool/add_los_geometry.js` | `validate` | médio | **Infinity aceito**; len≠2→false; 3D ok | [[Inf,0],[1,1]]→true (flag) | não | S |
| idem | `calculateLOS` (extrair `detectObstruction`) | alto | FOCO: primeiro cruzamento terrain>LOS; sem obstrução→null; `>` estrito; visível+obstruído===total | extrair pure; soma===totalLength (invariante) | sim | M |
| idem | `calculateProfile` (extrair `computeProfileFromElevations`) | alto | FOCO: slope %; primeiro herda segundo; deltaDist=0 guard; interp losElevation | extrair pure; flat→slope 0; endpoints exatos | não | M |

### Domínio: ie-csv
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `csv/csv-coordinate-converter.js` | `convertRowToLatLng` (+`_parseUTMZone`/`_parseSingleDMS`) | alto | Override BR 'S'=Sul (vs banda real); bandas inválidas I/O; **`_parseNumber` replace(',') só 1ª→`'1,234,5'`→1.234**; minutos/segundos>=60→null; O/L PT-BR | `'23K'`→Sul; min=60→null; sinal vs direção (Math.abs vence) | sim | M |
| `csv/csv-parser.js` | `parseCSV` | alto | Quoted-separator; `""` escape; newline em quotes; CRLF/LF/CR; linhas ragged; headers dup | quoted comma; round-trip simples | sim | M |
| idem | `detectSeparator` | médio | Vazio→','; dentro de quotes não conta; tie→',' (primeiro); consistência min-count | `;`→';'; `\t`→'\t' | sim/não | S |
| `csv/csv-to-geojson.js` | `csvToGeoJSON` | alto | 0 linhas/>1000→throw; all-inválido→throw distinto; **rowNumber=index+2**; coluna-coord excluída de props; ordem [lng,lat] | offset linha; 1001→limite; cols coord ausentes de props | não | M |

### Domínio: ie-pdf / ie-ebgeo (cartográfico — extrair privados)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `pdf-cartographic-elements.js` | `_formatDMS` (extrair) | alto | **Carry seg=60** (floor min + round sec); 0→'0°N'; hemisférios | seg arredonda a 60 (flag); /^...[NSEW]$/ | sim | M |
| idem | `_findEdgeIntersection` (extrair) | alto | Cruza borda uma vez; sem cruzamento→null; **near-vertical skip**→linha vertical na borda vertical→null; pega mais próximo do meio | y dentro [min,max]; coord borda===edgeVal | sim | M |
| idem | `_clipSegment` Liang-Barsky (extrair) | alto | Dentro→inalterado; fora-sem-cruzar→null; vertical/horizontal; tMin>tMax→null | endpoints clipados dentro do retângulo (property) | sim | M |
| idem | `_niceNumber` (extrair) | alto | **value=0→log10(0)=-Inf→NaN**; snap {1,2,5}·10^k; negativo→NaN | _niceNumber(0)→NaN (flag); 1.5→2, 7→10 | sim | S |
| `pdf-export.tab.js` | `calculateBoundsFromScaleAtCenter` (extrair) | alto | cosLat correção; **lat=90→div-zero→Infinity**; antimeridiano lng>180; usable dentro do paper; simetria | usable strictly inside paper (property); lat0 vs lat60 2× | sim | M |
| `pdf-export.constants.js` | `parseScaleDenom` | médio | `'1:0'`→25000 (silencioso); sem `:`→25000; **`'1:25.000'`→25** (pt-BR ponto); não-string→throw | `'1:0'`→25000 (documenta); `'1:25.000'`→25 (flag) | sim | S |

### Domínio: processing
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `processing/processing.constants.js` | `extractBaseCoordinates` | alto | null→inalterado; <=1→inalterado; `===` estrito (float quase-igual não strip); **coord len<2→`undefined===undefined`→strip errado** | round-trip strip-of-close; idempotente | sim | S |
| idem | `registerAlgorithm`/`getAlgorithm`/`getAllAlgorithms` | médio | id falsy→throw; dup→throw; Object.freeze; snapshot isolado; **singleton module-level** | dup id→throw; getAll snapshot | não | S |
| `algorithms/buffer.algorithm.js` | `executeBuffer` (via getAlgorithm) | alto | **MultiPolygon→fan-out 1 Polygon/poly**; null→skip; anel degenerado→skip; turf throw→continua; structuredClone attrs | stub turf MultiPolygon 2→2 results | não | M |
| `algorithms/voronoi.algorithm.js` | `executeVoronoi` | alto | pointsOnly filtra; centroid overwrite props; **alinhamento pointSources[i] vs voronoi reordenado** (cell errada); <2→throw | stub turf; nome 'Alvo'→'Proximidade - Alvo' | não | L |

### Domínio: store-rest
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `store/migration/v1-to-v2.migration.js` | `migrateFeature` | alto | null→inalterado; id null→não cunha UUID; layerId 'default' literal; resolveId idempotente | mesma id 2×→mesmo UUID; 'default' preservado | sim | S |
| `store/migration/v2-to-v2.1.migration.js` | `migratePointZoomProperties` | médio | **`sizeCreatedAtZoom===0` (falsy) é clobbered p/ 10**; identidade de referência se nada muda | 0→clobber (flag); nada muda→mesma ref | não | S |
| `store/atlas/atlas.entity.js` | `reorderAtlasMaps` | alto | **`[A,A]` passa (len===Set.size + every)→dropa B**; permutação imutável; falta id→throw | dup [A,A]→não throw, dropa B (flag) | sim | S |
| idem | `isValidAtlas`/`addMapToAtlas`/`removeMapFromAtlas`/`getAtlasTerrainExaggeration` | médio | settings null→false; position clamp; `terrainExaggeration===0` preservado (`??`) | exag 0→0; remove lastActive→null | sim | S |

### Domínio: state
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `state/state_manager.js` | `set`/`get`/`getUnsafe`/`getShallow` | alto | deepEqual no-op não notifica; get clona; getUnsafe ref-vivo; falsy aplica | set valor igual→0 callbacks; mutação de get isolada | sim | M |
| idem | `_pathMatches` (via subscribe/set) | alto | Exato/filho/pai; **guard `+'.'` evita 'mouse' vs 'mouseExtra'**; segmento aligned | mouse não notifica mouseExtra; property prefix | sim | M |
| idem | `batchUpdate`/`_flushPendingNotifications` | alto | Dedup 1×/subscriber; nested não flush; exception→finally decrementa | batch 2 sets→1 notificação; throw→depth 0 | não | M |
| idem | expand/collapse/open/closeFeaturePanel (mútua exclusão) | alto | Restore branch (`_hadFeaturePanelBeforeSidebar`+selection); invariante nunca ambos abertos | NUNCA (sidebar.expanded && featurePanelOpen) (property) | sim | L |
| idem | `set` (mouse.* throttling) | alto | **TODOS 'mouse.*' throttled→setCoordinateFormat não aplica síncrono** (bug latente); latest-wins | fakeTimers; A,B,C rápidos→só C | não | M |

### Domínio: mode
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `mode/application-mode.manager.js` | `enterMode`/`exitMode` | alto | Modo inválido→false sem push; mesmo modo sobrescreve context; stack nested; viewerMode restore | round-trip enter/exit volta ao snapshot inicial | sim | M/S |
| `ui/ui-visibility.controller.js` | `applyProfile` | alto | Perfil desconhecido→false; callbacks só p/ mudanças; restore briefing→NORMAL re-mostra | NORMAL→briefing→NORMAL restaura baseline (property) | sim | M |

### Domínio: ie-vector
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `import_export/import.control.js` | `decomposeMultiGeometry` (via prototype.call) | alto | Multi*→N features; **GeometryCollection com geom null SKIP** (não throw); recursão aninhada; props shallow-clone | GC [Point,null,Line]→2 features; isolamento de props | sim | M |
| `import_export/export-import.service.js` | `isV1Format`/`migrateImportDataToV2`/`normalize...` (exportar) | alto | atlas→false; **NÃO injeta map id** (regressão phantom-map); idempotente; features não-array guard | migrate nunca seta mapData.id; idempotência | não | M |

---

## P2 — Risco Médio OU Coupling `mixed` (extrair primeiro)

### Domínio: draw-* (geometrias restantes)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `add_point_geometry.js` | `applyOffset`/`getBoundingBox`/`normalizeCoordinates` | médio/baixo | Inválido→input inalterado (no-op); JSON `'5'`→null; bbox degenerado | round-trip; `'5'`→null | sim | S |
| `add_point_control.js` | `computeZoomCorrectedSize` (EXTRAIR — duplicado 4×) | alto | enabled false→base; clamp 500; `size||10` (0→10 suspeito) | extrair helper; clamp 500; size=0→10 (flag) | sim | M |
| `label-tab.helpers.js` | `recalcLabelSize`/`hasLabelChanged` | médio | Backfill createdAtZoom em ambos features; `===0` falsy backfill; clamp 255 | disabled→base; 0 clobber (flag) | sim/não | S |
| `add_circle_geometry.js` | `normalizeCenter`/`isValidCenter`/`createHandles` | médio/baixo | `'["a","b"]'`→passa (sem check numérico); Infinity passa isNaN | `'["a","b"]'`→gap; Inf→true (flag) | sim/não | S |
| `add_ellipse_geometry.js` | `validate`/`getBoundingBox`/`normalizeCenter`/`isValidCenter` | alto/médio | **NaN/Inf radius passam** (só bearing tem isNaN); polo cosLat→0; Math.max(major,minor) | validate NaN radius→true (flag); polo blow-up | sim | S/M |
| `add_ellipse_geometry.js` | `calculateRotationBearing`/`updateFromHandle`/`calculatePreview` (turf-stub) | médio/alto | **+90 sem normalização [0,360)**; floor <0.01→null; campo-seletivo | stub turf; bearing -180→-90 (flag); preview==commit | sim/não | S/M |
| `add_rectangle_geometry.js` | `calculateDimensionsFromCorners`/`extractCornersFromGeometry` | alto | Antimeridiano center=0 errado; **AABB normaliza retângulo rotacionado** (perde rotação); width na lat central | width<height por cos; rotacionado→AABB | sim | S |
| `add_rectangle_geometry.js` | `rotateAndTranslate`/`calculateDimensionsFromRotatedCorners` (turf) | alto | **Mistura atan2 (leste=0) com turf bearing (norte=0)**; Pitágoras w²+h²=diag² | spy turf.destination; w²+h²≈diag² (property) | sim/não | M |
| `add_rectangle_geometry.js` | `generateRectangleGeometry`/`calculateCornersFromCenterAndDimensions`/`validate` | médio | borderRadius 0→5 pts; cosLat polo div; round-trip haversine vs flat diverge | swap invariante; round-trip ~1% lat baixa | sim | M |
| `add_image_geometry.js` | `calculateSelectionBoxGeometry`/`createSelectionBoxFromDegrees`/`getBoundingBox`/`normalizeCoordinates`/`validate` | alto/médio | **`effectiveZoom!==null` (0 é zoom válido, não falsy)**; padding×2; 0.625 mágico; Infinity aceito | stub uiManager; effectiveZoom=0 usado (regressão) | sim/não | S/M |
| `add_text_geometry.js` | `calculateRotationHandlePosition`/`getBoundingBox`/`moveText`/`normalizeCoordinates`/`validate`/`affectsVisuals` | médio | **`mapZoom||createdAtZoom` (mapZoom=0 cai p/ createdAtZoom)**; 111320 vs METERS_PER_DEGREE; validate==isValidPosition dup | mapZoom=0 cai (flag); validate≡isValidPosition | sim/não | S/M |

### Domínio: mil-* (restantes)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_constants.js` | `isModifier1/2Applicable`/`isEngagementBar...`/`isValidSymbolSet`/`getEchelonData` etc | médio | **allow-by-default p/ código desconhecido** (`!includes`); `isValidSymbolSet` hasOwnProperty vs `__proto__` | 'zz'→true (documenta); `__proto__`→false | não | S |
| `brazilian_extension_catalog.js` | `getCatalogEntry`/`hasSection`/`supportsCommand` etc | médio | extensionNumber 0 vs '0' (String coerção); byStandardIdentity merge; supportsCommand default true | ext 0===String(0); merge SI | não | M |
| `brazilian_svg_postprocessing.js` | `applyBrazilianLabelsToSVG`/`checkCatalogWarnings` | médio | modifier1 '00'→skip; **RegExp-injection em label com metachar**; entityExtension 0 índice real | label metachar→risco; mod2>0 sem seção→warn | não | M |
| `military_symbol_generator.js` | `extractViewBoxDimensions`/`extractTextModifiers` (exportar) | médio | **viewBox double-space→Number('')=0**; `quantity:0` mantido; whitespace `' '` vaza | double-space→{w:0} (flag); 0 mantido | não | S |
| `arrow_tool/add_arrow_geometry.js` | `removeVertexInBranch`/`_applyHeadLengthFromHandle`/`_applyAirmobileFromHandle` | médio | branchIndex 0 sincroniza top-level; **wrap ângulo ~270 mal-classificado**; **lineLength 0→NaN não sanitizado** | branch 0 espelha; clamp NaN (flag) | sim | M |
| `boundary_tool/add_boundary_geometry.js` | `validate`/`isValidBoundary`/`createLineWithGap`/`generateBoundaryCircles` | médio/baixo | **3 políticas divergentes** (filter vs every vs all-or-nothing); echelon o→círculos | contraste validate≡isValidBoundary; 'oo'→2 círculos | não | S/M |
| `occupied_front_tool` | `validate`/`normalize...`/`getBoundingBox`/`destination` | médio/baixo | `normalizeBaseCoordinates`→[] vs `normalizeCenter`→null (assimétrico); NaN dist→NaN | assimetria documentada; bbox ordenado | sim | S |
| `coordination_measure_generator.js` | `escapeXml`/`estimateTextWidth`/`hasExternalText` | médio | `&` escapa primeiro; bold 0.7/normal 0.6; numero 0 presente | sem `&lt;`; numero 0→true | sim/não | S |
| `add_coordination_measure_geometry.js` | `getBoundingBox`/`affectsSIDC/TextModifiers/Visuals`/`moveSymbol` | médio/baixo | 111320 sem correção lat; conjuntos disjuntos sidc/visuals | sidc∩visuals=∅; pointCode→affectsSIDC | não | S |

### Domínio: import/export (extrações)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `import.control.js` | `getTargetType`/`generateImportName`/`uniquify` (extrair)/`stripClosingVertex` (extrair) | médio/baixo | substring case-insensitive; counter mutação; sufixo começa em 2; **strip `===` exato** | 'POLYGON'→polygons; uniquify gap; strip 1e-9→não | sim/não | S |
| `export-import.service.js` | `roundCoordinates`/`optimizeFeature`/`xorData`/`getBlobExtension` | médio | Recursão anéis; 6 decimais; **NaN/Inf passa unrounded**; xor self-inverse | xor(xor(d))===d (property); jpeg→jpg | sim | S |
| `garmin-kmz-export.js` | `lng/latToPixel...`/`pixelToLng/Lat` (extrair mercator) | alto | Round-trip; base 512 (não 256); polo div; antimeridiano lng>180; monotônico | round-trip <1e-6; lat90→não-finito | sim | M |
| `garmin-kmz-export.js` | `_cornersToBox`/`_calculateTileGrid`/`_buildMercatorTileGrid` (stub-map) | alto | Normaliza cantos; MAX_TILES 100/MAX_CANVAS 16384→null; cobertura sem gap; ordem row-major | 4 ordens→mesma box; soma widths===total | sim | M/L |
| `qan/qan-export.js` | `generateQAN` (turf-stub) | alto | Polígono fecha (legs=n vs n-1); **normalização azimuth `<0→+360`**; observations[i]||''; ordem [lat,lng] | stub turf; bearing neg→270; closing leg | sim/não | M |
| `drag-drop.handler.js` | `classifyFile`/`truncateName` (exportar) | baixo/médio | lastIndexOf('.'); **sem ponto→substring(-1) garbage** (bug); double-ext; '.json'→GEO_IMPORT | 'noextension'→INVALID (probe); 'a.kml.txt'→INVALID | não | S |
| `csv/csv-coordinate-converter.js` | `autoDetectColumnMapping` | médio | case+trim; exact-includes ('lat_deg' não casa); 'x'→long/'y'→lat; unknown→{} | exact-equality limitação; utm zone opcional | não | S |
| `pdf-cartographic-elements.js` | `_utmZone`/`_formatBarLabel`/`_formatScaleText`/`_getGridSpacing` (extrair) | médio/baixo | `_utmZone(-180)→1`,180→60,NaN→NaN; barLabel 0/'1.5 km'; scaleText '1:25.000' pt-BR | -180→1; 1500→'1.5 km'; 25000→'1:25.000' | sim/não | S |
| `pdf-export.tab.js` | `calculateA4PixelSize`/`convertMMToMapUnitsFromScale`/`_getFeatureCoord`/getters | médio/baixo | landscape/portrait swap; pixelRatio=dpi/96; UTM allowed `<` 2.5M estrito; Polygon anel vazio→undefined | dpi linear; UTM 2.5M excluído (fronteira) | sim/não | S/M |

### Domínio: terrain
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `data-layers.manager.js` | `_calculateBounds` (extrair `calculateBounds(features)`) | alto | Vazio→null (sentinel Infinity); recursão depth arbitrária; [0,0]≠falsy; **NaN→sentinels Infinity persistem**; antimeridiano | extrair pure; todo pt dentro bbox (property); MultiPolygon≡LineString | sim | M |
| `terrain.control.js` | `getTerrainElevation` (stub map) | alto | getTerrain null→0; **`exaggeration||1.5` engole 0**; `||0` confunde null com 0; negativo preservado | stub map; (100-20)/2=40; null query→0 | não | M |
| idem | `setExaggeration`/`initExaggeration`/`terrainConfig` | médio | map null→não throw; init NÃO chama setTerrain; 0 passa sem clamp | init não chama setTerrain; exag 0→0 | não | S |
| `analysis-layers.manager.js` | `_validateLayersConfig` | médio | disabled→skip; len≠4→throw; west>=east→throw; antimeridiano west>east→throw | bounds len 3→throw; antimeridiano→throw (documenta) | não | M |

### Domínio: layers
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `layers/visibility-filter.js` | `createLayerVisibilityFilter`/`createHatchLayerFilter` | alto | **null vs [] additionalFilters** (null→ramo curto, []→spread); hatch true→2 sub-filtros/false→1; ordem VISIBLE índice 1 | filtro deep-equal; null→3 elementos | sim/não | S |
| `layers/layer.manager.js` | `isFeatureEffectivelyVisible`/`Locked` | alto | feature null→true; `visivel===false` estrito (0/''não); layer fallback `?? true`; `bloqueado:'true'` string não bloqueia | visivel=0→true (prova estrito); 'true'→não locked | não | M |
| idem | `getLayers`/`_getNextLayerOrder`/`_switchActiveLayerOnDelete`/`getUnlockedLayerIds` | médio | `order||0` ties; **vazio→0 (evita -Infinity)**; switch por ordem-Map não order-field; locked undefined→incluído | vazio→0; switch ignora order (fixar) | sim/não | M |
| `layers/styles/content.layers.js` | `toBackgroundFeatures` (exportar) | médio | showBackground+selectionBox ambos; id+'_bg'; **sem guard p/ properties undefined** | numérico id 5→'5_bg'; ambos requeridos | não | S |

### Domínio: snapping
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `snapping/snapping.service.js` | `closestPointOnSegment` (extrair) | alto | lenSq=0→t=0 sem NaN; clamp t∈[0,1]; vertical/horizontal | extrair; t∈[0,1] sempre; dist<=dist(a)e dist(b) | sim | M |
| idem | `extractVertices`/`extractSegments` (extrair) | alto | type desconhecido→[]; slice(0,2) strip z; **flat(2) depth**; ring.length-1 bounds | MultiPolygon→4 verts; single-vertex line→0 seg | não | M |
| idem | `interpolateLngLat` (extrair) | médio | t=0/1 endpoints; **sem wrap antimeridiano** (179→-179 dá ~0); linear | linear property; antimeridiano→0 (documenta) | sim | S |
| idem | `computeEffectiveEnabled` (extrair XOR) | médio | global XOR ctrl; tabela-verdade 4 combos | global!==ctrl (tabela) | não | S |
| idem | `_findBestSnap` (extrair) | alto | vertex bonus vence edge; geometry null skip; tolerância; tie primeiro | bonus 4 faz vertex 10px vencer edge 9px | não | L |

### Domínio: catalog/search/coordinates/util/userdata/briefing/store
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `catalog/catalog.service.js` | `searchItems`/`_normalizeText` | alto/médio | query ''→todos; NFD accent-fold (ç NÃO decompõe); name null→sem throw; só keyword casa | 'analise'→'Análise'; '' →todos; ç sobrevive | sim | S |
| `catalog.service.js` | `sortCatalogItemsByDate` (extrair) | alto | **DD/MM/YYYY (BR)** não US; sem-data→fim; malformado→NaN instável | extrair; '05/03'=Março não Maio; sem-data→fim | não | S |
| `config.helpers.js` | `getValidBasemapFallback`/`getEnabledBasemaps`/`validateBasemapsConfig` | alto/médio | disabled→fallback prioridade; unknown id→fallback; nenhum→'carta-topografica'; **muta singleton** | save/restore config; all-disabled→carta-topografica | não | M |
| `config.helpers.js` | `getBasemapLayoutClass` | baixo | 1-5→classes; 0/6+/NaN→default | n fora [1,5]→default (property) | sim | S |
| `search/search-bar.search-providers.js` | `featureMatchesQuery`/`getFeatureCenter` (exportar) | alto | props.name não-string→throw; sem accent-fold; **Polygon centroid inclui vértice fechamento** (skew); anel []→[NaN,NaN]; '' query casa tudo | name 123→throw (documenta); square skew | sim | S |
| `search/...` | `searchAPI`→`mapApiResults` (extrair) | alto | non-array→[]; **lng 0 incluído** (equador); '' excluído; cap 5; descrição comma-strip | lon 0→incluído (regressão); só estado→sem comma | não | M |
| `coordinate_converter.js` | `getDisplayFormat`/`formatCoordinates` (DMS/MGRS string) | alto/médio | latlong 5-dec+°; DMS 'O'/'L' não 'W'/'E'; **carry seg 60**; MGRS spacing só len 15; throw→fallback | (-22.45,-44.45,dms) lon ' O'; 0,0→'N','L' | sim/não | M |
| `id_utils.js` | `generateUniqueLayerName`/`generateUniqueMapName` | alto | Vazio→base; base presente sem sufixo→'#2'; **gap-fill lowest>=2** não max+1; **regex metachar escapado** | ['X #2','X #4']→'X #3'; 'a.b' literal | sim | M |
| `image_utils.js` | `validateImageFile` | médio | null→msg; size===max inclusivo (`>`); type case-sensitive; size 0 passa | ==max→valid; 'IMAGE/PNG'→invalid | não | S |
| `user_data_manager.js` | `validateAttributeKey` | alto | non-string→false; trim 50 boundary; **reserved casing inconsistente** ('fillColor' vaza, 'outlinecolor' casa); unicode válido | 'a'×50→valid, ×51→false; inconsistência (flag) | sim | M |
| `user_data_manager.js` | `extractAttributesFromImport` (mock sanitizeHtml) | alto | desc keys case-insensitive 1º-vence; system props case-SENSITIVE; **0/false mantidos, null dropado**; `attributes`→`attributes_imported` | {count:0,ok:false,missing:null}→{count:'0',ok:'false'} | não | M |
| `pointer-utils.js` | `getTouchesDistance`/`Angle`/`Midpoint` | médio | <2→0 (dist/angle) / first (midpoint); **len 0 midpoint→throw**; graus não rad; simétrico | (3,4)→5; vertical→90°; <2→0 | sim | S |
| `feature_navigation_utils.js` | `extractAllCoordinates` (extrair) | médio | Point/Line/Polygon/MultiPolygon flatten; [lng,lat,z] mantém; null→[]; strings não-push | Polygon→flatten; MultiPolygon depth-4 | sim | M |
| `briefing.operations.js` | `reorderSlides`/`addSlide` (mock repo) | alto | **position===length→append não splice** (off-by-one); omitidos→append; order 0..n-1 sem gaps; dup id consome 1× | permutação→multiset igual + order [0..n] (property) | sim | M |
| `briefing.operations.js` | `generateUniqueBriefingName` | médio | **gap-scan primeiro-livre não max+1**; sem colisão→base | ['X','X (2)']→'X (1)' (prova gap) | não | S |
| `briefing/validation/reference-validator.js` | `_validateSlide`/`isLegacy360Position` (extrair) | alto | 360 \|lat\|>90 legacy; lat===90 não (estrito); **lng 0 não-ausente** (meridiano); modo→severidade (3D ERROR, 2D WARNING) | extrair; lng 0 lat 0→sem NO_POSITION (regressão); modo bogus→INVALID_MODE | não | M |
| `briefing/export/pdf-page-composer.js` | `computeCropRect` (extrair) | alto | srcAspect vs target; rounding cropX+cropW<=srcW; aspecto extremo; target 0/NaN | extrair; (3000,1000,1)→cropW 1000; dentro bounds (property) | sim | M |
| `analysis/...selection-highlight` (dup) | (ver draw-text) | — | já listado em P1 draw-text | — | — | — |
| `wmm_calculator.js` | `calculateMagneticDeclination` (mock geomagnetism) | alto | lat/lng ±90/±180 inclusivo; **NaN coord passa guard** (sem isFinite); altitude clamp Math.max(0,-5); arredonda 2dp/1dp | vi.mock geomagnetism; 91→null; NaN→não-null (flag) | não | M |
| `wmm_calculator.js` | `checkWMMValidity`/`dateToDecimalYear`/`roundTo` (exportar) | alto/médio | Fronteiras 2025.0/2030.0; **Invalid Date→valid:true** (NaN); ano bissexto 366; DST skew | extrair; 2025-01-01→true; Invalid Date→true (flag) | sim | S |
| `attribute_table/table-data.service.js` | `filterFeatures`/`sortFeatures`/`getCellValue` | alto | selectedOnly+vazio→[]; tipos coerce String(); vazios ao fim; natural sort; **0/false não-vazio** | selectedOnly vazio→[]; 'item2'<'item10'; 0 ordena | sim/não | M |
| `features_tab/feature-organizer.service.js` | `flattenAndSortFeatures`/`countTotalFeatures` (mock @store) | médio/baixo | storageType desconhecido filtrado; `?? true` não guarda false; sort pt-BR | visivel false preservado; accent pt-BR sort | sim | S/M |
| `phone/phone-layout.js` | `_getFeatureCentroid` (extrair→geometry-centroid.js) | alto | Point strip z; **Polygon inclui vértice fechamento** (skew); Line floor(len/2); null→null | extrair (dedup c/ search); square skew documentado | não | M |
| `deep-link/deep-link.js` | `parseDeepLink`/`buildShareUrl360/3D` (stub window) | alto/médio | hash vazio→null; param faltando→NaN não 0; round-trip toFixed precision | round-trip build→parse dentro precisão (property) | sim | S/M |
| `mode/application-mode.manager.js` | `setViewerMode`/`reset`/predicados | médio/baixo | inválido→false sem mutação; mesmo→false sem emit; mútua exclusão | exatamente 1 predicado true (invariante) | sim | S |
| `ui-visibility.controller.js` | `register`/`toggleElement`/`defineProfile` | médio | callback faltando→skip; late-join hide; `?? true` default; **defineProfile muta PROFILES global** | toggle 2×→identidade; default true | sim | S/M |
| `state_manager.js` | seleção (add/remove/select/update)/collapse toggles | médio/baixo | dedup (type,id); composite key; remove inexistente no-op; round-trip add/remove | add 2× mesma→count 1; toggle par→false | sim | S |
| `state_manager.js` | subscribe/unsubscribe/reset/toolbar groups | médio/baixo | double-unsub seguro; subscriber throw isolado; reset notifica todos; toolbar prev-group emit | throw isolado; reset→default + callback | não | M |
| `toolmgr/clipboard_manager.js` | `generateUniqueFeatureName`/`computeOffset` (extrair) | alto/médio | '- Cópia N' incremento; **'X - Cópia abc'→double-suffix**; unicode ó; cosLat polo singularidade | 'X - Cópia 5'→'6'; lat0 dx===dy | sim/não | M |
| `toolmgr/hatch_pattern_generator.js` | `getConfigFromProperties`/`getCacheKey`/`getPatternId` | médio | **spacing/lineWidth 0 falsy→default 8/2**; case hex →cache-miss; fillColor>hatchColor | spacing:0→8 (flag); '#ff'≠'#FF' keys | sim | S |
| `csv/csv-parser.js` | `parseCSVPreview` | médio | totalRows conta todos, preview cap 5; ragged sem padding (vs parseCSV) | 10 rows→preview 5, total 10 | não | S |
| `analysis/...` | `extractCenterFromGeometry`/`generateWedgePolygon`/`generateSectorGeometry` (turf-stub) | médio | **média de vértices ≠ centroid** (double-count fechamento); anel fechado; numArcPoints | empty→null; ring fechado | não | M |

---

## P3 — Baixo / Cosmético

| Módulo | Símbolo | Risco | Nota | Est. |
|---|---|---|---|---|
| `add_point_geometry.js` | `getBoundingBox`/`getCenter`/`validate` | baixo | Guards triviais; dobrar no suite de geometry | S |
| `add_line_geometry.js` | `insertVertexAtIndex`/`isPointTooClose`/`calculateTotalLength`/`createHandles` | baixo/médio | Splice quirks; additividade haversine; contagem handles 2N-1 | S/M |
| `add_brush_geometry.js` | `createLineStringGeometry`/`normalizeCoordinates`/`calculateTotalLength`/`getCenter` | baixo | getCenter retorna `points[0]` (não centroid — documentar) | S |
| `add_text_geometry.js` | `validateText`/`generatePointGeometry` | baixo | trim whitespace; dropa z | S |
| `add_image_geometry.js` | `isValidPosition` (dup de validate) | baixo | Equivalência paramétrica | S |
| `add_occupied_front_geometry.js` | `getBoundingBox`/`calculateCenter`/`updateFeatureForMove` | baixo | center=p1 (não centroid); imutabilidade | S |
| `military_constants.js` | `getMainIcons`/`getModifier1/2`/`getAllSymbolSetCodes` | médio | Invariante: todo code→Array | S |
| `coordination_measure_generator.js` | `generatePointGeometry` | baixo | dropa z; nova array | S |
| `add_coordination_measure_control.js` | `resolveActualPointCode` (extrair) | médio | ECHELON fallback duplicado 3× | M |
| `declination_svg_generator.js` | `generateDeclinationSvg` | médio | Threshold 0.1/8 fronteiras; NaN vaza p/ legenda; snapshot determinístico | M |
| `svg-to-png.js` | `computeImageFit` (extrair) | médio | Letterbox/pillarbox; dim 0→throw; centragem | M |
| `add_declination_geometry.js` | `calculateSelectionBoxGeometry`/`generate` | baixo | stub uiManager; anel fechado; strip altitude | S |
| `line_profile.js` | `formatLength` | médio | Fronteira 1000m toFixed(2); 999.999→'1000.00 m' quirk | S |
| `los_tool` | `extractCoordinatesFromGeometry`/`generateProcessedFeatures`/`formatDistance` | médio | Multi vs Single; toFixed(2) vs panel toFixed(1) divergência | S |
| `visibility` | `normalizeFeatureProperties`/`normalizeCenter`/`translateGeometry`/`getCachedElevation` | baixo/médio | bearing 0 vs angle legacy; cache key 5-dec colisão; translate dropa z | S/M |
| `store/migration/v1-to-v2.migration.js` | `migrateFeatures` | médio | non-object→as-is; non-array value passthrough | S |
| `streetview360.operations.js` | `filterActiveEntries`/`setStreetview360DataForImport` merge (extrair) | médio | soft-delete excluído; markers regeneram id | S/M |
| `cesium3d.operations.js` | `getNextAutoNumber`/`removeByTileset` (exportar) | médio | vazio→1; max+1 não first-free; regex anchored | M |
| `grid/grid-layers.config.js` | `GRID_LAYERS`/`lineLayerId`/`labelLayerId` (exportar) | médio | latlong label dropa '4326', utm mantém 'utm' (assimetria); 16 IDs/sistema; sem dup | S |
| `coordinate_converter.js` | `getPlaceholderForFormat` | baixo | Self-consistência: placeholder parseável | S |
| `mouse-coordinates.control.js` | `formatElevation`/`shouldShowElevation` (extrair) | baixo | Math.round(NaN); gate null+enabled | S |
| `search/feature-search.control.js` | `filterValidSuggestions`/`search3DModelsFromTilesets` (extrair) | baixo/médio | 3d-model bypass; lon 0 incluído; keywords divergência | S |
| `briefing.operations.js` | `createEmptySlide`/`createEmptyBriefing`/`importBriefings` | baixo | id fresco; settings copy isolada; createdAt===updatedAt | S |
| `briefing/validation/reference-validator.js` | `ValidationResult`/`ValidationError` | baixo/médio | severidade routing; getSummary sem leading comma; slideIndex+1 display | S |
| `briefing/presentation` | `_getTransitionHandler`/`shouldUseInstant` (extrair) | médio | 9 pares modo; first-load→instant; forward→animated | S |
| `mode` | `createApplicationModeManager`/`getApplicationModeManager` (singleton) | baixo | vi.resetModules p/ instância fresca | S |

---

## Fase 2 (precisa jsdom / canvas / MapLibre / Cesium) — NÃO recomendar agora

Todos coupling `dom`/`maplibre`/`cesium`/`canvas`; valor de teste como lógica pura é baixo ou exige harness pesado:

- **Controls MapLibre (IControl):** todos `add_*_control.js` (point/line/polygon/circle/ellipse/rectangle/sector/text/image/brush, military, arrow, boundary, occupied_front, coordination_measure, declination, visibility, los) — `map.getSource/setData`, pointer events, RAF, snapping, store I/O.
- **Canvas/Image:** `point-marker-symbols.js`, `military_symbol_generator` PNG pipeline, `svg-to-png.js` (convert*), `hatch_pattern_generator` (createPatternImageData/draw*), `image_utils` (compressImage/createThumbnail/processImageFile), `pdf-cartographic-elements.composeLayout` + todos `_draw*`, `quill-helpers` (DOMParser/DOMPurify), `pdf-page-composer.stripHtmlToPlainText`.
- **DOM builders:** todos `*_attributes_panel.js`, `*.section.js`/`*.modal.js`, sidebar/*, modals/*, toolbar/*, context-menu/*, bottom-controls/*, features_tab/*.component.js, vector_info/*, ui/* (exceto controllers puros), search-bar component, phone views, attribute_table renderers/filters, catalog components, briefing editor/presenter/text-panel.
- **MapLibre source/layer:** `layers/styles/*.layers.js` (definições estáticas + ensureLayer), `measurement-labels.js`, `grid.control.js`, `terrain` toggle/zoom methods, `snapping showIndicator/hideIndicator`, `data/analysis-layers.manager` add/toggle layer methods.
- **Async-IO + store (integração, não unit puro):** import/export `handleImport/handleExport` (JSZip/IndexedDB/GDAL), `processing-runner`, briefing slide-capture/tile-preloader/transition handler bodies, cesium3d/streetview360 CRUD wrappers, store group.operations (delegação guard já-coberta), `tab-lock.js` (BroadcastChannel).
- **html-escape.escapeHtml** (document.createElement) — XSS, alto valor mas precisa jsdom.

---

## Pular / Baixo Valor

- **Dados estáticos:** `military_tools/data/*.js`, `coordination_measure_constants.js`, `layer.helpers.js` constantes, `baselayers/*` (estilos/URLs WMS/XYZ hardcoded — sem função montando URL), `carta_ortoimagem.js`. No máximo um smoke-test de integridade estrutural.
- **Wrappers triviais já-cobertos:** `BaseGeometry.calculateDistance`/`calculateMidpoint`/`getCenter`, todos os `calculateDistance`/`calculateBearing` que delegam a `geometry-utils` (haversine já testado), `searchCoordinates` (wrapper de coordinate_converter já-coberto).
- **No-ops intencionais:** `brush.createHandles`/`updateFromHandle` (retornam []/null), delegadores `group.operations`.
- **Predicados de 1 linha:** `needsPerFeatureImage`, `getSymbolIds`, `hasImageResource` pluralização, `generateGeoJSONId` (não-determinístico Date.now+random).
- **Barrels `index.js`** (excluídos de coverage).

---

## Notas Transversais (aplicar em todos os P1/P2)

1. **`x ?? 0` / `x || default` NÃO protegem contra NaN.** Padrão recorrente confirmado em: `calculateZoomCorrectedValue`, `recalcLabelSize`, `add_circle/ellipse/visibility.validate` (NaN/Infinity radius/aperture), `wmm_calculator` (NaN coord), `terrain.exaggeration||1.5` (engole 0), `_niceNumber(0)→NaN`. **Sempre fixar comportamento atual com teste e marcar com flag** para a correção ser deliberada.
2. **Antimeridiano (±180) não tratado** em praticamente todo bbox/midpoint/centroid/applyOffset/interpolateLngLat/calculateBearing local. Documentar como limitação conhecida, não como bug a corrigir no teste.
3. **`===` estrito vs float quase-igual** em `isPolygonClosed`/`extractBaseCoordinates`/snapping — fixar.
4. **fast-check** é ideal para: round-trips (normalize JSON, build/parse SIDC, build/parse deep-link, applyOffset ±d, mercator pixel↔lng), invariantes (bbox containment, anel fechado, batch dedup, perimeter reverso, `_pathMatches` prefix, ganho-perda=Δnet, w²+h²=diag², perfil restore), e monotonicidade (zoom-corrected size, distance step múltiplo de 30).
5. **Extrações recomendadas (refactor barato, alto payoff), em ordem:** `computeZoomCorrectedSize` (mata duplicação 4×) · `classifyRay`/`detectObstruction`/`computeProfileFromElevations` (análise militar) · helpers privados pdf-cartográficos (`_formatDMS`/`_clipSegment`/`_findEdgeIntersection`/`_niceNumber`) · mercator garmin · `calculateBounds(features)` (terrain) · `geometry-centroid.js` (consolida `_getFeatureCentroid` + `getFeatureCenter` duplicados) · helpers snapping · encode/decode engagement-bar · `sortCatalogItemsByDate`.
