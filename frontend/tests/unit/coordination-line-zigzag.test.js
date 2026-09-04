import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

import {
    LINEAR_SYMBOLS,
    resolveSymbol,
    symbolDesignation,
    symbolOptions,
} from '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js';
import {
    resolveContinuousLayout,
    COORDINATION_LINE_ZOOM_LIMITS,
} from '@tools/helpers/coordination-line-zoom.model.js';

/**
 * The two continuous MD33 symbols, against the REAL turf bundle the app ships.
 *
 * The sap (290999/01) and the trench (290999/02) share the code 290999 and the
 * `zigzagTooth` builder, and differ ONLY in two catalogue ratios. Everything here
 * is therefore a MEASUREMENT of the drawn coordinates: a stub turf would let both
 * defects through, and both are the kind that draws a plausible picture of the
 * WRONG symbol. Measured off the manual plate on 2026-09-03:
 *
 *   sap        period 46 px, depth 28 px (0.60 of the period), no flat at all
 *              (its 3 to 5 level pixels at the apex are the stroke width);
 *   trench     period 44 px, depth 31 px (0.70), flat 18 px (0.41).
 *
 * Draw them with the same flat and they become the same drawing; emit the spine
 * beside the teeth and both become a zigzag with a chord through it.
 */

// The geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules; a trivial base keeps this file in `node`.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(a, b) {
            const toRad = (d) => (d * Math.PI) / 180;
            const R = 6371000;
            const dLat = toRad(b[1] - a[1]);
            const dLng = toRad(b[0] - a[0]);
            const h = Math.sin(dLat / 2) ** 2
                + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(h));
        }
    },
}));

const require = createRequire(import.meta.url);

let AddCoordinationLineGeometry;
let geom;
let turf;

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module:
    // run the shipped bundle in this context and read the global it defines.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddCoordinationLineGeometry } =
        await import('../../src/js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    geom = new AddCoordinationLineGeometry();
});

// ============================================================================
// MEASURING TAPE
// ============================================================================

const SAPA = '290999-01';
const TRINCHEIRA = '290999-02';

/** Metres between two coordinates. */
const metros = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'meters' });

/** Metres from a coordinate to the base line AS DRAWN, tape and all. */
const metrosAteALinhaCrua = (coord, base) =>
    turf.pointToLineDistance(turf.point(coord), turf.lineString(base), { units: 'meters' });

const REGUAS = new Map();

/**
 * The base line densified into the course the geometry actually walks.
 *
 * The measuring tape had to be calibrated before it could measure anything:
 * `turf.along`, which places every tooth vertex, interpolates along the GREAT
 * CIRCLE, while `turf.pointToLineDistance` measures against the segment as a
 * chord. Measured on 2026-09-03 against this bundle, a point sitting exactly on a
 * 10 km two-point line reads 1.133 m off it at mid-span, which is the tape lying,
 * not the drawing wandering. Stepping the line into 400 pieces of its own `along`
 * stations drops that residual to 7.1e-6 m, and the calibration test below fails
 * if anyone trusts the raw line again.
 *
 * @param {Array} base - Base coordinates
 * @param {number} [passos] - Densification steps
 * @returns {Object} Turf lineString to measure against
 */
function reguaDe(base, passos = 400) {
    const chave = `${passos}:${JSON.stringify(base)}`;
    if (REGUAS.has(chave)) return REGUAS.get(chave);

    const line = turf.lineString(base);
    const total = turf.length(line, { units: 'kilometers' });
    const pontos = [];
    for (let i = 0; i <= passos; i++) {
        pontos.push(turf.along(line, (total * i) / passos, { units: 'kilometers' }).geometry.coordinates);
    }

    const regua = turf.lineString(pontos);
    REGUAS.set(chave, regua);
    return regua;
}

/** Metres from a coordinate to the drawn course, the independent depth measure. */
const metrosAteALinha = (coord, base) =>
    turf.pointToLineDistance(turf.point(coord), reguaDe(base), { units: 'meters' });

/** Kilometres along a coordinate array. */
const comprimentoKm = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/** A straight west-to-east line of roughly `km` kilometres at latitude -30. */
const linhaReta = (km) => [[-53.0, -30.0], [-53.0 + km / 96.3, -30.0]];

/** Build the properties a drawn coordination line would carry. */
const props = (baseCoordinates, overrides = {}) => ({
    baseCoordinates,
    lineWidth: 4,
    symbol_size: 0.5,
    symbol_spacing: 2,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    ...overrides,
});

