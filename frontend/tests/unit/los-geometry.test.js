// Path: tests/unit/los-geometry.test.js

/**
 * @fileoverview Pins `frontend/src/js/analysis_tools/los_tool/add_los_geometry.js`:
 * validation, the terrain obstruction sweep (`calculateLOS`), the elevation profile
 * (`calculateProfile`) and the surrounding pure helpers.
 *
 * WHAT THIS SUITE PINS
 * - `validate` (including the Infinity hole), `generate`,
 *   `extractCoordinatesFromGeometry`, `getBoundingBox`, `calculateLOSDistance`,
 *   `formatDistance`, `getMidpoint`, `generateProcessedFeatures`, `createHandles`,
 *   `updateFromHandle`, `getCoordinatesForMovement`.
 * - `calculateLOS`: the strict `>` comparison against the interpolated line of
 *   sight, the length bookkeeping invariant (visible + obstructed === total), the
 *   fact that the two ENDPOINTS are never sampled, and what unprotected NaN in
 *   `samplePoints` does to the verdict.
 * - `calculateProfile`: the entry count in absolute terms, the exact endpoints of
 *   the interpolated line-of-sight elevation, the slope percentage, the
 *   `deltaDistance > 0` guard and the "first inherits the second" rule.
 * - `createLOSFeature` / `recalculateFromCoordinates`: the MultiLineString vs
 *   LineString branch and the serialized profile.
 *
 * WHAT IT DOES NOT REACH
 * - `add_los_control.js` and `los_attributes_panel.js` (MapLibre, DOM, store).
 * - The real `getTerrainElevation` (mocked) and the real turf (stubbed with a
 *   deterministic 2-point linear model): this suite measures the module's logic on
 *   top of them, never their own correctness.
 * - The chart rendering of the profile, and the `processed_los` output as a NAMED
 *   thing: that output is drawn and never labelled, which is a legitimate state of
 *   the feature-type registry, so no label or icon is asserted here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// See the twin note in tests/unit/visibility-geometry.test.js: the `@tools` barrel
// drags DOM/MapLibre modules, but `calculateDistance` is genuinely inherited and is
// wired to the real leaf haversine so distance-gated behaviour is not measured
// against a stub.
vi.mock('@tools', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn() }));

const { getTerrainElevation } = await import('@js/terrain');
const { default: AddLOSGeometry } = await import(
    '../../src/js/analysis_tools/los_tool/add_los_geometry.js'
);

const geom = new AddLOSGeometry();

/**
 * Deterministic 2-point turf stub. `along` interpolates linearly between the two
 * endpoints, so with the line [[0,0],[1,0]] the sampled LONGITUDE is exactly the
 * fraction of the way along, which is what lets the terrain mock be a function of
 * progress without calling any module code.
 * @param {number} totalLength - Length in meters that turf.length will report.
 * @returns {Object} The stub, for call-count assertions.
 */
function stubTurf(totalLength) {
    const stub = {
        totalLength,
        alongCalls: [],
        lineString: vi.fn(coords => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords.map(c => [...c]) },
        })),
        length: vi.fn(() => stub.totalLength),
        along: vi.fn((line, dist) => {
            stub.alongCalls.push(dist);
            const [a, b] = line.geometry.coordinates;
            const t = stub.totalLength === 0 ? 0 : dist / stub.totalLength;
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
            };
        }),
    };
    globalThis.turf = stub;
    return stub;
}

/**
 * Wires the mocked terrain to a profile keyed by the fraction of the way along,
 * which the turf stub above puts straight into the longitude.
 * @param {Function} perfil - (fraction) => elevation in meters
 */
function terrenoPorFracao(perfil) {
    vi.mocked(getTerrainElevation).mockImplementation(async (_map, coord) => perfil(coord[0]));
}

/** A straight west-to-east line whose longitude doubles as the progress fraction. */
const LINHA = [[0, 0], [1, 0]];

let warnSpy;
let errSpy;
beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    warnSpy.mockRestore();
    errSpy.mockRestore();
    vi.mocked(getTerrainElevation).mockReset();
    delete globalThis.turf;
});

// ============================================================================
// validate / isValidLOS
// ============================================================================

