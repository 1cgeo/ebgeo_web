// Path: tests/unit/presence-fp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorPresenceSchema, validatePresenceFrame } from '../../src/modules/collab/collab.schemas.js';

test('first-person presence preserves local metres, scope and a positionless exit', () => {
  const frame = { surface: 'fp', mapId: 'Map', tilesetId: 'museum', position: { x: 1, y: -2, z: 3 } };
  const result = validatePresenceFrame(cursorPresenceSchema, frame);
  assert.ifError(result.error);
  assert.deepEqual(result.value, frame);
  assert.ifError(validatePresenceFrame(cursorPresenceSchema, { ...frame, position: null }).error);
});

test('first-person presence rejects geographic and incomplete or nonfinite positions', () => {
  for (const position of [{ lng: 1, lat: 2, alt: 3 }, { x: 1, y: 2 }, { x: Infinity, y: 2, z: 3 }]) {
    assert.ok(validatePresenceFrame(cursorPresenceSchema, { surface: 'fp', position }).error);
  }
});
