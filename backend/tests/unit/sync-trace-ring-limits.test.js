// Path: tests/unit/sync-trace-ring-limits.test.js
// The two MEMORY BOUNDS of the backend SyncLedger ring, neither of which
// tests/unit/sync-trace.test.js touches:
//
//   1. MAX_ATLAS_RINGS (64) — the top-level `buffers` Map used to grow one entry per
//      distinct atlasId FOREVER. Deleting the eviction `while` loop produces no red
//      anywhere today; the leak comes back invisible and only surfaces as RSS growth
//      in a long-lived dev/e2e process, far from the cause.
//   2. DEFAULT_CAPACITY (5000) — the per-atlas ring `splice`. Deleting it turns a
//      single hot atlas into unbounded growth with the same silence.
//
// Both constants are module-private, so the assertions are written against the
// OBSERVED behavior (which atlas ids still answer, how many spans survive) rather than
// re-stating the constant against itself.
//
// The eviction policy is FIFO BY INSERTION, not LRU — deliberately counterintuitive:
// the busiest atlas can be evicted while 64 idle-but-recent ones survive. That is
// pinned explicitly so a future "improvement" to LRU is a decision, not a drift.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSpan,
  getTrace,
  clearTrace,
  setTraceEnabled,
  TraceStage,
} from '../../src/utils/sync-trace.js';

/** The cap the module documents; asserted only through observed retention. */
const EXPECTED_MAX_RINGS = 64;
/** The per-atlas ring capacity the module documents. */
const EXPECTED_CAPACITY = 5000;

describe('sync-trace — the ring memory bounds (MAX_ATLAS_RINGS, DEFAULT_CAPACITY)', () => {
  beforeEach(() => {
    clearTrace();
    setTraceEnabled(true);
  });

  it('keeps EXACTLY 64 atlas rings: the 65th insertion evicts the FIRST inserted', () => {
    const ids = Array.from({ length: EXPECTED_MAX_RINGS + 1 }, (_, i) => `ring-atlas-${i}`);
    for (const id of ids) {
      recordSpan(id, TraceStage.SERVER_INSERTED, { opId: `op-${id}` });
    }

    // Counted, not spot-checked: a spot-check on the two ends stays green if the
    // eviction loop evicted five rings instead of one.
    const alive = ids.filter((id) => getTrace(id).length > 0);
    assert.equal(alive.length, EXPECTED_MAX_RINGS, 'exactly 64 rings may be retained at once');

    assert.equal(getTrace(ids[0]).length, 0, 'the oldest KEY is the one evicted');
    assert.equal(getTrace(ids[ids.length - 1]).length, 1, 'the newest key is retained');
    assert.equal(getTrace(ids[1]).length, 1, 'only ONE ring was dropped, not a swath');
  });

  it('eviction is FIFO by insertion, NOT LRU: activity does not renew a ring', () => {
    // A is the busiest atlas in the process and still dies first. This is the
    // counterintuitive half of the policy; a switch to LRU must be a conscious
    // choice, so it is pinned here.
    for (let i = 0; i < 100; i += 1) {
      recordSpan('A', TraceStage.SERVER_APPLIED, { opId: `op-${i}` });
    }
    assert.equal(getTrace('A').length, 100, 'precondition: A is populated and hot');

    for (let i = 0; i < EXPECTED_MAX_RINGS; i += 1) {
      recordSpan(`cold-${i}`, TraceStage.SERVER_INSERTED, { opId: `c-${i}` });
    }

    assert.equal(getTrace('A').length, 0, 'the hottest ring is evicted purely for being oldest');
    assert.equal(getTrace(`cold-${EXPECTED_MAX_RINGS - 1}`).length, 1, 'the idle newcomers survive');
  });

  it('a single atlas ring is capped at 5000 spans, dropping the OLDEST', () => {
    const total = EXPECTED_CAPACITY + 1;
    for (let i = 0; i < total; i += 1) {
      recordSpan('cap', TraceStage.SERVER_INSERTED, { opId: `op-${i}` });
    }

    const spans = getTrace('cap');
    assert.equal(spans.length, EXPECTED_CAPACITY, 'the ring must not grow past its capacity');
    // Which END was dropped matters: dropping the NEWEST would keep the length
    // green while making the ledger useless (the merger reads recent spans).
    assert.equal(spans[0].opId, 'op-1', 'the FIRST span recorded is the one discarded');
    assert.equal(spans[spans.length - 1].opId, `op-${total - 1}`, 'the newest span is retained');
    // `seq` is monotonic per process, so the surviving head must be the SECOND
    // recorded, one above the head that was dropped.
    assert.equal(spans[1].seq - spans[0].seq, 1, 'the ring stays contiguous after the splice');
  });

  it('an atlasId never recorded returns [] — never undefined (the ledger merger iterates it)', () => {
    const out = getTrace('atlas-que-nunca-existiu');
    assert.ok(Array.isArray(out), 'the Playwright ledger merger spreads this value');
    assert.equal(out.length, 0);
  });
});
