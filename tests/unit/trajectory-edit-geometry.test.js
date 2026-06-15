import { describe, it, expect } from 'vitest';
import { buildPathCollection } from '../../src/js/temporal/trajectory-tool/trajectory-edit-geometry.js';

describe('buildPathCollection', () => {
    it('returns an empty collection for fewer than 2 keypoints', () => {
        expect(buildPathCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
        expect(buildPathCollection([{ t: 1, lng: 0, lat: 0 }])).toEqual({ type: 'FeatureCollection', features: [] });
        expect(buildPathCollection(null)).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('builds a single time-ordered LineString through the keypoints', () => {
        const fc = buildPathCollection([
            { t: 200, lng: 1, lat: 1 },
            { t: 100, lng: 0, lat: 0 },
        ]);
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('drops invalid keypoints before building the path', () => {
        const fc = buildPathCollection([
            { t: 1, lng: 0, lat: 0 },
            { t: NaN, lng: 5, lat: 5 },
            { t: 2, lng: 1, lat: 1 },
        ]);
        expect(fc.features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
    });
});
