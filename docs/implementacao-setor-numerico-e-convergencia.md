# Documentação de Implementação

**Itens migrados do EBGeo Desktop (QGIS) → EBGeo Web**

1. **Setor (`sector`) com azimute, distância e abertura configuráveis numericamente**
2. **Convergência meridiana junto com a declinação magnética**

> Escopo deliberadamente fechado nestes dois itens. Cada parte é independente e
> pode ser implementada/mergeada separadamente.

---

## Parte 1 — Setor com azimute, distância e abertura numéricos

### 1.1 Contexto e estado atual

A ferramenta de setor já modela todos os parâmetros geométricos necessários. Um
setor é uma "fatia de pizza" definida por:

| Propriedade | Significado | Unidade |
|---|---|---|
| `center` | centro `[lng, lat]` | — |
| `radius` | **distância / raio** (eixo central) | metros |
| `bearing` | **azimute do eixo central** (0 = Norte, horário) | graus |
| `aperture` | **ângulo de abertura** | graus |

Arquivos:

- `src/js/draw_tools/sector_tool/add_sector_geometry.js` — geometria (já completa).
- `src/js/draw_tools/sector_tool/add_sector_control.js` — controle (já completo).
- `src/js/draw_tools/sector_tool/sector_attributes_panel.js` — **painel (a alterar).**

**Achado-chave:** a propriedade `bearing` **já está totalmente integrada** ao
fluxo. Em `add_sector_control.js`, `updateFeaturesProperty()` já trata `bearing`
e regenera a geometria (linha ~711):

```js
if (property === 'radius' || property === 'center' || property === 'bearing' || property === 'aperture') {
    const center = this.geometry.normalizeCenter(sourceFeature.properties.center);
    const newGeometry = this.geometry.generate(
        center,
        sourceFeature.properties.radius,
        sourceFeature.properties.bearing,
        sourceFeature.properties.aperture
    );
    sourceFeature.geometry = newGeometry;
    feature.geometry = newGeometry;
}
```

`hasFeatureChanged()`, `prepareForPaste()` e `updateFeatureForMove()` já
consideram `bearing`. Ou seja, **toda a plumbing existe** — falta apenas expor o
controle no painel.

**Distância (`radius`) e abertura (`aperture`) já são numéricas.** O componente
`createModernSlider` (`tool_manager/helpers/slider.helpers.js`) renderiza um
`<input type="number">` ao lado do slider por padrão (`showInput = true`), com
clamp/round/debounce. Hoje o painel já tem:

- `Raio` → slider 10–100000 m com input numérico (linhas 108–117).
- `Ângulo de Abertura` → slider 1–359° com input numérico (linhas 119–128).

**Única lacuna real: não existe controle de `bearing` (azimute) no painel.** Ele
só pode ser definido desenhando ou arrastando o handle do raio.

### 1.2 Mudança obrigatória — adicionar controle de Azimute

Em `sector_attributes_panel.js`, dentro de `buildStyleContent`, logo **após** o
slider de "Ângulo de Abertura" (após a linha 128), inserir:

```js
// Bearing (azimuth of central axis) — numeric, 0=North clockwise
container.appendChild(createModernSlider({
    label: 'Azimute',
    min: 0, max: 360, step: 1,
    value: Math.round(feature.properties.bearing ?? 0),
    unit: '°',
    onChange: (value) => {
        // 360 wraps to 0 to keep a single canonical value
        sectorControl.updateFeaturesProperty(selectedFeatures, 'bearing', value % 360);
    }
}));
```

Recomenda-se posicioná-lo logo abaixo do "Raio" e acima da "Abertura" para
agrupar os três parâmetros geométricos (Raio → Azimute → Abertura), todos sob o
divisor `Geometria` já existente (linha 106).

### 1.3 Mudança recomendada — default explícito de `bearing`

Em `add_sector_control.js`, `DEFAULT_PROPERTIES` (linhas 41–59) tem `aperture: 60`
mas **não** tem `bearing`. Hoje `createFeature()` sempre define `bearing` a partir
do desenho, mas para robustez (paste programático, criação futura sem desenho e o
fallback `?? 0` do painel) adicionar:

```js
static DEFAULT_PROPERTIES = {
    // ...
    aperture: 60,
    bearing: 0,        // <-- adicionar
    ...LABEL_DEFAULT_PROPERTIES,
};
```

### 1.4 Opcional — distância de armamento maior que 100 km

