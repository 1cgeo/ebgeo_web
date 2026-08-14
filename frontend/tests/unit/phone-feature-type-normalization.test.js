// Path: tests/unit/phone-feature-type-normalization.test.js

/**
 * Regression tests for the phone layout feature-type normalization.
 *
 * Root cause: FEATURE_PANEL_OPENED is emitted with the SINGULAR source type by the
 * map (ui_manager.js), with the PLURAL storage type by the bottom-sheet tree and the
 * phone search, and with pseudo-types ('searchResult', 'tool_panel') by the sidebar.
 * The phone handler passed the value straight to getFeatureById, which indexes
 * `mapData.features[type]` — a plural-keyed object — so a tap on the map hit
 * `features['point'] === undefined` and threw inside an empty catch: nothing happened
 * on screen, silently.
 */

import { describe, it, expect } from 'vitest';
import { resolveStorageType } from '../../src/js/phone/phone-layout.js';
import { getAllStorageTypes } from '../../src/js/store/store.constants.js';

describe('resolveStorageType — singular source types (emitted by the map)', () => {
    it.each([
        ['point', 'points'],
        ['line', 'lines'],
        ['polygon', 'polygons'],
        ['sector', 'setores'],
        ['military_symbol', 'military_symbols'],
        ['occupied_front', 'occupied_fronts'],
    ])('maps %s to %s', (source, storage) => {
        expect(resolveStorageType(source)).toBe(storage);
    });

    it('maps every known source type onto a real storage bucket', () => {
        const storageTypes = getAllStorageTypes();
        expect(storageTypes.length).toBeGreaterThan(0);
        for (const source of ['point', 'line', 'polygon', 'circle', 'ellipse', 'rectangle',
            'sector', 'text', 'image', 'brush', 'arrow', 'boundary', 'occupied_front',
            'military_symbol', 'coordination_measure', 'magnetic_declination']) {
            expect(storageTypes).toContain(resolveStorageType(source));
        }
    });
});

describe('resolveStorageType — plural storage types (emitted by tree and search)', () => {
    it.each(['points', 'setores', 'military_symbols', 'occupied_fronts'])(
        'keeps %s unchanged',
        (storage) => {
            expect(resolveStorageType(storage)).toBe(storage);
        },
    );

    it('is idempotent (double normalization must not append another plural)', () => {
        for (const source of ['point', 'sector', 'los', 'visibility']) {
            const once = resolveStorageType(source);
            expect(resolveStorageType(once)).toBe(once);
        }
    });

    it('handles the types whose singular and plural are identical', () => {
        expect(resolveStorageType('los')).toBe('los');
        expect(resolveStorageType('visibility')).toBe('visibility');
    });
});

describe('resolveStorageType — rejections (edge cases)', () => {
    it.each(['searchResult', 'tool_panel', 'vectorInfo'])(
        'rejects the pseudo-type %s emitted by the sidebar',
        (pseudo) => {
            expect(resolveStorageType(pseudo)).toBeNull();
        },
    );

    it('rejects an unknown type instead of inventing a bucket', () => {
        // getStorageTypeFromSource falls back to `${type}s`, which would be a phantom
        // bucket; the phone must not query it.
        expect(resolveStorageType('banana')).toBeNull();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['empty string', ''],
        ['number', 42],
        ['object', { type: 'point' }],
    ])('rejects %s', (_label, value) => {
        expect(resolveStorageType(value)).toBeNull();
    });
});
