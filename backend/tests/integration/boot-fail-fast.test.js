// Path: tests/integration/boot-fail-fast.test.js
// P1 nº 13: `src/index.js` had 0% coverage — 63 lines of boot, SIGTERM and graceful
// shutdown that no test ever executed.
//
// The invariant is one of ORDER: `validateEnvVariables()` must run BEFORE
// `createServer`/`listen`. A server that binds the port first and only then discovers
// it is misconfigured is not fail-fast — it is a process that answers requests with a
// broken configuration until something else notices.
//
// WHY A SUBPROCESS, and not a spy on the module:
//   `src/index.js` has no exports and its whole behaviour IS its top-level side effects
//   (validate → createServer → listen → register signal handlers). Importing it into the
//   test process would bind a port inside the runner and, worse, its shutdown path calls
//   `process.exit()`, which would kill the test runner itself. Stubbing the module graph
//   to observe call order would test the stub's wiring, not the file. A subprocess runs
//   the REAL file, and the exit code plus the error text are observable without any
//   instrumentation of the thing under test.
//
// HOW ORDER IS OBSERVED, rather than merely "it exited non-zero":
//   both failing branches are given a configuration where validation AND listen would
//   each fail, but with DIFFERENT, unmistakable messages. Which message comes out names
//   which one ran first. The occupied-port case additionally runs a control child with a
//   valid config against the same held port, which must fail with EADDRINUSE — that is
//   what proves the port really was taken, so the ABSENCE of EADDRINUSE in the first
//   child means `listen` was never reached rather than that the port happened to be free.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(HERE, '../../src/index.js');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;

// The child must NOT inherit the runner's own PORT/knob overrides, and it must get a
// usable DATABASE_URL/JWT_SECRET so that module imports succeed and the only thing
// left to fail is what each test deliberately breaks.
function childEnv(overrides) {
  const env = { ...process.env, ...overrides };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
  }
  return env;
}

/**
 * Spawns a node child, resolving with { code, stdout, stderr, timedOut }.
 * `killAfterMs` bounds a child that boots successfully and would otherwise run forever —
 * `timedOut: true` is then an observable outcome an assertion can name, instead of the
 * suite hanging until the test timeout kills it with no diagnosis.
 */
function runChild(args, { env, onSpawn, killAfterMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = killAfterMs
      ? setTimeout(() => { timedOut = true; child.kill(); }, killAfterMs)
      : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (onSpawn) onSpawn(child);
  });
}

