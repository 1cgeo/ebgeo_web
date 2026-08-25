// Path: tests/unit/processing-voronoi.test.js

/**
 * @fileoverview Pins the `execute` of `frontend/src/js/processing/algorithms/voronoi.algorithm.js`
 * (Zonas de Proximidade).
 *
 * HOW IT IS REACHED
 * Same route as `processing-buffer.test.js`: `executeVoronoi` is not exported, so the
 * module is imported for the `registerAlgorithm({ id: 'voronoi', ... })` side effect and
 * the function is pulled out with `getAlgorithm('voronoi')`. `@tools/helpers/index.js` and
 * `panel-builder.js` are mocked because the panel is DOM- and store-coupled.
 *
 * WHAT THIS SUITE PINS
 * - the ALIGNMENT contract, which is the risky part of this algorithm: cell `i` is named
 *   and given the metadata of `pointSources[i]`. The suite pins both halves: that a cell
 *   the generator dropped (null) does NOT shift the alignment of the cells after it, and
 *   that a centroid that threw removes the feature from BOTH parallel arrays at once, so
 *   the indices stay in step;
 * - that the cell numbering of the unnamed fallback (`Zona N`) uses the CELL index, so a
 *   dropped cell leaves a GAP in the numbering;
 * - the two refusals (`< 2` points, empty/absent voronoi output), by message;
 * - that a non-Point feature is replaced by its centroid and that the centroid's
 *   properties are OVERWRITTEN with a shallow copy of the source's;
 * - the asymmetry against the buffer algorithm: this one echoes the cell geometry type
 *   verbatim and never fans a MultiPolygon out.
 *
 * WHAT IT DOES NOT REACH
 * - `createVoronoiPanel`, the rectangle-drawing interaction, and the bbox it produces (DOM
 *   + MapLibre).
 * - Real turf: `window.turf.voronoi` and `window.turf.centroid` are doubles, so nothing
 *   here asserts that the cells are geometrically a Voronoi diagram. In particular the
 *   assumption that turf returns cells in INPUT ORDER is pinned as a contract of this
 *   suite's double, not verified against turf.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tools/helpers/index.js', () => ({
    createModernToggle: vi.fn(() => ({})),
    createSectionDivider: vi.fn(() => ({})),
}));
vi.mock('../../src/js/processing/algorithms/panel-builder.js', () => ({
    buildAlgorithmPanelScaffold: vi.fn(() => ({})),
}));

await import('../../src/js/processing/algorithms/voronoi.algorithm.js');
const { getAlgorithm, POLYGON_DEFAULTS } =
    await import('../../src/js/processing/processing.constants.js');

const voronoiDef = getAlgorithm('voronoi');
const executeVoronoi = voronoiDef.execute;

const BBOX = [-1, -1, 1, 1];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} nome - Feature name (empty string for unnamed).
 * @param {object} [extra] - Extra properties.
 * @returns {object} A GeoJSON point feature.
 */
function pt(nome, extra = {}) {
    return {
        type: 'Feature',
        properties: { id: `p-${nome || 'sem-nome'}`, nome, ...extra },
        geometry: { type: 'Point', coordinates: [0, 0] },
    };
}

/**
 * @param {object} [props] - Feature properties.
 * @returns {object} A GeoJSON polygon feature (a non-Point, so it needs a centroid).
 */
function poly(props = {}) {
    return {
        type: 'Feature',
        properties: { id: 'poly-1', ...props },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
}

/** A closed square ring, used as a cell. */
const CELL_RING = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

/**
 * @param {number} [tag] - Value used to make each cell distinguishable.
 * @returns {object} A Polygon cell feature.
 */
function cell(tag = 0) {
    return {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [CELL_RING.map(([x, y]) => [x + tag, y + tag])],
        },
    };
}

/**
 * Installs the `window.turf` double.
 * @param {object[]|null} cells - What `voronoi()` returns as `features`, or null for a
 *   null return.
 * @param {(f: object) => object} [centroidImpl] - Override for `centroid`.
 * @returns {{ voronoi: import('vitest').Mock, centroid: import('vitest').Mock,
 *   featureCollection: import('vitest').Mock }}
 */
