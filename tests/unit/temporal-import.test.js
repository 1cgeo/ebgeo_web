import { describe, it, expect } from 'vitest';
import {
    extractTemporalProperties,
    extractGpxTimes,
    buildTrajectoryFromGpxFeature,
} from '../../src/js/temporal/temporal-import.js';

describe('extractTemporalProperties', () => {
    it('returns {} when there is no temporal data', () => {
        expect(extractTemporalProperties({ nome: 'x' })).toEqual({});
        expect(extractTemporalProperties(null)).toEqual({});
    });

    it('reads the canonical camelCase attributes', () => {
        const out = extractTemporalProperties({
            temporalInicio: '2024-01-01T00:00:00Z',
            temporalFim: '2024-02-01T00:00:00Z',
        });
        expect(out.temporalInicio).toBe(Date.parse('2024-01-01T00:00:00Z'));
        expect(out.temporalFim).toBe(Date.parse('2024-02-01T00:00:00Z'));
    });

    it('reads snake_case variants (CSV / GeoJSON)', () => {
        const out = extractTemporalProperties({
            temporal_inicio: 1000,
            temporal_fim: 2000,
        });
        expect(out).toEqual({ temporalInicio: 1000, temporalFim: 2000 });
    });

    it('reads KML TimeSpan begin/end', () => {
        const out = extractTemporalProperties({ begin: '2024-03-01', end: '2024-03-10' });
        expect(out.temporalInicio).toBe(Date.parse('2024-03-01'));
        expect(out.temporalFim).toBe(Date.parse('2024-03-10'));
    });

    it('reads KML TimeStamp <when> as the start instant', () => {
        const out = extractTemporalProperties({ when: '2024-05-05T12:00:00Z' });
        expect(out.temporalInicio).toBe(Date.parse('2024-05-05T12:00:00Z'));
        expect(out.temporalFim).toBeUndefined();
    });

    it('is case-insensitive', () => {
        expect(extractTemporalProperties({ BEGIN: 1000, END: 2000 })).toEqual({
            temporalInicio: 1000,
            temporalFim: 2000,
        });
    });

    it('ignores unparseable values', () => {
        expect(extractTemporalProperties({ begin: 'not-a-date' })).toEqual({});
    });
});

describe('extractGpxTimes', () => {
    it('reads coordinateProperties.times', () => {
        const f = { properties: { coordinateProperties: { times: ['a', 'b'] } } };
        expect(extractGpxTimes(f)).toEqual(['a', 'b']);
    });
    it('falls back to coordTimes then times', () => {
        expect(extractGpxTimes({ properties: { coordTimes: ['x'] } })).toEqual(['x']);
        expect(extractGpxTimes({ properties: { times: ['y'] } })).toEqual(['y']);
    });
    it('returns [] when absent', () => {
        expect(extractGpxTimes({ properties: {} })).toEqual([]);
        expect(extractGpxTimes({})).toEqual([]);
    });
});

describe('buildTrajectoryFromGpxFeature', () => {
    it('pairs LineString coordinates with their times', () => {
        const feature = {
            geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
            properties: { coordinateProperties: { times: ['2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z'] } },
        };
        const traj = buildTrajectoryFromGpxFeature(feature);
        expect(traj).toHaveLength(2);
        expect(traj[0]).toEqual({ t: Date.parse('2024-01-01T00:00:00Z'), lng: 0, lat: 0 });
        expect(traj[1].lng).toBe(10);
    });

    it('drops vertices without a valid time', () => {
        const feature = {
            geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
            properties: { coordTimes: ['2024-01-01T00:00:00Z', 'bad'] },
        };
        expect(buildTrajectoryFromGpxFeature(feature)).toHaveLength(1);
    });

    it('returns [] for non-track geometries', () => {
        expect(buildTrajectoryFromGpxFeature({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })).toEqual([]);
        expect(buildTrajectoryFromGpxFeature({})).toEqual([]);
    });
});
