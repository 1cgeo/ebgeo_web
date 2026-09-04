import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { collectStyleIds, mergeApplicationStyle } from '../../src/js/baselayers/style-transform.js';

const baseA = {
    version: 8,
    glyphs: 'g',
    sources: { osm: { type: 'raster', tiles: ['a'] } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
const baseB = {
    version: 8,
    glyphs: 'g',
    sources: { orto: { type: 'raster', tiles: ['b'] } },
    layers: [{ id: 'orto', type: 'raster', source: 'orto' }],
};

// The style as MapLibre serializes it after the app built on top of baseA.
function appOn(base, extra = {}) {
    const points = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    const terrainSource = { type: 'raster-dem', tiles: ['t'] };
    return {
        ...base,
        sources: { ...base.sources, points, terrainSource, 'data-moldura': { type: 'vector', url: 'u' } },
        layers: [
            ...base.layers,
            { id: 'analysis-separator', type: 'background', layout: { visibility: 'none' } },
            { id: 'hillshade', type: 'hillshade', source: 'terrainSource' },
            { id: 'point-layer', type: 'circle', source: 'points' },
        ],
        ...extra,
    };
}

describe('collectStyleIds', () => {
    it('lists the ids a style declares, and tolerates an empty style', () => {
        const ids = collectStyleIds(baseA);
        expect([...ids.sources]).toEqual(['osm']);
        expect([...ids.layers]).toEqual(['osm']);
        expect(collectStyleIds(null).sources.size).toBe(0);
        expect(collectStyleIds({}).layers.size).toBe(0);
    });
});

describe('mergeApplicationStyle', () => {
    it('keeps every application source and layer BY REFERENCE and drops the previous base', () => {
        const previous = appOn(baseA);
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));

        expect(Object.keys(merged.sources).sort()).toEqual(['data-moldura', 'orto', 'points', 'terrainSource']);
        expect(merged.sources.points).toBe(previous.sources.points);
        expect(merged.sources.terrainSource).toBe(previous.sources.terrainSource);
        expect(merged.sources.osm).toBeUndefined();

        expect(merged.layers.map((l) => l.id)).toEqual(['orto', 'analysis-separator', 'hillshade', 'point-layer']);
        expect(merged.layers[3]).toBe(previous.layers[3]);
    });

    it('puts the new base layers first, so the application draws on top', () => {
        const merged = mergeApplicationStyle(appOn(baseA), baseB, collectStyleIds(baseA));
        expect(merged.layers[0].id).toBe('orto');
    });

    it('drops a layer of the previous base even when its id was not recorded', () => {
        const previous = appOn(baseA);
        previous.layers.splice(1, 0, { id: 'osm-labels', type: 'symbol', source: 'osm' });
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.layers.map((l) => l.id)).not.toContain('osm-labels');
    });

    it('lets the new base win an id collision', () => {
        const previous = appOn(baseA);
        previous.sources.orto = { type: 'raster', tiles: ['stale'] };
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.sources.orto).toBe(baseB.sources.orto);
    });

    it('carries terrain and projection over when the new base does not declare them', () => {
        const previous = appOn(baseA, { terrain: { source: 'terrainSource', exaggeration: 1.5 }, projection: { type: 'globe' } });
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.terrain).toEqual({ source: 'terrainSource', exaggeration: 1.5 });
        expect(merged.projection).toEqual({ type: 'globe' });
        expect(baseB.terrain).toBeUndefined();
    });

    it('returns the new style untouched on the first application (no previous style)', () => {
        expect(mergeApplicationStyle(null, baseB, collectStyleIds(baseA))).toBe(baseB);
        expect(mergeApplicationStyle(undefined, baseB, collectStyleIds(baseA))).toBe(baseB);
    });

    it('is a no-op for the base when the previous style has no application content', () => {
        const merged = mergeApplicationStyle(baseA, baseB, collectStyleIds(baseA));
        expect(merged.sources).toEqual(baseB.sources);
        expect(merged.layers).toEqual(baseB.layers);
    });

    it('never loses an application source or layer, whatever the base ids are (worst case: 85 sources, 128 layers)', () => {
        const appSourceIds = Array.from({ length: 85 }, (_, i) => 'app-src-' + i);
        const appLayerIds = Array.from({ length: 128 }, (_, i) => 'app-layer-' + i);
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 5 }),
            fc.integer({ min: 1, max: 5 }),
            (nBaseSources, nBaseLayers) => {
                const base = { sources: {}, layers: [] };
                for (let i = 0; i < nBaseSources; i++) base.sources['base-' + i] = { type: 'raster', tiles: ['x'] };
                for (let i = 0; i < nBaseLayers; i++) base.layers.push({ id: 'base-l-' + i, type: 'raster', source: 'base-0' });
                const previous = { ...base, sources: { ...base.sources }, layers: [...base.layers] };
                for (const id of appSourceIds) previous.sources[id] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
                for (const [i, id] of appLayerIds.entries()) previous.layers.push({ id, type: 'circle', source: appSourceIds[i % appSourceIds.length] });

                const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(base));
                const sourceIds = new Set(Object.keys(merged.sources));
                const layerIds = merged.layers.map((l) => l.id);
                return appSourceIds.every((id) => sourceIds.has(id))
                    && appLayerIds.every((id) => layerIds.includes(id))
                    && !Object.keys(base.sources).some((id) => sourceIds.has(id))
                    && !base.layers.some((l) => layerIds.includes(l.id))
                    && layerIds[0] === 'orto';
            },
        ));
    });
});
