import { describe, it, expect, vi } from 'vitest';

import { queryHoverFeatures } from '../../src/js/tool_manager/helpers/hover-query.helpers.js';

/**
 * Map double: getLayer answers only for the ids the style is said to have.
 * @param {string[]} presentIds - Layer ids the style contains
 * @param {Array<Object>} [result] - What queryRenderedFeatures returns
 * @returns {Object} The double, with vi.fn() spies on both methods
 */
function makeMap(presentIds, result = []) {
    return {
        getLayer: vi.fn((id) => (presentIds.includes(id) ? { id } : undefined)),
        queryRenderedFeatures: vi.fn(() => result),
    };
}

describe('queryHoverFeatures', () => {
    it('passes the surviving ids as { layers } to the query', () => {
        const map = makeMap(['line-layer', 'line-edit-handles-layer']);
        const point = { x: 10, y: 20 };

        queryHoverFeatures(map, point, ['line-edit-handles-layer', 'line-layer']);

        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
        expect(map.queryRenderedFeatures).toHaveBeenCalledWith(point, {
            layers: ['line-edit-handles-layer', 'line-layer'],
        });
    });

    it('drops ids the style does not have BEFORE the query', () => {
        // The worst case this guard exists for: MapLibre throws on an unknown
        // layer id, so an id that never reaches the query is the whole point.
        const map = makeMap(['line-layer']);

        const out = queryHoverFeatures(map, { x: 1, y: 2 }, [
            'line-edit-handles-layer', // absent from the style
            'line-layer',
            'nao-existe-layer',        // absent from the style
        ]);

        expect(out).toEqual([]);
        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
        expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
            { x: 1, y: 2 },
            { layers: ['line-layer'] },
        );
        const sentIds = map.queryRenderedFeatures.mock.calls[0][1].layers;
        expect(sentIds).not.toContain('nao-existe-layer');
        expect(sentIds).not.toContain('line-edit-handles-layer');
    });

    it('returns [] without querying when every id is absent from the style', () => {
        const map = makeMap([]);

        expect(queryHoverFeatures(map, { x: 0, y: 0 }, ['a-layer', 'b-layer'])).toEqual([]);
        expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    });

    it('returns [] without querying for an empty or absent id list', () => {
        const map = makeMap(['line-layer']);

        expect(queryHoverFeatures(map, { x: 0, y: 0 }, [])).toEqual([]);
        expect(queryHoverFeatures(map, { x: 0, y: 0 }, undefined)).toEqual([]);
        expect(queryHoverFeatures(map, { x: 0, y: 0 }, null)).toEqual([]);
        expect(queryHoverFeatures(map, { x: 0, y: 0 }, 'line-layer')).toEqual([]);
        expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
        expect(map.getLayer).not.toHaveBeenCalled();
    });

    it('returns [] without querying when there is no map', () => {
        expect(queryHoverFeatures(null, { x: 0, y: 0 }, ['line-layer'])).toEqual([]);
        expect(queryHoverFeatures(undefined, { x: 0, y: 0 }, ['line-layer'])).toEqual([]);
    });

    it('hands back exactly what the query returned', () => {
        const features = [{ source: 'lines', properties: { id: 'a' } }];
        const map = makeMap(['line-layer'], features);

        expect(queryHoverFeatures(map, { x: 3, y: 4 }, ['line-layer'])).toBe(features);
    });
});
