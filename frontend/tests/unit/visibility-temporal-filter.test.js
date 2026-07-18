// Path: tests/unit/visibility-temporal-filter.test.js

/**
 * Temporal clause behaviour of the layer visibility filter. createLayerVisibilityFilter
 * takes the visible-layer set as an argument and reads only the module's temporal
 * window state (set via setTemporalCursor), so it is testable without a map/store.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    setTemporalCursor,
    createLayerVisibilityFilter,
} from '../../src/js/layers/visibility-filter.js';

const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;

/** Extracts the temporal sub-clause appended by createLayerVisibilityFilter, if any. */
function temporalClause(filter) {
    // ['all', VISIBLE_FILTER, layerFilter, ...extra]; the temporal clause is the
    // trailing ['all', ['<=', ...inicio...], ['>=', ...fim...]] entry.
    return filter
        .slice(3)
        .find(
            (c) =>
                Array.isArray(c) &&
                c[0] === 'all' &&
                JSON.stringify(c).includes('temporalInicio')
        ) || null;
}

afterEach(() => {
    setTemporalCursor(null); // reset module state between tests
});

describe('visibility filter temporal clause', () => {
    it('omits the temporal clause when no cursor is set', () => {
        setTemporalCursor(null);
        expect(temporalClause(createLayerVisibilityFilter(['l1']))).toBeNull();
    });

    it('builds an instantaneous test when end === start', () => {
        setTemporalCursor(1000);
        const clause = temporalClause(createLayerVisibilityFilter(['l1']));
        expect(clause).toEqual([
            'all',
            ['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], 1000],
            ['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], 1000],
        ]);
    });

    it('uses the window [start, end] for overlap (start for fim, end for inicio)', () => {
        setTemporalCursor(1000, 2000);
        const clause = temporalClause(createLayerVisibilityFilter(['l1']));
        // inicio must be <= window end; fim must be >= window start → overlap test.
        expect(clause[1]).toEqual(['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], 2000]);
        expect(clause[2]).toEqual(['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], 1000]);
    });

    it('clamps a backwards window end up to the start (never inverted)', () => {
        setTemporalCursor(2000, 1000);
        const clause = temporalClause(createLayerVisibilityFilter(['l1']));
        expect(clause[1]).toEqual(['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], 2000]);
        expect(clause[2]).toEqual(['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], 2000]);
    });
});
