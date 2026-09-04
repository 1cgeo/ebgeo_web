import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module creates `maplibregl.Marker` instances and touches `document` only
// in code paths not exercised here; a Marker double that counts `remove()` is
// what the clear-all contract needs.
const removed = [];
class MarkerDouble {
    constructor() { this._lngLat = null; this._map = null; }
    setLngLat(lngLat) { this._lngLat = lngLat; return this; }
    addTo(map) { this._map = map; return this; }
    remove() {
        // A marker placed at lng 999 stands for one whose map is already gone.
        if (this._lngLat && this._lngLat[0] === 999) throw new Error('map gone');
        removed.push(this);
        this._map = null;
        return this;
    }
}
globalThis.maplibregl = { Marker: MarkerDouble };
globalThis.document = { createElement: () => ({ className: '', innerText: '', dataset: {} }), querySelector: () => null };

vi.mock('@js/measurement_tool/measurement-geometry.js', () => ({ calculateLineLength: () => 0 }));

const { displayMeasurement, removeMeasurement, clearAllMeasurementMarkers } = await import('../../src/js/draw_tools/line_tool/line_measurement.js');

describe('clearAllMeasurementMarkers', () => {
    beforeEach(() => { removed.length = 0; clearAllMeasurementMarkers(); });

    it('removes every registered marker (detaching its map listeners) and empties the registry', () => {
        const map = {};
        displayMeasurement(map, [0, 0], '1 km', 'a', 'default');
        displayMeasurement(map, [1, 1], '2 km', 'b', 'default');
        displayMeasurement(map, [2, 2], '3 km', 'c', 'default');

        expect(clearAllMeasurementMarkers()).toBe(3);
        expect(removed).toHaveLength(3);
        // The registry is empty: clearing again removes nothing.
        expect(clearAllMeasurementMarkers()).toBe(0);
        expect(removed).toHaveLength(3);
    });

    it('does not double-remove a marker already removed by feature id', () => {
        displayMeasurement({}, [0, 0], '1 km', 'x', 'default');
        removeMeasurement('x');
        expect(removed).toHaveLength(1);
        expect(clearAllMeasurementMarkers()).toBe(0);
        expect(removed).toHaveLength(1);
    });

    it('survives a marker whose remove() throws, and still clears the rest', () => {
        displayMeasurement({}, [0, 0], '1 km', 'ok', 'default');
        displayMeasurement({}, [999, 0], '1 km', 'bad', 'default');
        expect(() => clearAllMeasurementMarkers()).not.toThrow();
        expect(removed).toHaveLength(1);
        expect(clearAllMeasurementMarkers()).toBe(0);
    });
});
