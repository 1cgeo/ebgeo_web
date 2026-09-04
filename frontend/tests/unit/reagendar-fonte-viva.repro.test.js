import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';

// Regression test for the "Reagendar" (reschedule) gesture, which is TWO halves that
// disagree with each other.
//
// Half one — the live map goes out of phase with the store. `shiftMapTemporalTimes`
// (store/feature.operations.js) walks `Object.keys` over the buckets of
// getEmptyMapData(), which is an OPEN list, while `shiftSourcesTemporal`
// (temporal/temporal-render.service.js) walks `Object.values(FEATURE_SOURCES)`
// (layers/layer.constants.js), which is a CLOSED list. Every bucket whose live source is
// missing from the closed list keeps the OLD window in the MapLibre source after the
// store already holds the new one. The temporal show/hide filter is a MapLibre
// expression reading `temporalInicio` FROM THE SOURCE (layers/visibility-filter.js), so
// those features appear and vanish at the wrong instant until an F5 reloads the sources.
//
// Half two — the ungated half runs even when the gated half refused. `shiftFeatureTimes`
// (temporal/temporal-controller.js) called the store half (which returns 0 when
// `guardWrite` blocks) and then called the source half unconditionally, ignoring the
// return. A `read`/`comment` user on a remote atlas saw the map reschedule itself while
// the store stayed untouched. Fixing only the list would have made that WORSE: more
// sources moved with no permission at all.
//
// This test drives the PRODUCTION functions. The spelling table below is written out by
// hand ON PURPOSE: normalizing `-` to `_` would erase the one difference that matters
// (`processed_los` the bucket vs `processed-los` the source) and leave this guard green
// while the constant stayed wrong.

// The store barrel is mocked so the guard-blocked case can be driven by its CONTRACT
// (shiftMapTemporalTimes returns the number of features changed, 0 when refused) instead
// of by standing up a session, an atlas origin and a repository.
const { storeMock } = vi.hoisted(() => ({
    storeMock: {
        shiftMapTemporalTimes: vi.fn(async () => 1),
        getCurrentMapNameSync: vi.fn(() => 'TestMap'),
        getCurrentMapFeatures: vi.fn(async () => []),
        getMapTemporalConfig: vi.fn(async () => ({ ativo: false })),
        getStateManager: vi.fn(() => null),
    },
}));

vi.mock('../../src/js/store', () => storeMock);

import { shiftSourcesTemporal } from '../../src/js/temporal/temporal-render.service.js';
import { TemporalController } from '../../src/js/temporal/temporal-controller.js';
import { FEATURE_SOURCES } from '../../src/js/layers/layer.constants.js';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const T0 = 1_700_000_000_000;
const DELTA = 86_400_000; // one day

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * Fake MapLibre GeoJSONSource. `getData` is ASYNC on purpose and this is load-bearing:
 * `shiftSourcesTemporal` skips any source whose `getData` is not a function, so a
 * synchronous (or absent) `getData` makes the whole loop `continue` and every assertion
 * below pass for the wrong reason.
 */
function makeSource(...features) {
    return {
        setDataCalls: 0,
        _data: { type: 'FeatureCollection', features },
        async getData() {
            return structuredClone(this._data);
        },
        setData(obj) {
            this.setDataCalls++;
            this._data = obj;
        },
    };
}

/** A timed feature: a validity window plus one trajectory keypoint. */
function timedFeature(id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
            id,
            temporalInicio: T0,
            temporalFim: T0 + 3_600_000,
            trajetoria: [{ t: T0, lng: 0, lat: 0 }, { t: T0 + 1000, lng: 1, lat: 0 }],
        },
    };
}

function makeMap(sources) {
    return { getSource: (id) => sources[id] || null };
}

/** Window the MAP currently shows for a feature (not the one the store holds). */
function windowOf(source, id) {
    const f = source._data.features.find((x) => x.properties.id === id);
    return { inicio: f.properties.temporalInicio, fim: f.properties.temporalFim };
}

// ---------------------------------------------------------------------------
// Part A — behaviour: the live sources the gesture forgets
// ---------------------------------------------------------------------------

