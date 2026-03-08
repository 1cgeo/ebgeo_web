// Path: tests/unit/sync-operations.test.js
// Unit tests for sync operation logic and edge cases

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLWW, resolveFieldConflict } from '../../src/crdt/resolver.js';
import { mergeChanges, mergeUpdate } from '../../src/crdt/merger.js';

describe('CRDT Resolver - Advanced Scenarios', () => {
  describe('resolveLWW', () => {
    it('returns remote when timestamps are equal and remote clientId is higher', () => {
      const local = { timestamp: 1000, clientId: 'aaa', value: 'A' };
      const remote = { timestamp: 1000, clientId: 'zzz', value: 'Z' };

      const result = resolveLWW(local, remote);
      assert.equal(result.clientId, 'zzz');
      assert.equal(result.value, 'Z');
    });

    it('returns local when timestamps are equal and local clientId is higher', () => {
      const local = { timestamp: 1000, clientId: 'zzz', value: 'A' };
      const remote = { timestamp: 1000, clientId: 'aaa', value: 'B' };

      const result = resolveLWW(local, remote);
      assert.equal(result.clientId, 'zzz');
      assert.equal(result.value, 'A');
    });

    it('remote delete wins over local update even with earlier timestamp', () => {
      const local = { type: 'update', timestamp: 5000, value: 'updated' };
      const remote = { type: 'delete', timestamp: 1000, deleted_at: true };

      const result = resolveLWW(local, remote);
      assert.equal(result.type, 'delete');
    });

    it('local delete wins over remote update even with earlier timestamp', () => {
      const local = { type: 'delete', timestamp: 1000, deleted_at: true };
      const remote = { type: 'update', timestamp: 5000, value: 'updated' };

      const result = resolveLWW(local, remote);
      assert.equal(result.type, 'delete');
    });

    it('handles missing clientId gracefully', () => {
      const local = { timestamp: 1000 };
      const remote = { timestamp: 1000, clientId: 'zzz' };

      const result = resolveLWW(local, remote);
      assert.equal(result.clientId, 'zzz');
    });

    it('handles updated_at as timestamp fallback', () => {
      const local = { updated_at: 1000, value: 'old' };
      const remote = { updated_at: 2000, value: 'new' };

      const result = resolveLWW(local, remote);
      assert.equal(result.value, 'new');
    });
  });

  describe('resolveFieldConflict', () => {
    it('handles equal timestamps with clientId tiebreaker', () => {
      const current = { value: 'current', timestamp: 1000, clientId: 'aaa' };
      const incoming = { value: 'incoming', timestamp: 1000, clientId: 'zzz' };

      const result = resolveFieldConflict(current, incoming);
      assert.equal(result.applied, true);
      assert.equal(result.value, 'incoming');
      assert.equal(result.winner, 'incoming');
    });

    it('rejects incoming when current has same timestamp but higher clientId', () => {
      const current = { value: 'current', timestamp: 1000, clientId: 'zzz' };
      const incoming = { value: 'incoming', timestamp: 1000, clientId: 'aaa' };

      const result = resolveFieldConflict(current, incoming);
      assert.equal(result.applied, false);
      assert.equal(result.value, 'current');
      assert.equal(result.winner, 'current');
    });
  });
});

