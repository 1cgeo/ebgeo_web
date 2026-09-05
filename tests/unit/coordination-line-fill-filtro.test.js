// Path: tests/unit/coordination-line-fill-filtro.test.js

/**
 * @fileoverview The FILL layer of the coordination line (the anti-tank ditch) goes through
 * the filter rewrite like every other feature layer, and its code clause survives the rewrite.
 *
 * THE DEFECT THIS RULE EXISTS TO CATCH (found while porting to the backend branch on
 * 2026-09-04): `coordination-line-fill-layer` was born with a static filter (`visivel` plus
 * the filled codes) and outside `FEATURE_LAYER_IDS`, so `updateAllLayerFilters` never
 * touched it. Layer membership and the temporal window reached only the line layer: hiding
 * the user's layer erased the outline of the ditch and left the filled band on screen.
 *
 * The fix has TWO halves, and the second is the one that gets forgotten: the id in the list,
 * AND the filled-codes clause in `LAYER_ADDITIONAL_FILTERS`, because the rewritten filter
 * replaces the static one entirely, and without the clause the fill would paint the inside
 * of every hollow diamond of the same source. The clause is DERIVED from the catalogue here,
 * never retyped: a test that repeats a constant fails the right code when it changes.
 *
 * Negative control: with `layer.constants.js` reverted, all three cases fail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const visible = { ids: ['default'] };
vi.mock('../../src/js/store/index.js', () => ({
    getVisibleLayerIds: () => visible.ids,
}));

const { FEATURE_LAYER_IDS, LAYER_ADDITIONAL_FILTERS } = await import('../../src/js/layers/layer.constants.js');
const { updateAllLayerFilters, invalidateFilterCache } = await import('../../src/js/layers/visibility-filter.js');
const { FILLED_SYMBOL_CODES } = await import('../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js');

const FILL = 'coordination-line-fill-layer';
const LINE = 'coordination-line-layer';
const CODE_CLAUSE = ['in', ['get', 'symbol_code'], ['literal', [...FILLED_SYMBOL_CODES]]];

function fakeMap(layerIds) {
    const filters = new Map();
    return {
        filters,
        getLayer: (id) => (layerIds.includes(id) ? { id } : undefined),
        setFilter: (id, filter) => { filters.set(id, filter); },
    };
}

describe('the coordination line fill layer follows the rule of the other feature layers', () => {
    beforeEach(() => {
        visible.ids = ['default', 'layer-a'];
        invalidateFilterCache();
    });

    it('is in FEATURE_LAYER_IDS, next to the line layer', () => {
        expect(FEATURE_LAYER_IDS).toContain(FILL);
        expect(FEATURE_LAYER_IDS).toContain(LINE);
    });

    it('carries the filled-codes clause in LAYER_ADDITIONAL_FILTERS, and the line layer does not', () => {
        expect(FILLED_SYMBOL_CODES.length, 'the catalogue must mark at least one code as filled').toBeGreaterThan(0);
        expect(LAYER_ADDITIONAL_FILTERS[FILL]).toEqual([CODE_CLAUSE]);
        expect(LAYER_ADDITIONAL_FILTERS[LINE]).toBeUndefined();
    });

    it('updateAllLayerFilters rewrites the fill with layer membership AND the code clause', () => {
        const map = fakeMap([FILL, LINE]);
        updateAllLayerFilters(map);

        const fill = map.filters.get(FILL);
        expect(fill, 'the fill must receive setFilter').toBeDefined();
        expect(fill[0]).toBe('all');
        // Layer membership is the half that was missing: it hides the band together with
        // the outline when the user's layer is hidden.
        expect(JSON.stringify(fill)).toContain(JSON.stringify(['literal', visible.ids]));
        // And the code clause is the half the rewrite would otherwise lose.
        expect(fill).toContainEqual(CODE_CLAUSE);

        const line = map.filters.get(LINE);
        expect(line, 'the line layer keeps being rewritten').toBeDefined();
        expect(line).not.toContainEqual(CODE_CLAUSE);
    });
});