describe('Reagendar — shiftSourcesTemporal alcança toda fonte viva', () => {
    let sources;
    let map;

    beforeEach(() => {
        sources = {
            military_symbols: makeSource(timedFeature('sim')),
            magnetic_declinations: makeSource(timedFeature('dec')),
            'processed-los': makeSource(timedFeature('los-out')),
            los: makeSource(timedFeature('los-in')),
        };
        map = makeMap(sources);
    });

    it('desloca o símbolo militar (controle positivo do instrumento)', async () => {
        await shiftSourcesTemporal(map, DELTA);

        // If THIS one fails the double is broken, not the product: nothing below means
        // anything until the known-listed source moves.
        expect(sources.military_symbols.setDataCalls).toBe(1);
        expect(windowOf(sources.military_symbols, 'sim')).toEqual({
            inicio: T0 + DELTA,
            fim: T0 + 3_600_000 + DELTA,
        });
        expect(sources.military_symbols._data.features[0].properties.trajetoria[0].t).toBe(T0 + DELTA);
    });

    it('desloca início e fim da declinação magnética', async () => {
        await shiftSourcesTemporal(map, DELTA);

        expect(windowOf(sources.magnetic_declinations, 'dec')).toEqual({
            inicio: T0 + DELTA,
            fim: T0 + 3_600_000 + DELTA,
        });
    });

    it('desloca a saída de processamento, cuja fonte viva se escreve com HÍFEN', async () => {
        await shiftSourcesTemporal(map, DELTA);

        // `processed-los`, not `processed_los`: the bucket and the source spell it
        // differently, and only the source name reaches map.getSource().
        expect(windowOf(sources['processed-los'], 'los-out')).toEqual({
            inicio: T0 + DELTA,
            fim: T0 + 3_600_000 + DELTA,
        });
    });

    it('continua deslocando a fonte de ENTRADA da análise, que é outra fonte', async () => {
        await shiftSourcesTemporal(map, DELTA);

        // `los` and `processed-los` are two live sources for two different buckets, both
        // fed by setupLOSLayers (layers/styles/tactical.layers.js). Rewriting the `los`
        // entry into `processed-los` instead of adding one would trade one hole for
        // another; this case is what makes that trade visible.
        expect(windowOf(sources.los, 'los-in')).toEqual({
            inicio: T0 + DELTA,
            fim: T0 + 3_600_000 + DELTA,
        });
    });
});

// ---------------------------------------------------------------------------
// Part B — structure: every stored bucket has its live source declared
// ---------------------------------------------------------------------------

/**
 * Bucket of getEmptyMapData() → id of the MapLibre source that renders it.
 *
 * Written out instead of derived: `-` vs `_` is the only difference that matters here
 * (see the header), so any normalization would defeat the guard.
 */
const LIVE_SOURCE_BY_BUCKET = Object.freeze({
    points: 'points',
    lines: 'lines',
    polygons: 'polygons',
    circles: 'circles',
    rectangles: 'rectangles',
    ellipses: 'ellipses',
    setores: 'setores',
    texts: 'texts',
    images: 'images',
    brushes: 'brushes',
    arrows: 'arrows',
    boundarys: 'boundarys',
    occupied_fronts: 'occupied_fronts',
    coordination_lines: 'coordination_lines',
    military_symbols: 'military_symbols',
    coordination_measures: 'coordination_measures',
    magnetic_declinations: 'magnetic_declinations',
    los: 'los',
    visibility: 'visibility',
    processed_los: 'processed-los',
    processed_visibility: 'processed-visibility',
});

/** Buckets with no live source at all, each with the reason written down. */
const BUCKETS_WITHOUT_LIVE_SOURCE = Object.freeze({
    coordenadas:
        'leituras efêmeras de azimute/coordenada: não têm fonte GeoJSON nem camada, e são '
        + 'declaradas fora do contrato do servidor em import_export/local-atlas-to-server.js',
});

/** Every GeoJSON source id declared by the layer-style modules. */
function liveSourceIdsFromStyles() {
    const dir = new URL('../../src/js/layers/styles/', import.meta.url);
    const ids = new Set();
    const patterns = [
        /(?:setOrCreateSource|setSourceData)\(\s*\w+\s*,\s*'([^']+)'/g,
        /sourceId:\s*'([^']+)'/g,
        /addSource\(\s*'([^']+)'/g,
    ];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
        const text = readFileSync(new URL(file, dir), 'utf8');
        for (const re of patterns) {
            for (const m of text.matchAll(re)) ids.add(m[1]);
        }
    }
    return ids;
}

