// Path: tests/unit/processing-buffer.test.js

/**
 * @fileoverview Pins the `execute` of `frontend/src/js/processing/algorithms/buffer.algorithm.js`
 * (Zona de Influência).
 *
 * HOW IT IS REACHED
 * `executeBuffer` is NOT exported: the module's only public surface is the
 * `registerAlgorithm({ id: 'buffer', ... })` it runs at load. The suite therefore imports
 * the module for its side effect and pulls the function out with `getAlgorithm('buffer')`,
 * which is also how the running app reaches it. The DOM half of the module (the panel) is
 * cut off with mocks of `@tools/helpers/index.js` and `panel-builder.js`, since
 * `panel-builder.js` imports `@store/layer.operations.js` and would drag the whole store
 * into a `node` test.
 *
 * WHAT THIS SUITE PINS
 * - the MultiPolygon fan-out (one output feature per polygon) that the module's own
 *   comment says exists to keep `baseCoordinates` a flat ring;
 * - that `baseCoordinates` is the ring WITHOUT the closing vertex while `geometry` keeps
 *   the closed ring, which is the asymmetry an edit depends on;
 * - that a throwing turf, a null return and a collapsed ring are all survivable and none
 *   of them stops the loop;
 * - that `onProgress` counts INPUT features, not produced ones;
 * - that `distance` reaches turf verbatim, 0 and negative included (this function does not
 *   sanitize; the panel is what refuses `distance <= 0`);
 * - that the temporal window is inherited, `temporalInicio: 0` included.
 *
 * WHAT IT DOES NOT REACH
 * - `createBufferPanel` and its validation (DOM).
 * - Real turf geometry: `window.turf.buffer` is a double throughout, so nothing here says
 *   the buffer is geometrically correct, only that its output is transported correctly.
 * - The store write that consumes these features.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The panel half of the module is DOM- and store-coupled. Neither mock is exercised by
// any test below; they exist only so the module loads under `node`.
vi.mock('@tools/helpers/index.js', () => ({
    createModernNumericInput: vi.fn(() => ({})),
    createSectionDivider: vi.fn(() => ({})),
}));
vi.mock('../../src/js/processing/algorithms/panel-builder.js', () => ({
    buildAlgorithmPanelScaffold: vi.fn(() => ({})),
}));

await import('../../src/js/processing/algorithms/buffer.algorithm.js');
const { getAlgorithm, POLYGON_DEFAULTS } =
    await import('../../src/js/processing/processing.constants.js');

const bufferDef = getAlgorithm('buffer');
const executeBuffer = bufferDef.execute;

// ---------------------------------------------------------------------------
// turf double
// ---------------------------------------------------------------------------

/** A closed square ring. */
const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
/** A second closed square, disjoint from the first. */
const FAR_SQUARE = [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];

/**
 * Installs a `window.turf.buffer` double.
 * @param {(feature: object, distance: number, opts: object) => any} impl
 * @returns {import('vitest').Mock} The spy, for call assertions.
 */
function stubBuffer(impl) {
    const spy = vi.fn(impl);
    globalThis.window = { turf: { buffer: spy } };
    return spy;
}

/**
 * @param {object} [props] - Feature properties.
 * @returns {object} A minimal GeoJSON point feature.
 */
function pointFeature(props = {}) {
    return {
        type: 'Feature',
        properties: { id: 'f1', ...props },
        geometry: { type: 'Point', coordinates: [0, 0] },
    };
}

let warnSpy;

beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warnSpy.mockRestore();
    delete globalThis.window;
    vi.restoreAllMocks();
});

// ============================================================================
// Registration
// ============================================================================