function stubTurf(cells, centroidImpl) {
    const turf = {
        featureCollection: vi.fn((features) => ({ type: 'FeatureCollection', features })),
        voronoi: vi.fn(() => (cells === null ? null : { features: cells })),
        centroid: vi.fn(centroidImpl ?? ((f) => ({
            type: 'Feature',
            properties: { origem: 'centroide' },
            geometry: { type: 'Point', coordinates: [0, 0], __from: f.properties?.id },
        }))),
    };
    globalThis.window = { turf };
    return turf;
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

describe('registro do algoritmo voronoi', () => {
    it('CONTROLE: a definicao existe e o execute e alcancavel', () => {
        expect(voronoiDef).toBeDefined();
        expect(voronoiDef.id).toBe('voronoi');
        expect(typeof executeVoronoi).toBe('function');
        expect(voronoiDef.name).toBe('Zonas de Proximidade');
    });
});

// ============================================================================
// Refusals
// ============================================================================

describe('executeVoronoi: recusas', () => {
    it('lista vazia recusa NOMEANDO o minimo de dois pontos', () => {
        stubTurf([cell()]);
        expect(() => executeVoronoi([], { bbox: BBOX }))
            .toThrow('São necessários pelo menos 2 pontos para gerar as zonas de proximidade');
    });

    it('UM ponto recusa (a fronteira e `< 2`, entao 2 passa)', () => {
        stubTurf([cell(0), cell(1)]);
        expect(() => executeVoronoi([pt('A')], { bbox: BBOX })).toThrow('pelo menos 2 pontos');
        expect(executeVoronoi([pt('A'), pt('B')], { bbox: BBOX })).toHaveLength(2);
    });

    it('pointsOnly com so poligonos recusa, porque a filtragem esvazia a lista', () => {
        stubTurf([cell()]);
        expect(() => executeVoronoi([poly(), poly()], { bbox: BBOX, pointsOnly: true }))
            .toThrow('pelo menos 2 pontos');
    });

    it('a recusa acontece ANTES de chamar turf.voronoi', () => {
        const turf = stubTurf([cell()]);
        expect(() => executeVoronoi([pt('A')], { bbox: BBOX })).toThrow();
        expect(turf.voronoi).not.toHaveBeenCalled();
        expect(turf.featureCollection).not.toHaveBeenCalled();
    });

    it('turf.voronoi devolvendo null recusa com a segunda mensagem', () => {
        stubTurf(null);
        expect(() => executeVoronoi([pt('A'), pt('B')], { bbox: BBOX }))
            .toThrow('Não foi possível gerar as zonas de proximidade');
    });

    it('turf.voronoi devolvendo lista VAZIA de celulas recusa igual', () => {
        stubTurf([]);
        expect(() => executeVoronoi([pt('A'), pt('B')], { bbox: BBOX }))
            .toThrow('Não foi possível gerar as zonas de proximidade');
    });
});

// ============================================================================
// Point collection and centroids
// ============================================================================

describe('executeVoronoi: coleta de pontos', () => {
    it('o bbox chega ao turf.voronoi VERBATIM', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });
        expect(turf.voronoi).toHaveBeenCalledTimes(1);
        expect(turf.voronoi.mock.calls[0][1]).toEqual({ bbox: BBOX });
    });

    it('bbox ausente atravessa como undefined (nao ha default aqui)', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        executeVoronoi([pt('A'), pt('B')], {});
        expect(turf.voronoi.mock.calls[0][1]).toEqual({ bbox: undefined });
    });

    it('feicao Point entra SEM passar por centroid', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        const a = pt('A');
        executeVoronoi([a, pt('B')], { bbox: BBOX });
        expect(turf.centroid).not.toHaveBeenCalled();
        expect(turf.featureCollection.mock.calls[0][0][0]).toBe(a);
    });

    it('feicao NAO-Point vira centroide, e as properties do centroide sao SOBRESCRITAS', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        const p = poly({ nome: 'Area', extra: 1 });
        executeVoronoi([p, pt('B')], { bbox: BBOX });

        expect(turf.centroid).toHaveBeenCalledTimes(1);
        const collected = turf.featureCollection.mock.calls[0][0];
        expect(collected).toHaveLength(2);
        // The double's own `origem: 'centroide'` is gone: the assignment REPLACES the
        // object rather than merging into it.
        expect(collected[0].properties).toEqual({ id: 'poly-1', nome: 'Area', extra: 1 });
        expect(collected[0].properties.origem).toBeUndefined();
    });

    it('a sobrescrita e copia RASA: um objeto aninhado continua compartilhado com a origem', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        const p = poly({ nome: 'Area', attributes: { a: { b: 1 } } });
        executeVoronoi([p, pt('B')], { bbox: BBOX });
        const collected = turf.featureCollection.mock.calls[0][0];
        expect(collected[0].properties.attributes).toBe(p.properties.attributes);
    });

    it('pointsOnly descarta o nao-Point ANTES do centroide', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        executeVoronoi([poly(), pt('A'), pt('B')], { bbox: BBOX, pointsOnly: true });
        expect(turf.centroid).not.toHaveBeenCalled();
        expect(turf.featureCollection.mock.calls[0][0]).toHaveLength(2);
    });

    it('feicao SEM geometry e tratada como nao-Point e vai para o centroide', () => {
        const turf = stubTurf([cell(0), cell(1)]);
        executeVoronoi(
            [{ type: 'Feature', properties: { id: 'sem-geom' } }, pt('A'), pt('B')],
            { bbox: BBOX }
        );
        expect(turf.centroid).toHaveBeenCalledTimes(1);
    });

    it('centroide que LANCA descarta a feicao dos DOIS arrays paralelos de uma vez', () => {
        // This is what keeps `pointSources[i]` aligned with the cells: the push into
        // `points` and into `pointSources` both live after the throwing call.
        const turf = stubTurf([cell(0), cell(1)], () => { throw new Error('centroide falhou'); });
        const out = executeVoronoi([poly({ nome: 'Ruim' }), pt('A'), pt('B')], { bbox: BBOX });

        expect(turf.featureCollection.mock.calls[0][0]).toHaveLength(2);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(out).toHaveLength(2);
        // The names come from A and B, not shifted by the dropped polygon.
        expect(out.map(f => f.properties.nome))
            .toEqual(['Proximidade - A', 'Proximidade - B']);
    });
});

