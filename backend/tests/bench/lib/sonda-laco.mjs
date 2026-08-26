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

import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { createServer } from 'http';

const PORTA = Number(process.env.BENCH_PROBE_PORT || 0);

if (PORTA > 0) {
  // 10 ms resolution: finer buckets buy precision we cannot use, since the delays that matter
  // here (a serialized push queue) are tens to thousands of milliseconds.
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();

  // ---------------------------------------------------------------------------------------------
  // ATRASO E OCUPACAO SAO PROPRIEDADES DIFERENTES, E CONFUNDI-LAS INVALIDOU UMA RODADA INTEIRA.
  //
  // `monitorEventLoopDelay` mede BLOQUEIO: quanto um temporizador chega atrasado. Um laco que
  // processa trinta mil mensagens por segundo, cada uma curta, NUNCA fica bloqueado — os
  // temporizadores disparam no horario e o histograma marca 16 ms, que e o piso do relogio do
  // Windows. E o laco esta em cem por cento de uso, sem folga, com tudo entrando em fila.
  //
  // Foi exatamente o que aconteceu com mil usuarios na cadencia de trabalho: ack mediano de 8,5 s,
  // 338 sockets ceifados por ping nao processado, 85% de presenca descartada por contrapressao —
  // e este mesmo histograma dizendo p99 de 16 ms. A bancada concluiu "nao e o servidor", e errou.
  //
  // `eventLoopUtilization` mede OCUPACAO: a fracao do tempo em que o laco esteve ativo. Perto de
  // 1,0 significa zero folga, mesmo com atraso baixo. E a metrica que discrimina "ocioso" de
  // "saturado", e as duas so fazem sentido lado a lado.
  // ---------------------------------------------------------------------------------------------
  let baseElu = performance.eventLoopUtilization();
  // CAMINHO INDEPENDENTE PARA A MESMA PERGUNTA. `eventLoopUtilization` e derivado do tempo ocioso
  // que a libuv contabiliza; `process.cpuUsage()` vem do sistema operacional e nao compartilha
  // nenhuma linhagem com ele. Quando a bancada afirmar "o Node estava ocioso", os dois tem de
  // concordar. Se discordarem, o instrumento e que esta errado, e e melhor descobrir isso aqui do
  // que depois de escrever uma conclusao em cima dele.
  let baseCpu = process.cpuUsage();

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
      // Delta desde o ultimo reset, nunca desde o boot: o valor acumulado do processo diluiria a
      // janela medida na rampa e na semeadura que vieram antes dela.
      const elu = performance.eventLoopUtilization(baseElu);
      corpo.usoDoLacoPct = Math.round(elu.utilization * 1000) / 10;
      const cpu = process.cpuUsage(baseCpu);
      corpo.cpuUsuarioMs = Math.round(cpu.user / 1000);
      corpo.cpuSistemaMs = Math.round(cpu.system / 1000);
      corpo.ativoMs = Math.round(elu.active);
      corpo.ociosoMs = Math.round(elu.idle);
      if (url.searchParams.get('reset') === '1') {
        h.reset();
        baseElu = performance.eventLoopUtilization();
        baseCpu = process.cpuUsage();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
      return;
    }
    res.writeHead(404).end();
  });

  // MEASURED ON WINDOWS: leaving the histogram enabled while the process tears down can abort
  // with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv's async handle, because
  // `src/index.js` ends its graceful shutdown with `process.exit(0)`. The crash comes AFTER the
  // work, so it corrupts no measurement, but it turns a clean stop into a scary log line and a
  // non-zero exit code. Disabling the histogram first closes that handle in an orderly way.
  const desligar = () => { try { h.disable(); } catch { /* já desligado */ } };
  process.once('SIGTERM', desligar);
  process.once('SIGINT', desligar);
  process.once('beforeExit', desligar);

  // A DIAGNOSTIC MUST NEVER KILL ITS SUBJECT. Without this handler an `EADDRINUSE` on the probe
  // port becomes an unhandled 'error' event, and Node takes the whole SERVER process down with it.
  // The bench then reports "o servidor morreu antes de ficar pronto" and points the reader at the
  // server instead of at the probe. The measurement is worth less without the histogram; it is
  // worth nothing without the server.
  servidor.on('error', (err) => {
    process.stderr.write(`[sonda-laco] desligada (porta ${PORTA}): ${err.code || err.message}
`);
  });

  servidor.listen(PORTA, '127.0.0.1', () => {
    // stderr, never stdout: the driver parses the server's stdout for the listen line.
    process.stderr.write(`[sonda-laco] escutando em 127.0.0.1:${PORTA}\n`);
  });
  servidor.unref();
}