describe('Reagendar — FEATURE_SOURCES cobre todo balde persistido', () => {
    const buckets = Object.keys(getEmptyMapData().features);
    const declared = new Set(Object.values(FEATURE_SOURCES));
    const liveIds = liveSourceIdsFromStyles();

    it('as três extrações acharam alguma coisa (piso anti-vazio)', () => {
        // Without this, the day an anchor breaks reads as "the lists diverged" when the
        // truth is "the extractor stopped working".
        expect(buckets.length).toBeGreaterThanOrEqual(20);
        expect(declared.size).toBeGreaterThanOrEqual(17);
        expect(liveIds.size).toBeGreaterThanOrEqual(20);
        // Absolute anchor, not a comparison: the hyphenated spelling really is what the
        // style module registers.
        expect(liveIds.has('processed-los')).toBe(true);
        expect(liveIds.has('magnetic_declinations')).toBe(true);
    });

    it('todo balde está classificado: ou tem fonte viva, ou tem motivo escrito', () => {
        const unclassified = buckets.filter(
            (b) => !(b in LIVE_SOURCE_BY_BUCKET) && !(b in BUCKETS_WITHOUT_LIVE_SOURCE),
        );
        expect(unclassified).toEqual([]);

        // Anti-tapete: no entry may point at a bucket that no longer exists, and no
        // allowlisted reason may be blank.
        const known = new Set(buckets);
        expect(Object.keys(LIVE_SOURCE_BY_BUCKET).filter((b) => !known.has(b))).toEqual([]);
        expect(Object.keys(BUCKETS_WITHOUT_LIVE_SOURCE).filter((b) => !known.has(b))).toEqual([]);
        for (const [bucket, reason] of Object.entries(BUCKETS_WITHOUT_LIVE_SOURCE)) {
            expect(reason.length, `motivo vazio para ${bucket}`).toBeGreaterThan(20);
        }
    });

    it('a tabela de grafia não mente: toda fonte que ela cita existe nos estilos', () => {
        const inventados = Object.entries(LIVE_SOURCE_BY_BUCKET)
            .filter(([, id]) => !liveIds.has(id))
            .map(([bucket, id]) => `${bucket} -> ${id}`);
        expect(inventados).toEqual([]);
    });

    it('toda fonte viva de balde persistido está declarada em FEATURE_SOURCES', () => {
        const faltando = Object.entries(LIVE_SOURCE_BY_BUCKET)
            .filter(([, id]) => !declared.has(id))
            .map(([bucket, id]) => `${bucket} -> ${id}`);
        expect(
            faltando,
            'FEATURE_SOURCES (layers/layer.constants.js) é lista fechada e shiftSourcesTemporal '
            + 'só alcança o que está nela. Acrescente a fonte com a grafia EXATA do estilo.',
        ).toEqual([]);

        // Absolute assertions beside the comparison: the three that were missing.
        expect(declared.has('magnetic_declinations')).toBe(true);
        expect(declared.has('processed-los')).toBe(true);
        expect(declared.has('processed-visibility')).toBe(true);
        // And the two analysis INPUT sources, which are NOT the same as the outputs.
        expect(declared.has('los')).toBe(true);
        expect(declared.has('visibility')).toBe(true);
    });

    it('FEATURE_SOURCES não carrega entrada morta', () => {
        const alvos = new Set(Object.values(LIVE_SOURCE_BY_BUCKET));
        const sobrando = [...declared].filter((id) => !alvos.has(id));
        expect(sobrando).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Part C — permission: the ungated half must not run when the gated half refused
// ---------------------------------------------------------------------------

describe('Reagendar — shiftFeatureTimes respeita o gate da metade gateada', () => {
    let source;
    let controller;

    beforeEach(() => {
        storeMock.shiftMapTemporalTimes.mockReset();
        source = makeSource(timedFeature('sim'));
        controller = new TemporalController({
            map: makeMap({ military_symbols: source }),
            eventBus: { on: () => () => {} },
        });
    });

    it('com o guard bloqueando (store devolve 0), nenhuma fonte recebe setData', async () => {
        storeMock.shiftMapTemporalTimes.mockResolvedValue(0);

        await controller.shiftFeatureTimes(DELTA);

        expect(storeMock.shiftMapTemporalTimes).toHaveBeenCalledOnce();
        expect(source.setDataCalls).toBe(0);
        expect(windowOf(source, 'sim')).toEqual({ inicio: T0, fim: T0 + 3_600_000 });
    });

    it('com o store aceitando, as fontes deslocam (a saída cedo não é um bloqueio geral)', async () => {
        storeMock.shiftMapTemporalTimes.mockResolvedValue(1);

        await controller.shiftFeatureTimes(DELTA);

        expect(source.setDataCalls).toBe(1);
        expect(windowOf(source, 'sim')).toEqual({ inicio: T0 + DELTA, fim: T0 + 3_600_000 + DELTA });
    });
});