describe('registro do algoritmo buffer', () => {
    it('CONTROLE: a definicao existe e o execute e alcancavel', () => {
        expect(bufferDef).toBeDefined();
        expect(bufferDef.id).toBe('buffer');
        expect(typeof executeBuffer).toBe('function');
        expect(bufferDef.name).toBe('Zona de Influência');
        expect(Array.isArray(bufferDef.supportedGeometryTypes)).toBe(true);
        expect(bufferDef.supportedGeometryTypes.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// Shape of the produced feature
// ============================================================================

describe('executeBuffer: forma da feicao produzida', () => {
    it('um Polygon produz UMA feicao poligono', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const out = executeBuffer([pointFeature()], { distance: 100 });

        expect(out).toHaveLength(1);
        expect(out[0].type).toBe('Feature');
        expect(out[0].geometry.type).toBe('Polygon');
        expect(out[0].properties.source).toBe('polygon');
    });

    it('baseCoordinates perde o vertice de fechamento, mas geometry o MANTEM', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature()], { distance: 100 });

        expect(feat.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
        expect(feat.geometry.coordinates[0]).toHaveLength(5);
        expect(feat.geometry.coordinates[0][4]).toEqual([0, 0]);
    });

    it('herda POLYGON_DEFAULTS e carimba visivel/bloqueado', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature()], { distance: 100 });

        for (const [key, value] of Object.entries(POLYGON_DEFAULTS)) {
            expect(feat.properties[key]).toEqual(value);
        }
        expect(feat.properties.visivel).toBe(true);
        expect(feat.properties.bloqueado).toBe(false);
    });

    it('NAO propaga o id da feicao de origem (a nova feicao nasce sem id)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature({ id: 'origem-123' })], { distance: 100 });
        expect(feat.properties.id).toBeUndefined();
    });
});

// ============================================================================
// MultiPolygon fan-out
// ============================================================================

describe('executeBuffer: fan-out de MultiPolygon', () => {
    it('um MultiPolygon de 2 poligonos produz DUAS feicoes Polygon distintas', () => {
        stubBuffer(() => ({
            geometry: { type: 'MultiPolygon', coordinates: [[SQUARE], [FAR_SQUARE]] },
        }));
        const out = executeBuffer([pointFeature({ nome: 'Alvo' })], { distance: 100 });

        expect(out).toHaveLength(2);
        expect(out.map(f => f.geometry.type)).toEqual(['Polygon', 'Polygon']);
        expect(out[0].properties.baseCoordinates).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
        expect(out[1].properties.baseCoordinates)
            .toEqual([[10, 10], [11, 10], [11, 11], [10, 11]]);
        // Both carry the source name: the fan-out copies the metadata, it does not split it.
        expect(out.map(f => f.properties.nome)).toEqual(['Alvo', 'Alvo']);
    });

    it('cada poligono do fan-out perde SO o proprio vertice de fechamento', () => {
        stubBuffer(() => ({
            geometry: { type: 'MultiPolygon', coordinates: [[SQUARE], [FAR_SQUARE]] },
        }));
        const out = executeBuffer([pointFeature()], { distance: 100 });
        expect(out).toHaveLength(2);
        for (const feat of out) {
            expect(feat.properties.baseCoordinates).toHaveLength(4);
            expect(feat.geometry.coordinates[0]).toHaveLength(5);
        }
    });

    it('um MultiPolygon com anel interno leva o anel interno junto na geometry', () => {
        const withHole = [SQUARE, [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.2]]];
        stubBuffer(() => ({ geometry: { type: 'MultiPolygon', coordinates: [withHole] } }));
        const out = executeBuffer([pointFeature()], { distance: 100 });

        expect(out).toHaveLength(1);
        expect(out[0].geometry.coordinates).toHaveLength(2);
        // baseCoordinates comes from ring 0 only: the hole is drawn but not editable.
        expect(out[0].properties.baseCoordinates).toHaveLength(4);
    });
});

// ============================================================================
// Degenerate and failing inputs
// ============================================================================

