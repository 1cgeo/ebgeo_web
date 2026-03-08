// Path: tests/unit/crdt-merger.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChanges, mergeUpdate } from '../../src/crdt/merger.js';

describe('CRDT Merger', () => {
  it('merges non-conflicting fields from two operations', () => {
    const existing = { name: 'Old', visible: true, color: '#000' };
    const opA = { changes: { name: 'New Name' }, timestamp: 1000, clientId: 'aaa' };
    const opB = { changes: { color: '#fff' }, timestamp: 1001, clientId: 'bbb' };

    const merged = mergeChanges(existing, [opA, opB]);
    assert.equal(merged.name, 'New Name');
    assert.equal(merged.color, '#fff');
    assert.equal(merged.visible, true); // untouched
  });

  it('applies LWW when both operations change the same field', () => {
    const existing = { name: 'Old' };
    const opA = { changes: { name: 'From A' }, timestamp: 1000, clientId: 'aaa' };
    const opB = { changes: { name: 'From B' }, timestamp: 2000, clientId: 'bbb' };

    const merged = mergeChanges(existing, [opA, opB]);
    assert.equal(merged.name, 'From B'); // later timestamp wins
  });

  it('uses clientId as tiebreaker when timestamps are equal', () => {
    const existing = { name: 'Old' };
    const opA = { changes: { name: 'From A' }, timestamp: 1000, clientId: 'aaa' };
    const opB = { changes: { name: 'From B' }, timestamp: 1000, clientId: 'zzz' };

    const merged = mergeChanges(existing, [opA, opB]);
    assert.equal(merged.name, 'From B'); // higher clientId wins
  });

  it('mergeUpdate applies changes when operation is newer than entity', () => {
    const entity = { name: 'Old', updated_at: new Date(1000).toISOString() };
    const operation = { changes: { name: 'New' }, timestamp: 2000 };

    const { merged, fieldsApplied } = mergeUpdate(entity, operation);
    assert.equal(merged.name, 'New');
    assert.deepEqual(fieldsApplied, ['name']);
  });

  it('mergeUpdate applies changes when operation has same timestamp', () => {
    const entity = { name: 'Old', updated_at: new Date(1000).toISOString() };
    const operation = { changes: { name: 'New' }, timestamp: 1000 };

    const { merged, fieldsApplied } = mergeUpdate(entity, operation);
    assert.equal(merged.name, 'New');
    assert.deepEqual(fieldsApplied, ['name']);
  });
});
