// Path: tests/unit/brush-zoom-pass.repro.test.js

/**
 * The brush zoom pass, reproduced.
 *
 * `AddBrushControl` cannot be instantiated here: the suite runs on the `node` environment and
 * the control's import chain reaches `document`. What the pass DOES, though, is a composition
 * of things this file can drive for real, the pure `calculateZoomCorrectedValue` and the write
 * through the diff dispatcher, so `performZoomUpdate` below is the same loop as the control's,
 * character for character on the parts that decide `hasChanges`.
 *
 * TWO GATES ARE PINNED DOWN HERE, and they are not the same gate.
 *
 * 1. The EMPTY-COLLECTION exit. The old pass rebuilt the whole `brushes` collection and wrote
 *    it on EVERY frame of a zoom gesture, empty collection included, and a whole-collection
 *    write re-parses the data, rebuilds the geojson-vt index and drops every loaded tile of the
 *    source. The bench measured it on this branch: 90 writes to `brushes` in one zoom gesture
 *    with nothing drawn.
 *
 * 2. The WRITE ITSELF goes through the dispatcher, never through `source.setData`. `brushes` is
 *    one of the sixteen sources the dispatcher owns, and a raw `setData` there DISCARDS the
 *    pending batch (`layers/geojson-dispatcher.js`). That is the divergence from the main
 *    branch, whose pass mutates the collection read back and calls `setData` on the source.
 */

import { describe, it, expect, vi } from 'vitest';

import { calculateZoomCorrectedValue } from '@tools/helpers/zoom-correction.helpers.js';

const BRUSH_ZOOM_CONFIG = {
    sourceProperty: 'lineWidth',
    calculatedProperty: 'calculatedLineWidth',
};

/**
 * The control's pass, with the map and the dispatcher handed in.
 * @param {Object} source - GeoJSON source double
 * @param {Object} dispatcher - Dispatcher double for `brushes`
 * @param {number} currentZoom - Current map zoom
 * @returns {Promise<{wrote: boolean}>} Whether the source was written
 */
async function performZoomUpdate(source, dispatcher, currentZoom) {
    await dispatcher.flush();
    if (!source) return { wrote: false };

    const data = await source.getData();
    if (!data?.features?.length) return { wrote: false };

    let hasChanges = false;
    for (const feature of data.features) {
        const newLineWidth = calculateZoomCorrectedValue(feature.properties, currentZoom, BRUSH_ZOOM_CONFIG);
        if (feature.properties.calculatedLineWidth !== newLineWidth) {
            feature.properties.calculatedLineWidth = newLineWidth;
            hasChanges = true;
        }
    }

    if (hasChanges) {
        dispatcher.setData(data.features);
        await dispatcher.flush();
    }
    return { wrote: hasChanges };
}

/**
 * The pass as it stood BEFORE this port, kept here as the negative control: no empty gate, no
 * change gate, one whole-collection write per call.
 * @param {Object} source - GeoJSON source double
 * @param {Object} dispatcher - Dispatcher double for `brushes`
 * @param {number} currentZoom - Current map zoom
 * @returns {Promise<{wrote: boolean}>} Whether the source was written
 */
async function performZoomUpdateAntes(source, dispatcher, currentZoom) {
    await dispatcher.flush();
    if (!source) return { wrote: false };

    const data = await source.getData();
    if (data && data.features) {
        const updated = data.features.map((feature) => ({
            ...feature,
            properties: {
                ...feature.properties,
                calculatedLineWidth: calculateZoomCorrectedValue(feature.properties, currentZoom, BRUSH_ZOOM_CONFIG),
            },
        }));
        dispatcher.setData(updated);
        await dispatcher.flush();
        return { wrote: true };
    }
    return { wrote: false };
}

/** Shape of a MapLibre 5.18 GeoJSONSource, reduced to what the pass touches. */
function makeSource(collection) {
    return {
        _held: collection,
        getData: vi.fn(async function () { return JSON.parse(JSON.stringify(this._held)); }),
    };
}

/** The dispatcher for `brushes`, reduced to the two calls the pass makes. */
function makeDispatcher(source) {
    return {
        setData: vi.fn((features) => { source._held = { type: 'FeatureCollection', features }; }),
        flush: vi.fn(async () => {}),
    };
}

const brush = (properties) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});

const collection = (features) => ({ type: 'FeatureCollection', features });