describe('AddLOSGeometry.validate', () => {
    it('aceita exatamente dois pontos numericos', () => {
        expect(geom.validate([[0, 0], [1, 1]])).toBe(true);
    });

    it('aceita coordenada 3D (length >= 2 por ponto)', () => {
        expect(geom.validate([[0, 0, 500], [1, 1, 600]])).toBe(true);
    });

    it('recusa comprimento diferente de 2, nos dois sentidos', () => {
        expect(geom.validate([[0, 0]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 1], [2, 2]])).toBe(false);
        expect(geom.validate([])).toBe(false);
    });

    it('recusa nao-array e ponto nao-array', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
        expect(geom.validate('0,0;1,1')).toBe(false);
        expect(geom.validate([[0, 0], '1,1'])).toBe(false);
    });

    it('recusa NaN e coordenada em string', () => {
        expect(geom.validate([[NaN, 0], [1, 1]])).toBe(false);
        expect(geom.validate([[0, NaN], [1, 1]])).toBe(false);
        expect(geom.validate([['0', '0'], [1, 1]])).toBe(false);
    });

    it('aceita zero e negativos (nao ha guarda de falsy)', () => {
        expect(geom.validate([[0, 0], [-0, -0]])).toBe(true);
        expect(geom.validate([[-180, -90], [180, 90]])).toBe(true);
    });

    it('isValidLOS e o mesmo predicado', () => {
        expect(geom.isValidLOS([[0, 0], [1, 1]])).toBe(geom.validate([[0, 0], [1, 1]]));
        expect(geom.isValidLOS([[0, 0]])).toBe(false);
    });

    // ------------------------------------------------------------- fixed defect
    it('CONTROLE: validate discrimina, NaN e recusado', () => {
        expect(geom.validate([[NaN, 0], [1, 1]])).toBe(false);
    });

    it('DEFEITO CORRIGIDO: validate recusa Infinity, o guarda virou Number.isFinite', () => {
        expect(geom.validate([[Infinity, 0], [1, 1]])).toBe(false);
        expect(geom.validate([[0, -Infinity], [1, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, Infinity]])).toBe(false);
    });

    it('isValidLOS herda a correcao, porque e o MESMO predicado', () => {
        expect(geom.isValidLOS([[Infinity, 0], [1, 1]])).toBe(false);
    });
});

// ============================================================================
// generate / extractCoordinatesFromGeometry / getCoordinatesForMovement
// ============================================================================