/** Every emitted position, whatever the geometry type. */
const todasAsCoordenadas = (geometry) =>
    (geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat());

/** Relative closeness, for the plate's 2% reading tolerance. */
function perto(medido, esperado, tolerancia = 0.02) {
    return Math.abs(medido - esperado) <= Math.abs(esperado) * tolerancia;
}

/**
 * The along-line run before the V starts, measured rather than counted: a tooth
 * point that sits ON the base line is a corner, one that hangs off it is the apex.
 * @param {Array} dente - One emitted tooth
 * @param {Array} base - Base coordinates
 * @returns {number} Flat length in metres, zero when the V starts at the tooth start
 */
function patamarMetros(dente, base) {
    const segundo = dente[1];
    return metrosAteALinha(segundo, base) < 0.001 ? metros(dente[0], segundo) : 0;
}

/** The apex is the one vertex of a tooth that hangs off the line. */
function apiceDe(dente, base) {
    let melhor = dente[0];
    let maior = -1;
    for (const ponto of dente) {
        const d = metrosAteALinha(ponto, base);
        if (d > maior) { maior = d; melhor = ponto; }
    }
    return { apice: melhor, profundidade: maior };
}

// ============================================================================
// 0. THE TAPE ITSELF — calibrated before it is trusted
// ============================================================================

describe('a fita metrica antes da medida', () => {
    it('a linha crua de dois pontos mente mais de um metro sobre o proprio traco', () => {
        const base = linhaReta(10);
        const line = turf.lineString(base);
        const total = turf.length(line, { units: 'kilometers' });

        let pior = 0;
        for (let i = 0; i <= 20; i++) {
            const estacao = turf.along(line, (total * i) / 20, { units: 'kilometers' });
            pior = Math.max(pior, metrosAteALinhaCrua(estacao.geometry.coordinates, base));
        }

        console.log(`[calibracao] linha crua: pior desvio ${pior.toFixed(4)} m sobre pontos que estao NELA`);

        // Ponto colocado por `turf.along`, portanto EXATAMENTE sobre o traco, lido
        // como fora dele: o instrumento e que erra, nao o desenho.
        expect(pior).toBeGreaterThan(1);
        expect(pior).toBeLessThan(1.2);
    });

    it('a regua densificada zera o desvio, e so entao serve de medida', () => {
        const base = linhaReta(10);
        const line = turf.lineString(base);
        const total = turf.length(line, { units: 'kilometers' });

        let pior = 0;
        for (let i = 0; i <= 97; i++) {
            const estacao = turf.along(line, (total * i) / 97, { units: 'kilometers' });
            pior = Math.max(pior, metrosAteALinha(estacao.geometry.coordinates, base));
        }

        console.log(`[calibracao] regua de 400 passos: pior desvio ${pior.toExponential(3)} m`);

        // Cinco ordens de grandeza abaixo da linha crua, e sete abaixo da
        // profundidade que ela vai medir.
        expect(pior).toBeLessThan(0.0001);
    });
});

// ============================================================================
// 7. THE CATALOGUE — the test that catches a re-key by code
// ============================================================================

