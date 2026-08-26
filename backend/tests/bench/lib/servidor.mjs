// Path: tests/bench/lib/servidor.mjs
//
// Starts the REAL server in its OWN process and hands the driver a handle to it.
//
// THE TWO-PROCESS SPLIT IS THE POINT. Every existing bench in this folder runs `createApp()`
// inside the measuring process, and `overview-capas.bench.mjs` documents the consequence in its
// own header: the loop-delay probe becomes a ceiling, because the bench's own work runs on the
// loop it is measuring. With dozens of concurrent writers the distortion stops being a caveat
// and becomes the result. Here the server gets a clean process, the driver gets another, and
// the loop histogram (see `sonda-laco.mjs`) is taken inside the server.
//
// NODE_ENV=test, AND WHAT THAT REMOVES FROM THE NUMBERS. Two production behaviours are off,
// both deliberately, both printed in the bench header so no reader has to guess:
//   - Rate limiters are skipped (`src/middleware/rate-limit.js`: `skip()` returns true in test).
//     Dozens of writers would otherwise measure `authLimiter`, not the write path.
//   - The logger is silent (`src/utils/logger.js`). Per-request logging is real production cost
//     that these numbers therefore EXCLUDE.
// The config cache is forced ON (`CONFIG_CACHE_FORCE=1`), because leaving it off would be a
// third divergence, and this one is not wanted: it makes the read side slower than production.
//
// READINESS IS ANCHORED ON A STATUS CODE, NEVER ON LOG TEXT. This repository has paid for the
// other way: a wait that matched the ANNOUNCEMENT of a step instead of its completion declared
// ready in the middle. `/api/v1/health` answering 200 is the only signal used here.

import { spawn } from 'child_process';
import { createServer } from 'net';
import { setTimeout as sleep } from 'timers/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const DIR_BENCH = path.dirname(fileURLToPath(import.meta.url));
const DIR_BACKEND = path.resolve(DIR_BENCH, '../../..');

// MEASURED, NOT GUESSED. `node --import <caminho>` rejects a Windows absolute path with
// `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'` — the ESM loader reads the argument as
// a URL, and `D:\...` parses as a scheme. `pathToFileURL` is the conversion the loader wants, and
// it is harmless on POSIX. This cost the first real run of this bench.
const URL_SONDA = pathToFileURL(path.join(DIR_BENCH, 'sonda-laco.mjs')).href;

export const PORTA_PADRAO = process.env.BENCH_PORT ? Number(process.env.BENCH_PORT) : null;
export const PORTA_SONDA = process.env.BENCH_PROBE_PORT
  ? Number(process.env.BENCH_PROBE_PORT)
  : null;

/**
 * Asks the OS for N free ports, holding every socket open until all of them are assigned.
 *
 * TWO BUGS PAID FOR THIS FUNCTION, both on the first real runs of this bench:
 *
 *   1. FIXED PORTS were the wrong default. A parallel `npm run dev` and a Playwright run on this
 *      machine already held the hard-coded number, and the bench died before its first request.
 *
 *   2. CALLING A ONE-PORT HELPER TWICE returns the SAME port. Each call binds zero, reads the
 *      assignment and closes; the OS then hands the very same number to the next request, so the
 *      app and the probe both got 49247 and the second bind crashed the server process. Holding
 *      all the sockets open at once is what makes the numbers distinct.
 *
 * A residual race remains (someone can take a port between the close and the spawn), which is why
 * the probe's listener is also non-fatal. The alternative is a bench that fails for a reason with
 * nothing to do with what it measures.
 */
export function portasLivres(quantas) {
  const sockets = [];
  return new Promise((resolve, reject) => {
    const portas = [];
    let pendentes = quantas;
    for (let i = 0; i < quantas; i += 1) {
      const s = createServer();
      sockets.push(s);
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        portas.push(s.address().port);
        pendentes -= 1;
        if (pendentes === 0) {
          let fechando = sockets.length;
          for (const aberto of sockets) {
            aberto.close(() => {
              fechando -= 1;
              if (fechando === 0) resolve(portas);
            });
          }
        }
      });
    }
  });
}

