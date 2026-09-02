import { describe, it, expect } from 'vitest';
import {
    TransferMode,
    buildTargetLayerName,
    buildTargetLayerRecord,
    partitionTransferableFeatures,
    remapFeatureForTransfer
} from '../../src/js/store/layer-transfer.model.js';

// ============================================================================
// Helpers
// ============================================================================

function makeFeature(id, source = 'point', extra = {}) {
    return {
        type: 'Feature',
        id: 12345,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: {
            id,
            source,
            nome: `Feição ${id}`,
            layerId: 'origem',
            createdAt: 1000,
            updatedAt: 1000,
            version: 3,
            ...extra
        }
    };
}

const isUncopyable = (sourceType) => sourceType === 'los' || sourceType === 'visibility';

// ============================================================================
// buildTargetLayerName
// ============================================================================

describe('buildTargetLayerName', () => {
    it('keeps the source name when the destination has none like it', () => {
        expect(buildTargetLayerName('Inimigo', [{ name: 'Padrão' }])).toBe('Inimigo');
    });

    it('returns the source name for an empty destination', () => {
        expect(buildTargetLayerName('Inimigo', [])).toBe('Inimigo');
        expect(buildTargetLayerName('Inimigo')).toBe('Inimigo');
    });

    it('picks the next number when the destination already has the name', () => {
        expect(buildTargetLayerName('Inimigo', [{ name: 'Inimigo' }])).toBe('Inimigo #2');
    });

    it('skips numbers already taken', () => {
        const target = [{ name: 'Inimigo' }, { name: 'Inimigo #2' }];
        expect(buildTargetLayerName('Inimigo', target)).toBe('Inimigo #3');
    });

    it('fills the first hole in the numbering', () => {
        const target = [{ name: 'Inimigo' }, { name: 'Inimigo #3' }];
        expect(buildTargetLayerName('Inimigo', target)).toBe('Inimigo #2');
    });

    it('treats regex metacharacters in the name as literal text', () => {
        // Without escaping, "Setor (A)" would compile to a group and match
        // "Setor A", handing back a name that is already taken.
        const target = [{ name: 'Setor (A)' }, { name: 'Setor A' }];
        expect(buildTargetLayerName('Setor (A)', target)).toBe('Setor (A) #2');
    });

    it('does not collide with a name that merely starts the same', () => {
        expect(buildTargetLayerName('Rota', [{ name: 'Rota Alfa' }])).toBe('Rota');
    });

    it('falls back to a generic name when the source has none', () => {
        expect(buildTargetLayerName(undefined, [])).toBe('Camada');
        expect(buildTargetLayerName('   ', [])).toBe('Camada');
    });

    it('ignores destination entries without a name', () => {
        expect(buildTargetLayerName('Inimigo', [{}, { name: null }])).toBe('Inimigo');
    });
});

// ============================================================================
// partitionTransferableFeatures
// ============================================================================