describe('o par 290999 sobrevive ao catalogo', () => {
    it('guarda os dois simbolos sob ids distintos, com o mesmo codigo', () => {
        const sapa = LINEAR_SYMBOLS[SAPA];
        const trincheira = LINEAR_SYMBOLS[TRINCHEIRA];

        expect(sapa).toBeDefined();
        expect(trincheira).toBeDefined();

        // O que um objeto chaveado por codigo perderia em silencio.
        expect(sapa.code).toBe('290999');
        expect(trincheira.code).toBe('290999');
        expect(sapa.code).toBe(trincheira.code);
        expect(sapa.extension).toBe('01');
        expect(trincheira.extension).toBe('02');
        expect(sapa.extension).not.toBe(trincheira.extension);
        expect(sapa.name).toBe('Sapa');
        expect(trincheira.name).toBe('Trincheira');
    });

    it('devolve a designacao do manual, com a extensao', () => {
        expect(symbolDesignation(LINEAR_SYMBOLS[SAPA])).toBe('290999/01');
        expect(symbolDesignation(LINEAR_SYMBOLS[TRINCHEIRA])).toBe('290999/02');
        // Simbolo sem extensao nao ganha barra nenhuma.
        expect(symbolDesignation(LINEAR_SYMBOLS['290199'])).toBe('290199');
    });

    it('oferece dois rotulos distintos no combobox', () => {
        const opcoes = symbolOptions();
        const doPar = opcoes.filter(o => o.value === SAPA || o.value === TRINCHEIRA);

        expect(doPar).toHaveLength(2);
        expect(doPar[0].label).not.toBe(doPar[1].label);
        expect(doPar.map(o => o.label).sort()).toEqual([
            'Sapa (290999/01)',
            'Trincheira (290999/02)',
        ]);
    });

    it('resolve cada id ao seu proprio par de ratios', () => {
        expect(resolveSymbol(SAPA).depthRatio).toBe(0.6);
        expect(resolveSymbol(SAPA).flatRatio).toBe(0);
        expect(resolveSymbol(TRINCHEIRA).depthRatio).toBe(0.7);
        expect(resolveSymbol(TRINCHEIRA).flatRatio).toBe(0.41);
        expect(resolveSymbol(SAPA).continuous).toBe(true);
        expect(resolveSymbol(TRINCHEIRA).continuous).toBe(true);
    });

    it('os ratios do catalogo batem com a prancha MD33-M-02', () => {
        // Sapa: 46 px de periodo, 28 px de profundidade, patamar zero.
        expect(perto(28 / 46, LINEAR_SYMBOLS[SAPA].depthRatio)).toBe(true);
        expect(LINEAR_SYMBOLS[SAPA].flatRatio).toBe(0);
        // Trincheira: 44 px de periodo, 31 px de profundidade, 18 px de patamar.
        expect(perto(31 / 44, LINEAR_SYMBOLS[TRINCHEIRA].depthRatio)).toBe(true);
        expect(perto(18 / 44, LINEAR_SYMBOLS[TRINCHEIRA].flatRatio)).toBe(true);
    });
});

// ============================================================================
// 1. NO SPINE COMES OUT BESIDE THE TEETH
// ============================================================================

describe('o zigue-zague substitui a linha, nunca sai ao lado dela', () => {
    const bases = [
        ['reta de 10 km', linhaReta(10)],
        ['quebrada de 6 vertices', Array.from({ length: 6 }, (_, i) => [-53 + i * 0.02, -30 + (i % 2) * 0.008])],
    ];

    for (const [nome, base] of bases) {
        for (const id of [SAPA, TRINCHEIRA]) {
            it(`${nome}, ${id}: nenhuma parte da saida e a linha base inteira`, () => {
                const total = comprimentoKm(base);
                const esperado = resolveContinuousLayout(total, 0.5);
                const geometry = geom.generate(props(base, { symbol_code: id }), 12);

                expect(geometry.type).toBe('MultiLineString');
                // Um dente por periodo e NADA MAIS. A espinha seria a de numero N+1.
                expect(geometry.coordinates.length).toBe(esperado.count);

                for (const sub of geometry.coordinates) {
                    // A espinha da quebrada teria 6 vertices; um dente tem 3 ou 4.
                    expect(sub.length).toBeLessThanOrEqual(4);
                    expect(sub.length).toBeGreaterThanOrEqual(3);
                    // E teria o comprimento da linha inteira.
                    expect(comprimentoKm(sub)).toBeLessThan(total * 0.5);
                    expect(JSON.stringify(sub)).not.toBe(JSON.stringify(base));
                }
            });
        }
    }
});

// ============================================================================
// 2 and 4. THREE POINTS AGAINST FOUR, AND THE FLAT THAT PUTS THE FOURTH THERE
// ============================================================================

