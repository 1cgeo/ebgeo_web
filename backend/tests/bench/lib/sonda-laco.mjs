// Path: tests/bench/lib/sonda-laco.mjs
//
// EVENT-LOOP PROBE, injected into the SERVER process with `node --import`.
//
// WHY IT LIVES HERE AND NOT IN `src/`. The number this file produces is the server's own
// event-loop delay, and it can only be taken inside the server process. The obvious way to get
// it out is a debug route, but that is a change to production code for a bench. `--import`
// runs this module before the entry point, in the same thread, so the histogram sees the real
// loop and `src/` stays untouched.
//
// WHY THE EXISTING BENCH COULD NOT DO THIS. `tests/bench/overview-capas.bench.mjs` says in its
// own header that its loop probe is a ceiling, not a clean measurement, because the server it
// measures runs in the same process that spawns the `curl` children. Splitting the two
// processes is what makes this histogram mean what it says.
//
// THE PROBE IS NOT FREE, AND THE COST IS BOUNDED ON PURPOSE. `monitorEventLoopDelay` samples in
// C++ off the JS loop; the HTTP endpoint below only does work when polled, which the driver
// does once per second. The listener is `unref`ed so it never holds the process open during the
// graceful shutdown that `src/index.js` performs.
//
// Usage (the driver does this for you, see `lib/servidor.mjs`):
//   BENCH_PROBE_PORT=8099 node --import ./tests/bench/lib/sonda-laco.mjs src/index.js

import { monitorEventLoopDelay } from 'perf_hooks';
import { createServer } from 'http';

const PORTA = Number(process.env.BENCH_PROBE_PORT || 0);

if (PORTA > 0) {
  // 10 ms resolution: finer buckets buy precision we cannot use, since the delays that matter
  // here (a serialized push queue) are tens to thousands of milliseconds.
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();

  const ns = (v) => Math.round(v / 1e6); // nanoseconds to milliseconds

  const servidor = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/laco') {
      const corpo = {
        lacoMs: {
          media: ns(h.mean),
          p50: ns(h.percentile(50)),
          p95: ns(h.percentile(95)),
          p99: ns(h.percentile(99)),
          max: ns(h.max),
        },
        memoria: {
          rssMB: Math.round(process.memoryUsage().rss / 1024 ** 2),
          heapMB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
        },
        // The count of live handles is the cheapest proxy for "sockets still open", which is
        // what E5 (fan-out) needs to know when a peer was terminated for backpressure.
        handles: typeof process._getActiveHandles === 'function'
          ? process._getActiveHandles().length
          : null,
        uptimeS: Math.round(process.uptime()),
      };
      if (url.searchParams.get('reset') === '1') h.reset();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
      return;
    }
    res.writeHead(404).end();
  });

  servidor.listen(PORTA, '127.0.0.1', () => {
    // stderr, never stdout: the driver parses the server's stdout for the listen line.
    process.stderr.write(`[sonda-laco] escutando em 127.0.0.1:${PORTA}\n`);
  });
  servidor.unref();
}
