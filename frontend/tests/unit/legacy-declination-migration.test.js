import { describe, expect, it } from 'vitest';
import { ensureMapDataShape, normalizeLegacyDeclinationProperties } from '../../src/js/store/repository.utils.js';
import { normalizeMapDataForCurrentVersion } from '../../src/js/import_export/import-normalize.js';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';

const legacyMap = () => ({
    features: {
        coordination_lines: [],
        magnetic_declinations: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-47, -15] },
            properties: { id: 'd6088ac9-6e73-4d64-8934-c79b96ca1fae', source: 'magnetic_declination',
                declinacao: -21.5, convergencia: 0.7, ano: 2026, size: 0.4, visivel: true },
        }],
    },
});

describe('legacy declination recovery', () => {
    it('recovers browser-read angles and rendering defaults without changing the original document', () => {
        const original = legacyMap();
        const before = structuredClone(original);
        const shaped = ensureMapDataShape(original);
        const [feature] = shaped.features.magnetic_declinations;
        expect(feature.properties).toEqual({ ...before.features.magnetic_declinations[0].properties,
            declination: -21.5, convergence: 0.7, width: 400, height: 500, opacity: 1 });
        expect(feature.geometry).toBe(original.features.magnetic_declinations[0].geometry);
        expect(original).toEqual(before);
        expect(ensureMapDataShape(shaped)).toBeNull();
        expect(feature.properties).not.toHaveProperty('date');
        expect(feature.properties).not.toHaveProperty('createdAtZoom');
    });

    it('preserves zero, explicit canonical values and intentional display settings', () => {
        const properties = { declinacao: -21.5, convergencia: 0.7, declination: 0, convergence: null,
            opacity: 0, size: 0, width: 123, height: 456, visivel: false };
        expect(normalizeLegacyDeclinationProperties(properties)).toBe(properties);
        expect(normalizeLegacyDeclinationProperties({ declinacao: 0, convergencia: 0 }))
            .toMatchObject({ declination: 0, convergence: 0 });
    });

    it.each([null, undefined, '', '-21.5', '-21,5', NaN, Infinity, -Infinity])(
        'does not manufacture angles from invalid aliases: %s', value => {
            const properties = { declinacao: value, convergencia: value };
            expect(normalizeLegacyDeclinationProperties(properties)).toBe(properties);
        });

    it('does not reinterpret unrelated features or touch valid current declinations', () => {
        const map = { features: { coordination_lines: [],
            points: [{ properties: { declinacao: 42 } }],
            magnetic_declinations: [null, { properties: { declination: -20, convergence: 1 } }],
        } };
        expect(ensureMapDataShape(map)).toBeNull();
    });

    it('normalizes file imports even when the export already has the current version', () => {
        const map = { ...legacyMap(), version: '3.0' };
        const first = normalizeMapDataForCurrentVersion(map);
        const properties = first.mapData.features.magnetic_declinations[0].properties;
        expect(properties).toMatchObject({ declination: -21.5, convergence: 0.7, opacity: 1 });
        normalizeMapDataForCurrentVersion(map);
        expect(map.features.magnetic_declinations[0].properties).toBe(properties);
    });

    it('includes the same recovery in direct server imports without mutating the source export', () => {
        const map = legacyMap();
        const before = structuredClone(map);
        const { payload } = buildServerImportPayload({ maps: { Principal: map } }, { name: 'Legacy' });
        const [feature] = payload.maps[0].features;
        expect(feature.feature_type).toBe('magnetic_declination');
        expect(feature.geometry).toEqual(before.features.magnetic_declinations[0].geometry);
        expect(feature.properties).toMatchObject({ ...before.features.magnetic_declinations[0].properties,
            declination: -21.5, convergence: 0.7, opacity: 1, width: 400, height: 500 });
        expect(map).toEqual(before);
    });
});