describe('a sapa tem 3 pontos por dente e a trincheira 4', () => {
    it('a sapa e um V puro: comeco, apice, fim', () => {
        const base = linhaReta(10);
        const geometry = geom.generate(props(base, { symbol_code: SAPA }), 12);

        for (const dente of geometry.coordinates) {
            expect(dente).toHaveLength(3);
            // O ponto do meio JA e o apice: nao ha canto de patamar antes dele.
            expect(metrosAteALinha(dente[1], base)).toBeGreaterThan(100);
            expect(patamarMetros(dente, base)).toBe(0);
        }
    });

    it('a trincheira tem o canto do patamar como quarto ponto, e ele esta SOBRE a linha', () => {
        const base = linhaReta(10);
        const geometry = geom.generate(props(base, { symbol_code: TRINCHEIRA }), 12);

        for (const dente of geometry.coordinates) {
            expect(dente).toHaveLength(4);
            // O canto e o unico ponto interno que continua na linha, e esta mais
            // perto dela do que o erro da linha crua saberia distinguir.
            expect(metrosAteALinha(dente[1], base)).toBeLessThan(0.001);
            expect(metrosAteALinha(dente[2], base)).toBeGreaterThan(100);
        }
    });

    it('o patamar da trincheira mede 0,41 do periodo, e o da sapa mede zero', () => {
        const base = linhaReta(10);
        const total = comprimentoKm(base);
        const periodoM = resolveContinuousLayout(total, 0.5).period * 1000;

        const daSapa = geom.generate(props(base, { symbol_code: SAPA }), 12).coordinates;
        const daTrincheira = geom.generate(props(base, { symbol_code: TRINCHEIRA }), 12).coordinates;

        const patamaresSapa = daSapa.map(d => patamarMetros(d, base));
        const patamaresTrincheira = daTrincheira.map(d => patamarMetros(d, base));

        console.log(
            `[patamar] periodo ${periodoM.toFixed(2)} m | sapa ${Math.max(...patamaresSapa).toFixed(3)} m`
            + ` | trincheira ${(patamaresTrincheira.reduce((a, b) => a + b, 0) / patamaresTrincheira.length).toFixed(2)} m`
            + ` (razao ${(patamaresTrincheira[0] / periodoM).toFixed(4)})`,
        );

        for (const patamar of patamaresSapa) {
            expect(patamar).toBe(0);
        }
        for (const patamar of patamaresTrincheira) {
            expect(perto(patamar / periodoM, 0.41)).toBe(true);
        }
    });
});

// ============================================================================
// 3. THE DEPTH, MEASURED AGAINST THE LINE
// ============================================================================

describe('a profundidade medida bate com o ratio do catalogo', () => {
    const casos = [
        [SAPA, 0.6],
        [TRINCHEIRA, 0.7],
    ];

    const medidas = {};

    for (const [id, ratio] of casos) {
        it(`${id}: o apice cai a ${ratio} do periodo da linha base`, () => {
            const base = linhaReta(10);
            const total = comprimentoKm(base);
            const periodoM = resolveContinuousLayout(total, 0.5).period * 1000;
            const geometry = geom.generate(props(base, { symbol_code: id }), 12);

            const profundidades = geometry.coordinates.map(d => apiceDe(d, base).profundidade);
            const media = profundidades.reduce((a, b) => a + b, 0) / profundidades.length;
            medidas[id] = media;

            console.log(
                `[profundidade] ${id}: periodo ${periodoM.toFixed(2)} m,`
                + ` media ${media.toFixed(2)} m, razao ${(media / periodoM).toFixed(4)},`
                + ` esperado ${(periodoM * ratio).toFixed(2)} m`,
            );

            for (const profundidade of profundidades) {
                expect(perto(profundidade, periodoM * ratio)).toBe(true);
            }
        });
    }

    it('0,6 e 0,7 sao diferentes NA MEDIDA, nao so no catalogo', () => {
        const base = linhaReta(10);
        const periodoM = resolveContinuousLayout(comprimentoKm(base), 0.5).period * 1000;

        const fundo = (id) => {
            const geometry = geom.generate(props(base, { symbol_code: id }), 12);
            const p = geometry.coordinates.map(d => apiceDe(d, base).profundidade);
            return p.reduce((a, b) => a + b, 0) / p.length;
        };

        const daSapa = fundo(SAPA);
        const daTrincheira = fundo(TRINCHEIRA);

        expect(daTrincheira).toBeGreaterThan(daSapa);
        // Um decimo do periodo de diferenca, e nada menos.
        expect(perto(daTrincheira - daSapa, periodoM * 0.1)).toBe(true);
    });
});

// ============================================================================
// 5 and 6. END TO END, AND THE TEETH JOINED TO EACH OTHER
// ============================================================================