describe('AddLOSGeometry.generate', () => {
    it('embrulha as coordenadas num LineString', () => {
        expect(geom.generate([[0, 0], [1, 1]]))
            .toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('OBSERVADO: NAO copia, o array de entrada vira o array da geometria', () => {
        const coords = [[0, 0], [1, 1]];
        const g = geom.generate(coords);
        expect(g.coordinates).toBe(coords);
        coords.push([2, 2]);
        expect(g.coordinates).toHaveLength(3);
    });

    it('nao valida nada: entrada absurda atravessa', () => {
        expect(geom.generate(null).coordinates).toBeNull();
    });
});

describe('AddLOSGeometry.extractCoordinatesFromGeometry', () => {
    it('LineString: primeiro e ultimo vertices', () => {
        const g = { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] };
        expect(geom.extractCoordinatesFromGeometry(g)).toEqual([[0, 0], [2, 2]]);
    });

    it('LineString de um ponto so: o mesmo vertice duas vezes, por referencia', () => {
        const p = [5, 5];
        const out = geom.extractCoordinatesFromGeometry({ type: 'LineString', coordinates: [p] });
        expect(out[0]).toBe(p);
        expect(out[1]).toBe(p);
    });

    it('MultiLineString: inicio da PRIMEIRA linha e fim da SEGUNDA', () => {
        const g = {
            type: 'MultiLineString',
            coordinates: [[[0, 0], [5, 5]], [[5, 5], [9, 9]]],
        };
        expect(geom.extractCoordinatesFromGeometry(g)).toEqual([[0, 0], [9, 9]]);
    });

    it('OBSERVADO: uma terceira linha e simplesmente ignorada', () => {
        const g = {
            type: 'MultiLineString',
            coordinates: [[[0, 0]], [[5, 5]], [[100, 100]]],
        };
        expect(geom.extractCoordinatesFromGeometry(g)).toEqual([[0, 0], [5, 5]]);
    });

    it('OBSERVADO: MultiLineString com UMA linha so lanca (segunda linha undefined)', () => {
        const g = { type: 'MultiLineString', coordinates: [[[0, 0], [5, 5]]] };
        expect(() => geom.extractCoordinatesFromGeometry(g)).toThrow(TypeError);
    });

    it('tipo desconhecido -> null com aviso', () => {
        expect(geom.extractCoordinatesFromGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('getCoordinatesForMovement delega', () => {
        const g = { type: 'LineString', coordinates: [[0, 0], [3, 3]] };
        expect(geom.getCoordinatesForMovement(g)).toEqual([[0, 0], [3, 3]]);
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddLOSGeometry.getBoundingBox', () => {
    it('ordena para [minLng, minLat, maxLng, maxLat]', () => {
        expect(geom.getBoundingBox([[10, 20], [-5, 3]])).toEqual([-5, 3, 10, 20]);
        expect(geom.getBoundingBox([[-5, 3], [10, 20]])).toEqual([-5, 3, 10, 20]);
    });

    it('coordenadas invalidas -> [0,0,0,0]', () => {
        expect(geom.getBoundingBox([[NaN, 0], [1, 1]])).toEqual([0, 0, 0, 0]);
        expect(geom.getBoundingBox(null)).toEqual([0, 0, 0, 0]);
        expect(geom.getBoundingBox([[0, 0], [1, 1], [2, 2]])).toEqual([0, 0, 0, 0]);
    });

    it('linha degenerada -> caixa de area zero', () => {
        expect(geom.getBoundingBox([[7, 7], [7, 7]])).toEqual([7, 7, 7, 7]);
    });

    it('property: os dois extremos caem SEMPRE dentro da caixa', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            (a, b, c, d) => {
                const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox([[a, b], [c, d]]);
                expect(minLng).toBeLessThanOrEqual(maxLng);
                expect(minLat).toBeLessThanOrEqual(maxLat);
                [[a, b], [c, d]].forEach(([lng, lat]) => {
                    expect(lng).toBeGreaterThanOrEqual(minLng);
                    expect(lng).toBeLessThanOrEqual(maxLng);
                    expect(lat).toBeGreaterThanOrEqual(minLat);
                    expect(lat).toBeLessThanOrEqual(maxLat);
                });
            },
        ));
    });

    it('OBSERVADO: no antimeridiano a caixa ingenua cobre o globo inteiro', () => {
        // Two points 2 degrees apart, but the box that comes out is 358 wide.
        expect(geom.getBoundingBox([[179, 0], [-179, 0]])).toEqual([-179, 0, 179, 0]);
    });
});

// ============================================================================
// calculateLOSDistance / formatDistance / getMidpoint
// ============================================================================

describe('AddLOSGeometry.calculateLOSDistance', () => {
    it('um grau de latitude na haversine esferica de R = 6371 km', () => {
        expect(geom.calculateLOSDistance([[0, 0], [0, 1]]))
            .toBeCloseTo(6371000 * Math.PI / 180, 6);
    });

    it('coordenadas invalidas -> 0, sem lancar', () => {
        expect(geom.calculateLOSDistance(null)).toBe(0);
        expect(geom.calculateLOSDistance([[0, 0], [1, 1], [2, 2]])).toBe(0);
    });

    it('pontos coincidentes -> 0', () => {
        expect(geom.calculateLOSDistance([[3, 4], [3, 4]])).toBe(0);
    });

    it('e simetrico', () => {
        const ida = geom.calculateLOSDistance([[0, 0], [10, 20]]);
        const volta = geom.calculateLOSDistance([[10, 20], [0, 0]]);
        expect(ida).toBeCloseTo(volta, 9);
    });
});

describe('AddLOSGeometry.formatDistance', () => {
    it('abaixo de 1000 m sai em metros com duas casas', () => {
        expect(geom.formatDistance(0)).toBe('0.00 m');
        expect(geom.formatDistance(999.99)).toBe('999.99 m');
    });

    it('a fronteira 1000 e INCLUSIVA no ramo de km', () => {
        expect(geom.formatDistance(1000)).toBe('1.00 km');
        expect(geom.formatDistance(1500)).toBe('1.50 km');
    });

    it('OBSERVADO: 999.999 m e arredondado para "1000.00 m", nao para "1.00 km"', () => {
        // The branch tests the raw number, the rounding happens afterwards, so the
        // string can announce a thousand metres while staying on the metre branch.
        expect(geom.formatDistance(999.999)).toBe('1000.00 m');
    });

    it('OBSERVADO: negativo, NaN e Infinity atravessam sem recusa', () => {
        expect(geom.formatDistance(-50)).toBe('-50.00 m');
        expect(geom.formatDistance(NaN)).toBe('NaN m');
        expect(geom.formatDistance(Infinity)).toBe('Infinity km');
    });

    it('OBSERVADO: null e undefined LANCAM (nao ha guarda de tipo)', () => {
        expect(() => geom.formatDistance(null)).toThrow(TypeError);
        expect(() => geom.formatDistance(undefined)).toThrow(TypeError);
    });
});

describe('AddLOSGeometry.getMidpoint', () => {
    it('coordenadas invalidas -> [0,0] sem tocar em turf', () => {
        const turfStub = stubTurf(1000);
        expect(geom.getMidpoint(null)).toEqual([0, 0]);
        expect(turfStub.along).not.toHaveBeenCalled();
    });

    it('pede a turf o ponto na METADE do comprimento', () => {
        const turfStub = stubTurf(1000);
        expect(geom.getMidpoint(LINHA)).toEqual([0.5, 0]);
        expect(turfStub.alongCalls).toEqual([500]);
    });
});

// ============================================================================
// calculateLOS
// ============================================================================

describe('AddLOSGeometry.calculateLOS', () => {
    it('recusa coordenadas invalidas antes de qualquer conta', async () => {
        stubTurf(1000);
        await expect(geom.calculateLOS([[0, 0]], {}))
            .rejects.toThrow('Invalid coordinates for LOS calculation');
        expect(getTerrainElevation).not.toHaveBeenCalled();
    });

    it('terreno plano: sem obstrucao, obstructed null e os comprimentos batem', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).toBeNull();
        expect(r.visibleLength).toBe(1000);
        expect(r.obstructedLength).toBe(0);
        expect(r.totalLength).toBe(1000);
        expect(r.visible.geometry.coordinates).toEqual([[0, 0], [1, 0]]);
    });

    it('crista no meio: corta na PRIMEIRA travessia e reparte o comprimento', async () => {
        stubTurf(1000);
        // observer 1.5, target 0: the line of sight falls from 1.5 to 0 across the run,
        // so a 100 m hill at the halfway sample is the first crossing.
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 100 : 0));
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).not.toBeNull();
        expect(r.visibleLength).toBe(500);
        expect(r.obstructedLength).toBe(500);
        expect(r.visible.geometry.coordinates).toEqual([[0, 0], [0.5, 0]]);
        expect(r.obstructed.geometry.coordinates).toEqual([[0.5, 0], [1, 0]]);
    });

    it('para na PRIMEIRA crista, ignorando a segunda mais alta', async () => {
        stubTurf(1000);
        terrenoPorFracao((f) => {
            if (f > 0.25 && f < 0.35) return 50;
            if (f > 0.65 && f < 0.75) return 500;
            return 0;
        });
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.visibleLength).toBe(300);
        expect(r.obstructedLength).toBe(700);
    });

    it('property: visivel + obstruido === total, com e sem obstrucao', () => {
        return fc.assert(fc.asyncProperty(
            fc.double({ min: 0.05, max: 0.95, noNaN: true }),
            fc.double({ min: 0, max: 200, noNaN: true }),
            async (posicao, altura) => {
                stubTurf(1000);
                terrenoPorFracao(f => (Math.abs(f - posicao) < 0.04 ? altura : 0));
                const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
                expect(r.visibleLength + r.obstructedLength).toBeCloseTo(r.totalLength, 6);
                expect(r.visibleLength).toBeGreaterThanOrEqual(0);
                expect(r.obstructedLength).toBeGreaterThanOrEqual(0);
            },
        ), { numRuns: 40 });
    });

    it('a comparacao e ESTRITA: terreno IGUAL a linha de visada nao obstrui', async () => {
        stubTurf(1000);
        // observer 0 and target 0 over flat ground puts the line of sight exactly at 0.
        terrenoPorFracao(() => 0);
        const r = await geom.calculateLOS(LINHA, {}, {
            samplePoints: 10, observerHeight: 0, targetHeight: 0,
        });
        expect(r.obstructed).toBeNull();
    });

    it('CONTROLE do estrito: um nanometro acima da visada JA obstrui', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 1e-9 : 0));
        const r = await geom.calculateLOS(LINHA, {}, {
            samplePoints: 10, observerHeight: 0, targetHeight: 0,
        });
        expect(r.obstructed).not.toBeNull();
        expect(r.visibleLength).toBe(500);
    });

    it('observerHeight maior levanta a visada e desobstrui', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 100 : 0));
        const baixo = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        const alto = await geom.calculateLOS(LINHA, {}, {
            samplePoints: 10, observerHeight: 500,
        });
        expect(baixo.obstructed).not.toBeNull();
        expect(alto.obstructed).toBeNull();
    });

    it('targetHeight levanta a ponta oposta da visada', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.85 && f < 0.95 ? 30 : 0));
        const semAlvo = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        const comAlvo = await geom.calculateLOS(LINHA, {}, {
            samplePoints: 10, targetHeight: 200,
        });
        expect(semAlvo.obstructed).not.toBeNull();
        expect(comAlvo.obstructed).toBeNull();
    });

    it('observerHeight 0 explicito sobrevive ao ?? (nao cai para 1.5)', async () => {
        stubTurf(1000);
        // With observer 1.5 the sight line clears a 1 m bump at the first sample;
        // with an explicit 0 it does not.
        terrenoPorFracao(f => (f > 0.05 && f < 0.15 ? 1 : 0));
        const padrao = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        const zero = await geom.calculateLOS(LINHA, {}, {
            samplePoints: 10, observerHeight: 0,
        });
        expect(padrao.obstructed).toBeNull();
        expect(zero.obstructed).not.toBeNull();
    });

    it('OBSERVADO: os DOIS extremos nunca sao amostrados (i vai de 1 a steps-1)', async () => {
        const turfStub = stubTurf(1000);
        terrenoPorFracao(() => 0);
        await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(turfStub.alongCalls).toHaveLength(9);
        expect(turfStub.alongCalls[0]).toBe(100);
        expect(turfStub.alongCalls[8]).toBe(900);
        expect(turfStub.alongCalls).not.toContain(0);
        expect(turfStub.alongCalls).not.toContain(1000);
    });

    it('OBSERVADO: uma parede exatamente no ponto final passa despercebida', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f >= 0.999 ? 9000 : 0));
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).toBeNull();
    });

    it('samplePoints 0 sobrevive ao ?? e cai no piso de 2 passos (uma amostra so)', async () => {
        const turfStub = stubTurf(1000);
        terrenoPorFracao(() => 0);
        await geom.calculateLOS(LINHA, {}, { samplePoints: 0 });
        expect(turfStub.alongCalls).toEqual([500]);
    });

    it('samplePoints 1 tambem cai no piso de 2', async () => {
        const turfStub = stubTurf(1000);
        terrenoPorFracao(() => 0);
        await geom.calculateLOS(LINHA, {}, { samplePoints: 1 });
        expect(turfStub.alongCalls).toEqual([500]);
    });

    it('o padrao de 100 amostras produz 99 consultas intermediarias', async () => {
        const turfStub = stubTurf(1000);
        terrenoPorFracao(() => 0);
        await geom.calculateLOS(LINHA, {});
        expect(turfStub.alongCalls).toHaveLength(99);
    });

    // ------------------------------------------------------------- fixed defect
    it('CONTROLE: com samplePoints numerico a montanha e detectada', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 5000 : 0));
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).not.toBeNull();
    });

    /**
     * A real 5 km peak: ground at 0 at BOTH endpoints and a summit across the middle.
     * A uniform 5000 m plateau does NOT obstruct anything (the observer stands on it and
     * the sight line runs 1.5 m above it), which is what the first version of this block
     * used; that made the case fail for a reason unrelated to the sample count.
     * @param {number} f - Fraction of the way along the line.
     * @returns {number} Elevation in meters.
     */
    const montanha = f => (f > 0.4 && f < 0.6 ? 5000 : 0);

    it('samplePoints NaN volta a amostrar, com a contagem PADRAO', async () => {
        // Was zero samples and an empty alongCalls; the fallback is DEFAULT_SAMPLE_POINTS,
        // so the sweep does the same 99 intermediate queries as the default path. Flat
        // ground here on purpose: an obstruction breaks the loop early and would hide the
        // count being measured.
        const turfStub = stubTurf(1000);
        terrenoPorFracao(() => 0);
        await geom.calculateLOS(LINHA, {}, { samplePoints: NaN });
        expect(turfStub.alongCalls).toHaveLength(99);
    });

    it('CONTROLE da montanha: com 10 amostras ela ja e detectada', async () => {
        stubTurf(1000);
        terrenoPorFracao(montanha);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).not.toBeNull();
    });

    it('DEFEITO CORRIGIDO: samplePoints NaN nao falha mais ABERTO, a montanha de 5 km aparece', async () => {
        stubTurf(1000);
        terrenoPorFracao(montanha);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: NaN });
        expect(r.obstructed).not.toBeNull();
        expect(r.obstructedLength).toBeGreaterThan(0);
        expect(r.visibleLength).toBeLessThan(r.totalLength);
    });

    it('Infinity, string e null tambem caem no padrao, sem laco infinito e sem o piso', async () => {
        const ruins = [Infinity, -Infinity, '10', null, undefined];
        expect(ruins).toHaveLength(5);
        for (const ruim of ruins) {
            const turfStub = stubTurf(1000);
            terrenoPorFracao(montanha);
            const r = await geom.calculateLOS(LINHA, {}, { samplePoints: ruim });
            expect(turfStub.alongCalls.length, `samplePoints ${String(ruim)}`)
                .toBeLessThanOrEqual(99);
            expect(r.obstructed, `samplePoints ${String(ruim)}`).not.toBeNull();
        }
    });
});

