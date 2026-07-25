// Path: tests/unit/collab-quality.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConnectionQuality,
  adaptiveSettingsFor,
  truncateCoords,
} from '../../src/modules/collab/collab.quality.js';

describe('collab.quality — classifyConnectionQuality', () => {
  it('bands latency correctly (interior points)', () => {
    assert.equal(classifyConnectionQuality(50), 'excellent');
    assert.equal(classifyConnectionQuality(200), 'good');
    assert.equal(classifyConnectionQuality(500), 'poor');
    assert.equal(classifyConnectionQuality(1200), 'critical');
  });

  // The four cases above sit in the MIDDLE of each band, and the thresholds are
  // 100 / 300 / 800 with a strict `<`. Moving any threshold by one, or turning a
  // `<` into a `<=`, changed nothing that was observed. Bands are numeric-edge
  // logic, so the edges are where the test belongs.
  it('the exact thresholds, from both sides', () => {
    const cases = [
      [99, 'excellent'], [100, 'good'],
      [299, 'good'], [300, 'poor'],
      [799, 'poor'], [800, 'critical'],
    ];
    let checked = 0;
    for (const [rtt, expected] of cases) {
      assert.equal(classifyConnectionQuality(rtt), expected, `rtt=${rtt}`);
      checked++;
    }
    assert.equal(checked, cases.length, 'every boundary case ran');
  });

  it('domain edges: 0, negative and Infinity', () => {
    assert.equal(classifyConnectionQuality(0), 'excellent', 'a zero round trip is the best case');
    assert.equal(classifyConnectionQuality(-1), 'excellent',
      'a negative rtt is impossible but classifies as excellent today (pinned)');
    assert.equal(classifyConnectionQuality(Infinity), 'critical');
  });

  it('TRAP (pinned): a non-numeric rtt silently classifies as CRITICAL', () => {
    // Every comparison against NaN is false, so the function falls through all
    // three bands to the final `return 'critical'`. There is no Number.isFinite
    // guard, and `?? 0` would not have provided one either. The consequence is
    // real: one corrupted rtt degrades the transport (3 s batches, 4-decimal
    // geometry, viewport-only) for that peer, with no error anywhere.
    //
    // This is the current contract, asserted so that adding a guard is a
    // deliberate change to this line rather than an invisible one.
    assert.equal(classifyConnectionQuality(NaN), 'critical');
    assert.equal(classifyConnectionQuality(undefined), 'critical');
    assert.equal(classifyConnectionQuality(null), 'excellent',
      'null coerces to 0 in `null < 100`, so it lands in the OPPOSITE band from NaN');
  });

  it('quality never improves as latency grows (monotonic)', () => {
    const rank = { excellent: 0, good: 1, poor: 2, critical: 3 };
    const samples = [0, 1, 99, 100, 150, 299, 300, 500, 799, 800, 1200, 60000];
    let previous = -1;
    let checked = 0;
    for (const rtt of samples) {
      const current = rank[classifyConnectionQuality(rtt)];
      assert.ok(current >= previous, `rtt=${rtt} classified better than a lower rtt`);
      previous = current;
      checked++;
    }
    assert.equal(checked, samples.length);
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

  it('every band has its exact transport parameters', () => {
    // These are wire parameters the client applies verbatim, and the previous
    // test compared only two of the four bands relatively — 'excellent' and
    // 'poor' could have held any values at all.
    assert.deepEqual(adaptiveSettingsFor('excellent'), {
      batchIntervalMs: 250, geometryPrecision: 7, viewportOnly: false,
    });
    assert.deepEqual(adaptiveSettingsFor('good'), {
      batchIntervalMs: 500, geometryPrecision: 7, viewportOnly: false,
    });
    assert.deepEqual(adaptiveSettingsFor('poor'), {
      batchIntervalMs: 1500, geometryPrecision: 5, viewportOnly: true,
    });
    assert.deepEqual(adaptiveSettingsFor('critical'), {
      batchIntervalMs: 3000, geometryPrecision: 4, viewportOnly: true,
    });
  });

  it('an unknown band falls back to the "good" profile, never to nothing', () => {
    const fallback = { batchIntervalMs: 500, geometryPrecision: 7, viewportOnly: false };
    assert.deepEqual(adaptiveSettingsFor('inexistente'), fallback);
    assert.deepEqual(adaptiveSettingsFor(undefined), fallback);
  });

  it('the four bands are monotonic in every parameter', () => {
    const order = ['excellent', 'good', 'poor', 'critical'];
    let prevInterval = -1;
    let prevPrecision = Infinity;
    let checked = 0;
    for (const band of order) {
      const s = adaptiveSettingsFor(band);
      assert.ok(s.batchIntervalMs >= prevInterval, `${band}: batch interval must not shrink`);
      assert.ok(s.geometryPrecision <= prevPrecision, `${band}: precision must not grow`);
      prevInterval = s.batchIntervalMs;
      prevPrecision = s.geometryPrecision;
      checked++;
    }
    assert.equal(checked, order.length);
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