describe('o padrao cobre a linha inteira e os dentes se emendam', () => {
    const bases = [
        ['reta de 10 km', linhaReta(10)],
        ['dobra de 90 graus', [[-53.0, -30.0], [-52.9, -30.0], [-52.9, -29.9]]],
        ['quebrada de 6 vertices', Array.from({ length: 6 }, (_, i) => [-53 + i * 0.02, -30 + (i % 2) * 0.008])],
    ];

    for (const [nome, base] of bases) {
        for (const id of [SAPA, TRINCHEIRA]) {
            it(`${nome}, ${id}: comeca no inicio, termina no fim, sem toco de linha reta`, () => {
                const geometry = geom.generate(props(base, { symbol_code: id }), 12);
                expect(geometry.type).toBe('MultiLineString');

                const dentes = geometry.coordinates;
                const primeiro = dentes[0][0];
                const ultimo = dentes[dentes.length - 1].at(-1);

                expect(metros(primeiro, base[0])).toBeLessThan(0.05);
                expect(metros(ultimo, base.at(-1))).toBeLessThan(0.05);
            });

            it(`${nome}, ${id}: o fim de um dente e o comeco do seguinte`, () => {
                const geometry = geom.generate(props(base, { symbol_code: id }), 12);
                const dentes = geometry.coordinates;

                let pior = 0;
                for (let i = 0; i < dentes.length - 1; i++) {
                    pior = Math.max(pior, metros(dentes[i].at(-1), dentes[i + 1][0]));
                }
                expect(pior).toBeLessThan(0.001);
            });
        }
    }
});

// ============================================================================
// 8. THE CEILING
// ============================================================================

describe('o teto de 120 dentes alarga o periodo em vez de parar o padrao', () => {
    for (const id of [SAPA, TRINCHEIRA]) {
        it(`${id}: um symbol_size minusculo numa linha longa para em 120 e ainda cobre tudo`, () => {
            const base = linhaReta(100);
            const total = comprimentoKm(base);
            const properties = props(base, { symbol_code: id, symbol_size: 0.001 });

            const layout = geom.describeLayout(properties, 12);
            expect(layout.capped).toBe(true);
            expect(layout.count).toBe(COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS);
            expect(layout.count).toBe(geom.maxGlyphs);
            expect(layout.count).toBe(120);

            const geometry = geom.generate(properties, 12);
            expect(geometry.type).toBe('MultiLineString');
            expect(geometry.coordinates.length).toBe(120);

            // O periodo alargou de 1 m para total/120, e o padrao nao encurtou.
            const periodoKm = total / 120;
            expect(periodoKm).toBeGreaterThan(0.5);
            expect(metros(geometry.coordinates[0][0], base[0])).toBeLessThan(0.05);
            expect(metros(geometry.coordinates.at(-1).at(-1), base.at(-1))).toBeLessThan(0.05);
        });
    }
});

// ============================================================================
// PIOR CASO — the degenerate inputs the ruler exists to survive
// ============================================================================

