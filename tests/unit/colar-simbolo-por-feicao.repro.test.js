// Path: tests/unit/colar-simbolo-por-feicao.repro.test.js

/**
 * Regression test for the id list that feeds MapLibre image registration.
 *
 * Root cause: the symbol layers name their icon after the feature itself
 * ('icon-image': ['get', 'id']), so an image-backed feature draws nothing until
 * an image is registered under its id. Copy/paste duplicated the stored blob
 * under the new id correctly, but ClipboardManager.loadPastedImages walked a
 * CLOSED list of two buckets (images, military_symbols) written before
 * coordination measures and magnetic declinations existed. Neither was ever
 * visited, so the pasted feature stayed invisible until a reload, where
 * layer_setup.setImages walked a SECOND, hand-written list that happened to be
 * complete. Two hand-written lists for one fact: one of them was bound to rot.
 *
 * collectImageResourceIds derives the buckets from IMAGE_RESOURCE_FEATURE_TYPES,
 * so there is no list left to forget.
 */

import { describe, it, expect } from 'vitest';
import {
    IMAGE_RESOURCE_FEATURE_TYPES,
    IMAGE_RESOURCE_STORAGE_TYPES,
    getStorageTypeFromSource
} from '@js/store/store.constants.js';
import { collectImageResourceIds } from '@js/layers/feature-images.js';

/** @returns {Object} a minimal feature carrying only what the walk reads */
function featureWithId(id) {
    return { type: 'Feature', properties: { id }, geometry: null };
}

describe('IMAGE_RESOURCE_STORAGE_TYPES', () => {
    it('names the two buckets the paste bug missed', () => {
        // The literal bucket names from the bug report, spelled out on purpose:
        // they are what a reader greps for when the symbol goes missing again.
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('coordination_measures');
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toContain('magnetic_declinations');
    });

    it('is the plural view of the source list, same length and order', () => {
        expect(IMAGE_RESOURCE_STORAGE_TYPES).toEqual(
            IMAGE_RESOURCE_FEATURE_TYPES.map(getStorageTypeFromSource)
        );
    });

    it('is frozen, so a caller cannot grow it at runtime', () => {
        expect(Object.isFrozen(IMAGE_RESOURCE_STORAGE_TYPES)).toBe(true);
    });
});

describe('collectImageResourceIds', () => {
    it('collects an id from each of the four image-backed buckets', () => {
        const ids = collectImageResourceIds({
            images: [featureWithId('img-1')],
            military_symbols: [featureWithId('mil-1')],
            coordination_measures: [featureWithId('med-1')],
            magnetic_declinations: [featureWithId('dec-1')]
        });

        expect(ids).toEqual(['img-1', 'mil-1', 'med-1', 'dec-1']);
    });

    it('ignores buckets that carry no image', () => {
        const ids = collectImageResourceIds({
            points: [featureWithId('pt-1')],
            lines: [featureWithId('ln-1')],
            polygons: [featureWithId('pg-1')],
            coordination_measures: [featureWithId('med-1')]
        });

        expect(ids).toEqual(['med-1']);
    });

    it('skips a missing, null or non-array bucket', () => {
        const ids = collectImageResourceIds({
            images: null,
            military_symbols: undefined,
            coordination_measures: 'nao e um array',
            magnetic_declinations: [featureWithId('dec-1')]
        });

        expect(ids).toEqual(['dec-1']);
    });

    it('skips an empty bucket without inventing an id', () => {
        expect(collectImageResourceIds({ images: [] })).toEqual([]);
    });

    it('skips a feature with no usable properties.id', () => {
        const ids = collectImageResourceIds({
            images: [
                featureWithId('img-1'),
                { type: 'Feature', properties: {} },
                { type: 'Feature' },
                null,
                undefined,
                featureWithId(''),
                featureWithId('img-2')
            ]
        });

        expect(ids).toEqual(['img-1', 'img-2']);
    });

    it('returns each id once even when it repeats across buckets', () => {
        const ids = collectImageResourceIds({
            images: [featureWithId('mesmo-id'), featureWithId('mesmo-id')],
            military_symbols: [featureWithId('mesmo-id')]
        });

        expect(ids).toEqual(['mesmo-id']);
    });

    it('returns an empty array for null, undefined and an empty collection', () => {
        expect(collectImageResourceIds(null)).toEqual([]);
        expect(collectImageResourceIds(undefined)).toEqual([]);
        expect(collectImageResourceIds({})).toEqual([]);
    });

    it('finds the id of EVERY image-backed type the store declares', () => {
        // The invariant that replaces the closed list: whatever
        // IMAGE_RESOURCE_FEATURE_TYPES grows to, a feature of that type placed
        // in its own bucket must come back out. A future type added to the
        // source list is covered here without touching this test.
        expect(IMAGE_RESOURCE_FEATURE_TYPES.length).toBeGreaterThan(0);

        for (const sourceType of IMAGE_RESOURCE_FEATURE_TYPES) {
            const storageType = getStorageTypeFromSource(sourceType);
            const collection = { [storageType]: [featureWithId('id-de-' + sourceType)] };

            expect(collectImageResourceIds(collection)).toEqual(['id-de-' + sourceType]);
        }
    });
});