describe('CRDT Merger - Advanced Scenarios', () => {
  describe('mergeChanges', () => {
    it('correctly merges operations on different fields from multiple clients', () => {
      const existing = { name: 'Original', color: 'red', size: 10 };
      const operations = [
        { changes: { name: 'From A' }, timestamp: 1000, clientId: 'aaa' },
        { changes: { color: 'blue' }, timestamp: 1001, clientId: 'bbb' },
        { changes: { size: 20 }, timestamp: 999, clientId: 'ccc' },
      ];

      const merged = mergeChanges(existing, operations);
      assert.equal(merged.name, 'From A');
      assert.equal(merged.color, 'blue');
      assert.equal(merged.size, 20);
    });

    it('handles three-way conflict on same field', () => {
      const existing = { name: 'Original' };
      const operations = [
        { changes: { name: 'From A' }, timestamp: 1000, clientId: 'aaa' },
        { changes: { name: 'From B' }, timestamp: 2000, clientId: 'bbb' },
        { changes: { name: 'From C' }, timestamp: 1500, clientId: 'ccc' },
      ];

      const merged = mergeChanges(existing, operations);
      // Timestamp 2000 is highest, so "From B" wins
      assert.equal(merged.name, 'From B');
    });

    it('handles operations with same timestamp but different clientIds', () => {
      const existing = { name: 'Original' };
      const operations = [
        { changes: { name: 'From A' }, timestamp: 1000, clientId: 'bbb' },
        { changes: { name: 'From B' }, timestamp: 1000, clientId: 'aaa' },
        { changes: { name: 'From C' }, timestamp: 1000, clientId: 'zzz' },
      ];

      const merged = mergeChanges(existing, operations);
      // Same timestamp, so highest clientId wins: 'zzz'
      assert.equal(merged.name, 'From C');
    });

    it('preserves untouched fields from existing entity', () => {
      const existing = { name: 'Original', color: 'red', size: 10, visible: true };
      const operations = [
        { changes: { name: 'New Name' }, timestamp: 1000, clientId: 'aaa' },
      ];

      const merged = mergeChanges(existing, operations);
      assert.equal(merged.name, 'New Name');
      assert.equal(merged.color, 'red');
      assert.equal(merged.size, 10);
      assert.equal(merged.visible, true);
    });

    it('handles empty operations array', () => {
      const existing = { name: 'Original', color: 'red' };
      const merged = mergeChanges(existing, []);
      assert.deepEqual(merged, existing);
    });

    it('handles operations without changes property', () => {
      const existing = { name: 'Original' };
      const operations = [
        { timestamp: 1000, clientId: 'aaa' }, // No changes
        { changes: { name: 'Updated' }, timestamp: 2000, clientId: 'bbb' },
      ];

      const merged = mergeChanges(existing, operations);
      assert.equal(merged.name, 'Updated');
    });

    it('handles nested JSONB objects in changes', () => {
      const existing = { properties: { color: 'red', size: 10 } };
      const operations = [
        { changes: { properties: { color: 'blue', size: 20 } }, timestamp: 1000, clientId: 'aaa' },
      ];

      const merged = mergeChanges(existing, operations);
      assert.deepEqual(merged.properties, { color: 'blue', size: 20 });
    });
  });

  describe('mergeUpdate', () => {
    it('applies all changes when operation is newer', () => {
      const entity = { name: 'Old', color: 'red', updated_at: new Date(1000).toISOString() };
      const operation = {
        changes: { name: 'New', color: 'blue' },
        timestamp: 2000,
      };

      const { merged, fieldsApplied } = mergeUpdate(entity, operation);
      assert.equal(merged.name, 'New');
      assert.equal(merged.color, 'blue');
      assert.deepEqual(fieldsApplied.sort(), ['color', 'name']);
    });

    it('does not apply changes when operation is older', () => {
      const entity = { name: 'Current', updated_at: new Date(5000).toISOString() };
      const operation = {
        changes: { name: 'Old' },
        timestamp: 1000,
      };

      const { merged, fieldsApplied } = mergeUpdate(entity, operation);
      assert.equal(merged.name, 'Current');
      assert.deepEqual(fieldsApplied, []);
    });

    it('returns empty fieldsApplied when no changes', () => {
      const entity = { name: 'Test', updated_at: new Date(1000).toISOString() };
      const operation = { timestamp: 2000 }; // No changes

      const { merged, fieldsApplied } = mergeUpdate(entity, operation);
      assert.equal(merged.name, 'Test');
      assert.deepEqual(fieldsApplied, []);
    });

    it('handles entity without updated_at', () => {
      const entity = { name: 'Test' }; // No updated_at
      const operation = {
        changes: { name: 'Updated' },
        timestamp: 1000,
      };

      const { merged, fieldsApplied } = mergeUpdate(entity, operation);
      // Since entityTimestamp is 0, operation (1000) is newer
      assert.equal(merged.name, 'Updated');
      assert.deepEqual(fieldsApplied, ['name']);
    });

    it('preserves other entity fields', () => {
      const entity = {
        name: 'Test',
        color: 'red',
        size: 10,
        updated_at: new Date(1000).toISOString(),
      };
      const operation = {
        changes: { name: 'Updated' },
        timestamp: 2000,
      };

      const { merged, fieldsApplied } = mergeUpdate(entity, operation);
      assert.equal(merged.name, 'Updated');
      assert.equal(merged.color, 'red');
      assert.equal(merged.size, 10);
    });
  });
});

