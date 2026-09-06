// Path: tests/unit/feature-hit-test.helpers.test.js

/**
 * The map-facing half of the click hit-test, against map doubles (the same
 * technique as `hover-query.helpers.test.js`: no MapLibre, no DOM, node env).
 *
 * What matters here is not arithmetic — that is pinned in
 * `hit-test.model.test.js` — but the SEQUENCE the helper drives: the tolerant
 * box query first, the exact point query only when an area row survived it, and
 * the image rows filtered against the rectangle that was actually drawn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTouchDevice } from '@utils/pointer-utils.js';
import {
    getSymbolPerspectiveRatio,
    isDecisiveHit,
    isPointInsideRenderedIcon,
    queryFeaturesAtPoint,
    rankHitRows,
    renderedIconQuad,
} from '../../src/js/tool_manager/helpers/feature-hit-test.helpers.js';
import {
    CLICK_TOLERANCE_PX,
    TOUCH_CLICK_TOLERANCE_PX,
    EXACT_ICON_LAYER_IDS,
} from '../../src/js/tool_manager/helpers/hit-test.model.js';

vi.mock('@utils/pointer-utils.js', () => ({ isTouchDevice: vi.fn(() => false) }));

/** The module under test, for the fresh-import dance the memoized tolerance needs. */
const HELPERS_PATH = '../../src/js/tool_manager/helpers/feature-hit-test.helpers.js';

/** Anchor every icon test uses, in screen pixels. */
const ANCHOR = { x: 500, y: 300 };

/**
 * A row as `queryRenderedFeatures` returns it.
 * @param {Object} spec - Row parts
 * @param {string} spec.layerId - MapLibre layer id
 * @param {string} [spec.layerType] - MapLibre layer type (`symbol`, `line`, ...)
 * @param {string} spec.source - MapLibre source name
 * @param {Object} spec.properties - Feature properties
 * @param {Object} [spec.geometry] - Feature geometry
 * @returns {Object} The row
 */
function makeRow({ layerId, layerType, source, properties, geometry }) {
    return {
        layer: layerType ? { id: layerId, type: layerType } : { id: layerId },
        source,
        properties,
        geometry: geometry || { type: 'Point', coordinates: [0, 0] },
    };
}

/**
 * Map double. `queryRenderedFeatures` answers from a queue: the first call gets
 * `results[0]` (the tolerant box query), the second `results[1]` (the exact
 * point query).
 * @param {Object} [options] - Double configuration
 * @param {Array<Array<Object>>} [options.results] - Queued query answers
 * @param {string[]} [options.presentLayers] - Layer ids the style has
 * @param {number} [options.zoom] - Map zoom
 * @param {Object|undefined} [options.image] - What `getImage` returns
 * @returns {Object} The double
 */
function makeMap({ results = [[]], presentLayers = [], zoom = 10, image } = {}) {
    let call = 0;
    return {
        queryRenderedFeatures: vi.fn(() => results[Math.min(call++, results.length - 1)] || []),
        getLayer: vi.fn((id) => (presentLayers.includes(id) ? { id } : undefined)),
        getZoom: vi.fn(() => zoom),
        getPitch: vi.fn(() => 0),
        getTerrain: vi.fn(() => null),
        getImage: vi.fn(() => image),
        project: vi.fn(() => ({ ...ANCHOR })),
    };
}

const LINE_ROW = makeRow({
    layerId: 'line-layer',
    source: 'lines',
    properties: { id: 'l1', source: 'line' },
});

const POLYGON_ROW = makeRow({
    layerId: 'polygon-layer',
    source: 'polygons',
    properties: { id: 'p1', source: 'polygon' },
});

/** An edit handle: no `properties.source`, so only the handle flag holds it back. */
const HANDLE_ROW = makeRow({
    layerId: 'line-edit-handles-layer',
    layerType: 'circle',
    source: 'line-edit-handles',
    properties: { id: 'h1', user_isEditingHandle: true },
});

/** An area row that came back with no `layer` at all, so it cannot be narrowed. */
const LAYERLESS_POLYGON_ROW = {
    source: 'polygons',
    properties: { id: 'p9', source: 'polygon' },
    geometry: { type: 'Point', coordinates: [0, 0] },
};

beforeEach(() => {
    vi.mocked(isTouchDevice).mockReturnValue(false);
});

/**
 * A FRESH copy of the helper module. `getClickTolerancePx` memoizes at module
 * level (first call wins, because `isTouchDevice` ends in a `matchMedia` call
 * that must not run per mousemove), so the only way to observe a second answer
 * is a second module instance. `vi.resetModules()` also re-runs the `vi.mock`
 * factory, which is why the pointer mock has to be re-imported and re-armed.
 * @param {boolean|Error} pointer - `true` for a touch device, `false` for a
 *   mouse, or an `Error` the probe should throw
 * @returns {Promise<{helpers: Object, probe: Function}>} Module and its probe
 */