// ============================================================================
// calculateProfile
// ============================================================================

describe('AddLOSGeometry.calculateProfile', () => {
    it('recusa coordenadas invalidas', async () => {
        stubTurf(1000);
        await expect(geom.calculateProfile([[0, 0]], {}))
            .rejects.toThrow('Invalid coordinates for profile calculation');
    });

    it('devolve passos + 1 entradas, e a contagem e asserida antes de qualquer laco', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        p.forEach(e => expect(Object.keys(e).sort())
            .toEqual(['distance', 'elevation', 'losElevation', 'slope']));
    });

    it('o padrao PROFILE_STEPS de 25 rende 26 entradas', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        expect(await geom.calculateProfile(LINHA, {})).toHaveLength(26);
    });

    it('as distancias vao de 0 ate o comprimento, em passo constante', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        expect(p[0].distance).toBe(0);
        expect(p[10].distance).toBeCloseTo(1000, 9);
        expect(p.map(e => e.distance)).toEqual(
            [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
        );
    });

    it('a visada interpolada casa os DOIS extremos em absoluto', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f < 0.5 ? 100 : 300));
        const p = await geom.calculateProfile(LINHA, {}, {
            samplePoints: 10, observerHeight: 2, targetHeight: 8,
        });
        expect(p).toHaveLength(11);
        expect(p[0].losElevation).toBe(102);   // terrain 100 + observer 2
        expect(p[10].losElevation).toBeCloseTo(308, 9); // terrain 300 + target 8
        expect(p[5].losElevation).toBeCloseTo(205, 9);  // exactly halfway
    });

    it('terreno plano: declividade 0 em todas as entradas', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 42);
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        expect(p.every(e => e.slope === 0)).toBe(true);
        expect(p.every(e => e.elevation === 42)).toBe(true);
    });

    it('rampa constante: declividade em porcento, subida sobre percurso', async () => {
        stubTurf(1000);
        // 100 m of rise over 1000 m of run, sampled every 100 m: 10 m per 100 m = 10%.
        terrenoPorFracao(f => 100 * f);
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        p.forEach(e => expect(e.slope).toBeCloseTo(10, 9));
    });

    it('descida da declividade NEGATIVA', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => 100 - 100 * f);
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        expect(p[5].slope).toBeCloseTo(-10, 9);
    });

    it('a PRIMEIRA entrada herda a declividade da segunda', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f === 0 ? 0 : 500));
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        expect(p[1].slope).toBeCloseTo(500, 9);
        expect(p[0].slope).toBe(p[1].slope);
    });

    it('linha de comprimento zero: a guarda deltaDistance > 0 segura as declividades', async () => {
        stubTurf(0);
        terrenoPorFracao(() => 10);
        const p = await geom.calculateProfile([[0, 0], [0, 0]], {}, { samplePoints: 10 });
        expect(p).toHaveLength(11);
        expect(p.every(e => e.distance === 0)).toBe(true);
        expect(p.every(e => e.slope === 0)).toBe(true);
        expect(p.every(e => Number.isFinite(e.slope))).toBe(true);
    });

    it('OBSERVADO: samplePoints 0 devolve UMA entrada com distancia NaN', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        // stepLength = 1000 / 0 = Infinity, and 0 * Infinity is NaN.
        const p = await geom.calculateProfile(LINHA, {}, { samplePoints: 0 });
        expect(p).toHaveLength(1);
        expect(p[0].distance).toBeNaN();
    });

    it('OBSERVADO: samplePoints negativo devolve lista VAZIA, sem lancar', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        expect(await geom.calculateProfile(LINHA, {}, { samplePoints: -1 })).toEqual([]);
    });
});

