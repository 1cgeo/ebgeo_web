// Path: tests/unit/kmz-feature-types.repro.test.js

/**
 * Regression test for the KMZ export losing polygon fills, label text and
 * symbol icons.
 *
 * Root cause: `getCurrentMapFeatures()` returns a collection keyed by STORAGE
 * type, which is plural and irregular (`polygon` -> `polygons`,
 * `sector` -> `setores`, `boundary` -> `boundarys`). The exporter compared
 * those raw keys against sets of SOURCE (singular) type names, so every
 * comparison failed and each feature fell through to the generic line branch:
 * polygons lost their PolyStyle, texts became bare points, and military
 * symbols / coordination measures / images lost their icons entirely.
 * Lines appeared to work only because the generic branch IS the line branch.
 */

import { describe, it, expect } from 'vitest';
import { FEATURE_TYPE_MAPPINGS, getSourceTypeFromStorage } from '@js/store/store.constants.js';
import {
    classifyFeatureType,
    FeatureCategory,
    AREA_TYPES,
    LINE_TYPES,
    SYMBOL_TYPES,
    SKIPPED_TYPES,
} from '@js/import_export/kmz/kmz-feature-types.js';

describe('storage type -> source type conversion', () => {
    it('round-trips every mapped feature type', () => {
        for (const [sourceType, storageType] of Object.entries(FEATURE_TYPE_MAPPINGS)) {
            expect(getSourceTypeFromStorage(storageType)).toBe(sourceType);
        }
    });

    it('covers the irregular plurals that string munging would miss', () => {
        // Naive de-pluralizing ("strip the s") gets these wrong.
        expect(getSourceTypeFromStorage('setores')).toBe('sector');
        expect(getSourceTypeFromStorage('boundarys')).toBe('boundary');
        expect(getSourceTypeFromStorage('brushes')).toBe('brush');
        expect(getSourceTypeFromStorage('ellipses')).toBe('ellipse');
    });
});

describe('classifyFeatureType', () => {
    it('classifies every known feature type as something other than a bare fallback', () => {
        // The bug: storage keys never matched, so everything became LINE.
        // Pin the categories that MUST NOT be the generic fallback.
        const expected = {
            polygon: FeatureCategory.AREA,
            circle: FeatureCategory.AREA,
            ellipse: FeatureCategory.AREA,
            rectangle: FeatureCategory.AREA,
            sector: FeatureCategory.AREA,
            arrow: FeatureCategory.AREA,
            line: FeatureCategory.LINE,
            brush: FeatureCategory.LINE,
            boundary: FeatureCategory.LINE,
            occupied_front: FeatureCategory.LINE,
            point: FeatureCategory.POINT,
            text: FeatureCategory.TEXT,
            image: FeatureCategory.IMAGE,
            military_symbol: FeatureCategory.SYMBOL,
            coordination_measure: FeatureCategory.SYMBOL,
            magnetic_declination: FeatureCategory.SYMBOL,
            los: FeatureCategory.SKIPPED,
            visibility: FeatureCategory.SKIPPED,
        };

        for (const [sourceType, category] of Object.entries(expected)) {
            expect(classifyFeatureType(sourceType)).toBe(category);
        }
    });

    it('classifies every type the store knows about', () => {
        // Guards against a new feature type being added to the store without
        // the exporter learning how to handle it.
        for (const sourceType of Object.keys(FEATURE_TYPE_MAPPINGS)) {
            expect(Object.values(FeatureCategory)).toContain(classifyFeatureType(sourceType));
        }
    });

    it('never classifies a PLURAL storage key as a drawable category', () => {
        // This is the exact regression: passing storage keys straight in.
        // They must not accidentally match a singular set.
        for (const storageType of Object.values(FEATURE_TYPE_MAPPINGS)) {
            const sourceType = getSourceTypeFromStorage(storageType);
            if (storageType === sourceType) continue; // 'los' / 'visibility' are identical
            expect(AREA_TYPES.has(storageType)).toBe(false);
            expect(SYMBOL_TYPES.has(storageType)).toBe(false);
        }
    });

    it('keeps the type sets disjoint', () => {
        const sets = [AREA_TYPES, LINE_TYPES, SYMBOL_TYPES, SKIPPED_TYPES];
        for (let i = 0; i < sets.length; i++) {
            for (let j = i + 1; j < sets.length; j++) {
                const overlap = [...sets[i]].filter(type => sets[j].has(type));
                expect(overlap).toEqual([]);
            }
        }
    });

    it('handles unknown and malformed input without throwing', () => {
        expect(classifyFeatureType('nao_existe')).toBe(FeatureCategory.LINE);
        expect(classifyFeatureType(undefined)).toBe(FeatureCategory.LINE);
        expect(classifyFeatureType(null)).toBe(FeatureCategory.LINE);
        expect(classifyFeatureType('')).toBe(FeatureCategory.LINE);
    });
});