/**
 * Boots the server and waits until it answers health.
 *
 * @param {Object} opts
 * @param {string} opts.databaseUrl - The BENCH database. Never the dev or test database.
 * @param {number} [opts.porta]
 * @param {number} [opts.portaSonda]
 * @param {Object} [opts.env] - Extra environment for the child.
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<{ base: string, parar: () => Promise<void>, laco: Function, saida: () => string }>}
 */
export async function subirServidor({
  databaseUrl,
  porta = PORTA_PADRAO,
  portaSonda = PORTA_SONDA,
  env = {},
  timeoutMs = 30_000,
} = {}) {
  if (!databaseUrl) throw new Error('subirServidor exige databaseUrl explícita');
  if (porta == null || portaSonda == null) {
    const [a, b] = await portasLivres(2);
    porta = porta ?? a;
    portaSonda = portaSonda ?? b;
  }

  const filho = spawn(
    process.execPath,
    ['--import', URL_SONDA, 'src/index.js'],
    {
      cwd: DIR_BACKEND,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(porta),
        BENCH_PROBE_PORT: String(portaSonda),
        DATABASE_URL: databaseUrl,
        JWT_SECRET:
          process.env.JWT_SECRET || 'bench-secret-key-for-load-testing-only-32chars',
        CONFIG_CACHE_FORCE: '1',
        IMAGES_DIR: process.env.IMAGES_DIR || './data/bench-images',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let saida = '';
  filho.stdout.on('data', (b) => { saida += b.toString(); });
  filho.stderr.on('data', (b) => { saida += b.toString(); });

  let morreu = null;
  filho.on('exit', (code, signal) => { morreu = { code, signal }; });

  const base = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (morreu) {
      throw new Error(
        `O servidor morreu antes de ficar pronto (code=${morreu.code} signal=${morreu.signal}).\n${saida}`
      );
    }
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.status === 200) {
        await r.arrayBuffer();
        return criarHandle({ filho, base, portaSonda, obterSaida: () => saida });
      }
      await r.arrayBuffer();
    } catch {
      // Connection refused while it is still binding. Expected; keep polling.
    }
    await sleep(200);
  }

  filho.kill();
  throw new Error(`O servidor não respondeu health em ${timeoutMs} ms.\n${saida}`);
}

function criarHandle({ filho, base, portaSonda, obterSaida }) {
  return {
    base,
    saida: obterSaida,

    /**
     * Reads the in-server loop histogram. `reset` clears it, which is how a bench discards the
     * warm-up round without discarding the process.
     */
    async laco({ reset = false } = {}) {
      try {
        const r = await fetch(`http://127.0.0.1:${portaSonda}/laco${reset ? '?reset=1' : ''}`);
        if (r.status !== 200) { await r.arrayBuffer(); return null; }
        return await r.json();
      } catch {
        // The probe is diagnostic. Its absence must never fail a run that produced real numbers.
        return null;
      }
    },

    /**
     * Stops the server.
     *
     * ON WINDOWS THIS IS NOT GRACEFUL, and pretending otherwise would be the lie. `kill()` maps
     * to TerminateProcess, so the SIGTERM handler in `src/index.js` never runs and Postgres
     * reaps the connections itself. Harmless for a bench database that the run owns; it would
     * not be harmless anywhere else, which is one more reason the bench database is dedicated.
     */
    async parar() {
      if (filho.exitCode !== null || filho.signalCode !== null) return;
      filho.kill('SIGTERM');
      const limite = Date.now() + 10_000;
      while (Date.now() < limite) {
        if (filho.exitCode !== null || filho.signalCode !== null) return;
        await sleep(100);
      }
      filho.kill('SIGKILL');
    },
  };
}