describe('brush zoom pass', () => {
    it('writes nothing when every calculatedLineWidth is already right for the zoom', async () => {
        // lineWidth 4, anchored at zoom 10, read at zoom 12: 4 * 2^2 = 16.
        const source = makeSource(collection([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
            brush({ id: 'b', lineWidth: 2.5, createdAtZoom: 12, calculatedLineWidth: 2.5 }),
        ]));
        const dispatcher = makeDispatcher(source);

        const { wrote } = await performZoomUpdate(source, dispatcher, 12);

        expect(wrote).toBe(false);
        expect(dispatcher.setData).not.toHaveBeenCalled();
    });

    // THE WORST CASE THE GATE EXISTS FOR. The old pass wrote here on every single frame of the
    // gesture, on a map with no brush drawn at all.
    it('writes nothing on an empty collection', async () => {
        const source = makeSource(collection([]));
        const dispatcher = makeDispatcher(source);

        const { wrote } = await performZoomUpdate(source, dispatcher, 12);

        expect(wrote).toBe(false);
        expect(dispatcher.setData).not.toHaveBeenCalled();
    });

    it('CONTROLE NEGATIVO: the shape this replaced writes on both, and once per call', async () => {
        const vazia = makeSource(collection([]));
        const dispatcherVazio = makeDispatcher(vazia);
        expect((await performZoomUpdateAntes(vazia, dispatcherVazio, 12)).wrote).toBe(true);
        expect(dispatcherVazio.setData).toHaveBeenCalledTimes(1);

        const estavel = makeSource(collection([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
        ]));
        const dispatcherEstavel = makeDispatcher(estavel);
        await performZoomUpdateAntes(estavel, dispatcherEstavel, 12);
        await performZoomUpdateAntes(estavel, dispatcherEstavel, 12);
        await performZoomUpdateAntes(estavel, dispatcherEstavel, 12);
        // Three frames at the SAME zoom, three whole-collection writes.
        expect(dispatcherEstavel.setData).toHaveBeenCalledTimes(3);
    });

    it('writes once when the zoom moved, and not again at the same zoom', async () => {
        const source = makeSource(collection([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
        ]));
        const dispatcher = makeDispatcher(source);

        const first = await performZoomUpdate(source, dispatcher, 13);
        expect(first.wrote).toBe(true);
        expect(source._held.features[0].properties.calculatedLineWidth).toBe(32);

        const second = await performZoomUpdate(source, dispatcher, 13);
        expect(second.wrote).toBe(false);
        expect(dispatcher.setData).toHaveBeenCalledTimes(1);
    });

    it('writes through the dispatcher and never through the source', async () => {
        // `brushes` is one of the sixteen sources the dispatcher owns, and a raw `setData`
        // there discards the pending batch. The source double carries no `setData` at all, so
        // a pass that reached for one would throw rather than pass quietly.
        const source = makeSource(collection([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
        ]));
        const dispatcher = makeDispatcher(source);

        expect(source.setData).toBeUndefined();
        await performZoomUpdate(source, dispatcher, 14);

        expect(dispatcher.setData).toHaveBeenCalledTimes(1);
        // Flushed before the read AND after the write: the read must see the queued batch, and
        // the write must not sit in the queue until the next gesture.
        expect(dispatcher.flush).toHaveBeenCalledTimes(2);
    });
});

describe('calculateZoomCorrectedValue, the brush cases', () => {
    it('honours the clamp, and a value already clamped produces no change', () => {
        const properties = { lineWidth: 10, createdAtZoom: 1, calculatedLineWidth: 500 };
        const config = { ...BRUSH_ZOOM_CONFIG, maxValue: 500 };

        expect(calculateZoomCorrectedValue(properties, 24, config)).toBe(500);
        expect(properties.calculatedLineWidth).toBe(calculateZoomCorrectedValue(properties, 24, config));
    });

    it('returns the authored width untouched when zoom correction is off', () => {
        const properties = {
            lineWidth: 6,
            createdAtZoom: 3,
            zoomCorrectionEnabled: false,
            calculatedLineWidth: 6,
        };

        expect(calculateZoomCorrectedValue(properties, 18, BRUSH_ZOOM_CONFIG)).toBe(6);
        expect(calculateZoomCorrectedValue(properties, 0, BRUSH_ZOOM_CONFIG)).toBe(6);
    });

    it('answers with the base width when the feature carries no zoom reference', () => {
        // Legacy `.ebgeo` brushes have no createdAtZoom at all.
        expect(calculateZoomCorrectedValue({ lineWidth: 5 }, 14, BRUSH_ZOOM_CONFIG)).toBe(5);
    });
});