describe('executeBuffer: entrada degenerada e falha do turf', () => {
    it('lista vazia devolve [] e nunca chama turf nem onProgress', () => {
        const spy = stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const onProgress = vi.fn();
        expect(executeBuffer([], { distance: 100, onProgress })).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('turf devolvendo null: a feicao e pulada sem lancar', () => {
        stubBuffer(() => null);
        expect(executeBuffer([pointFeature()], { distance: 100 })).toEqual([]);
    });

    it('turf devolvendo objeto sem geometry: pulado', () => {
        stubBuffer(() => ({ type: 'Feature' }));
        expect(executeBuffer([pointFeature()], { distance: 100 })).toEqual([]);
    });

    it('anel VAZIO colapsado e pulado (nao vira feicao sem geometria editavel)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [[]] } }));
        expect(executeBuffer([pointFeature()], { distance: -100 })).toEqual([]);
    });

    it('anel AUSENTE (coordinates vazio) e pulado, e nao estoura no indice 0', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [] } }));
        expect(executeBuffer([pointFeature()], { distance: 100 })).toEqual([]);
    });

    it('anel de UM ponto sobrevive (length 1 nao e 0), o que a guarda deixa passar', () => {
        // The guard is `length === 0`, not `length < 3`: a single-point ring reaches the
        // store as a "polygon" with one vertex. Recorded as observed behaviour.
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [[[5, 5]]] } }));
        const out = executeBuffer([pointFeature()], { distance: 100 });
        expect(out).toHaveLength(1);
        expect(out[0].properties.baseCoordinates).toEqual([[5, 5]]);
    });

    it('turf que LANCA e capturado, avisado no console e NAO interrompe o laco', () => {
        const spy = stubBuffer((feature) => {
            if (feature.properties.id === 'ruim') throw new Error('turf explodiu');
            return { geometry: { type: 'Polygon', coordinates: [SQUARE] } };
        });

        const out = executeBuffer(
            [pointFeature({ id: 'ruim' }), pointFeature({ id: 'bom' })],
            { distance: 100 }
        );

        expect(spy).toHaveBeenCalledTimes(2);
        expect(out).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain('ruim');
    });

    it('feicao SEM properties nao derruba a execucao (optional chaining por toda parte)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const out = executeBuffer(
            [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }],
            { distance: 100 }
        );
        expect(out).toHaveLength(1);
        expect(out[0].properties.nome).toBe('');
        expect(out[0].properties.descricao).toBe('');
    });
});

// ============================================================================
// Parameter transport
// ============================================================================

describe('executeBuffer: transporte do parametro distance', () => {
    it('a distancia chega ao turf VERBATIM, com units metros', () => {
        const spy = stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const feat = pointFeature();
        executeBuffer([feat], { distance: 250.5 });
        expect(spy).toHaveBeenCalledWith(feat, 250.5, { units: 'meters' });
    });

    it('distance 0 e distance negativa NAO sao saneadas aqui (quem recusa e o painel)', () => {
        const spy = stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        executeBuffer([pointFeature()], { distance: 0 });
        expect(spy).toHaveBeenCalledWith(expect.anything(), 0, { units: 'meters' });

        spy.mockClear();
        executeBuffer([pointFeature()], { distance: -50 });
        expect(spy).toHaveBeenCalledWith(expect.anything(), -50, { units: 'meters' });
    });

    it('distance undefined/NaN tambem atravessa: nao ha Number.isFinite neste ponto', () => {
        const spy = stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        executeBuffer([pointFeature()], {});
        expect(spy).toHaveBeenCalledWith(expect.anything(), undefined, { units: 'meters' });

        spy.mockClear();
        executeBuffer([pointFeature()], { distance: NaN });
        expect(spy.mock.calls[0][1]).toBeNaN();
    });
});

// ============================================================================
// onProgress
// ============================================================================

describe('executeBuffer: onProgress', () => {
    it('conta as feicoes de ENTRADA, uma vez cada, com (i+1, total)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const onProgress = vi.fn();
        executeBuffer([pointFeature(), pointFeature(), pointFeature()], {
            distance: 100,
            onProgress,
        });
        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('reporta 1 de 1 mesmo quando o fan-out produziu DUAS feicoes', () => {
        stubBuffer(() => ({
            geometry: { type: 'MultiPolygon', coordinates: [[SQUARE], [FAR_SQUARE]] },
        }));
        const onProgress = vi.fn();
        const out = executeBuffer([pointFeature()], { distance: 100, onProgress });
        expect(out).toHaveLength(2);
        expect(onProgress.mock.calls).toEqual([[1, 1]]);
    });

    it('avanca tambem para a feicao que o turf derrubou', () => {
        stubBuffer(() => { throw new Error('sempre falha'); });
        const onProgress = vi.fn();
        executeBuffer([pointFeature(), pointFeature()], { distance: 100, onProgress });
        expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
    });

    it('onProgress ausente nao e erro', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        expect(() => executeBuffer([pointFeature()], { distance: 100 })).not.toThrow();
    });
});

// ============================================================================
// Metadata copying
// ============================================================================