describe('partitionTransferableFeatures', () => {
    it('returns empty results for an empty collection', () => {
        expect(partitionTransferableFeatures({}, isUncopyable))
            .toEqual({ transferable: {}, skipped: [] });
    });

    it('returns empty results for null input', () => {
        expect(partitionTransferableFeatures(null, isUncopyable))
            .toEqual({ transferable: {}, skipped: [] });
    });

    it('keeps ordinary features and skips analysis ones', () => {
        const { transferable, skipped } = partitionTransferableFeatures({
            points: [makeFeature('p1'), makeFeature('p2')],
            los: [makeFeature('a1', 'los')],
            visibility: [makeFeature('a2', 'visibility')]
        }, isUncopyable);

        expect(Object.keys(transferable)).toEqual(['points']);
        expect(transferable.points).toHaveLength(2);
        expect(skipped.map(f => f.properties.id)).toEqual(['a1', 'a2']);
    });

    it('keeps a feature with no source (the predicate answers false)', () => {
        const orphan = makeFeature('sem-fonte');
        delete orphan.properties.source;

        const { transferable, skipped } = partitionTransferableFeatures(
            { points: [orphan] }, isUncopyable
        );

        expect(transferable.points).toHaveLength(1);
        expect(skipped).toHaveLength(0);
    });

    it('drops the bucket entirely when only analysis features are in it', () => {
        const { transferable, skipped } = partitionTransferableFeatures({
            los: [makeFeature('a1', 'los'), makeFeature('a2', 'los')]
        }, isUncopyable);

        expect(transferable).toEqual({});
        expect(skipped).toHaveLength(2);
    });

    it('ignores empty and non-array buckets', () => {
        const { transferable } = partitionTransferableFeatures({
            points: [],
            lines: null
        }, isUncopyable);

        expect(transferable).toEqual({});
    });

    it('keeps everything when no predicate is given', () => {
        const { transferable, skipped } = partitionTransferableFeatures({
            los: [makeFeature('a1', 'los')]
        });

        expect(transferable.los).toHaveLength(1);
        expect(skipped).toHaveLength(0);
    });
});

// ============================================================================
// remapFeatureForTransfer
// ============================================================================

describe('remapFeatureForTransfer', () => {
    it('move keeps both ids and createdAt, and bumps updatedAt/version', () => {
        const feature = makeFeature('f1');

        const moved = remapFeatureForTransfer(feature, {
            mode: TransferMode.MOVE,
            layerId: 'destino',
            now: 9999
        });

        expect(moved.properties.id).toBe('f1');
        expect(moved.id).toBe(12345);
        expect(moved.properties.createdAt).toBe(1000);
        expect(moved.properties.updatedAt).toBe(9999);
        expect(moved.properties.version).toBe(4);
        expect(moved.properties.layerId).toBe('destino');
    });

    it('copy mints both ids and restarts the sync metadata', () => {
        const feature = makeFeature('f1');

        const copied = remapFeatureForTransfer(feature, {
            mode: TransferMode.COPY,
            layerId: 'destino',
            newId: 'novo-uuid',
            newGeoJsonId: 777,
            now: 9999
        });

        expect(copied.properties.id).toBe('novo-uuid');
        expect(copied.id).toBe(777);
        expect(copied.properties.createdAt).toBe(9999);
        expect(copied.properties.updatedAt).toBe(9999);
        expect(copied.properties.version).toBe(1);
    });

    it('copy falls back to the new sync id when no GeoJSON id is given', () => {
        const copied = remapFeatureForTransfer(makeFeature('f1'), {
            mode: TransferMode.COPY,
            layerId: 'destino',
            newId: 'novo-uuid'
        });

        expect(copied.id).toBe('novo-uuid');
    });

    it('gives the target layer to a feature that had no layerId', () => {
        const orphan = makeFeature('f1');
        delete orphan.properties.layerId;

        const moved = remapFeatureForTransfer(orphan, {
            mode: TransferMode.MOVE,
            layerId: 'destino'
        });

        expect(moved.properties.layerId).toBe('destino');
    });

    it('starts the version at 1 when the source had none', () => {
        const feature = makeFeature('f1');
        delete feature.properties.version;

        const moved = remapFeatureForTransfer(feature, {
            mode: TransferMode.MOVE,
            layerId: 'destino'
        });

        expect(moved.properties.version).toBe(1);
    });

    it('never mutates the input feature', () => {
        const feature = makeFeature('f1');
        const before = JSON.stringify(feature);

        remapFeatureForTransfer(feature, {
            mode: TransferMode.COPY,
            layerId: 'destino',
            newId: 'novo-uuid',
            newGeoJsonId: 777,
            now: 9999
        });

        expect(JSON.stringify(feature)).toBe(before);
    });

    it('deep-clones nested properties instead of sharing them', () => {
        const feature = makeFeature('f1', 'point', { attributes: { alvo: 'ponte' } });

        const moved = remapFeatureForTransfer(feature, {
            mode: TransferMode.MOVE,
            layerId: 'destino'
        });
        moved.properties.attributes.alvo = 'outro';

        expect(feature.properties.attributes.alvo).toBe('ponte');
    });

    it('throws on an unknown mode', () => {
        expect(() => remapFeatureForTransfer(makeFeature('f1'), { mode: 'teleport' }))
            .toThrow(/mode must be/);
    });

    it('throws when copy mode gets no new id', () => {
        expect(() => remapFeatureForTransfer(makeFeature('f1'), { mode: TransferMode.COPY }))
            .toThrow(/newId is required/);
    });

    it('throws when there is no feature', () => {
        expect(() => remapFeatureForTransfer(null, { mode: TransferMode.MOVE }))
            .toThrow(/feature is required/);
    });
});