describe('pior caso: a linha degenerada', () => {
    for (const id of [SAPA, TRINCHEIRA]) {
        it(`${id}: linha de comprimento ZERO degrada para LineString sem lancar`, () => {
            const base = [[-53.0, -30.0], [-53.0, -30.0]];
            const geometry = geom.generate(props(base, { symbol_code: id }), 12);

            expect(geometry.type).toBe('LineString');
            expect(geometry.coordinates).toEqual(base);
        });

        it(`${id}: linha de 1 m degrada para LineString, com o simbolo padrao ou com o menor`, () => {
            const base = linhaReta(0.001);
            // Medida, nao suposta: a reta de 1 m de longitude mede 0,99998 m, e o
            // piso MIN_SYMBOL_SIZE_KM impede qualquer periodo abaixo de 1 m. Nao
            // ha zigue-zague possivel numa linha mais curta que um metro.
            expect(comprimentoKm(base) * 1000).toBeLessThan(1);
            expect(COORDINATION_LINE_ZOOM_LIMITS.MIN_SYMBOL_SIZE_KM * 1000).toBe(1);

            for (const symbol_size of [0.5, 0.0001]) {
                const geometry = geom.generate(props(base, { symbol_code: id, symbol_size }), 12);
                expect(geometry.type).toBe('LineString');
                expect(geometry.coordinates).toEqual(base);
            }
        });

        it(`${id}: a linha mais curta que aceita um dente, 1,2 m, desenha um dente inteiro`, () => {
            const base = linhaReta(0.0012);
            const geometry = geom.generate(props(base, { symbol_code: id, symbol_size: 0.0001 }), 12);

            expect(geometry.type).toBe('MultiLineString');
            expect(geometry.coordinates).toHaveLength(1);
            expect(geometry.coordinates[0]).toHaveLength(id === SAPA ? 3 : 4);

            // Um dente de 1,2 m de periodo tem profundidade sub-metrica e continua
            // valendo o ratio: a regua nao desiste no pequeno.
            const periodoM = comprimentoKm(base) * 1000;
            const { profundidade } = apiceDe(geometry.coordinates[0], base);
            expect(perto(profundidade, periodoM * resolveSymbol(id).depthRatio, 0.05)).toBe(true);

            for (const coord of todasAsCoordenadas(geometry)) {
                expect(Number.isFinite(coord[0])).toBe(true);
                expect(Number.isFinite(coord[1])).toBe(true);
            }
        });

        it(`${id}: symbol_size maior que a linha inteira degrada para LineString`, () => {
            const base = linhaReta(1);
            const properties = props(base, { symbol_code: id, symbol_size: 40 });

            expect(geom.describeLayout(properties, 12).count).toBe(0);

            const geometry = geom.generate(properties, 12);
            expect(geometry.type).toBe('LineString');
            expect(geometry.coordinates).toEqual(base);
        });

        it(`${id}: vai-e-volta A -> B -> A nao produz NaN quando o rumo inverte`, () => {
            const base = [[-53.0, -30.0], [-52.9, -30.0], [-53.0, -30.0]];
            const geometry = geom.generate(props(base, { symbol_code: id, symbol_size: 1 }), 12);

            expect(geometry.type).toBe('MultiLineString');
            expect(geometry.coordinates.length).toBeGreaterThan(1);

            for (const coord of todasAsCoordenadas(geometry)) {
                expect(Number.isNaN(coord[0])).toBe(false);
                expect(Number.isNaN(coord[1])).toBe(false);
                expect(Number.isFinite(coord[0])).toBe(true);
                expect(Number.isFinite(coord[1])).toBe(true);
            }
        });

        it(`${id}: dobra de 90 graus segue a curva sem vertice infinito`, () => {
            const base = [[-53.0, -30.0], [-52.9, -30.0], [-52.9, -29.9]];
            const geometry = geom.generate(props(base, { symbol_code: id, symbol_size: 0.5 }), 12);

            expect(geometry.type).toBe('MultiLineString');
            for (const dente of geometry.coordinates) {
                for (const coord of dente) {
                    expect(Number.isFinite(coord[0])).toBe(true);
                    expect(Number.isFinite(coord[1])).toBe(true);
                }
                // Nenhum dente pode explodir: o V mais fundo mede meio periodo mais
                // a profundidade, e nada perto do tamanho da linha.
                expect(comprimentoKm(dente)).toBeLessThan(5);
            }
        });
    }
});

describe('pior caso: o clamp de flatRatio', () => {
    it('flatRatio 5 e cortado em 0,9, e o dente nao degenera', () => {
        const base = linhaReta(10);
        const line = turf.lineString(base);
        const periodoKm = 0.5;

        const [dente] = geom.zigzagTooth(line, 1, 1 + periodoKm, { depthRatio: 0.6, flatRatio: 5 });

        expect(dente).toHaveLength(4);

        const patamar = metros(dente[0], dente[1]);
        // 0,9 do periodo, e nao 5 periodos: sem o clamp o canto cairia a 2,5 km
        // adiante e o V viraria um traco para tras.
        expect(perto(patamar, periodoKm * 1000 * 0.9)).toBe(true);
        // O que sobra do periodo ainda desenha um V de verdade.
        expect(metros(dente[1], dente[3])).toBeGreaterThan(periodoKm * 1000 * 0.09);
        expect(perto(apiceDe(dente, base).profundidade, periodoKm * 1000 * 0.6)).toBe(true);

        for (const coord of dente) {
            expect(Number.isFinite(coord[0])).toBe(true);
            expect(Number.isFinite(coord[1])).toBe(true);
        }
    });

    it('flatRatio negativo cai para zero e devolve o V de 3 pontos', () => {
        const base = linhaReta(10);
        const line = turf.lineString(base);

        const [dente] = geom.zigzagTooth(line, 1, 1.5, { depthRatio: 0.6, flatRatio: -1 });

        expect(dente).toHaveLength(3);
        expect(patamarMetros(dente, base)).toBe(0);
    });

    it('periodo nao positivo nao emite dente nenhum', () => {
        const line = turf.lineString(linhaReta(10));
        expect(geom.zigzagTooth(line, 1, 1, LINEAR_SYMBOLS[SAPA])).toEqual([]);
        expect(geom.zigzagTooth(line, 2, 1, LINEAR_SYMBOLS[TRINCHEIRA])).toEqual([]);
    });
});

// ============================================================================
// THE RULER AGAINST THE WORST CASE — it has to REPROVE, not merely pass
// ============================================================================

