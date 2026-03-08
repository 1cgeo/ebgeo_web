// Path: tests/unit/crdt-resolver.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLWW, resolveFieldConflict } from '../../src/crdt/resolver.js';

describe('CRDT LWW Resolver', () => {
  it('later timestamp wins on same entity', () => {
    const local = { timestamp: 1000, clientId: 'aaa', value: 'A' };
    const remote = { timestamp: 2000, clientId: 'bbb', value: 'B' };

    const result = resolveLWW(local, remote);
    assert.equal(result.timestamp, 2000);
  });

  it('higher clientId breaks ties when timestamps are equal', () => {
    const opA = { timestamp: 1000, clientId: 'aaa', value: 'A' };
    const opB = { timestamp: 1000, clientId: 'zzz', value: 'Z' };

    const result = resolveLWW(opA, opB);
    assert.equal(result.clientId, 'zzz');
  });

  it('delete always wins against update', () => {
    const update = { type: 'update', timestamp: 5000 };
    const del = { type: 'delete', timestamp: 1000 };

    const result = resolveLWW(update, del);
    assert.equal(result.type, 'delete');
  });

  it('resolveFieldConflict returns incoming when timestamp is higher', () => {
    const current = { value: 'old', timestamp: 1000, clientId: 'aaa' };
    const incoming = { value: 'new', timestamp: 2000, clientId: 'bbb' };

    const result = resolveFieldConflict(current, incoming);
    assert.equal(result.applied, true);
    assert.equal(result.value, 'new');
    assert.equal(result.winner, 'incoming');
  });

  it('resolveFieldConflict returns current when timestamp is lower', () => {
    const current = { value: 'current', timestamp: 2000, clientId: 'aaa' };
    const incoming = { value: 'old', timestamp: 1000, clientId: 'bbb' };

    const result = resolveFieldConflict(current, incoming);
    assert.equal(result.applied, false);
    assert.equal(result.value, 'current');
    assert.equal(result.winner, 'current');
  });
});