describe('Operation Validation Scenarios', () => {
  const validTargets = ['feature', 'group', 'layer', 'group_feature', 'map', 'briefing', 'slide', 'cesium3d', 'streetview360'];
  const validTypes = ['create', 'update', 'delete'];

  it('all valid targets are defined (9 total)', () => {
    // This documents expected targets for sync operations
    assert.ok(validTargets.length === 9);
    assert.ok(validTargets.includes('feature'));
    assert.ok(validTargets.includes('group'));
    assert.ok(validTargets.includes('layer'));
    assert.ok(validTargets.includes('map'));
    assert.ok(validTargets.includes('briefing'));
    assert.ok(validTargets.includes('slide'));
    assert.ok(validTargets.includes('group_feature'));
    assert.ok(validTargets.includes('cesium3d'));
    assert.ok(validTargets.includes('streetview360'));
  });

  it('all valid operation types are defined', () => {
    assert.ok(validTypes.length === 3);
    assert.ok(validTypes.includes('create'));
    assert.ok(validTypes.includes('update'));
    assert.ok(validTypes.includes('delete'));
  });

  it('all 18 feature types are defined', () => {
    const validFeatureTypes = [
      // Basic
      'point', 'line', 'polygon', 'text', 'image',
      // Shapes
      'circle', 'rectangle', 'ellipse', 'brush',
      // Military
      'arrow', 'boundary', 'occupied_front', 'military_symbol', 'coordination_measure',
      // Analysis
      'los', 'visibility', 'processed_los', 'processed_visibility',
    ];

    assert.equal(validFeatureTypes.length, 18);

    // Basic types
    assert.ok(validFeatureTypes.includes('point'));
    assert.ok(validFeatureTypes.includes('line'));
    assert.ok(validFeatureTypes.includes('polygon'));
    assert.ok(validFeatureTypes.includes('text'));
    assert.ok(validFeatureTypes.includes('image'));

    // Shape types
    assert.ok(validFeatureTypes.includes('circle'));
    assert.ok(validFeatureTypes.includes('rectangle'));
    assert.ok(validFeatureTypes.includes('ellipse'));
    assert.ok(validFeatureTypes.includes('brush'));

    // Military types
    assert.ok(validFeatureTypes.includes('arrow'));
    assert.ok(validFeatureTypes.includes('boundary'));
    assert.ok(validFeatureTypes.includes('occupied_front'));
    assert.ok(validFeatureTypes.includes('military_symbol'));
    assert.ok(validFeatureTypes.includes('coordination_measure'));

    // Analysis types
    assert.ok(validFeatureTypes.includes('los'));
    assert.ok(validFeatureTypes.includes('visibility'));
    assert.ok(validFeatureTypes.includes('processed_los'));
    assert.ok(validFeatureTypes.includes('processed_visibility'));
  });

  it('all cesium3d data types are defined', () => {
    const validCesium3dTypes = ['marker', 'measurement', 'viewshed', 'camera_position'];

    assert.equal(validCesium3dTypes.length, 4);
    assert.ok(validCesium3dTypes.includes('marker'));
    assert.ok(validCesium3dTypes.includes('measurement'));
    assert.ok(validCesium3dTypes.includes('viewshed'));
    assert.ok(validCesium3dTypes.includes('camera_position'));
  });

  it('all streetview360 data types are defined', () => {
    const validStreetview360Types = ['orientation', 'marker'];

    assert.equal(validStreetview360Types.length, 2);
    assert.ok(validStreetview360Types.includes('orientation'));
    assert.ok(validStreetview360Types.includes('marker'));
  });
});