O slider de raio limita o `max` em `100000` (100 km) e o input numérico herda esse
clamp (`clampValue` em `slider.helpers.js`). Suficiente para a maioria dos
empregos. Se for necessário cobrir alcances de foguetes/mísseis, aumentar o `max`
do slider de `Raio`:

```js
container.appendChild(createModernSlider({
    label: 'Raio',
    min: 10, max: 300000, step: 1,   // <-- 300 km
    value: Math.round(feature.properties.radius || 1000),
    unit: 'm',
    onChange: (value) => {
        sectorControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
    }
}));
```

### 1.5 Opcional — entrada em milésimos (consistência militar)

O `azimuth_distance_tool` já trabalha no sistema NATO de 6400 milésimos
(`azimuth_distance_constants.js`: `DEG_TO_MIL`, `MIL_TO_DEG`). Se desejado, o
campo de Azimute pode oferecer um toggle graus/milésimos espelhando aquele
padrão. **Fora do escopo mínimo** — `bearing` permanece armazenado em graus; a
conversão seria só de apresentação. Não recomendado para a primeira entrega.

### 1.6 Considerações e casos de borda

- **Wrap 0/360:** `value % 360` normaliza 360 → 0. O slider mostra 0–360; valor
  canônico fica em `[0, 360)`. Coerente com `calculateBearing()` da geometria,
  que retorna `[0, 360)`.
- **Multisseleção:** o valor exibido vem de `selectedFeatures[0]` (mesmo padrão
  de raio/abertura). `updateFeaturesProperty(selectedFeatures, ...)` aplica a
  **todos** os selecionados — comportamento esperado.
- **Handles de edição:** ao alterar `bearing` numericamente,
  `updateFeaturesProperty` chama `createEditHandles()` no final, reposicionando os
  handles de raio e abertura. Nenhuma ação extra necessária.
- **Persistência:** segue o fluxo normal (`saveFeatures`/`discardChangeFeatures`);
  `bearing` já está em `hasFeatureChanged`.

### 1.7 Critérios de aceitação

1. Selecionar um setor abre o painel com três campos numéricos: **Raio**,
   **Azimute**, **Abertura**.
2. Digitar `90` no Azimute gira o eixo central para Leste em tempo real.
3. Digitar valores em Raio/Abertura atualiza a geometria (já funcionava).
4. Editar 360 no Azimute normaliza para 0.
5. Salvar e recarregar o projeto preserva o azimute.
6. `npm run lint` e `npm test` passam.

### 1.8 Arquivos tocados (Parte 1)

| Arquivo | Mudança |
|---|---|
| `sector_attributes_panel.js` | + controle "Azimute" (obrigatório) |
| `add_sector_control.js` | + `bearing: 0` em `DEFAULT_PROPERTIES` (recomendado) |

Nenhuma mudança em geometria, store, eventos ou CSS (reuso de `attr-modern-slider`).

---

## Parte 2 — Convergência meridiana + diagrama de 3 nortes

### 2.1 Contexto e estado atual

A ferramenta `declination_tool` coloca no mapa um diagrama de declinação
rasterizado (SVG → PNG). Hoje ele mostra **dois** nortes:

- **NQ** (Norte de Quadrícula) — sempre vertical.
- **NM** (Norte Magnético) — rotacionado pela declinação (WMM2025).

Arquivos:

- `src/js/utilities/geomagnetic/wmm_calculator.js` — declinação WMM2025 (pronto).
- `src/js/military_tools/declination_tool/declination_svg_generator.js` — **SVG (a alterar).**
- `src/js/military_tools/declination_tool/add_declination_control.js` — **controle (a alterar).**
- `src/js/military_tools/declination_tool/declination_attributes_panel.js` — **painel (a alterar).**

**Problema técnico atual:** o gerador desenha **NQ na vertical** e rotaciona NM
pela declinação magnética. Mas a declinação do WMM é medida em relação ao **Norte
Verdadeiro (NV)**, não ao Norte de Quadrícula. Hoje o código trata NV ≡ NQ, o que
só é correto quando a convergência é ~0. Implementar a convergência **corrige**
essa imprecisão e completa o diagrama clássico de 3 nortes.

### 2.2 Conceitos e convenção de sinais

| Sigla | Norte | Definição |
|---|---|---|
| **NV** | Verdadeiro / geográfico | aponta para o polo norte geográfico |
| **NQ** | de Quadrícula (UTM) | paralelo ao meridiano central do fuso |
| **NM** | Magnético | direção da bússola |

