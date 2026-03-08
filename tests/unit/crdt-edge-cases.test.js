// Path: tests/unit/crdt-edge-cases.test.js
// Edge case tests for CRDT resolver, merger, and operations.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLWW, resolveFieldConflict } from '../../src/crdt/resolver.js';
import { mergeChanges, mergeUpdate } from '../../src/crdt/merger.js';
import { validateOperation } from '../../src/crdt/operations.js';

describe('CRDT Resolver — Edge Cases', () => {
  it('resolveLWW: same timestamps and same clientIds → returns local', () => {
    const local = { timestamp: 1000, clientId: 'aaa', value: 'L' };
    const remote = { timestamp: 1000, clientId: 'aaa', value: 'R' };
    const result = resolveLWW(local, remote);
    assert.equal(result, local);
  });

  it('resolveLWW: timestamp = 0 on both → uses clientId tiebreaker', () => {
    const local = { timestamp: 0, clientId: 'aaa' };
    const remote = { timestamp: 0, clientId: 'bbb' };
    const result = resolveLWW(local, remote);
    assert.equal(result.clientId, 'bbb');
  });

  it('resolveLWW: clientId undefined/null → falls back to empty string compare', () => {
    const local = { timestamp: 1000 };
    const remote = { timestamp: 1000 };
    const result = resolveLWW(local, remote);
    // Both clientId fallback to '', so local wins (comparison returns 0 → local)
    assert.equal(result, local);
  });

  it('resolveLWW: delete wins even with lower timestamp', () => {
    const local = { type: 'update', timestamp: 9999, clientId: 'zzz' };
    const remote = { type: 'delete', timestamp: 1 };
    const result = resolveLWW(local, remote);
    assert.equal(result.type, 'delete');
  });

  it('resolveLWW: local delete wins over remote update', () => {
    const local = { type: 'delete', timestamp: 1 };
    const remote = { type: 'update', timestamp: 9999 };
    const result = resolveLWW(local, remote);
    assert.equal(result.type, 'delete');
  });

  it('resolveLWW: uses updated_at as fallback when timestamp absent', () => {
    const local = { updated_at: 500 };
    const remote = { updated_at: 1000 };
    const result = resolveLWW(local, remote);
    assert.equal(result, remote);
  });

  it('resolveFieldConflict: equal timestamps → clientId decides', () => {
    const current = { value: 'A', timestamp: 100, clientId: 'bbb' };
    const incoming = { value: 'B', timestamp: 100, clientId: 'aaa' };
    const result = resolveFieldConflict(current, incoming);
    // bbb > aaa → current wins
    assert.equal(result.applied, false);
    assert.equal(result.winner, 'current');
  });

  it('resolveFieldConflict: equal timestamps, incoming clientId higher → incoming wins', () => {
    const current = { value: 'A', timestamp: 100, clientId: 'aaa' };
    const incoming = { value: 'B', timestamp: 100, clientId: 'zzz' };
    const result = resolveFieldConflict(current, incoming);
    assert.equal(result.applied, true);
    assert.equal(result.winner, 'incoming');
  });
});