// ============================================================================
// Alignment: the risky part
// ============================================================================

describe('executeVoronoi: alinhamento celula <-> ponto gerador', () => {
    it('a celula i recebe o nome do ponto i (contrato de ordem)', () => {
        stubTurf([cell(0), cell(1), cell(2)]);
        const out = executeVoronoi([pt('Alfa'), pt('Bravo'), pt('Charlie')], { bbox: BBOX });
        expect(out).toHaveLength(3);
        expect(out.map(f => f.properties.nome))
            .toEqual(['Proximidade - Alfa', 'Proximidade - Bravo', 'Proximidade - Charlie']);
    });

    it('celula NULA no meio nao desloca o alinhamento das seguintes', () => {
        stubTurf([cell(0), null, cell(2)]);
        const out = executeVoronoi([pt('Alfa'), pt('Bravo'), pt('Charlie')], { bbox: BBOX });
        expect(out).toHaveLength(2);
        expect(out.map(f => f.properties.nome))
            .toEqual(['Proximidade - Alfa', 'Proximidade - Charlie']);
    });

    it('celula sem geometry e pulada como a nula', () => {
        stubTurf([cell(0), { type: 'Feature' }, cell(2)]);
        const out = executeVoronoi([pt('Alfa'), pt('Bravo'), pt('Charlie')], { bbox: BBOX });
        expect(out).toHaveLength(2);
        expect(out.map(f => f.properties.nome))
            .toEqual(['Proximidade - Alfa', 'Proximidade - Charlie']);
    });

    it('MAIS celulas que pontos: as excedentes caem no rotulo generico sem estourar', () => {
        stubTurf([cell(0), cell(1), cell(2), cell(3)]);
        const out = executeVoronoi([pt('Alfa'), pt('Bravo')], { bbox: BBOX });
        expect(out).toHaveLength(4);
        expect(out.map(f => f.properties.nome))
            .toEqual(['Proximidade - Alfa', 'Proximidade - Bravo', 'Zona 3', 'Zona 4']);
    });

    it('MENOS celulas que pontos: os pontos sobrando simplesmente nao geram zona', () => {
        stubTurf([cell(0)]);
        const out = executeVoronoi([pt('Alfa'), pt('Bravo'), pt('Charlie')], { bbox: BBOX });
        expect(out).toHaveLength(1);
        expect(out[0].properties.nome).toBe('Proximidade - Alfa');
    });
});

