// Path: tests/unit/sync-trace-env-gate.test.js
// Item 62 (testes-backend.md) — the SyncLedger environment gate (invariant I14).
//
// `state.enabled` is computed ONCE, at module-initialization time, from
// EBGEO_TRACE / NODE_ENV. Any in-process assertion about it is worthless: the suite
// itself runs under NODE_ENV=test and every other test calls setTraceEnabled(true).
// That is exactly why the old `it('is enabled under NODE_ENV=test')` could not fail —
// it asserted a value the beforeEach had just written.
//
// So the gate is exercised OUT OF PROCESS, where the initializer really runs. Both
// directions have real consequences:
//   - always-false  → the SyncLedger goes dark and every deterministic Playwright wait
//                     degrades into a silent timeout;
//   - always-true   → recordSpan allocates rings and stores spans in PRODUCTION, on the
//                     sync hot path. app.js's `!config.isProd` cross-check only blocks
//                     MOUNTING the debug route; it does not stop the recording.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_URL = pathToFileURL(path.join(HERE, '..', '..', 'src', 'utils', 'sync-trace.js')).href;

/**
 * Runs `snippet` in a fresh node process with a controlled environment and returns
 * its trimmed stdout. `m` is the freshly-imported sync-trace module.
 */
function runWithEnv(env, snippet) {
  const script = `import(${JSON.stringify(MODULE_URL)}).then((m) => { ${snippet} });`;
  return execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
}

const PRINT_GATE = 'process.stdout.write(String(m.isTraceEnabled()));';

describe('sync-trace — environment gate (I14: tracing is unreachable in production)', () => {
  it('is OFF under NODE_ENV=production with EBGEO_TRACE unset', () => {
    const out = runWithEnv({ NODE_ENV: 'production', EBGEO_TRACE: '' }, PRINT_GATE);
    assert.equal(out, 'false');
  });

  it('is OFF under NODE_ENV=production even when EBGEO_TRACE is a truthy-looking non-1', () => {
    // The gate is a strict === '1' comparison; 'true'/'0' must not enable it.
    assert.equal(runWithEnv({ NODE_ENV: 'production', EBGEO_TRACE: 'true' }, PRINT_GATE), 'false');
    assert.equal(runWithEnv({ NODE_ENV: 'production', EBGEO_TRACE: '0' }, PRINT_GATE), 'false');
  });

  it('is ON under NODE_ENV=production when EBGEO_TRACE=1 (the explicit dev opt-in)', () => {
    const out = runWithEnv({ NODE_ENV: 'production', EBGEO_TRACE: '1' }, PRINT_GATE);
    assert.equal(out, 'true');
  });

  it('is ON under NODE_ENV=test with EBGEO_TRACE absent (what the old test only pretended to check)', () => {
    const out = runWithEnv({ NODE_ENV: 'test', EBGEO_TRACE: '' }, PRINT_GATE);
    assert.equal(out, 'true');
  });

  it('is OFF for any other NODE_ENV (development included) without the opt-in', () => {
    assert.equal(runWithEnv({ NODE_ENV: 'development', EBGEO_TRACE: '' }, PRINT_GATE), 'false');
  });

  it('records NOTHING in production — the cost is really zero, not just the flag read', () => {
    const out = runWithEnv(
      { NODE_ENV: 'production', EBGEO_TRACE: '' },
      `m.recordSpan('A', m.TraceStage.SERVER_INSERTED, { opId: 'x' });
       m.recordSpan('A', m.TraceStage.SERVER_APPLIED, { opId: 'x', rowsAffected: 1 });
       process.stdout.write(String(m.getTrace('A').length));`
    );
    assert.equal(out, '0');
  });

  it('records normally under the test gate — the OFF assertions above are not vacuous', () => {
    const out = runWithEnv(
      { NODE_ENV: 'test', EBGEO_TRACE: '' },
      `m.recordSpan('A', m.TraceStage.SERVER_INSERTED, { opId: 'x' });
       m.recordSpan('A', m.TraceStage.SERVER_APPLIED, { opId: 'x', rowsAffected: 1 });
       process.stdout.write(String(m.getTrace('A').length));`
    );
    assert.equal(out, '2');
  });
});