describe('CRDT Merger — Edge Cases', () => {
  it('mergeChanges: empty operations array → returns existing unchanged', () => {
    const existing = { name: 'test', color: 'red' };
    const result = mergeChanges(existing, []);
    assert.deepEqual(result, existing);
  });

  it('mergeChanges: operation without changes property → skipped', () => {
    const existing = { name: 'test' };
    const ops = [{ timestamp: 1000, clientId: 'a' }]; // no changes
    const result = mergeChanges(existing, ops);
    assert.deepEqual(result, existing);
  });

  it('mergeChanges: nested JSONB objects in changes', () => {
    const existing = { properties: { name: 'old' } };
    const ops = [{
      changes: { properties: { name: 'new', color: '#f00' } },
      timestamp: 1000,
      clientId: 'a',
    }];
    const result = mergeChanges(existing, ops);
    assert.deepEqual(result.properties, { name: 'new', color: '#f00' });
  });

  it('mergeChanges: three operations on same field → last writer wins', () => {
    const existing = { name: 'original' };
    const ops = [
      { changes: { name: 'first' }, timestamp: 1000, clientId: 'a' },
      { changes: { name: 'second' }, timestamp: 3000, clientId: 'b' },
      { changes: { name: 'third' }, timestamp: 2000, clientId: 'c' },
    ];
    const result = mergeChanges(existing, ops);
    assert.equal(result.name, 'second'); // highest timestamp wins
  });

  it('mergeChanges: preserves fields not in any operation', () => {
    const existing = { name: 'test', color: 'red', size: 42 };
    const ops = [{ changes: { name: 'updated' }, timestamp: 1000, clientId: 'a' }];
    const result = mergeChanges(existing, ops);
    assert.equal(result.name, 'updated');
    assert.equal(result.color, 'red');
    assert.equal(result.size, 42);
  });

  it('mergeUpdate: empty changes → no fields applied', () => {
    const entity = { name: 'test', updated_at: new Date(500).toISOString() };
    const op = { changes: {}, timestamp: 1000, clientId: 'a' };
    const { merged, fieldsApplied } = mergeUpdate(entity, op);
    assert.deepEqual(fieldsApplied, []);
    assert.equal(merged.name, 'test');
  });

  it('mergeUpdate: null changes → no fields applied', () => {
    const entity = { name: 'test' };
    const op = { changes: null, timestamp: 1000, clientId: 'a' };
    const { merged, fieldsApplied } = mergeUpdate(entity, op);
    assert.deepEqual(fieldsApplied, []);
  });

  it('mergeUpdate: entity without updated_at → accepts any operation (timestamp >= 0)', () => {
    const entity = { name: 'old' };
    const op = { changes: { name: 'new' }, timestamp: 1, clientId: 'a' };
    const { merged, fieldsApplied } = mergeUpdate(entity, op);
    assert.equal(merged.name, 'new');
    assert.deepEqual(fieldsApplied, ['name']);
  });

  it('mergeUpdate: operation older than entity → no fields applied', () => {
    const entity = { name: 'current', updated_at: new Date(5000).toISOString() };
    const op = { changes: { name: 'old' }, timestamp: 1000, clientId: 'a' };
    const { merged, fieldsApplied } = mergeUpdate(entity, op);
    assert.equal(merged.name, 'current');
    assert.deepEqual(fieldsApplied, []);
  });

  it('mergeUpdate: preserves entity fields not in fieldsApplied', () => {
    const entity = { name: 'test', color: 'red', size: 10, updated_at: new Date(100).toISOString() };
    const op = { changes: { name: 'new' }, timestamp: 1000, clientId: 'a' };
    const { merged } = mergeUpdate(entity, op);
    assert.equal(merged.name, 'new');
    assert.equal(merged.color, 'red');
    assert.equal(merged.size, 10);
  });
});

describe('CRDT Operations — Edge Cases', () => {
  it('validateOperation: missing entityType/target → error', () => {
    const result = validateOperation({
      id: 'op1', type: 'create', targetId: 't1',
      timestamp: 1000, clientId: 'c1', data: {},
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('target')));
  });

  it('validateOperation: invalid type → error', () => {
    const result = validateOperation({
      id: 'op1', type: 'upsert', target: 'feature', targetId: 't1',
      timestamp: 1000, clientId: 'c1',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('type')));
  });

  it('validateOperation: create without data → error', () => {
    const result = validateOperation({
      id: 'op1', type: 'create', target: 'feature', targetId: 't1',
      timestamp: 1000, clientId: 'c1',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('data')));
  });

  it('validateOperation: update without changes → error', () => {
    const result = validateOperation({
      id: 'op1', type: 'update', target: 'feature', targetId: 't1',
      timestamp: 1000, clientId: 'c1',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('changes')));
  });
});