// ============================================================================
// Naming
// ============================================================================

describe('executeVoronoi: nomeacao', () => {
    it('ponto sem nome cai no rotulo generico numerado a partir de 1', () => {
        stubTurf([cell(0), cell(1)]);
        const out = executeVoronoi([pt(''), pt('')], { bbox: BBOX });
        expect(out.map(f => f.properties.nome)).toEqual(['Zona 1', 'Zona 2']);
    });

    it('a numeracao do rotulo generico usa o indice da CELULA, entao celula pulada deixa BURACO', () => {
        stubTurf([cell(0), null, cell(2)]);
        const out = executeVoronoi([pt(''), pt(''), pt('')], { bbox: BBOX });
        expect(out.map(f => f.properties.nome)).toEqual(['Zona 1', 'Zona 3']);
    });

    it('OBSERVADO: `nome` numerico 0 cai no rotulo generico (veracidade, nao presenca)', () => {
        // `sourceName ? ... : ...` is a truthiness test. `nome` is a text field, so 0 is
        // not a legitimate value; pinned because this is the `valor || padrao` family.
        stubTurf([cell(0), cell(1)]);
        const out = executeVoronoi([pt(0), pt('B')], { bbox: BBOX });
        expect(out[0].properties.nome).toBe('Zona 1');
        expect(out[1].properties.nome).toBe('Proximidade - B');
    });

    it('a descricao da zona nasce VAZIA, nunca herdada do ponto', () => {
        stubTurf([cell(0), cell(1)]);
        const out = executeVoronoi(
            [pt('A', { descricao: 'texto do ponto' }), pt('B')],
            { bbox: BBOX }
        );
        expect(out[0].properties.descricao).toBe('');
    });
});

// ============================================================================
// Produced feature
// ============================================================================