describe('a regua reprova o insumo degenerado', () => {
    /** The degenerate teeth are built by the REAL builder, fed a mutated symbol. */
    const bancada = () => {
        const base = linhaReta(10);
        return { base, line: turf.lineString(base), periodo: comprimentoKm(base) / 20 };
    };

    it('a sapa desenhada com o patamar da trincheira nao passa por sapa', () => {
        const { base, line, periodo } = bancada();
        const [mutante] = geom.zigzagTooth(line, 0, periodo, { depthRatio: 0.6, flatRatio: 0.41 });

        // As duas assercoes que definem a sapa reprovam este dente.
        expect(mutante).not.toHaveLength(3);
        expect(patamarMetros(mutante, base)).toBeGreaterThan(200);
    });

    it('a trincheira desenhada sem patamar nao passa por trincheira', () => {
        const { base, line, periodo } = bancada();
        const [mutante] = geom.zigzagTooth(line, 0, periodo, { depthRatio: 0.7, flatRatio: 0 });

        expect(mutante).not.toHaveLength(4);
        expect(perto(patamarMetros(mutante, base) / (periodo * 1000), 0.41)).toBe(false);
    });

    it('a sapa com a profundidade da trincheira e reprovada pela medida', () => {
        const { base, line, periodo } = bancada();
        const [mutante] = geom.zigzagTooth(line, 0, periodo, { depthRatio: 0.7, flatRatio: 0 });
        const { profundidade } = apiceDe(mutante, base);

        expect(perto(profundidade, periodo * 1000 * 0.6)).toBe(false);
        expect(perto(profundidade, periodo * 1000 * 0.7)).toBe(true);
    });

    it('a tolerancia de 2% reprova um erro de 5% na profundidade', () => {
        const { base, line, periodo } = bancada();
        const [mutante] = geom.zigzagTooth(line, 0, periodo, { depthRatio: 0.63, flatRatio: 0 });

        // 15 m de erro num apice de 300 m: a fita pega, e e o que separa uma
        // profundidade lida na prancha de uma inventada.
        expect(perto(apiceDe(mutante, base).profundidade, periodo * 1000 * 0.6)).toBe(false);
    });

    it('a sapa com os dois ratios da trincheira reprova o padrao INTEIRO, nao so um dente', () => {
        const base = linhaReta(10);
        const line = turf.lineString(base);
        const pattern = resolveContinuousLayout(comprimentoKm(base), 0.5);
        const periodoM = pattern.period * 1000;

        // O caminho continuo inteiro, com a entrada de catalogo trocada: e o que
        // uma edicao descuidada dos ratios da sapa produziria na tela.
        const dentes = geom.buildContinuousPattern(line, pattern, {
            glyph: 'zigzag', depthRatio: 0.7, flatRatio: 0.41,
        });

        expect(dentes).toHaveLength(pattern.count);
        for (const dente of dentes) {
            expect(dente).not.toHaveLength(3);
            expect(patamarMetros(dente, base)).toBeGreaterThan(200);
            expect(perto(apiceDe(dente, base).profundidade, periodoM * 0.6)).toBe(false);
        }
    });

    it('a espinha vazada junto dos dentes e pega pela contagem, pelo vertice e pelo comprimento', () => {
        const base = Array.from({ length: 6 }, (_, i) => [-53 + i * 0.02, -30 + (i % 2) * 0.008]);
        const total = comprimentoKm(base);
        const esperado = resolveContinuousLayout(total, 0.5).count;
        const geometry = geom.generate(props(base, { symbol_code: SAPA }), 12);

        // O desenho que teria uma corda atravessando os dentes.
        const vazado = [...geometry.coordinates, base];
        const intruso = vazado.at(-1);

        expect(vazado.length).not.toBe(esperado);
        expect(intruso.length).toBeGreaterThan(4);
        expect(comprimentoKm(intruso)).toBeGreaterThan(total * 0.5);
        expect(JSON.stringify(intruso)).toBe(JSON.stringify(base));
    });

    it('um padrao que para antes do fim deixa um toco de linha reta, e a regua o pega', () => {
        const base = linhaReta(10);
        const geometry = geom.generate(props(base, { symbol_code: TRINCHEIRA }), 12);
        const truncado = geometry.coordinates.slice(0, -1);

        // Meio quilometro de linha reta no fim, contra os 5 cm que a regua tolera.
        expect(metros(truncado.at(-1).at(-1), base.at(-1))).toBeGreaterThan(400);
    });

    it('um dente deslocado abre uma emenda que a regua nao aceita', () => {
        const { line, periodo } = bancada();
        const [primeiro] = geom.zigzagTooth(line, 0, periodo, LINEAR_SYMBOLS[SAPA]);
        const [deslocado] = geom.zigzagTooth(line, periodo * 1.02, periodo * 2, LINEAR_SYMBOLS[SAPA]);

        // Dez metros de fenda, contra o milimetro que a regua da emenda tolera.
        expect(metros(primeiro.at(-1), deslocado[0])).toBeGreaterThan(0.001);
    });

    it('o catalogo rechaveado por codigo perde a sapa em silencio', () => {
        const porCodigo = {};
        for (const simbolo of Object.values(LINEAR_SYMBOLS)) porCodigo[simbolo.code] = simbolo;

        // Um simbolo a menos, sem erro em lugar nenhum: o ultimo literal vence.
        expect(Object.keys(porCodigo)).toHaveLength(Object.keys(LINEAR_SYMBOLS).length - 1);
        expect(porCodigo['290999'].name).toBe('Trincheira');
        expect(Object.values(porCodigo).some(s => s.name === 'Sapa')).toBe(false);
    });

    it('sem o clamp de 0,9 o canto do patamar cairia fora do proprio dente', () => {
        const { line, periodo } = bancada();
        const inicio = 1;

        // O que `flatRatio: 5` pediria sem o corte: o canto 5 periodos adiante,
        // muito depois do fim do dente, com o V apontando para tras.
        const semClamp = turf.along(line, inicio + periodo * 5, { units: 'kilometers' }).geometry.coordinates;
        const fimDoDente = turf.along(line, inicio + periodo, { units: 'kilometers' }).geometry.coordinates;
        const [dente] = geom.zigzagTooth(line, inicio, inicio + periodo, { depthRatio: 0.6, flatRatio: 5 });

        expect(metros(semClamp, fimDoDente)).toBeGreaterThan(periodo * 1000 * 3);
        // Com o clamp, o canto fica DENTRO do dente, a um decimo do fim.
        expect(metros(dente[1], fimDoDente)).toBeLessThan(periodo * 1000 * 0.11);
    });
});