/** Resolves once something accepts a TCP connection on `port`, or rejects at the deadline. */
async function waitForListening(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => { sock.destroy(); resolve(false); });
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`nothing listening on ${port} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Binds an ephemeral port and keeps it held; returns { port, release() }.
 *
 * The bind is host-less on purpose, mirroring `server.listen(config.port)` in index.js:
 * holding only 127.0.0.1 does NOT stop a dual-stack `::` bind on Windows, so the child
 * started anyway and the "port is taken" premise was quietly false.
 */
function holdPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      resolve({ port, release: () => new Promise((r) => srv.close(r)) });
    });
  });
}

describe('Boot fail-fast (src/index.js)', () => {
  let held = null;

  before(async () => {
    held = await holdPort();
  });

  after(async () => {
    if (held) await held.release();
  });

  it('validates BEFORE listen: an out-of-range PORT yields the config error, never ERR_SOCKET_BAD_PORT', async () => {
    // PORT=99999 fails BOTH checks: validateEnvVariables rejects `port > 65535`, and
    // `server.listen(99999)` throws RangeError ERR_SOCKET_BAD_PORT. Only one of them
    // can speak first, and which one does is exactly the invariant.
    const res = await runChild([INDEX_PATH], {
      env: childEnv({ NODE_ENV: 'test', PORT: '99999' }),
    });

    assert.notEqual(res.code, 0, 'boot must fail, not start');
    assert.match(res.stderr, /Configuração inválida/);
    assert.match(res.stderr, /PORT deve estar entre 1 e 65535/);
    assert.doesNotMatch(
      res.stderr,
      /ERR_SOCKET_BAD_PORT/,
      'listen() spoke first — validateEnvVariables must run before createServer/listen'
    );
  });

  it('reports the CONFIG error, not EADDRINUSE, when the port is also unavailable', async () => {
    // HONESTY NOTE, learned from the negative control: this test is NOT an ordering
    // proof, and an earlier version of it claimed to be one. Moving
    // `validateEnvVariables()` to AFTER `server.listen()` left it green, because
    // EADDRINUSE arrives asynchronously (a 'error' event on the next turn) while the
    // validation throw is synchronous — the throw wins the race whatever the order.
    // The ordering guard is the ERR_SOCKET_BAD_PORT test above, which pits a
    // SYNCHRONOUS listen failure against the synchronous throw; that one does go red.
    //
    // What this test does hold is the diagnostic invariant: when a deploy is BOTH
    // misconfigured and racing an old process on the port, the operator is told about
    // the configuration — the fixable, actual cause — rather than the port.
    const port = String(held.port);

    // Control FIRST, so the rest of the test has evidence the port is genuinely held:
    // a VALID config on this port must die of EADDRINUSE.
    const control = await runChild([INDEX_PATH], {
      env: childEnv({ NODE_ENV: 'test', PORT: port, WS_HEARTBEAT_INTERVAL_MS: undefined }),
      killAfterMs: 15000,
    });
    assert.equal(control.timedOut, false, 'the control child kept running — the port was NOT held');
    assert.notEqual(control.code, 0, 'the control child must fail — the port is held');
    assert.match(
      control.stderr,
      /EADDRINUSE/,
      'the held port must really be unbindable, or the assertion below proves nothing'
    );

    // Same held port, plus one invalid knob. The control above proved the port is
    // genuinely unbindable, so the absence of EADDRINUSE below is a statement about
    // which failure the process CHOSE to report, not about the port being free.
    const res = await runChild([INDEX_PATH], {
      env: childEnv({ NODE_ENV: 'test', PORT: port, WS_HEARTBEAT_INTERVAL_MS: 'abc' }),
      killAfterMs: 15000,
    });

    assert.equal(res.timedOut, false);
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /WS_HEARTBEAT_INTERVAL_MS deve ser um inteiro/);
    assert.doesNotMatch(
      res.stderr,
      /EADDRINUSE/,
      'the socket was bound before the config was checked — that is not fail-fast'
    );
  });

  it('accumulates every configuration error in one throw, not just the first', async () => {
    // validateEnvVariables deliberately collects all errors; a fail-fast that reveals
    // one problem per restart makes a misconfigured deploy an N-round trip.
    const res = await runChild([INDEX_PATH], {
      env: childEnv({
        NODE_ENV: 'test',
        PORT: '0',
        WS_HEARTBEAT_INTERVAL_MS: 'abc',
        JWT_ACCESS_EXPIRY: '1w',
      }),
    });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /PORT deve estar entre 1 e 65535/);
    assert.match(res.stderr, /WS_HEARTBEAT_INTERVAL_MS deve ser um inteiro/);
    assert.match(res.stderr, /JWT_ACCESS_EXPIRY deve ser um número seguido de/);
  });

  it('boots on a valid config and shuts down gracefully with exit code 0', async () => {
    // The positive control for everything above: if validateEnvVariables threw
    // unconditionally, the three tests above would still be green and this one red.
    const { port, release } = await holdPort();
    await release(); // free it again; we only wanted an unused number

    // Node on Windows does not deliver a real SIGTERM to a child (child.kill() maps to
    // TerminateProcess and the handler never runs), so the signal is raised INSIDE the
    // child via `process.emit('SIGTERM')` on a stdin nudge. That still exercises the
    // registration (`process.on('SIGTERM', …)`) and the whole shutdown body — what it
    // does not cover is the OS-level delivery, which is Node's job, not this file's.
    const bootstrap = `
      await import(${JSON.stringify(INDEX_URL)});
      process.stdin.on('data', () => { process.emit('SIGTERM'); });
      process.stdin.resume();
    `;

    let child = null;
    const done = runChild(['--input-type=module', '-e', bootstrap], {
      env: childEnv({ NODE_ENV: 'test', PORT: String(port) }),
      onSpawn: (c) => { child = c; },
    });

    await waitForListening(port);
    child.stdin.write('\n');

    const res = await done;
    assert.equal(res.code, 0, `graceful shutdown must exit 0 — stderr: ${res.stderr}`);

    // And it actually let the port go, which is what `server.close()` is for.
    await assert.rejects(
      () => waitForListening(port, 3000),
      /nothing listening/,
      'the port is still bound after shutdown'
    );
  });

  it('is re-entrant: a second signal during shutdown does not run the teardown twice', async () => {
    // The `shuttingDown` guard. A double Ctrl+C used to re-enter shutdown, which
    // double-closes the pool and can surface as an error exit on a clean stop.
    const { port, release } = await holdPort();
    await release();

    const bootstrap = `
      await import(${JSON.stringify(INDEX_URL)});
      process.stdin.on('data', () => {
        process.emit('SIGTERM');
        process.emit('SIGINT');
        process.emit('SIGTERM');
      });
      process.stdin.resume();
    `;

    let child = null;
    const done = runChild(['--input-type=module', '-e', bootstrap], {
      env: childEnv({ NODE_ENV: 'test', PORT: String(port) }),
      onSpawn: (c) => { child = c; },
    });

    await waitForListening(port);
    child.stdin.write('\n');

    const res = await done;
    assert.equal(res.code, 0, `re-entrant shutdown must still exit 0 — stderr: ${res.stderr}`);
  });
});