async function freshHelpers(pointer) {
    vi.resetModules();

    const pointerUtils = await import('@utils/pointer-utils.js');
    if (pointer instanceof Error) {
        vi.mocked(pointerUtils.isTouchDevice).mockImplementation(() => { throw pointer; });
    } else {
        vi.mocked(pointerUtils.isTouchDevice).mockReturnValue(pointer);
    }
    // The mock registry survives resetModules, so the probe is the SAME spy as
    // in the previous test: only the helper module is new. Clear its history so
    // the call count below is this test's alone.
    vi.mocked(pointerUtils.isTouchDevice).mockClear();

    const helpers = await import(HELPERS_PATH);
    return { helpers, probe: pointerUtils.isTouchDevice };
}

describe('getClickTolerancePx', () => {
    it('gives a mouse the fine tolerance', async () => {
        const { helpers } = await freshHelpers(false);
        expect(helpers.getClickTolerancePx()).toBe(CLICK_TOLERANCE_PX);
    });

    it('gives a coarse pointer the touch tolerance', async () => {
        const { helpers } = await freshHelpers(true);
        expect(helpers.getClickTolerancePx()).toBe(TOUCH_CLICK_TOLERANCE_PX);
    });

    it('falls back to the fine tolerance when the pointer cannot be probed', async () => {
        const { helpers } = await freshHelpers(new Error('no window'));
        expect(helpers.getClickTolerancePx()).toBe(CLICK_TOLERANCE_PX);
    });

    it('probes the pointer ONCE and answers from the memo afterwards', async () => {
        const { helpers, probe } = await freshHelpers(true);

        expect(helpers.getClickTolerancePx()).toBe(TOUCH_CLICK_TOLERANCE_PX);
        expect(probe).toHaveBeenCalledTimes(1);

        // Flipping the probe now must change nothing: the answer is cached.
        probe.mockReturnValue(false);
        expect(helpers.getClickTolerancePx()).toBe(TOUCH_CLICK_TOLERANCE_PX);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('memoizes the fine tolerance too, even after the probe starts throwing', async () => {
        const { helpers, probe } = await freshHelpers(false);

        expect(helpers.getClickTolerancePx()).toBe(CLICK_TOLERANCE_PX);
        probe.mockImplementation(() => { throw new Error('no window'); });
        expect(helpers.getClickTolerancePx()).toBe(CLICK_TOLERANCE_PX);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('is the tolerance queryFeaturesAtPoint builds its box from', async () => {
        const { helpers } = await freshHelpers(true);
        const map = makeMap({ results: [[LINE_ROW]] });

        helpers.queryFeaturesAtPoint(map, { x: 0, y: 0 });

        expect(map.queryRenderedFeatures.mock.calls[0][0]).toEqual([
            [-TOUCH_CLICK_TOLERANCE_PX, -TOUCH_CLICK_TOLERANCE_PX],
            [TOUCH_CLICK_TOLERANCE_PX, TOUCH_CLICK_TOLERANCE_PX],
        ]);
    });
});

describe('queryFeaturesAtPoint', () => {
    it('queries the TOLERANCE BOX first, not the bare point', () => {
        const map = makeMap({ results: [[LINE_ROW]] });

        queryFeaturesAtPoint(map, { x: 100, y: 50 });

        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
        expect(map.queryRenderedFeatures.mock.calls[0][0]).toEqual([
            [100 - CLICK_TOLERANCE_PX, 50 - CLICK_TOLERANCE_PX],
            [100 + CLICK_TOLERANCE_PX, 50 + CLICK_TOLERANCE_PX],
        ]);
    });

    it('honours an explicit tolerance', () => {
        const map = makeMap({ results: [[LINE_ROW]] });
        queryFeaturesAtPoint(map, [100, 50], { tolerance: 20 });
        expect(map.queryRenderedFeatures.mock.calls[0][0]).toEqual([[80, 30], [120, 70]]);
    });

    it('queries the BARE POINT, not a zero-area box, for tolerance 0', () => {
        // A two-corner box is expanded into a ring by MapLibre and takes the
        // polygon path; a caller asking for zero slack wants the point query.
        const point = { x: 100, y: 50 };
        const map = makeMap({ results: [[LINE_ROW]] });

        queryFeaturesAtPoint(map, point, { tolerance: 0 });

        expect(map.queryRenderedFeatures.mock.calls[0][0]).toBe(point);
    });

    it('does NOT run the exact query when no area row survived', () => {
        const map = makeMap({ results: [[LINE_ROW]] });

        expect(queryFeaturesAtPoint(map, { x: 100, y: 50 })).toEqual([LINE_ROW]);
        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
    });

    it('runs the exact point query when an area row survived, and keeps the area only if it is there', () => {
        const point = { x: 100, y: 50 };
        const hit = makeMap({
            results: [[LINE_ROW, POLYGON_ROW], [POLYGON_ROW]],
            presentLayers: ['polygon-layer'],
        });

        expect(queryFeaturesAtPoint(hit, point)).toEqual([LINE_ROW, POLYGON_ROW]);
        expect(hit.queryRenderedFeatures).toHaveBeenCalledTimes(2);
        expect(hit.queryRenderedFeatures.mock.calls[1][0]).toBe(point);

        const miss = makeMap({
            results: [[LINE_ROW, POLYGON_ROW], []],
            presentLayers: ['polygon-layer'],
        });
        expect(queryFeaturesAtPoint(miss, point)).toEqual([LINE_ROW]);
        expect(miss.queryRenderedFeatures).toHaveBeenCalledTimes(2);
    });

    it('narrows the exact query to the layers of the rows that need it, and to those only', () => {
        // The mousemove path pays for this second walk on every frame, so it
        // must not re-walk the line layer that already answered exactly.
        const point = { x: 100, y: 50 };
        const map = makeMap({
            results: [[LINE_ROW, POLYGON_ROW], [POLYGON_ROW]],
            presentLayers: ['line-layer', 'polygon-layer'],
        });

        queryFeaturesAtPoint(map, point);

        expect(map.queryRenderedFeatures.mock.calls[1]).toEqual([point, { layers: ['polygon-layer'] }]);
    });

    it('narrows the exact query even when the tolerant query was already scoped', () => {
        const point = { x: 100, y: 50 };
        const map = makeMap({
            results: [[LINE_ROW, POLYGON_ROW], [POLYGON_ROW]],
            presentLayers: ['line-layer', 'polygon-layer'],
        });

        queryFeaturesAtPoint(map, point, { layers: ['line-layer', 'polygon-layer'] });

        expect(map.queryRenderedFeatures.mock.calls[0][1])
            .toEqual({ layers: ['line-layer', 'polygon-layer'] });
        expect(map.queryRenderedFeatures.mock.calls[1]).toEqual([point, { layers: ['polygon-layer'] }]);
    });

    it('falls back to the tolerant scope when the row needing the exact hit has no layer id', () => {
        const point = { x: 100, y: 50 };

        const unscoped = makeMap({ results: [[LAYERLESS_POLYGON_ROW], [LAYERLESS_POLYGON_ROW]] });
        expect(queryFeaturesAtPoint(unscoped, point)).toEqual([LAYERLESS_POLYGON_ROW]);
        expect(unscoped.queryRenderedFeatures.mock.calls[1]).toEqual([point]);

        const scoped = makeMap({
            results: [[LAYERLESS_POLYGON_ROW], [LAYERLESS_POLYGON_ROW]],
            presentLayers: ['polygon-layer'],
        });
        queryFeaturesAtPoint(scoped, point, { layers: ['polygon-layer'] });
        expect(scoped.queryRenderedFeatures.mock.calls[1])
            .toEqual([point, { layers: ['polygon-layer'] }]);
    });

    it('makes an EDIT HANDLE earn the exact query too, and drops it when it misses', () => {
        // The tools grab handles with a zero-tolerance query of their own; a
        // handle reported 6 px away would promise a grab the mousedown never
        // honours and would block a feature drag for nothing.
        const point = { x: 100, y: 50 };

        const hit = makeMap({
            results: [[LINE_ROW, HANDLE_ROW], [HANDLE_ROW]],
            presentLayers: ['line-edit-handles-layer'],
        });
        expect(queryFeaturesAtPoint(hit, point)).toEqual([LINE_ROW, HANDLE_ROW]);
        expect(hit.queryRenderedFeatures).toHaveBeenCalledTimes(2);
        expect(hit.queryRenderedFeatures.mock.calls[1])
            .toEqual([point, { layers: ['line-edit-handles-layer'] }]);

        const miss = makeMap({
            results: [[LINE_ROW, HANDLE_ROW], []],
            presentLayers: ['line-edit-handles-layer'],
        });
        expect(queryFeaturesAtPoint(miss, point)).toEqual([LINE_ROW]);
    });

    it('routes through { layers } and drops ids the style does not have', () => {
        const map = makeMap({ results: [[LINE_ROW]], presentLayers: ['line-layer'] });

        queryFeaturesAtPoint(map, { x: 10, y: 10 }, {
            layers: ['line-layer', 'nao-existe-layer'],
        });

        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
        expect(map.queryRenderedFeatures.mock.calls[0][1]).toEqual({ layers: ['line-layer'] });
    });

    it('queries the whole style, with no second argument, when no layers are given', () => {
        const map = makeMap({ results: [[LINE_ROW]] });
        queryFeaturesAtPoint(map, { x: 10, y: 10 });
        expect(map.queryRenderedFeatures.mock.calls[0].length).toBe(1);
    });

    it('returns [] for a missing map and never throws on odd rows', () => {
        expect(queryFeaturesAtPoint(null, { x: 1, y: 1 })).toEqual([]);
        expect(queryFeaturesAtPoint(undefined, { x: 1, y: 1 })).toEqual([]);

        const broken = makeMap({ results: [[{}, { layer: {}, properties: null }, LINE_ROW]] });
        expect(() => queryFeaturesAtPoint(broken, { x: 1, y: 1 })).not.toThrow();
        expect(queryFeaturesAtPoint(broken, { x: 1, y: 1 })).toHaveLength(3);
    });

    it('returns [] when the query itself throws', () => {
        const map = makeMap();
        map.queryRenderedFeatures = vi.fn(() => { throw new Error('style not loaded'); });
        expect(queryFeaturesAtPoint(map, { x: 1, y: 1 })).toEqual([]);
    });
});

describe('queryFeaturesAtPoint - exact icon rectangle', () => {
    /**
     * A 200x100 image at pixelRatio 2, i.e. 100x50 CSS pixels, anchored at
     * ANCHOR and drawn by the image layer.
     * @param {Object} [overrides] - Property overrides
     * @returns {Object} The row
     */
    function imageRow(overrides = {}) {
        return makeRow({
            layerId: 'image-layer',
            source: 'images',
            properties: {
                id: 'img1',
                source: 'image',
                size: 1,
                createdAtZoom: 10,
                zoomCorrectionEnabled: true,
                rotation: 0,
                ...overrides,
            },
        });
    }

    const IMAGE = { data: { width: 200, height: 100 }, pixelRatio: 2 };

    it('keeps a click inside the drawn rectangle and drops one outside it', () => {
        const inside = makeMap({ results: [[imageRow()]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(inside, { x: ANCHOR.x + 40, y: ANCHOR.y + 20 })).toHaveLength(1);

        const outside = makeMap({ results: [[imageRow()]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(outside, { x: ANCHOR.x + 60, y: ANCHOR.y })).toEqual([]);
    });

    it('doubles the MODEL rectangle from createdAtZoom 10 to zoom 11', () => {
        // What is pinned here is the rectangle THIS MODEL rebuilds — 100 CSS px
        // wide at zoom 10, 200 at zoom 11 — not MapLibre's collision box, which
        // no double in this file reproduces. The rows are handed in verbatim;
        // only the filter decides which survive.
        const point = { x: ANCHOR.x + 60, y: ANCHOR.y };

        const atTen = makeMap({ results: [[imageRow()]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(atTen, point)).toEqual([]);

        const atEleven = makeMap({ results: [[imageRow()]], zoom: 11, image: IMAGE });
        expect(queryFeaturesAtPoint(atEleven, point)).toHaveLength(1);

        // ... and 200 px wide means the edge is still an edge.
        const farOut = makeMap({ results: [[imageRow()]], zoom: 11, image: IMAGE });
        expect(queryFeaturesAtPoint(farOut, { x: ANCHOR.x + 110, y: ANCHOR.y })).toEqual([]);
    });

    it('places a rotated coordination measure by its icon-anchor', () => {
        // icon-anchor 'left' hangs the 100x50 rectangle to the RIGHT of the
        // anchor; rotating 90 degrees pivots it about the anchor and, with y
        // growing downwards, swings it BELOW the anchor.
        const rotated = () => makeRow({
            layerId: 'coordination-measures-layer',
            source: 'coordination_measures',
            properties: {
                id: 'cm1',
                source: 'coordination_measure',
                size: 1,
                createdAtZoom: 10,
                zoomCorrectionEnabled: true,
                rotation: 90,
                anchor: 'left',
            },
        });

        const below = makeMap({ results: [[rotated()]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(below, { x: ANCHOR.x, y: ANCHOR.y + 50 })).toHaveLength(1);

        // Where the UNROTATED rectangle would have been — the spot MapLibre's
        // axis-aligned collision box would still have accepted on a real map.
        const right = makeMap({ results: [[rotated()]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(right, { x: ANCHOR.x + 60, y: ANCHOR.y })).toEqual([]);

        // Unrotated, the same click lands inside.
        const unrotated = makeMap({
            results: [[{ ...rotated(), properties: { ...rotated().properties, rotation: 0 } }]],
            zoom: 10,
            image: IMAGE,
        });
        expect(queryFeaturesAtPoint(unrotated, { x: ANCHOR.x + 60, y: ANCHOR.y })).toHaveLength(1);
    });

    it('keeps the row when the image is unknown to the style', () => {
        const map = makeMap({ results: [[imageRow()]], zoom: 10, image: undefined });
        expect(queryFeaturesAtPoint(map, { x: ANCHOR.x + 500, y: ANCHOR.y })).toHaveLength(1);

        const noData = makeMap({ results: [[imageRow()]], zoom: 10, image: { pixelRatio: 2 } });
        expect(queryFeaturesAtPoint(noData, { x: ANCHOR.x + 500, y: ANCHOR.y })).toHaveLength(1);
    });

    it('does not touch rows of layers outside EXACT_ICON_LAYER_IDS', () => {
        const map = makeMap({ results: [[LINE_ROW]], zoom: 10, image: IMAGE });
        expect(queryFeaturesAtPoint(map, { x: ANCHOR.x + 5000, y: ANCHOR.y })).toEqual([LINE_ROW]);
        expect(map.getImage).not.toHaveBeenCalled();
    });
});

describe('renderedIconQuad', () => {
    /** A 200x100 bitmap at pixelRatio 2, i.e. 100x50 CSS pixels. */
    const IMAGE = { data: { width: 200, height: 100 }, pixelRatio: 2 };

    /**
     * Properties of an icon drawn at `icon-size` 1: zoom correction OFF pins the
     * size to `size` whatever the map zoom is, so the rectangle below is the
     * bitmap's own CSS size and nothing else.
     * @param {Object} [overrides] - Property overrides
     * @returns {Object} Feature properties
     */
    function props(overrides = {}) {
        return { id: 'img1', size: 1, zoomCorrectionEnabled: false, ...overrides };
    }

    const ICON = { layerId: 'image-layer', coordinates: [10, 20], properties: props() };

    it('returns the drawn rectangle grown by paddingPx on every side', () => {
        // 100x50 CSS px centred on the anchor, plus 5 px all round: half-width
        // 55, half-height 30.
        const map = makeMap({ image: IMAGE });
        expect(renderedIconQuad(map, ICON, { paddingPx: 5 })).toEqual([
            { x: ANCHOR.x - 55, y: ANCHOR.y - 30 },
            { x: ANCHOR.x + 55, y: ANCHOR.y - 30 },
            { x: ANCHOR.x + 55, y: ANCHOR.y + 30 },
            { x: ANCHOR.x - 55, y: ANCHOR.y + 30 },
        ]);
    });

    it('defaults to no padding, i.e. the picture itself', () => {
        const map = makeMap({ image: IMAGE });
        expect(renderedIconQuad(map, ICON)).toEqual([
            { x: ANCHOR.x - 50, y: ANCHOR.y - 25 },
            { x: ANCHOR.x + 50, y: ANCHOR.y - 25 },
            { x: ANCHOR.x + 50, y: ANCHOR.y + 25 },
            { x: ANCHOR.x - 50, y: ANCHOR.y + 25 },
        ]);
    });

    it('asks the style for the image named by properties.id', () => {
        const map = makeMap({ image: IMAGE });
        renderedIconQuad(map, { ...ICON, properties: props({ id: 'outra-imagem' }) });
        expect(map.getImage).toHaveBeenCalledWith('outra-imagem');
    });

    it('projects the coordinates it was handed, not the store position', () => {
        const map = makeMap({ image: IMAGE });
        renderedIconQuad(map, { ...ICON, coordinates: [-45.5, -23.5] });
        expect(map.project).toHaveBeenCalledWith([-45.5, -23.5]);
    });

    it('ignores a rotation on the declination layer, which has no icon-rotate', () => {
        const straight = makeMap({ image: IMAGE });
        const turned = makeMap({ image: IMAGE });

        const quad = renderedIconQuad(turned, {
            layerId: 'magnetic-declinations-layer',
            coordinates: [10, 20],
            properties: props({ rotation: 90 }),
        }, { paddingPx: 5 });

        expect(quad).toEqual(renderedIconQuad(straight, {
            layerId: 'magnetic-declinations-layer',
            coordinates: [10, 20],
            properties: props({ rotation: 0 }),
        }, { paddingPx: 5 }));
    });

    it('rotates the image layer, which does read icon-rotate', () => {
        const map = makeMap({ image: IMAGE });
        const quad = renderedIconQuad(map, { ...ICON, properties: props({ rotation: 90 }) });
        // The 100x50 rectangle turned a quarter turn is 50 wide and 100 tall.
        expect(quad[0].x).toBeCloseTo(ANCHOR.x + 25, 12);
        expect(quad[0].y).toBeCloseTo(ANCHOR.y - 50, 12);
    });

    it('ignores an anchor on the image layer, which has no icon-anchor', () => {
        const map = makeMap({ image: IMAGE });
        const quad = renderedIconQuad(map, { ...ICON, properties: props({ anchor: 'left' }) });
        expect(quad.map((corner) => corner.x)).toEqual([
            ANCHOR.x - 50, ANCHOR.x + 50, ANCHOR.x + 50, ANCHOR.x - 50,
        ]);
    });

    it('honours the anchor on the coordination-measures layer, which reads icon-anchor', () => {
        const map = makeMap({ image: IMAGE });
        const quad = renderedIconQuad(map, {
            layerId: 'coordination-measures-layer',
            coordinates: [10, 20],
            properties: props({ anchor: 'left' }),
        });
        // icon-anchor 'left' hangs the whole rectangle to the RIGHT of the anchor.
        expect(quad.map((corner) => corner.x)).toEqual([
            ANCHOR.x, ANCHOR.x + 100, ANCHOR.x + 100, ANCHOR.x,
        ]);
    });

    it('shifts the coordination-measures rectangle by properties.iconOffset', () => {
        // The bitmap is cropped to the drawing, so the nucleus anchors its
        // ELLIPSE centre and the generator writes the difference into
        // `iconOffset` (icon px). At icon-size 1 that is 12.5 screen px down.
        const map = makeMap({ image: IMAGE });
        const quad = renderedIconQuad(map, {
            layerId: 'coordination-measures-layer',
            coordinates: [10, 20],
            properties: props({ iconOffset: [0, 12.5] }),
        });

        expect(quad).toEqual([
            { x: ANCHOR.x - 50, y: ANCHOR.y - 12.5 },
            { x: ANCHOR.x + 50, y: ANCHOR.y - 12.5 },
            { x: ANCHOR.x + 50, y: ANCHOR.y + 37.5 },
            { x: ANCHOR.x - 50, y: ANCHOR.y + 37.5 },
        ]);
    });

    it('reads the iconOffset given as JSON text, the way a tile carries an array', () => {
        const map = makeMap({ image: IMAGE });
        const icon = {
            layerId: 'coordination-measures-layer',
            coordinates: [10, 20],
            properties: props({ iconOffset: '[0,12.5]' }),
        };

        expect(renderedIconQuad(map, icon)).toEqual(renderedIconQuad(makeMap({ image: IMAGE }), {
            ...icon,
            properties: props({ iconOffset: [0, 12.5] }),
        }));
    });

    it.each(['image-layer', 'military-symbols-layer', 'magnetic-declinations-layer'])(
        'ignores an iconOffset on %s, which declares no icon-offset',
        (layerId) => {
            const shifted = renderedIconQuad(makeMap({ image: IMAGE }), {
                layerId,
                coordinates: [10, 20],
                properties: props({ iconOffset: [0, 12.5] }),
            });

            expect(shifted).toEqual(renderedIconQuad(makeMap({ image: IMAGE }), {
                layerId,
                coordinates: [10, 20],
                properties: props(),
            }));
        },
    );

    it('keeps the rectangle when the iconOffset cannot be read', () => {
        const icon = {
            layerId: 'coordination-measures-layer',
            coordinates: [10, 20],
            properties: props(),
        };
        const plain = renderedIconQuad(makeMap({ image: IMAGE }), icon);

        for (const iconOffset of [null, [1], 'lixo', { x: 0, y: 12.5 }]) {
            expect(renderedIconQuad(makeMap({ image: IMAGE }), {
                ...icon,
                properties: props({ iconOffset }),
            })).toEqual(plain);
        }
    });

    it('returns null when there is nothing to rebuild the rectangle from', () => {
        const map = makeMap({ image: IMAGE });

        expect(renderedIconQuad(null, ICON)).toBeNull();
        expect(renderedIconQuad(map, { ...ICON, properties: null })).toBeNull();
        expect(renderedIconQuad(map, { ...ICON, coordinates: undefined })).toBeNull();
        // A layer with no size rule (`point-marker-layer` among them) is left
        // to MapLibre: a rule shaped like these would compute a wrong rectangle.
        expect(renderedIconQuad(map, { ...ICON, layerId: 'point-marker-layer' })).toBeNull();
        expect(renderedIconQuad(map, { ...ICON, layerId: undefined })).toBeNull();
    });

    it('returns null when the style has no bitmap for the icon', () => {
        expect(renderedIconQuad(makeMap({ image: undefined }), ICON)).toBeNull();
        expect(renderedIconQuad(makeMap({ image: { pixelRatio: 2 } }), ICON)).toBeNull();
    });

    it('returns null when the bitmap has no usable size', () => {
        const bad = makeMap({ image: { data: { width: 'wide', height: 100 }, pixelRatio: 2 } });
        expect(renderedIconQuad(bad, ICON)).toBeNull();
    });

    it('returns null when the icon size cannot be evaluated', () => {
        // Zoom correction ON needs a zoom; a map that cannot answer one leaves
        // the size NaN, and a NaN rectangle must never be trusted.
        const noZoom = makeMap({ image: IMAGE });
        noZoom.getZoom = vi.fn(() => undefined);
        expect(renderedIconQuad(noZoom, {
            ...ICON,
            properties: props({ zoomCorrectionEnabled: true, createdAtZoom: 10 }),
        })).toBeNull();
    });

    it('returns null when project() gives nothing back', () => {
        const noProject = makeMap({ image: IMAGE });
        noProject.project = vi.fn(() => undefined);
        expect(renderedIconQuad(noProject, ICON)).toBeNull();
    });
});

describe('isPointInsideRenderedIcon', () => {
    const map = makeMap({ zoom: 10, image: { data: { width: 100, height: 100 }, pixelRatio: 1 } });

    it('keeps anything it cannot reconstruct', () => {
        expect(isPointInsideRenderedIcon(null, {}, ANCHOR)).toBe(true);
        expect(isPointInsideRenderedIcon(map, null, ANCHOR)).toBe(true);
        expect(isPointInsideRenderedIcon(map, { properties: null }, ANCHOR)).toBe(true);
        expect(isPointInsideRenderedIcon(map, {
            layer: { id: 'image-layer' },
            properties: { id: 'x' },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        }, ANCHOR)).toBe(true);
    });

    it('keeps the row when the layer has no size rule', () => {
        const row = makeRow({
            layerId: 'nao-e-um-icone-layer',
            source: 'x',
            properties: { id: 'img1', source: 'image' },
        });
        expect(isPointInsideRenderedIcon(map, row, { x: 9999, y: 9999 })).toBe(true);
    });

    it('keeps the row when project() gives nothing back', () => {
        const noProject = makeMap({ zoom: 10, image: { data: { width: 10, height: 10 }, pixelRatio: 1 } });
        noProject.project = vi.fn(() => undefined);
        const row = makeRow({
            layerId: 'image-layer',
            source: 'images',
            properties: { id: 'img1', source: 'image', createdAtZoom: 10 },
        });
        expect(isPointInsideRenderedIcon(noProject, row, { x: 9999, y: 9999 })).toBe(true);
    });

    it('keeps a MultiPoint row: there is no single anchor to rebuild a rectangle from', () => {
        const row = makeRow({
            layerId: 'image-layer',
            source: 'images',
            properties: { id: 'img1', source: 'image', size: 1, createdAtZoom: 10 },
            geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] },
        });
        expect(isPointInsideRenderedIcon(map, row, { x: 9999, y: 9999 })).toBe(true);
    });

    it('treats a missing or zero pixelRatio as 1, so the rectangle is the raw pixel size', () => {
        // 120x60 device pixels with no usable pixelRatio must read as 120x60
        // CSS px, i.e. half-width 60 either side of a centred anchor.
        const row = makeRow({
            layerId: 'image-layer',
            source: 'images',
            properties: {
                id: 'img1',
                source: 'image',
                size: 1,
                rotation: 0,
                zoomCorrectionEnabled: false,
            },
        });

        for (const image of [
            { data: { width: 120, height: 60 } },
            { data: { width: 120, height: 60 }, pixelRatio: 0 },
        ]) {
            const noRatio = makeMap({ zoom: 14, image });
            expect(isPointInsideRenderedIcon(noRatio, row, { x: ANCHOR.x + 59, y: ANCHOR.y })).toBe(true);
            expect(isPointInsideRenderedIcon(noRatio, row, { x: ANCHOR.x + 61, y: ANCHOR.y })).toBe(false);
            expect(isPointInsideRenderedIcon(noRatio, row, { x: ANCHOR.x, y: ANCHOR.y + 29 })).toBe(true);
            expect(isPointInsideRenderedIcon(noRatio, row, { x: ANCHOR.x, y: ANCHOR.y + 31 })).toBe(false);
        }
    });
});

describe('isDecisiveHit', () => {
    it('trusts a row with no layer at all', () => {
        expect(isDecisiveHit({})).toBe(true);
        expect(isDecisiveHit({ layer: null })).toBe(true);
        expect(isDecisiveHit(null)).toBe(true);
        expect(isDecisiveHit(undefined)).toBe(true);
    });

    it('trusts every non-symbol layer, because MapLibre verifies the geometry itself', () => {
        for (const layer of [
            { id: 'line-layer', type: 'line' },
            { id: 'polygon-layer', type: 'fill' },
            { id: 'point-layer', type: 'circle' },
        ]) {
            expect(isDecisiveHit({ layer })).toBe(true);
        }
    });

    it('trusts the symbol layers whose rectangle is rebuilt here', () => {
        for (const id of EXACT_ICON_LAYER_IDS) {
            expect(isDecisiveHit({ layer: { id, type: 'symbol' } })).toBe(true);
        }
    });

    it('does NOT trust a symbol layer still answering from its collision box', () => {
        expect(isDecisiveHit({ layer: { id: 'text-layer', type: 'symbol' } })).toBe(false);
        expect(isDecisiveHit({ layer: { id: 'point-marker-layer', type: 'symbol' } })).toBe(false);
        expect(isDecisiveHit({ layer: { id: 'point-label-layer', type: 'symbol' } })).toBe(false);
    });
});

describe('rankHitRows', () => {
    const TEXT_ROW = makeRow({
        layerId: 'text-layer',
        layerType: 'symbol',
        source: 'texts',
        properties: { id: 't1', source: 'text' },
    });

    const IMAGE_ROW = makeRow({
        layerId: 'image-layer',
        layerType: 'symbol',
        source: 'images',
        properties: { id: 'i1', source: 'image' },
    });

    const POINT_ROW = makeRow({
        layerId: 'point-layer',
        layerType: 'circle',
        source: 'points',
        properties: { id: 'pt1', source: 'point' },
    });

    const FILL_ROW = makeRow({
        layerId: 'polygon-layer',
        layerType: 'fill',
        source: 'polygons',
        properties: { id: 'p1', source: 'polygon' },
    });

    it('keeps BOTH a text symbol and the polygon under it: the text cannot demote anything', () => {
        expect(rankHitRows([TEXT_ROW, FILL_ROW])).toEqual([TEXT_ROW, FILL_ROW]);
    });

    it('lets an image win outright, because its rectangle was rebuilt here', () => {
        expect(rankHitRows([IMAGE_ROW, FILL_ROW])).toEqual([IMAGE_ROW]);
    });

    it('lets a circle-layer point win outright, because MapLibre verified the radius', () => {
        expect(rankHitRows([POINT_ROW, FILL_ROW])).toEqual([POINT_ROW]);
    });

    it('keeps the non-decisive text alongside the class a decisive row won', () => {
        expect(rankHitRows([TEXT_ROW, IMAGE_ROW, FILL_ROW])).toEqual([TEXT_ROW, IMAGE_ROW]);
    });

    it('keeps the polygon when the only other row is non-decisive, in query order', () => {
        expect(rankHitRows([FILL_ROW, TEXT_ROW])).toEqual([FILL_ROW, TEXT_ROW]);
    });

    it('returns [] for empty or unusable input', () => {
        expect(rankHitRows([])).toEqual([]);
        expect(rankHitRows(undefined)).toEqual([]);
        expect(rankHitRows(null)).toEqual([]);
    });
});

describe('getSymbolPerspectiveRatio', () => {
    /**
     * @param {number} m3 - Matrix entry 3, the x contribution to w
     * @param {number} m11 - Matrix entry 11, the z (elevation) contribution to w
     * @param {number} m15 - Matrix entry 15, the constant contribution to w
     * @returns {Float64Array} A column-major mat4 with only the w row set
     */
    function wMatrix(m3, m11, m15) {
        const matrix = new Float64Array(16);
        matrix[3] = m3;
        matrix[11] = m11;
        matrix[15] = m15;
        return matrix;
    }

    it('short-circuits to 1 on a flat map with no terrain', () => {
        const map = makeMap();
        map.transform = { modelViewProjectionMatrix: wMatrix(2, 0, 0), cameraToCenterDistance: 1, worldSize: 1024 };

        expect(getSymbolPerspectiveRatio(map, [0, 0])).toBe(1);
        expect(map.getPitch).toHaveBeenCalled();
    });

    it('takes the matrix path when the map is pitched', () => {
        // lng 0 -> mercator x 0.5 -> world x 512; m[3] = 2 makes w = 1024, and
        // cameraToCenterDistance 512 gives 0.5 + 0.5 * (512 / 1024) = 0.75.
        const map = makeMap();
        map.getPitch = vi.fn(() => 45);
        map.transform = {
            modelViewProjectionMatrix: wMatrix(2, 0, 0),
            cameraToCenterDistance: 512,
            worldSize: 1024,
        };

        expect(getSymbolPerspectiveRatio(map, [0, 0])).toBe(0.75);
        expect(getSymbolPerspectiveRatio(map, { lng: 0, lat: 0 })).toBe(0.75);
    });

    it('adds the terrain elevation to w, even at pitch 0', () => {
        const map = makeMap();
        map.getTerrain = vi.fn(() => ({}));
        map.queryTerrainElevation = vi.fn(() => 512);
        map.transform = {
            modelViewProjectionMatrix: wMatrix(2, 1, 0),
            cameraToCenterDistance: 512,
            worldSize: 1024,
        };

        // w = 2 * 512 + 1 * 512 = 1536 -> 0.5 + 0.5 * (512 / 1536)
        expect(getSymbolPerspectiveRatio(map, [0, 0])).toBeCloseTo(0.5 + 0.5 * (512 / 1536), 12);
        expect(map.queryTerrainElevation).toHaveBeenCalled();
    });

    it('treats a missing terrain elevation as zero', () => {
        const map = makeMap();
        map.getTerrain = vi.fn(() => ({}));
        map.queryTerrainElevation = vi.fn(() => null);
        map.transform = {
            modelViewProjectionMatrix: wMatrix(2, 1, 0),
            cameraToCenterDistance: 512,
            worldSize: 1024,
        };

        expect(getSymbolPerspectiveRatio(map, [0, 0])).toBe(0.75);
    });

    it('returns 1 when the transform is missing, incomplete or throws', () => {
        const noTransform = makeMap();
        noTransform.getPitch = vi.fn(() => 45);
        expect(getSymbolPerspectiveRatio(noTransform, [0, 0])).toBe(1);

        const noMatrix = makeMap();
        noMatrix.getPitch = vi.fn(() => 45);
        noMatrix.transform = { cameraToCenterDistance: 512, worldSize: 1024 };
        expect(getSymbolPerspectiveRatio(noMatrix, [0, 0])).toBe(1);

        const noWorldSize = makeMap();
        noWorldSize.getPitch = vi.fn(() => 45);
        noWorldSize.transform = {
            modelViewProjectionMatrix: wMatrix(2, 0, 0),
            cameraToCenterDistance: 512,
        };
        expect(getSymbolPerspectiveRatio(noWorldSize, [0, 0])).toBe(1);

        const throwing = makeMap();
        throwing.getPitch = vi.fn(() => 45);
        Object.defineProperty(throwing, 'transform', {
            get() { throw new Error('transform gone'); },
        });
        expect(getSymbolPerspectiveRatio(throwing, [0, 0])).toBe(1);

        expect(getSymbolPerspectiveRatio(null, [0, 0])).toBe(1);
    });

    it('returns 1 for an unreadable position', () => {
        const map = makeMap();
        map.getPitch = vi.fn(() => 45);
        map.transform = {
            modelViewProjectionMatrix: wMatrix(2, 0, 0),
            cameraToCenterDistance: 512,
            worldSize: 1024,
        };

        expect(getSymbolPerspectiveRatio(map, undefined)).toBe(1);
        expect(getSymbolPerspectiveRatio(map, ['a', 'b'])).toBe(1);
    });
});