// ============================================================================
// generateProcessedFeatures
// ============================================================================

describe('AddLOSGeometry.generateProcessedFeatures', () => {
    it('MultiLineString -> duas features, verde primeiro e vermelho depois', () => {
        const f = {
            properties: { id: 'los1', outra: 'x' },
            geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] },
        };
        const out = geom.generateProcessedFeatures(f);
        expect(out).toHaveLength(2);
        expect(out[0].id).toBe('los1-visible');
        expect(out[0].properties.color).toBe('#00FF00');
        expect(out[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(out[1].id).toBe('los1-obstructed');
        expect(out[1].properties.color).toBe('#FF0000');
        expect(out[1].geometry).toEqual({ type: 'LineString', coordinates: [[1, 1], [2, 2]] });
        expect(out[0].properties.outra).toBe('x');
    });

    it('o id de dentro das properties tambem e reescrito, nao so o id da feature', () => {
        const f = {
            properties: { id: 'los1' },
            geometry: { type: 'MultiLineString', coordinates: [[[0, 0]], [[1, 1]]] },
        };
        const out = geom.generateProcessedFeatures(f);
        expect(out[0].properties.id).toBe('los1-visible');
        expect(out[1].properties.id).toBe('los1-obstructed');
    });

    it('LineString -> UMA feature, so a verde', () => {
        const f = {
            properties: { id: 'los2' },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        };
        const out = geom.generateProcessedFeatures(f);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('los2-visible');
        expect(out[0].properties.color).toBe('#00FF00');
    });

    it('OBSERVADO: no ramo LineString a geometria e COMPARTILHADA por referencia', () => {
        const f = {
            properties: { id: 'los2' },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        };
        const out = geom.generateProcessedFeatures(f);
        expect(out[0].geometry).toBe(f.geometry);
    });

    it('OBSERVADO: id ausente vira a string "undefined-visible"', () => {
        const f = { properties: {}, geometry: { type: 'LineString', coordinates: [] } };
        expect(geom.generateProcessedFeatures(f)[0].id).toBe('undefined-visible');
    });

    it('OBSERVADO: MultiLineString com UMA linha gera a segunda feature sem coordenadas', () => {
        const f = {
            properties: { id: 'los3' },
            geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
        };
        const out = geom.generateProcessedFeatures(f);
        expect(out).toHaveLength(2);
        expect(out[1].geometry.coordinates).toBeUndefined();
    });
});