// ============================================================================
// buildTargetLayerRecord
// ============================================================================

describe('buildTargetLayerRecord', () => {
    const sourceLayer = {
        id: 'default',
        name: 'Inimigo',
        visible: false,
        locked: true,
        opacity: 0.35,
        order: 7,
        createdAt: 10,
        updatedAt: 20,
        version: 9
    };

    it('carries visibility, lock and opacity across', () => {
        const record = buildTargetLayerRecord(sourceLayer, [], { id: 'novo', now: 500 });

        expect(record.visible).toBe(false);
        expect(record.locked).toBe(true);
        expect(record.opacity).toBe(0.35);
    });

    it('always takes a brand new id and restarts the sync metadata', () => {
        const record = buildTargetLayerRecord(sourceLayer, [], { id: 'novo', now: 500 });

        expect(record.id).toBe('novo');
        expect(record.createdAt).toBe(500);
        expect(record.updatedAt).toBe(500);
        expect(record.version).toBe(1);
    });

    it('starts the order at 0 for an empty destination', () => {
        const record = buildTargetLayerRecord(sourceLayer, [], { id: 'novo' });
        expect(record.order).toBe(0);
    });

    it('counts a destination layer whose order is undefined as 0', () => {
        const record = buildTargetLayerRecord(sourceLayer, [{ id: 'a' }], { id: 'novo' });
        expect(record.order).toBe(1);
    });

    it('goes one past the highest order in the destination', () => {
        const target = [{ order: 0 }, { order: 5 }, { order: 2 }];
        const record = buildTargetLayerRecord(sourceLayer, target, { id: 'novo' });
        expect(record.order).toBe(6);
    });

    it('derives a free name from the destination when none is given', () => {
        const record = buildTargetLayerRecord(sourceLayer, [{ name: 'Inimigo' }], { id: 'novo' });
        expect(record.name).toBe('Inimigo #2');
    });

    it('uses the explicit name when one is given', () => {
        const record = buildTargetLayerRecord(sourceLayer, [], { id: 'novo', name: 'Escolhido' });
        expect(record.name).toBe('Escolhido');
    });

    it('normalizes a source layer with no style fields', () => {
        const record = buildTargetLayerRecord({ id: 'x', name: 'Sem estilo' }, [], { id: 'novo' });

        expect(record.visible).toBe(true);
        expect(record.locked).toBe(false);
        expect(record.opacity).toBe(1);
    });

    it('keeps extra style attributes the source record carries', () => {
        const record = buildTargetLayerRecord(
            { ...sourceLayer, corDaEtiqueta: '#ff0000' }, [], { id: 'novo' }
        );
        expect(record.corDaEtiqueta).toBe('#ff0000');
    });

    it('never mutates the source layer', () => {
        const before = JSON.stringify(sourceLayer);
        buildTargetLayerRecord(sourceLayer, [], { id: 'novo', now: 500 });
        expect(JSON.stringify(sourceLayer)).toBe(before);
    });

    it('throws without an id, because layer ids are not unique across maps', () => {
        expect(() => buildTargetLayerRecord(sourceLayer, [], {})).toThrow(/id is required/);
    });
});
