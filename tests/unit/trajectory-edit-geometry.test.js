import { describe, it, expect } from 'vitest';
import {
    buildPreviewCollection,
    appendKeypoint,
    removeLastKeypoint,
} from '../../src/js/temporal/trajectory-tool/trajectory-edit-geometry.js';

describe('buildPreviewCollection', () => {
    it('returns an empty collection for no keypoints', () => {
        const fc = buildPreviewCollection([]);
        expect(fc.type).toBe('FeatureCollection');
        expect(fc.features).toEqual([]);
    });

    it('emits one labelled Point per keypoint and no path for a single point', () => {
        const fc = buildPreviewCollection([{ t: 1, lng: 10, lat: 20 }]);
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [10, 20] });
        expect(fc.features[0].properties.label).toBe('1');
    });

    it('adds a LineString path when there are 2+ keypoints (sorted by time)', () => {
        const fc = buildPreviewCollection([
            { t: 200, lng: 1, lat: 1 },
            { t: 100, lng: 0, lat: 0 },
        ]);
        const points = fc.features.filter((f) => f.geometry.type === 'Point');
        const paths = fc.features.filter((f) => f.geometry.type === 'LineString');
        expect(points).toHaveLength(2);
        expect(paths).toHaveLength(1);
        // Sorted chronologically: (0,0) then (1,1)
        expect(paths[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
        expect(points.map((p) => p.properties.label)).toEqual(['1', '2']);
    });

    it('drops invalid keypoints', () => {
        const fc = buildPreviewCollection([
            { t: 1, lng: 0, lat: 0 },
            { t: NaN, lng: 1, lat: 1 },
        ]);
        expect(fc.features.filter((f) => f.geometry.type === 'Point')).toHaveLength(1);
    });
});

describe('appendKeypoint / removeLastKeypoint', () => {
    it('appends preserving insertion order (not sorted by time)', () => {
        let list = appendKeypoint([], 100, 0, 0);
        list = appendKeypoint(list, 50, 1, 1);
        expect(list.map((k) => k.t)).toEqual([100, 50]);
    });

    it('removes the most-recently-added keypoint, regardless of its time', () => {
        // Insertion order: A@10:00 added, then B@09:00 (earlier time) added last.
        let list = appendKeypoint([], 600, 0, 0); // A (later time, added first)
        list = appendKeypoint(list, 540, 1, 1); // B (earlier time, added last)
        const out = removeLastKeypoint(list);
        // Right-click must undo the last click (B), keeping A — not pop the latest time.
        expect(out.map((k) => k.t)).toEqual([600]);
    });

    it('handles empty input', () => {
        expect(removeLastKeypoint([])).toEqual([]);
        expect(appendKeypoint(undefined, 1, 0, 0)).toEqual([{ t: 1, lng: 0, lat: 0 }]);
    });
});