// ============================================================================
// THE SWEEP — every coordinate of every case above
// ============================================================================

describe('toda coordenada emitida e finita e cabe no planeta', () => {
    const cenarios = () => [
        ['reta de 10 km', linhaReta(10), {}],
        ['reta de 100 km capada', linhaReta(100), { symbol_size: 0.001 }],
        ['comprimento zero', [[-53.0, -30.0], [-53.0, -30.0]], {}],
        ['1 m com simbolo padrao', linhaReta(0.001), {}],
        ['1 m com o menor simbolo', linhaReta(0.001), { symbol_size: 0.0001 }],
        ['1,2 m com o menor simbolo', linhaReta(0.0012), { symbol_size: 0.0001 }],
        ['simbolo maior que a linha', linhaReta(1), { symbol_size: 40 }],
        ['vai-e-volta', [[-53.0, -30.0], [-52.9, -30.0], [-53.0, -30.0]], { symbol_size: 1 }],
        ['dobra de 90 graus', [[-53.0, -30.0], [-52.9, -30.0], [-52.9, -29.9]], {}],
        ['quebrada de 6 vertices', Array.from({ length: 6 }, (_, i) => [-53 + i * 0.02, -30 + (i % 2) * 0.008]), {}],
        ['perto do polo', [[-53.0, -84.0], [-52.0, -84.0]], { symbol_size: 2 }],
        ['cruzando o equador', [[-53.0, -0.5], [-53.0, 0.5]], { symbol_size: 5 }],
    ];

    for (const id of [SAPA, TRINCHEIRA]) {
        for (const [nome, base, extra] of cenarios()) {
            it(`${id}, ${nome}: nenhuma coordenada NaN, infinita ou fora de [-90, 90]`, () => {
                const geometry = geom.generate(props(base, { symbol_code: id, ...extra }), 12);
                const coords = todasAsCoordenadas(geometry);

                expect(coords.length).toBeGreaterThan(0);
                for (const coord of coords) {
                    expect(Array.isArray(coord)).toBe(true);
                    expect(Number.isFinite(coord[0])).toBe(true);
                    expect(Number.isFinite(coord[1])).toBe(true);
                    expect(coord[1]).toBeGreaterThanOrEqual(-90);
                    expect(coord[1]).toBeLessThanOrEqual(90);
                }
            });
        }
    }
});