// ============================================================================
// createLOSFeature / recalculateFromCoordinates / handles
// ============================================================================

describe('AddLOSGeometry.createLOSFeature', () => {
    it('sem obstrucao: LineString e os tres comprimentos nas properties', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const f = await geom.createLOSFeature(LINHA, { id: 'ignorado' }, {});
        expect(f.geometry.type).toBe('LineString');
        expect(f.properties.totalLength).toBe(1000);
        expect(f.properties.visibleLength).toBe(1000);
        expect(f.properties.obstructedLength).toBe(0);
    });

    it('com obstrucao: MultiLineString de exatamente duas linhas', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 100 : 0));
        const f = await geom.createLOSFeature(LINHA, { id: 'x', samplePoints: 10 }, {});
        expect(f.geometry.type).toBe('MultiLineString');
        expect(f.geometry.coordinates).toHaveLength(2);
    });

    it('o perfil viaja SERIALIZADO em string, e volta por JSON.parse', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 7);
        const f = await geom.createLOSFeature(LINHA, { samplePoints: 10 }, {});
        expect(typeof f.properties.profileData).toBe('string');
        const perfil = JSON.parse(f.properties.profileData);
        expect(perfil).toHaveLength(11);
        expect(perfil[0].elevation).toBe(7);
    });

    it('o id vem do relogio e IGNORA o properties.id recebido', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        const f = await geom.createLOSFeature(LINHA, { id: 'meu-id' }, {});
        expect(f.id).toBe('1700000000000');
        expect(f.properties.id).toBe('meu-id');
        nowSpy.mockRestore();
    });

    it('alturas 0 explicitas sobrevivem ao ?? e sao ecoadas nas properties', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const f = await geom.createLOSFeature(
            LINHA, { observerHeight: 0, targetHeight: 0, samplePoints: 4 }, {},
        );
        expect(f.properties.observerHeight).toBe(0);
        expect(f.properties.targetHeight).toBe(0);
        expect(f.properties.samplePoints).toBe(4);
    });

    it('os defaults da classe entram quando as alturas faltam', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const f = await geom.createLOSFeature(LINHA, {}, {});
        expect(f.properties.observerHeight).toBe(1.5);
        expect(f.properties.targetHeight).toBe(0);
        expect(f.properties.samplePoints).toBe(100);
    });

    it('recusa coordenadas invalidas', async () => {
        stubTurf(1000);
        await expect(geom.createLOSFeature([[0, 0]], {}, {}))
            .rejects.toThrow('Invalid coordinates for LOS feature creation');
    });
});