- **Declinação magnética** `δ` = ângulo **NV → NM**. Fonte: WMM2025.
- **Convergência meridiana** `γ` = ângulo **NV → NQ**. A implementar.
- **Ângulo de quadrícula (G-M angle / deflexão)** = ângulo **NQ → NM** = `δ − γ`.

**Convenção adotada:** positivo = **Leste** (sentido horário a partir do NV),
negativo = Oeste. Coerente com o WMM (declinação Leste positiva) e com o render
atual (`Math.sin(angle)` para X, horário = Leste).

> No Brasil, tipicamente `δ` é Oeste (negativa) e `γ` é pequena (poucos graus,
> sinal dependente da posição relativa ao meridiano central).

### 2.3 Fórmula da convergência meridiana

Para a projeção Transversa de Mercator / UTM:

```
γ = (λ − λ₀) · sen(φ)            (1ª ordem, suficiente para o diagrama)
```

- `φ` = latitude, `λ` = longitude do ponto.
- `λ₀` = meridiano central do fuso = `6·Z − 183`, com `Z = floor((λ+180)/6) + 1`.

O sinal sai automático: no hemisfério Sul (`φ < 0`), um ponto a Leste do meridiano
central (`λ > λ₀`) resulta em `γ < 0` (NQ a Oeste do NV) — comportamento correto e
oposto ao hemisfério Norte. Para conversão de azimutes: `A_quadrícula = A_verdadeiro − γ`.

### 2.4 Novo módulo utilitário

Criar `src/js/utilities/geomagnetic/meridian_convergence.js`:

```js
// Path: js/utilities/geomagnetic/meridian_convergence.js
/**
 * @fileoverview Meridian (grid) convergence for UTM / Transverse Mercator.
 * γ = angle from True North (NV) to Grid North (NQ), positive = East (clockwise).
 *
 * @module utilities/geomagnetic/meridian_convergence
 */

const DEG = Math.PI / 180;

/** WGS84 second eccentricity squared (e'^2), used in the 2nd-order term. */
const E_PRIME_SQ = 0.00673949674228;

/**
 * UTM zone number (1-60) for a longitude.
 * @param {number} lng - Longitude in decimal degrees
 * @returns {number}
 */
function utmZone(lng) {
    return Math.floor((lng + 180) / 6) + 1;
}

/**
 * Central meridian (decimal degrees) of the UTM zone containing lng.
 * @param {number} lng - Longitude in decimal degrees
 * @returns {number}
 */
export function utmCentralMeridian(lng) {
    return utmZone(lng) * 6 - 183;
}

/**
 * Meridian convergence at a point.
 * First-order term (λ−λ₀)·sinφ with a small 2nd-order correction.
 *
 * @param {number} lat - Latitude in decimal degrees (-90..90)
 * @param {number} lng - Longitude in decimal degrees (-180..180)
 * @param {number} [lambda0] - Central meridian (deg); defaults to UTM zone CM
 * @returns {number|null} Convergence in degrees (+East, −West), or null if invalid
 */
export function calculateMeridianConvergence(lat, lng, lambda0 = utmCentralMeridian(lng)) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const phi = lat * DEG;
    const dLambda = (lng - lambda0) * DEG;
    const cos2 = Math.cos(phi) ** 2;

    const gammaRad = dLambda * Math.sin(phi) *
        (1 + (dLambda ** 2 / 3) * cos2 * (1 + 3 * E_PRIME_SQ * cos2));

    return Math.round((gammaRad / DEG) * 100) / 100; // 2 casas decimais
}
```

Sem novas dependências (trig pura; não precisa de proj4).

### 2.5 Reescrita do gerador de SVG (3 nortes)

Substituir o conteúdo de `declination_svg_generator.js`. Mudanças principais:

- Nova assinatura: `generateDeclinationSvg(declinationDeg, convergenceDeg = 0)`
  (retrocompatível — sem convergência cai no comportamento ~atual com NQ≈NV).
- **NV** passa a ser a referência **vertical** (coerente com o mapa Web Mercator,
  onde a vertical da tela ≈ Norte Verdadeiro no ponto do diagrama).
- Três setas: **NV** (vertical), **NQ** (girada por `γ`), **NM** (girada por `δ`).
- Dois arcos (raios diferentes para não sobrepor) e rótulos NV/NQ/NM nas pontas.
- **Legenda textual** no topo com os valores (`δ` e `γ`), sempre legível mesmo
  quando as setas quase coincidem (caso comum, `γ` pequeno).

