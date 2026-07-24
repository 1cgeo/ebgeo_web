import { describe, it, expect } from 'vitest';
import cartaTopografica from '../../src/js/baselayers/carta_topografica.js';
import cartaOrtoimagem from '../../src/js/baselayers/carta_ortoimagem.js';
import osmLayer from '../../src/js/baselayers/osm_layer.js';
import imagensLayer from '../../src/js/baselayers/imagens_layer.js';
import bdgexLayer from '../../src/js/baselayers/bdgex_layer.js';

/**
 * Regression: the app hung on the loading screen forever when switching to a
 * base layer whose style is identical to the one already applied.
 *
 * Root cause: MapLibre's Style.setState() diffs the incoming style against the
 * current one and returns early when the diff yields zero operations, WITHOUT
 * firing 'styledata'. switchLayer() awaited that event, so the await rejected
 * on timeout, the rejection escaped the async map 'load' handler, and
 * hideLoadingScreen() never ran.
 *
 * The trigger is carta_topografica.js being a byte-for-byte copy of
 * osm_layer.js. The map always boots with carta_topografica (map_sig.js), so
 * any user whose persisted base layer was 'osm' hit the no-op diff on every
 * page load. switchLayer() no longer treats a missing 'styledata' as fatal.
 */
describe('base layer styles', () => {
    const STYLES = {
        'carta-topografica': cartaTopografica,
        'carta-ortoimagem': cartaOrtoimagem,
        'osm': osmLayer,
        'imagens': imagensLayer,
        'bdgex': bdgexLayer
    };

    /**
     * Pairs that currently hold the same style. Two identical entries are a bug
     * on their own — they are indistinguishable on the map, so the picker
     * offers a choice that does nothing — but deciding which service
     * "Topográfica" should point at is a product call, not a code fix.
     *
     * This list is the accepted debt. Anything NOT listed here is a new
     * duplicate and fails. When the topographic style gets its own service,
     * drop the entry and this test starts guarding the invariant outright.
     */
    const KNOWN_DUPLICATES = ['carta-topografica === osm'];

    it('introduces no new pair of identical styles', () => {
        const entries = Object.entries(STYLES);
        const duplicates = [];

        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const [idA, styleA] = entries[i];
                const [idB, styleB] = entries[j];
                if (JSON.stringify(styleA) === JSON.stringify(styleB)) {
                    duplicates.push(`${idA} === ${idB}`);
                }
            }
        }

        expect(duplicates).toEqual(KNOWN_DUPLICATES);
    });

    it('gives every style something MapLibre can actually load', () => {
        for (const [id, style] of Object.entries(STYLES)) {
            expect(style, `${id} has no style`).toBeTruthy();

            // setStyle() accepts either a style URL or an inline style object.
            // Anything else (undefined, empty object) leaves the map blank and,
            // before the switchLayer() guard, hung the caller outright.
            if (typeof style === 'string') {
                expect(style, `${id} is not a URL`).toMatch(/^https?:\/\//);
                continue;
            }

            const sources = Object.values(style.sources ?? {});
            expect(sources.length, `${id} has no sources`).toBeGreaterThan(0);
            expect(style.layers?.length, `${id} has no layers`).toBeGreaterThan(0);

            const hasTiles = sources.some(
                (source) => Array.isArray(source.tiles) && source.tiles.length > 0
            );
            expect(hasTiles, `${id} has no tile URL`).toBe(true);
        }
    });
});
