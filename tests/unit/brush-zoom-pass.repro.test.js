// Path: tests/unit/brush-zoom-pass.repro.test.js

import { describe, it, expect, vi } from 'vitest';

import { calculateZoomCorrectedValue } from '../../src/js/tool_manager/helpers/zoom-correction.helpers.js';
import { readGeoJSONSourceDataAsync } from '../../src/js/utilities/geojson-source.js';

/**
 * The brush zoom pass, reproduced.
 *
 * `AddBrushControl` cannot be instantiated here: the suite runs on the `node`
 * environment and the control's import chain reaches `document`. What the pass
 * DOES, though, is a composition of two things this file can drive for real, the
 * pure `calculateZoomCorrectedValue` and the synchronous source read, so the loop
 * below is the same loop as `performZoomUpdate`, character for character on the
 * parts that decide `hasChanges`.
 *
 * What it pins down is the gate that did not exist before 2026-09-03: the old
 * pass called `setData` on EVERY frame of a zoom gesture, empty collection
 * included, and each `setData` re-parses the collection, rebuilds the geojson-vt
 * index and drops every loaded tile of the source.
 */
const BRUSH_ZOOM_CONFIG = {
    sourceProperty: 'lineWidth',
    calculatedProperty: 'calculatedLineWidth',
};

async function performZoomUpdate(source, currentZoom) {
    const data = await readGeoJSONSourceDataAsync(source);
    if (!data?.features?.length) return { setDataCalled: false };

    let hasChanges = false;
    for (const feature of data.features) {
        const newLineWidth = calculateZoomCorrectedValue(feature.properties, currentZoom, BRUSH_ZOOM_CONFIG);
        if (feature.properties.calculatedLineWidth !== newLineWidth) {
            feature.properties.calculatedLineWidth = newLineWidth;
            hasChanges = true;
        }
    }

    if (hasChanges) source.setData(data);
    return { setDataCalled: hasChanges };
}

// Shape of a MapLibre 5.18 GeoJSONSource, reduced to what the pass touches.
function makeSource(collection) {
    return {
        _data: { geojson: collection },
        serialize() { return { type: 'geojson', data: this._data.geojson }; },
        getData: vi.fn(async function () { return JSON.parse(JSON.stringify(this._data.geojson)); }),
        setData: vi.fn(function (next) { this._data.geojson = next; }),
    };
}

const brush = (properties) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});

const fc = (features) => ({ type: 'FeatureCollection', features });

describe('brush zoom pass', () => {
    it('writes nothing when every calculatedLineWidth is already right for the zoom', async () => {
        // lineWidth 4, anchored at zoom 10, read at zoom 12: 4 * 2^2 = 16.
        const source = makeSource(fc([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
            brush({ id: 'b', lineWidth: 2.5, createdAtZoom: 12, calculatedLineWidth: 2.5 }),
        ]));

        const { setDataCalled } = await performZoomUpdate(source, 12);

        expect(setDataCalled).toBe(false);
        expect(source.setData).not.toHaveBeenCalled();
        expect(source.getData).not.toHaveBeenCalled();
    });

    // THE WORST CASE THE GATE EXISTS FOR. The old pass called `setData` here on
    // every single frame of the gesture, on a map with no brush drawn at all.
    it('writes nothing on an empty collection', async () => {
        const source = makeSource(fc([]));

        const { setDataCalled } = await performZoomUpdate(source, 12);

        expect(setDataCalled).toBe(false);
        expect(source.setData).not.toHaveBeenCalled();
    });

    it('writes once when the zoom moved, and not again at the same zoom', async () => {
        const source = makeSource(fc([
            brush({ id: 'a', lineWidth: 4, createdAtZoom: 10, calculatedLineWidth: 16 }),
        ]));

        const first = await performZoomUpdate(source, 13);
        expect(first.setDataCalled).toBe(true);
        expect(source._data.geojson.features[0].properties.calculatedLineWidth).toBe(32);

        const second = await performZoomUpdate(source, 13);
        expect(second.setDataCalled).toBe(false);
        expect(source.setData).toHaveBeenCalledTimes(1);
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