describe('executeBuffer: copia de metadados', () => {
    it('attributes e images sao copia PROFUNDA, isolada da origem', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const source = pointFeature({
            attributes: { setor: { valor: 'A' } },
            images: [{ id: 'i1', meta: { tag: 'x' } }],
        });

        const [feat] = executeBuffer([source], { distance: 100 });

        expect(feat.properties.attributes).toEqual({ setor: { valor: 'A' } });
        expect(feat.properties.attributes).not.toBe(source.properties.attributes);
        expect(feat.properties.attributes.setor).not.toBe(source.properties.attributes.setor);

        feat.properties.attributes.setor.valor = 'MUDOU';
        feat.properties.images[0].meta.tag = 'MUDOU';
        expect(source.properties.attributes.setor.valor).toBe('A');
        expect(source.properties.images[0].meta.tag).toBe('x');
    });

    it('attributes ausente nao cria a chave (nao vira undefined explicito)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature()], { distance: 100 });
        expect('attributes' in feat.properties).toBe(false);
        expect('images' in feat.properties).toBe(false);
    });

    it('as DUAS saidas do fan-out recebem clones INDEPENDENTES dos attributes', () => {
        stubBuffer(() => ({
            geometry: { type: 'MultiPolygon', coordinates: [[SQUARE], [FAR_SQUARE]] },
        }));
        const source = pointFeature({ attributes: { setor: { valor: 'A' } } });
        const out = executeBuffer([source], { distance: 100 });

        expect(out).toHaveLength(2);
        expect(out[0].properties.attributes).not.toBe(out[1].properties.attributes);
        out[0].properties.attributes.setor.valor = 'X';
        expect(out[1].properties.attributes.setor.valor).toBe('A');
    });

    it('OBSERVADO: `nome || \'\'` engole o zero, mas o campo e textual e o efeito e cosmetico', () => {
        // Flagged because `valor || padrao` is the shape that produced real defects
        // elsewhere in this codebase. Here `nome` is a string field, so a numeric 0 is not
        // a legitimate value and the collapse costs nothing; recorded so a future change
        // to a numeric-capable field is a deliberate one.
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature({ nome: 0, descricao: 0 })], { distance: 100 });
        expect(feat.properties.nome).toBe('');
        expect(feat.properties.descricao).toBe('');
    });
});

// ============================================================================
// Temporal inheritance
// ============================================================================

describe('executeBuffer: heranca da janela temporal', () => {
    it('herda inicio e fim da feicao de origem', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer(
            [pointFeature({ temporalInicio: 1000, temporalFim: 2000 })],
            { distance: 100 }
        );
        expect(feat.properties.temporalInicio).toBe(1000);
        expect(feat.properties.temporalFim).toBe(2000);
    });

    it('temporalInicio 0 (epoch) e HERDADO: a heranca usa Number.isFinite, nao veracidade', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer(
            [pointFeature({ temporalInicio: 0, temporalFim: 0 })],
            { distance: 100 }
        );
        expect(feat.properties.temporalInicio).toBe(0);
        expect(feat.properties.temporalFim).toBe(0);
    });

    it('feicao permanente nao ganha chave temporal nenhuma', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature()], { distance: 100 });
        expect('temporalInicio' in feat.properties).toBe(false);
        expect('temporalFim' in feat.properties).toBe(false);
    });

    it('so metade da janela definida herda so essa metade', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [feat] = executeBuffer([pointFeature({ temporalInicio: 500 })], { distance: 100 });
        expect(feat.properties.temporalInicio).toBe(500);
        expect('temporalFim' in feat.properties).toBe(false);
    });

    it('temporalInicio NaN/Infinity nao e herdado (nao vira janela invalida)', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const [a] = executeBuffer([pointFeature({ temporalInicio: NaN })], { distance: 100 });
        expect('temporalInicio' in a.properties).toBe(false);
        const [b] = executeBuffer([pointFeature({ temporalInicio: Infinity })], { distance: 100 });
        expect('temporalInicio' in b.properties).toBe(false);
    });

    it('a heranca e POR FEICAO: duas origens com janelas diferentes nao se misturam', () => {
        stubBuffer(() => ({ geometry: { type: 'Polygon', coordinates: [SQUARE] } }));
        const out = executeBuffer(
            [
                pointFeature({ temporalInicio: 100, temporalFim: 200 }),
                pointFeature({ temporalInicio: 900, temporalFim: 999 }),
            ],
            { distance: 100 }
        );
        expect(out).toHaveLength(2);
        expect(out[0].properties.temporalInicio).toBe(100);
        expect(out[1].properties.temporalInicio).toBe(900);
    });
});