describe('executeVoronoi: forma da feicao produzida', () => {
    it('herda POLYGON_DEFAULTS e carimba source/visivel/bloqueado', () => {
        stubTurf([cell(0), cell(1)]);
        const [feat] = executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });
        for (const [key, value] of Object.entries(POLYGON_DEFAULTS)) {
            expect(feat.properties[key]).toEqual(value);
        }
        expect(feat.properties.source).toBe('polygon');
        expect(feat.properties.visivel).toBe(true);
        expect(feat.properties.bloqueado).toBe(false);
    });

    it('baseCoordinates perde o vertice de fechamento e geometry o mantem', () => {
        stubTurf([cell(0), cell(1)]);
        const [feat] = executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });
        expect(feat.properties.baseCoordinates).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
        expect(feat.geometry.coordinates[0]).toHaveLength(5);
    });

    it('attributes e images vem do PONTO GERADOR, em copia profunda isolada', () => {
        stubTurf([cell(0), cell(1)]);
        const source = pt('A', {
            attributes: { setor: { valor: 'A' } },
            images: [{ id: 'i1' }],
        });
        const [feat] = executeVoronoi([source, pt('B')], { bbox: BBOX });

        expect(feat.properties.attributes).toEqual({ setor: { valor: 'A' } });
        expect(feat.properties.attributes).not.toBe(source.properties.attributes);
        feat.properties.attributes.setor.valor = 'MUDOU';
        expect(source.properties.attributes.setor.valor).toBe('A');
        expect(feat.properties.images).toEqual([{ id: 'i1' }]);
    });

    it('sem attributes/images a chave nao e criada', () => {
        stubTurf([cell(0), cell(1)]);
        const [feat] = executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });
        expect('attributes' in feat.properties).toBe(false);
        expect('images' in feat.properties).toBe(false);
    });

    it('herda a janela temporal do ponto gerador, epoch 0 incluido', () => {
        stubTurf([cell(0), cell(1)]);
        const out = executeVoronoi(
            [pt('A', { temporalInicio: 0, temporalFim: 0 }), pt('B', { temporalInicio: 50 })],
            { bbox: BBOX }
        );
        expect(out[0].properties.temporalInicio).toBe(0);
        expect(out[0].properties.temporalFim).toBe(0);
        expect(out[1].properties.temporalInicio).toBe(50);
        expect('temporalFim' in out[1].properties).toBe(false);
    });

    it('celula com coordinates ausente e capturada pelo catch e nao derruba as demais', () => {
        stubTurf([
            { type: 'Feature', geometry: { type: 'Polygon' } },
            cell(1),
        ]);
        const out = executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });
        expect(out).toHaveLength(1);
        expect(out[0].properties.nome).toBe('Proximidade - B');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain('célula 0');
    });

    it('OBSERVADO: uma celula MultiPolygon NAO sofre fan-out, ao contrario do buffer', () => {
        // `buffer.algorithm.js` explodes a MultiPolygon into one feature per polygon and
        // says in its own comment why: `baseCoordinates` taken from `coordinates[0]` of a
        // MultiPolygon is an array of RINGS, which corrupts the shape on the first edit.
        // This algorithm has no such fan-out; the case is unreachable with today's turf
        // (voronoi cells are Polygons), so this pins the asymmetry rather than a live bug.
        const multi = {
            type: 'Feature',
            geometry: { type: 'MultiPolygon', coordinates: [[CELL_RING], [CELL_RING]] },
        };
        stubTurf([multi, cell(1)]);
        const out = executeVoronoi([pt('A'), pt('B')], { bbox: BBOX });

        expect(out).toHaveLength(2);
        expect(out[0].geometry.type).toBe('MultiPolygon');
        // baseCoordinates is an array of RINGS, not of points: malformed for the editor.
        expect(Array.isArray(out[0].properties.baseCoordinates[0][0])).toBe(true);
    });
});

// ============================================================================
// onProgress
// ============================================================================

describe('executeVoronoi: onProgress', () => {
    it('conta as CELULAS, uma vez cada, com (i+1, total de celulas)', () => {
        stubTurf([cell(0), cell(1), cell(2)]);
        const onProgress = vi.fn();
        executeVoronoi([pt('A'), pt('B'), pt('C')], { bbox: BBOX, onProgress });
        expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('avanca tambem na celula nula e na celula que o catch capturou', () => {
        stubTurf([null, { type: 'Feature', geometry: { type: 'Polygon' } }, cell(2)]);
        const onProgress = vi.fn();
        const out = executeVoronoi([pt('A'), pt('B'), pt('C')], { bbox: BBOX, onProgress });
        expect(out).toHaveLength(1);
        expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it('NAO reporta progresso na fase de coleta de pontos, so na de celulas', () => {
        stubTurf([cell(0)]);
        const onProgress = vi.fn();
        executeVoronoi([pt('A'), pt('B'), pt('C'), pt('D')], { bbox: BBOX, onProgress });
        // Four inputs, one cell: progress speaks of cells only.
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith(1, 1);
    });

    it('onProgress ausente nao e erro', () => {
        stubTurf([cell(0), cell(1)]);
        expect(() => executeVoronoi([pt('A'), pt('B')], { bbox: BBOX })).not.toThrow();
    });
});