```js
// Path: js/military_tools/declination_tool/declination_svg_generator.js

/**
 * @fileoverview Generates SVG diagrams of the three norths:
 * True North (NV), Grid North (NQ) and Magnetic North (NM).
 * Reference north (vertical) is NV, matching the Web Mercator map vertical
 * at the diagram location. Shows magnetic declination (NV→NM) and meridian
 * convergence (NV→NQ).
 */

const SVG_WIDTH = 400;
const SVG_HEIGHT = 500;

const ORIGIN_X = SVG_WIDTH / 2;
const ORIGIN_Y = 380;
const ARROW_LENGTH = 300;

const LINE_COLOR = '#0077CC';
const TEXT_COLOR = '#0077CC';
const ARC_COLOR = '#0077CC';

const ARROW_HEAD_SIZE = 12;
const BASE_LINE_HALF = 80;

/** Arc radii (px): convergence inner, declination outer (avoid overlap). */
const ARC_RADIUS_CONV = 48;
const ARC_RADIUS_DECL = 80;

/**
 * @param {number} declinationDeg - Magnetic declination (+East, −West), NV→NM
 * @param {number} [convergenceDeg=0] - Meridian convergence (+East, −West), NV→NQ
 * @returns {string} SVG markup string
 */
export function generateDeclinationSvg(declinationDeg, convergenceDeg = 0) {
    const nv = endpointFor(0);
    const nq = endpointFor(convergenceDeg);
    const nm = endpointFor(declinationDeg);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <defs>
    <marker id="arrowHead" markerWidth="${ARROW_HEAD_SIZE}" markerHeight="${ARROW_HEAD_SIZE}" refX="${ARROW_HEAD_SIZE / 2}" refY="${ARROW_HEAD_SIZE / 2}" orient="auto-start-reverse">
      <polygon points="0,0 ${ARROW_HEAD_SIZE},${ARROW_HEAD_SIZE / 2} 0,${ARROW_HEAD_SIZE}" fill="${LINE_COLOR}"/>
    </marker>
  </defs>
  ${buildBaseLines()}
  ${buildArrow(nv.x, nv.y)}
  ${buildArrow(nq.x, nq.y)}
  ${buildArrow(nm.x, nm.y)}
  ${buildAngleArc(convergenceDeg, ARC_RADIUS_CONV)}
  ${buildAngleArc(declinationDeg, ARC_RADIUS_DECL)}
  ${buildTipLabel(nv, 'NV')}
  ${buildTipLabel(nq, 'NQ')}
  ${buildTipLabel(nm, 'NM')}
  ${buildLegend(declinationDeg, convergenceDeg)}
</svg>`;
}

/** Arrow tip endpoint for an angle (deg, clockwise from vertical/NV). */
function endpointFor(angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    return {
        x: ORIGIN_X + Math.sin(a) * ARROW_LENGTH,
        y: ORIGIN_Y - Math.cos(a) * ARROW_LENGTH,
        angleDeg,
    };
}

function buildBaseLines() {
    const y = ORIGIN_Y;
    return `<line x1="${ORIGIN_X - BASE_LINE_HALF}" y1="${y}" x2="${ORIGIN_X + BASE_LINE_HALF}" y2="${y}" stroke="${LINE_COLOR}" stroke-width="1.5" stroke-dasharray="6,3"/>`;
}

function buildArrow(x2, y2) {
    return `<line x1="${ORIGIN_X}" y1="${ORIGIN_Y}" x2="${x2}" y2="${y2}" stroke="${LINE_COLOR}" stroke-width="2" marker-end="url(#arrowHead)"/>`;
}

/** Small arc from vertical (NV) to the given angle. */
function buildAngleArc(angleDeg, arcRadius) {
    if (Math.abs(angleDeg) < 0.1) return '';
    const startRad = -Math.PI / 2;                       // vertical up
    const endRad = startRad + (angleDeg * Math.PI) / 180;
    const sx = ORIGIN_X + Math.cos(startRad) * arcRadius;
    const sy = ORIGIN_Y + Math.sin(startRad) * arcRadius;
    const ex = ORIGIN_X + Math.cos(endRad) * arcRadius;
    const ey = ORIGIN_Y + Math.sin(endRad) * arcRadius;
    const largeArc = Math.abs(angleDeg) > 180 ? 1 : 0;
    const sweep = angleDeg > 0 ? 1 : 0;
    return `<path d="M ${sx} ${sy} A ${arcRadius} ${arcRadius} 0 ${largeArc} ${sweep} ${ex} ${ey}" fill="none" stroke="${ARC_COLOR}" stroke-width="1.5"/>`;
}

