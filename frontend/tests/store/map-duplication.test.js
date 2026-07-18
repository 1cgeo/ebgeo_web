import { describe, it, expect, vi } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Mock store dependencies for IDUtils
// ============================================================================

vi.mock('../../src/js/store', () => ({
    getFeatureDisplayName: vi.fn(() => 'Point'),
    getStorageTypeFromSource: vi.fn(() => 'points'),
    hasImageResource: vi.fn(() => false),
    getImage: vi.fn(async () => null),
    storeImage: vi.fn(async () => {})
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { IDUtils } from '../../src/js/utilities/id_utils.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMapDataWithFeatures(features) {
    const mapData = getEmptyMapData();
    for (const f of features) {
        const storageType = f._storageType || 'points';
        mapData.features[storageType].push(f);
    }
    return mapData;
}

function makeFeature(id, layerId, type = 'point') {
    const geomType = type === 'line' ? 'LineString' : 'Point';
    const coords = type === 'line'
        ? [[-43.17, -22.90], [-43.18, -22.91]]
        : [-43.2, -22.9];
    const storageType = type === 'line' ? 'lines' : 'points';
    return {
        type: 'Feature',
        id: Date.now() + Math.floor(Math.random() * 10000),
        geometry: { type: geomType, coordinates: coords },
        properties: {
            id,
            source: type,
            nome: `Feature ${id}`,
            cor: '#ff0000',
            layerId,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1
        },
        _storageType: storageType
    };
}

// ============================================================================
// regenerateMapIds - layer ID remapping
// ============================================================================

describe('regenerateMapIds - layer ID remapping', () => {
    it('remaps layerIds using provided mapping', async () => {
        const layerIdMapping = new Map([
            ['default', 'default'],
            ['layer-A', 'layer-X'],
            ['layer-B', 'layer-Y']
        ]);

        const mapData = makeMapDataWithFeatures([
            makeFeature('f1', 'default'),
            makeFeature('f2', 'layer-A'),
            makeFeature('f3', 'layer-B'),
            makeFeature('f4', 'layer-A')
        ]);

        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap', layerIdMapping);
        const points = newMapData.features.points;

        expect(points).toHaveLength(4);
        expect(points[0].properties.layerId).toBe('default');
        expect(points[1].properties.layerId).toBe('layer-X');
        expect(points[2].properties.layerId).toBe('layer-Y');
        expect(points[3].properties.layerId).toBe('layer-X');
    });

    it('preserves layerIds when no mapping is provided', async () => {
        const mapData = makeMapDataWithFeatures([
            makeFeature('f1', 'layer-A'),
            makeFeature('f2', 'layer-B')
        ]);

        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap', null);
        const points = newMapData.features.points;

        expect(points[0].properties.layerId).toBe('layer-A');
        expect(points[1].properties.layerId).toBe('layer-B');
    });

    it('keeps original layerId when mapping has no entry for it', async () => {
        const layerIdMapping = new Map([['default', 'default']]);

        const mapData = makeMapDataWithFeatures([
            makeFeature('f1', 'orphan-layer')
        ]);

        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap', layerIdMapping);

        // orphan-layer not in mapping → unchanged
        expect(newMapData.features.points[0].properties.layerId).toBe('orphan-layer');
    });

    it('skips layerId remapping for features without layerId', async () => {
        const layerIdMapping = new Map([['default', 'default']]);

        const f = makeFeature('f1', undefined);
        delete f.properties.layerId;

        const mapData = makeMapDataWithFeatures([f]);
        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap', layerIdMapping);

        expect(newMapData.features.points[0].properties.layerId).toBeUndefined();
    });

    it('generates new unique IDs for all features', async () => {
        const mapData = makeMapDataWithFeatures([
            makeFeature('f1', 'default'),
            makeFeature('f2', 'layer-A')
        ]);

        const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap');
        const points = newMapData.features.points;

        expect(points[0].properties.id).not.toBe('f1');
        expect(points[1].properties.id).not.toBe('f2');
        expect(idMapping.get('f1')).toBe(points[0].properties.id);
        expect(idMapping.get('f2')).toBe(points[1].properties.id);
    });

    it('deep clones data - original is not mutated', async () => {
        const layerIdMapping = new Map([['layer-A', 'layer-X']]);

        const mapData = makeMapDataWithFeatures([
            makeFeature('f1', 'layer-A')
        ]);

        const originalLayerId = mapData.features.points[0].properties.layerId;
        const originalId = mapData.features.points[0].properties.id;

        await IDUtils.regenerateMapIds(mapData, 'CopiedMap', layerIdMapping);

        // Original must not be mutated
        expect(mapData.features.points[0].properties.layerId).toBe(originalLayerId);
        expect(mapData.features.points[0].properties.id).toBe(originalId);
    });

    it('handles mixed feature types across layers', async () => {
        const layerIdMapping = new Map([
            ['default', 'default'],
            ['layer-A', 'layer-X']
        ]);

        const mapData = getEmptyMapData();
        mapData.features.points.push(makeFeature('p1', 'default'));
        mapData.features.points.push(makeFeature('p2', 'layer-A'));
        const line = makeFeature('l1', 'layer-A', 'line');
        mapData.features.lines.push(line);

        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'CopiedMap', layerIdMapping);

        expect(newMapData.features.points[0].properties.layerId).toBe('default');
        expect(newMapData.features.points[1].properties.layerId).toBe('layer-X');
        expect(newMapData.features.lines[0].properties.layerId).toBe('layer-X');
    });
});

// ============================================================================
// Full duplication scenario - 2 layers, 4 features
// ============================================================================

describe('map duplication scenario: 2 layers, 4 features', () => {
    it('preserves layer distribution after duplication', async () => {
        const layerIdMapping = new Map([
            ['default', 'default'],
            ['custom-layer', 'new-custom-layer']
        ]);

        const mapData = makeMapDataWithFeatures([
            makeFeature('p1', 'default'),
            makeFeature('p2', 'default'),
            makeFeature('p3', 'custom-layer'),
            makeFeature('p4', 'custom-layer')
        ]);

        const { newMapData } = await IDUtils.regenerateMapIds(mapData, 'DuplicatedMap', layerIdMapping);
        const points = newMapData.features.points;

        // 2 features in default, 2 in new-custom-layer
        const defaultFeatures = points.filter(p => p.properties.layerId === 'default');
        const customFeatures = points.filter(p => p.properties.layerId === 'new-custom-layer');

        expect(defaultFeatures).toHaveLength(2);
        expect(customFeatures).toHaveLength(2);

        // No features should have the old layer ID
        const oldLayerFeatures = points.filter(p => p.properties.layerId === 'custom-layer');
        expect(oldLayerFeatures).toHaveLength(0);
    });

    it('all 4 features get unique new IDs', async () => {
        const mapData = makeMapDataWithFeatures([
            makeFeature('p1', 'default'),
            makeFeature('p2', 'default'),
            makeFeature('p3', 'custom-layer'),
            makeFeature('p4', 'custom-layer')
        ]);

        const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, 'DuplicatedMap');
        const points = newMapData.features.points;

        const newIds = new Set(points.map(p => p.properties.id));
        expect(newIds.size).toBe(4);

        // None should be original IDs
        expect(newIds.has('p1')).toBe(false);
        expect(newIds.has('p2')).toBe(false);
        expect(newIds.has('p3')).toBe(false);
        expect(newIds.has('p4')).toBe(false);

        // idMapping should be complete
        expect(idMapping.size).toBe(4);
    });

    it('original map data is completely independent after duplication', async () => {
        const layerIdMapping = new Map([
            ['default', 'default'],
            ['layer-A', 'layer-B']
        ]);

        const originalMapData = makeMapDataWithFeatures([
            makeFeature('p1', 'default'),
            makeFeature('p2', 'layer-A')
        ]);

        const { newMapData } = await IDUtils.regenerateMapIds(originalMapData, 'Copy', layerIdMapping);

        // Mutate the copy
        newMapData.features.points[0].properties.nome = 'CHANGED';
        newMapData.features.points.push(makeFeature('extra', 'layer-B'));

        // Original must be untouched
        expect(originalMapData.features.points).toHaveLength(2);
        expect(originalMapData.features.points[0].properties.nome).toBe('Feature p1');
        expect(originalMapData.features.points[0].properties.layerId).toBe('default');
        expect(originalMapData.features.points[1].properties.layerId).toBe('layer-A');
    });
});
