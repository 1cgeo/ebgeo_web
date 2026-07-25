// Path: tests/unit/sync-trace.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSpan,
  getTrace,
  clearTrace,
  isTraceEnabled,
  setTraceEnabled,
  TraceStage,
  TraceOutcome,
} from '../../src/utils/sync-trace.js';

describe('sync-trace — backend SyncLedger ring', () => {
  beforeEach(() => {
    clearTrace();
    setTraceEnabled(true);
  });

  // The assertion "is enabled under NODE_ENV=test" used to live here. It was
  // UNFALSIFIABLE: the beforeEach above calls setTraceEnabled(true) before every it,
  // so isTraceEnabled() would have read true even if the module initializer were
  // hard-coded to false. The real gate is verified out-of-process, where the
  // initializer actually runs: tests/unit/sync-trace-env-gate.test.js.

  it('setTraceEnabled toggles the flag both ways', () => {
    setTraceEnabled(false);
    assert.equal(isTraceEnabled(), false);
    setTraceEnabled(true);
    assert.equal(isTraceEnabled(), true);
  });

  it('records spans per atlas and stamps actor=server', () => {
    recordSpan('A', TraceStage.SERVER_INSERTED, { opId: 'op1', serverVersion: 5, outcome: TraceOutcome.OK });
    recordSpan('A', TraceStage.SERVER_APPLIED, { opId: 'op1', rowsAffected: 1, outcome: TraceOutcome.OK });
    recordSpan('B', TraceStage.SERVER_BROADCAST, { opId: 'op2', sent: 2 });
    assert.equal(getTrace('A').length, 2);
    assert.equal(getTrace('B').length, 1);
    assert.equal(getTrace('A')[0].actor, 'server');
  });

  it('filters by opId and traceId', () => {
    recordSpan('A', TraceStage.SERVER_INSERTED, { opId: 'op1', traceId: 't1' });
    recordSpan('A', TraceStage.SERVER_INSERTED, { opId: 'op2', traceId: 't2' });
    assert.equal(getTrace('A', { opId: 'op1' }).length, 1);
    assert.equal(getTrace('A', { traceId: 't2' }).length, 1);
  });

  it('surfaces the acked-but-no-effect outcome (invariant I2)', () => {
    recordSpan('A', TraceStage.SERVER_APPLIED, { opId: 'op1', rowsAffected: 0, outcome: TraceOutcome.NO_EFFECT });
    const s = getTrace('A')[0];
    assert.equal(s.outcome, 'no-effect');
    assert.equal(s.rowsAffected, 0);
  });

  it('is a no-op when disabled (zero overhead in production)', () => {
    setTraceEnabled(false);
    recordSpan('A', TraceStage.SERVER_INSERTED, { opId: 'x' });
    assert.equal(getTrace('A').length, 0);
  });

  it('clears one atlas without touching others', () => {
    recordSpan('A', TraceStage.SERVER_INSERTED, { opId: 'op1' });
    recordSpan('B', TraceStage.SERVER_INSERTED, { opId: 'op2' });
    clearTrace('A');
    assert.equal(getTrace('A').length, 0);
    assert.equal(getTrace('B').length, 1);
  });

  it('never throws on a malformed span or missing atlasId', () => {
    assert.doesNotThrow(() => recordSpan('A', TraceStage.SERVER_INSERTED, null));
    assert.doesNotThrow(() => recordSpan(null, TraceStage.SERVER_INSERTED, { opId: 'y' }));
  });
});