/** Two-letter label just beyond an arrow tip, offset radially outward. */
function buildTipLabel(tip, text) {
    const a = (tip.angleDeg * Math.PI) / 180;
    const off = 22;
    const x = tip.x + Math.sin(a) * off;
    const y = tip.y - Math.cos(a) * off + 8;
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="${TEXT_COLOR}" text-anchor="middle">${text}</text>`;
}

/** Always-legible textual legend at the top of the diagram. */
function buildLegend(declinationDeg, convergenceDeg) {
    const fmt = (v) => `${Math.abs(v).toFixed(1).replace('.', ',')}° ${v >= 0 ? 'E' : 'W'}`;
    const fontSize = 20;
    const x = 20;
    return `
  <text x="${x}" y="34" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}">Decl. (NV-NM): ${fmt(declinationDeg)}</text>
  <text x="${x}" y="62" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}">Conv. (NV-NQ): ${fmt(convergenceDeg)}</text>`;
}
```

> Observação de UI: o posicionamento dos rótulos NV/NQ/NM nas pontas é uma
> aproximação; quando `δ` e `γ` têm o mesmo sinal e magnitudes próximas as setas
> podem quase coincidir. A **legenda no topo** garante a leitura dos valores
> nesse caso. Ajuste fino visual é validado manualmente (o usuário testa a UI).

### 2.6 Alterações no controle (`add_declination_control.js`)

**(a) Import** (junto ao import do WMM, linha ~16):

```js
import { calculateMagneticDeclination } from '@utils/geomagnetic/wmm_calculator.js';
import { calculateMeridianConvergence } from '@utils/geomagnetic/meridian_convergence.js';
```

**(b) `DEFAULT_PROPERTIES`** (após `declination: 0`, linha ~61):

```js
declination: 0,
convergence: 0,        // <-- adicionar
inclination: 0,
```

**(c) `createDeclinationFeature`** — calcular e armazenar a convergência e passá-la
ao gerador (linhas ~140–191):

```js
const wmmResult = calculateMagneticDeclination(lngLat.lat, lngLat.lng);
if (!wmmResult) {
    showError('Erro ao calcular declinação magnética');
    return;
}
const declination = wmmResult.declination;
const convergence = calculateMeridianConvergence(lngLat.lat, lngLat.lng) ?? 0;   // <-- novo

