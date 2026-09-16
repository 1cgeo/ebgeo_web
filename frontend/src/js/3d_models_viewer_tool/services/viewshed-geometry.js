// Path: js/3d_models_viewer_tool/services/viewshed-geometry.js

/**
 * @module 3d_models_viewer_tool/services/viewshed-geometry
 * @description The pure arithmetic behind the 3D viewshed: how a sector wider than one instance
 * can render is split, how much each piece is narrowed at the seam, the field of view of the
 * observer camera, and the wireframe of the drawn sector.
 *
 * ZERO IMPORTS, BY CONTRACT, and that is what this file is for. The two callers
 * (`viewshed-3d.js` and `tools/viewshed_tool_3d.js`) both pull in Cesium, the store or both, so
 * neither can be loaded by a node test; the numbers that decide the DRAWING were therefore
 * unmeasurable except through a browser and a screenshot. Here they are functions over numbers.
 *
 * THE ONE THING THAT IS NOT OBVIOUS FROM THE CODE: the seam narrowing and the shader's comparison
 * operator are a PAIR, and the pair only helps in ONE direction. The fragment shader refuses a
 * pixel whose angle is STRICTLY greater than half the opening, so two pieces that abut exactly
 * SHARE their boundary: the degenerate set is painted TWICE (a tint that reads slightly darker)
 * rather than not at all (raw, untinted ground). Since 2026-09-16 the narrowing is ZERO, and that
 * is deliberate, measured, and argued on `SEAM_NARROWING_DEGREES` below. Whoever switches the
 * shader to `>=` inverts the degenerate case into a hairline of raw ground, and has to say so in
 * the same commit.
 */

/** Widest horizontal opening a single viewshed instance renders acceptably, in degrees. */
export const MAX_SINGLE_VIEWSHED_ANGLE = 150;

/**
 * How much each sub-viewshed is narrowed, in degrees, when a sector is split.
 *
 * It is a TOTAL, not a half: the piece renders this much less than its share of the sector, so the
 * gap at each seam is this wide. Read the module header for why it exists at all.
 *
 * ELE E ZERO DESDE 2026-09-16, E QUALQUER VALOR POSITIVO E UMA CUNHA CEGA NA DIRECAO DE VISADA.
 * A folga da emenda nao e cosmetica: ela e um pedaco do setor que NENHUM sub-viewshed analisa, e
 * num setor partido em dois ela cai exatamente sobre a direcao para onde o observador aponta. Foi
 * 1,5 ate 2026-09-15 e 0,1 de la ate aqui.
 *
 * A REVISAO DE 2026-09-15 MEDIU A EMENDA NUM ENQUADRAMENTO LARGO E CONCLUIU "0 px de chao cru".
 * O numero estava certo e a conclusao nao: 0,1 grau a 186 m sao 0,32 m, que naquele enquadramento
 * (cerca de 0,42 m por pixel) cabem dentro de um pixel. Aproximada a camera ate o chao ficar com
 * cerca de 0,046 m por pixel, a mesma cena mostra a cunha como uma FRESTA CONTINUA de 3 a 4 px que
 * sobe do observador ate o corte de distancia, atravessa a face de um obstaculo posto sobre a
 * emenda e CORTA A SOMBRA DELE em duas. Medido nesta arvore em 2026-09-16, em oito aberturas (151,
 * 155, 180, 240, 300, 301, 320 e 360), sempre 4 px na vista aproximada e 0 ou 1 px na vista larga:
 * a fresta nao dependia da abertura, dependia de quao perto se olhava.
 *
 *     folga    fresta (vista larga)   fresta (vista aproximada)   mediana do canal oposto na emenda
 *     1,5              9 px                    60 px              (a emenda nao tem tinta nenhuma)
 *     0,1            0 a 1 px                   4 px                    62, igual ao chao vizinho
 *     0                0 px                     0 px                    62, igual ao chao vizinho
 *    -1,5               0 px                    0 px               31, METADE do chao vizinho
 *
 * O CONTROLE NEGATIVO ESTA NAS DUAS PONTAS: acima, a fresta; abaixo, a faixa saturada, que e o
 * defeito que a folga existia para evitar e que so aparece com SOBREPOSICAO de verdade. Em cima da
 * linha do zero nao ha faixa: com o `>` estrito do shader, o conjunto degenerado (o pixel cujo
 * angulo calculado cai exatamente na fronteira) e pintado duas vezes, e ele tem medida zero.
 * Medido: no setor de 320 graus sobram 170 pixels de mistura dupla espalhados por tres colunas de
 * 720 linhas, e no de 180 graus, nenhum; a mediana do canal oposto na faixa da emenda continua a do
 * chao vizinho, que e a regua que acusa a faixa saturada.
 *
 * E HA UMA RAZAO PARA O ZERO SER SEGURO, E ELA E O SINAL DO ERRO RESIDUAL. Os dois pedacos nao
 * concordam sobre onde exatamente esta a fronteira: o angulo que o shader mede e em torno do eixo
 * "para cima" de CADA pedaco, e o Cesium ortogonaliza esse eixo contra a direcao de cada um, entao
 * as duas contas divergem um pouco para um fragmento fora do plano horizontal do observador. A
 * divergencia foi medida por bisseccao, em graus de azimute, e o sinal dela e SOBREPOSICAO para
 * todo fragmento ABAIXO do horizonte, que e onde o chao esta:
 *
 *     distancia do observador    180 graus     320 graus
 *              20 m               -0,038        -0,044
 *              50 m               -0,014        -0,017
 *             100 m               -0,007        -0,008
 *             180 m               -0,003        -0,004
 *
 * (negativo = os pedacos se sobrepoem). Ou seja, com folga zero a emenda fecha com uma sobra de
 * centesimos de grau, que a 100 m e menos de um centimetro de chao, e nunca abre. Uma folga
 * positiva SOMA a esse numero e vira fresta; e por isso que a resposta certa aqui e zero e nao um
 * numero pequeno. Acima do horizonte o sinal inverte, entao o topo de um obstaculo muito proximo
 * pode mostrar a mesma ordem de grandeza como fresta: centesimos de grau, sub-pixel em toda
 * medicao feita ate aqui, e declarado em vez de escondido.
 *
 * Guarda: `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`, nos dois casos de costura.
 */
