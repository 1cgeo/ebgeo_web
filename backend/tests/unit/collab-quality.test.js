// Path: tests/unit/collab-quality.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConnectionQuality,
  adaptiveSettingsFor,
  truncateCoords,
} from '../../src/modules/collab/collab.quality.js';

describe('collab.quality — classifyConnectionQuality', () => {
  it('bands latency correctly', () => {
    assert.equal(classifyConnectionQuality(50), 'excellent');
    assert.equal(classifyConnectionQuality(200), 'good');
    assert.equal(classifyConnectionQuality(500), 'poor');
    assert.equal(classifyConnectionQuality(1200), 'critical');
  });
});

describe('collab.quality — adaptiveSettingsFor', () => {
  it('degrades transport settings as quality drops', () => {
    const good = adaptiveSettingsFor('good');
    const critical = adaptiveSettingsFor('critical');
    assert.ok(critical.batchIntervalMs > good.batchIntervalMs);
    assert.ok(critical.geometryPrecision < good.geometryPrecision);
    assert.equal(critical.viewportOnly, true);
  });
});

describe('collab.quality — truncateCoords', () => {
  it('rounds numeric coordinates to the given precision (deep)', () => {
    const geom = {
      type: 'LineString',
      coordinates: [
        [-43.2123456789, -22.9123456789],
        [-43.3987654321, -22.8987654321],
      ],
    };
    const out = truncateCoords(geom, 5);
    assert.equal(out.coordinates[0][0], -43.21235);
    assert.equal(out.coordinates[1][1], -22.89877);
    // original is untouched (transport-only)
    assert.equal(geom.coordinates[0][0], -43.2123456789);
  });

  it('leaves non-numeric values intact', () => {
    const out = truncateCoords({ name: 'x', n: null, flag: true }, 5);
    assert.deepEqual(out, { name: 'x', n: null, flag: true });
  });
});