describe('AddLOSGeometry.recalculateFromCoordinates', () => {
    it('sem obstrucao devolve LineString com perfil', async () => {
        stubTurf(1000);
        terrenoPorFracao(() => 0);
        const out = await geom.recalculateFromCoordinates(LINHA, {}, { samplePoints: 10 });
        expect(out.geometry.type).toBe('LineString');
        expect(out.profileData).toHaveLength(11);
        expect(out.totalLength).toBe(1000);
    });

    it('com obstrucao devolve MultiLineString emendado no ponto de corte', async () => {
        stubTurf(1000);
        terrenoPorFracao(f => (f > 0.45 && f < 0.55 ? 100 : 0));
        const out = await geom.recalculateFromCoordinates(LINHA, {}, { samplePoints: 10 });
        expect(out.geometry.type).toBe('MultiLineString');
        const [visivel, obstruido] = out.geometry.coordinates;
        expect(visivel[visivel.length - 1]).toEqual(obstruido[0]);
        expect(out.visibleLength + out.obstructedLength).toBeCloseTo(out.totalLength, 9);
    });

    it('recusa coordenadas invalidas antes de tocar em turf', async () => {
        const turfStub = stubTurf(1000);
        await expect(geom.recalculateFromCoordinates([[0, 0], [1, 1], [2, 2]], {}))
            .rejects.toThrow('Invalid coordinates for LOS recalculation');
        expect(turfStub.lineString).not.toHaveBeenCalled();
    });

    it('repassa o erro de baixo depois de registra-lo', async () => {
        stubTurf(1000);
        globalThis.turf.length = () => { throw new Error('turf caiu'); };
        await expect(geom.recalculateFromCoordinates(LINHA, {})).rejects.toThrow('turf caiu');
        expect(errSpy).toHaveBeenCalled();
    });
});

describe('AddLOSGeometry: LOS nao tem edicao por handle', () => {
    it('createHandles devolve lista vazia', () => {
        expect(geom.createHandles({ properties: {} })).toEqual([]);
    });

    it('updateFromHandle devolve null e avisa', () => {
        expect(geom.updateFromHandle('radius', [0, 0], {})).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
    });

    it('isTerrainAvailable compara com null estritamente', () => {
        expect(geom.isTerrainAvailable({ getTerrain: () => null })).toBe(false);
        expect(geom.isTerrainAvailable({ getTerrain: () => ({ source: 'dem' }) })).toBe(true);
    });
});