export const SEAM_NARROWING_DEGREES = 0;

/** Widest field of view a perspective frustum takes before it degenerates, in degrees. */
export const MAX_FRUSTUM_FOV_DEGREES = 170;

/** Fallbacks when an opening arrives absent, zero or not a number. */
const FALLBACK = Object.freeze({ horizontalAngle: 120, verticalAngle: 90 });

/**
 * A positive, finite opening, or the declared fallback.
 * @param {number} valor
 * @param {number} padrao
 * @returns {number}
 */
function aberturaValida(valor, padrao) {
    return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

/**
 * How the requested horizontal sector is covered by one, two or three instances.
 *
 * @param {number} horizontalAngle - Total horizontal opening in degrees.
 * @returns {{ count: number, subAngle: number, renderAngle: number, offsets: number[] }}
 *   `count` instances, each covering `subAngle` degrees of the sector but RENDERING
 *   `renderAngle` (narrowed at the seams when split), rotated by `offsets` degrees of heading
 *   from the sector's centre direction.
 */
export function subViewshedLayout(horizontalAngle) {
    const total = aberturaValida(horizontalAngle, FALLBACK.horizontalAngle);

    let count = 3;
    if (total <= MAX_SINGLE_VIEWSHED_ANGLE) count = 1;
    else if (total <= MAX_SINGLE_VIEWSHED_ANGLE * 2) count = 2;

    const subAngle = total / count;

    // ONE PIECE IS NEVER NARROWED, and that is the whole asymmetry: with no neighbour there is no
    // seam, so narrowing it would just shrink the answer the person asked for. With the narrowing
    // at zero the two branches coincide today; the shape stays because it is the knob the measured
    // table on the constant argues about, and collapsing it would hide the decision.
    const renderAngle = count > 1 ? subAngle - SEAM_NARROWING_DEGREES : subAngle;

    // Symmetric tiling around the centre direction. Note that the three-piece case uses the FULL
    // sub-angle as the step, not half of it, which is what puts the middle piece on the centre.
    let offsets;
    if (count === 1) offsets = [0];
    else if (count === 2) offsets = [-subAngle / 2, subAngle / 2];
    else offsets = [-subAngle, 0, subAngle];

    return { count, subAngle, renderAngle, offsets };
}

/**
 * Field of view, in degrees, of the camera that renders the observer's depth map.
 *
 * It is the WIDER of the two openings, because one perspective frustum has to contain both, and it
 * is clamped because a perspective frustum degenerates as it approaches 180 degrees.
 * @param {number} horizontalAngle - Horizontal opening in degrees.
 * @param {number} verticalAngle - Vertical opening in degrees.
 * @returns {number} Field of view in degrees.
 */
export function observerFovDegrees(horizontalAngle, verticalAngle) {
    const horizontal = aberturaValida(horizontalAngle, FALLBACK.horizontalAngle);
    const vertical = aberturaValida(verticalAngle, FALLBACK.verticalAngle);
    return Math.min(Math.max(horizontal, vertical), MAX_FRUSTUM_FOV_DEGREES);
}

/** Subdivisions per axis in the drawn frustum outline. */
export const OUTLINE_SLICES = 8;

/**
 * The (azimuth, elevation) pairs, in degrees, of the polylines that draw the sector's wireframe.
 *
 * Each entry is one polyline. `apex: true` means the line starts at the observer and ends at its
 * single point; the others run along the far surface.
 * @param {number} horizontalAngle - Horizontal opening in degrees.
 * @param {number} verticalAngle - Vertical opening in degrees.
 * @param {number} [slices] - Subdivisions per axis.
 * @returns {Array<{ apex: boolean, points: Array<{ azimuth: number, elevation: number }> }>}
 */
export function frustumOutlineAngles(horizontalAngle, verticalAngle, slices = OUTLINE_SLICES) {
    const halfH = Math.abs(aberturaValida(horizontalAngle, FALLBACK.horizontalAngle)) / 2;
    const halfV = Math.abs(aberturaValida(verticalAngle, FALLBACK.verticalAngle)) / 2;
    const steps = Math.max(1, Math.floor(Number.isFinite(slices) ? slices : OUTLINE_SLICES));
    const lines = [];

    const azimuthAt = (i) => -halfH + (2 * halfH * i) / steps;
    const elevationAt = (j) => -halfV + (2 * halfV * j) / steps;

    // Meridians: azimuth fixed, elevation sweeping.
    for (let i = 0; i <= steps; i++) {
        const azimuth = azimuthAt(i);
        const points = [];
        for (let j = 0; j <= steps; j++) points.push({ azimuth, elevation: elevationAt(j) });
        lines.push({ apex: false, points });
    }

    // Parallels: elevation fixed, azimuth sweeping.
    for (let j = 0; j <= steps; j++) {
        const elevation = elevationAt(j);
        const points = [];
        for (let i = 0; i <= steps; i++) points.push({ azimuth: azimuthAt(i), elevation });
        lines.push({ apex: false, points });
    }

    // Four edges from the apex to the corners, which is what reads as "a cone from the observer".
    for (const azimuth of [-halfH, halfH]) {
        for (const elevation of [-halfV, halfV]) {
            lines.push({ apex: true, points: [{ azimuth, elevation }] });
        }
    }

    return lines;
}

/**
 * Unit direction for one (azimuth, elevation) pair in the observer's local frame.
 *
 * Plain triples in, plain triple out, so it is testable without Cesium. The parameterization is
 * the one the shader's horizontal test implies: azimuth is measured around `up`, in the plane
 * perpendicular to it, from `forward` towards `right`.
 * @param {{x: number, y: number, z: number}} forward - Unit forward axis.
 * @param {{x: number, y: number, z: number}} right - Unit right axis.
 * @param {{x: number, y: number, z: number}} up - Unit up axis.
 * @param {number} azimuthDegrees - Angle around `up`, positive towards `right`.
 * @param {number} elevationDegrees - Angle around `right`, positive towards `up`.
 * @returns {{x: number, y: number, z: number}} Unit direction.
 */
export function directionFromAngles(forward, right, up, azimuthDegrees, elevationDegrees) {
    const az = (azimuthDegrees * Math.PI) / 180;
    const el = (elevationDegrees * Math.PI) / 180;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    const cosAz = Math.cos(az);
    const sinAz = Math.sin(az);
    return {
        x: cosEl * (cosAz * forward.x + sinAz * right.x) + sinEl * up.x,
        y: cosEl * (cosAz * forward.y + sinAz * right.y) + sinEl * up.y,
        z: cosEl * (cosAz * forward.z + sinAz * right.z) + sinEl * up.z,
    };
}