// Generate SVG diagram and convert to PNG
const svgString = generateDeclinationSvg(declination, convergence);             // <-- passar convergência
```

E incluir `convergence` em `feature.properties`:

```js
declination: wmmResult.declination,
convergence,                          // <-- adicionar
inclination: wmmResult.inclination,
```

**(d) `regenerateIcon`** (linhas ~231–241) — usar a convergência salva:

```js
async regenerateIcon(feature) {
    const svgString = generateDeclinationSvg(
        feature.properties.declination,
        feature.properties.convergence ?? 0,     // <-- adicionar
    );
    // ... resto inalterado
}
```

**(e) `recalculateDeclination`** (linhas ~409–446) — recalcular a convergência ao
recolocar/recalcular o ponto:

```js
const wmmResult = calculateMagneticDeclination(lat, lng);
if (!wmmResult) { /* ... */ return; }
const convergence = calculateMeridianConvergence(lat, lng) ?? 0;   // <-- novo
// ...
if (sourceFeature) {
    sourceFeature.properties.declination = wmmResult.declination;
    sourceFeature.properties.convergence = convergence;            // <-- novo (source)
    // ...
    feature.properties.declination = wmmResult.declination;
    feature.properties.convergence = convergence;                  // <-- novo (selected)
    // ...
    await this.regenerateIcon(sourceFeature);
}
```

`regenerateIcon` já recebe `sourceFeature`, que agora carrega `convergence`.

### 2.7 Painel — exibir os valores (`declination_attributes_panel.js`)

Hoje os valores só aparecem no diagrama. Adicionar um info box read-only no topo
do painel (após o header, antes do slider "Tamanho", linha ~64). Importar
`createModernInfoBox`:

```js
import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createModernInfoBox,          // <-- adicionar
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
} from '@tools';
```

E, quando há seleção única, montar a caixa:

```js
if (selectedFeatures.length === 1) {
    const fmt = (v) => `${Math.abs(v ?? 0).toFixed(1).replace('.', ',')}° ${(v ?? 0) >= 0 ? 'Leste' : 'Oeste'}`;
    const decl = feature.properties.declination ?? 0;
    const conv = feature.properties.convergence ?? 0;
    const grid = decl - conv; // ângulo de quadrícula (NQ→NM)

    panel.appendChild(createModernInfoBox({
        title: 'Diagrama de Nortes',
        rows: [
            { text: `Declinação magnética (NV-NM): ${fmt(decl)}` },
            { text: `Convergência meridiana (NV-NQ): ${fmt(conv)}` },
            { text: `Ângulo de quadrícula (NQ-NM): ${fmt(grid)}` },
            { text: `WMM2025 · ${feature.properties.calculationDate || ''}` },
        ],
    }));
}
```

`createModernInfoBox({ title, rows: [{ text, color? }] })` — assinatura conferida
em `form-controls.helpers.js`.

### 2.8 Compatibilidade e migração de diagramas existentes

Diagramas já salvos têm apenas `declination` (sem `convergence`). Estratégias:

- **Leitura segura:** todos os pontos novos usam `?? 0`, então diagramas antigos
  continuam renderizando (com `γ = 0`, ou seja, o comportamento atual). Sem
  quebra.
- **Migração preguiçosa (recomendada):** o feature **já armazena
  `latitude`/`longitude`**, então a convergência pode ser recomputada sem
  geometria. Em `createAttributePanel` (ou ao selecionar), se
  `feature.properties.convergence === undefined`, calcular a partir de
  `latitude`/`longitude`, gravar e chamar `regenerateIcon`. Exemplo de helper no
  controle:

  ```js
  async ensureConvergence(feature) {
      if (feature.properties.convergence !== undefined) return;
      const { latitude: lat, longitude: lng } = feature.properties;
      const convergence = calculateMeridianConvergence(lat, lng) ?? 0;
      feature.properties.convergence = convergence;
      const data = await this.map.getSource('magnetic_declinations').getData();
      const src = data.features.find(f => f.properties.id === feature.properties.id);
      if (src) src.properties.convergence = convergence;
      this.forceUpdateMainSource(data);
      await this.regenerateIcon(src || feature);
  }
  ```

  Não obrigatória — sem ela, basta mover o diagrama uma vez (dispara
  `recalculateDeclination`) para popular a convergência.

### 2.9 Critérios de aceitação

1. Colocar um diagrama no mapa renderiza **três** setas (NV, NQ, NM) com legenda
   de declinação **e** convergência no topo.
2. Os valores de convergência batem com referência conhecida: ex.
   `(lat −15°, lng −50°)` no fuso 22 (`λ₀ = −51°`) → `γ ≈ (−50−(−51))·sen(−15°)
   ≈ −0,26°` (Oeste). Conferir sinal e magnitude.
3. Ponto sobre o meridiano central → `γ ≈ 0` (NQ ≈ NV).
4. Painel mostra Declinação, Convergência e Ângulo de quadrícula coerentes
   (`quadrícula = decl − conv`).
5. Diagramas antigos (sem `convergence`) carregam sem erro.
6. `npm run lint` e `npm test` passam.

### 2.10 Testes unitários sugeridos

Criar `tests/meridian_convergence.test.js` (Vitest):

- `utmCentralMeridian(-50)` → `−51` (fuso 22).
- `calculateMeridianConvergence(0, lng)` → `0` para qualquer `lng` (sen 0 = 0).
- Ponto no meridiano central → `0`.
- Hemisfério Sul, a Leste do CM → valor **negativo** (Oeste); simétrico a Oeste.
- Fora de faixa (`lat 95`) → `null`.

### 2.11 Arquivos tocados (Parte 2)

| Arquivo | Mudança |
|---|---|
| `utilities/geomagnetic/meridian_convergence.js` | **novo** módulo |
| `declination_svg_generator.js` | reescrita: 3 nortes + legenda |
| `add_declination_control.js` | import, `convergence` em default/criação/recalc/regen |
| `declination_attributes_panel.js` | info box com os 3 ângulos |
| `tests/meridian_convergence.test.js` | **novo** (sugerido) |

---

## Resumo de esforço

| Parte | Risco | Esforço | Dependências novas |
|---|---|---|---|
| 1 — Setor numérico | Baixo | ~1 controle no painel (+1 default) | Nenhuma |
| 2 — Convergência meridiana | Baixo-médio | 1 util + reescrita do SVG + 4 pontos no controle + painel | Nenhuma |

Ambas as partes são **100% navegador**, sem backend, reaproveitando helpers,
fluxo de store e a infraestrutura WMM já existentes.
