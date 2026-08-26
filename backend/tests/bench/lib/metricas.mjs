// Path: tests/bench/lib/metricas.mjs
//
// Latency accumulator and report formatter for the write benches.
//
// WHY A RAW SAMPLE ARRAY AND NOT A STREAMING ESTIMATOR. The interesting number here is p99
// and the MAX, not the mean — the advisory lock in `pushOperations` produces a queue, and a
// queue is visible only in the tail. A t-digest would smooth exactly the shape we are hunting.
// A bench degrau is at most a few tens of thousands of samples, so the array is cheap and the
// percentile is EXACT rather than estimated. Sorting once at report time costs nothing next to
// the run it describes.
//
// STATUS IS NOT A DETAIL. A 503 from the `lock_timeout` is the headline result of E1/E2, so it
// gets its own column instead of being folded into an error count. A bench that reports "p99 =
// 120 ms" while a third of the requests were refused is reporting the latency of the refusal.

/** One measured series: every sample, keyed by outcome. */
export class Serie {
  constructor(nome) {
    this.nome = nome;
    this.amostras = [];
    this.porStatus = new Map();
    this.erros = [];
    this.inicio = null;
    this.fim = null;
  }

  /** Marks the wall-clock window the series covers (used for throughput). */
  abrir() {
    this.inicio = performance.now();
    return this;
  }

  fechar() {
    this.fim = performance.now();
    return this;
  }

  /**
   * Records one attempt.
   * @param {number} ms - Wall-clock duration of the attempt.
   * @param {number|string} status - HTTP status, or a symbolic outcome for the WS path.
   */
  registrar(ms, status) {
    this.amostras.push(ms);
    this.porStatus.set(status, (this.porStatus.get(status) ?? 0) + 1);
  }

  registrarErro(err) {
    this.erros.push(String(err && err.message ? err.message : err));
    this.porStatus.set('ERRO', (this.porStatus.get('ERRO') ?? 0) + 1);
  }

  get total() {
    return this.amostras.length + this.erros.length;
  }

  /** Requests that the server accepted. Everything else is a refusal, not a measurement of work. */
  get ok() {
    return this.porStatus.get(200) ?? 0;
  }

  get indisponivel() {
    return this.porStatus.get(503) ?? 0;
  }

  percentis() {
    if (this.amostras.length === 0) return null;
    const s = [...this.amostras].sort((a, b) => a - b);
    const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    return { p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1], min: s[0] };
  }

  /** Attempts per second over the open window. Zero when the window was never closed. */
  vazao() {
    if (this.inicio == null || this.fim == null || this.fim <= this.inicio) return 0;
    return (this.total * 1000) / (this.fim - this.inicio);
  }

  resumo() {
    const p = this.percentis();
    return {
      nome: this.nome,
      total: this.total,
      ok: this.ok,
      indisponivel: this.indisponivel,
      status: Object.fromEntries(this.porStatus),
      vazaoPorSegundo: round(this.vazao(), 2),
      ...(p
        ? { p50: round(p.p50), p95: round(p.p95), p99: round(p.p99), max: round(p.max) }
        : {}),
      // First three only: a degrau that fails wholesale would otherwise print a wall of the
      // same message and bury the numbers it exists to show.
      errosExemplo: this.erros.slice(0, 3),
    };
  }
}

export function round(n, casas = 1) {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/**
 * Prints a fixed-width table. Columns are derived from the first row, so every row must carry
 * the same keys — a missing key prints as an empty cell instead of shifting the row.
 */
export function tabela(linhas, colunas) {
  if (linhas.length === 0) {
    console.log('  (sem linhas)');
    return;
  }
  const cols = colunas ?? Object.keys(linhas[0]);
  const larguras = cols.map((c) =>
    Math.max(c.length, ...linhas.map((l) => String(l[c] ?? '').length))
  );
  const linha = (celulas) =>
    '  ' + celulas.map((v, i) => String(v ?? '').padStart(larguras[i])).join('  ');
  console.log(linha(cols));
  console.log('  ' + larguras.map((w) => '-'.repeat(w)).join('  '));
  for (const l of linhas) console.log(linha(cols.map((c) => l[c])));
}

/**
 * The header every bench prints before its first number.
 *
 * WHY IT IS MANDATORY: a latency figure without the machine and the pool size is not
 * comparable to the same figure taken tomorrow, and a baseline file that omits them invites
 * exactly that comparison. `DATABASE_POOL_MAX` is read from the environment the SERVER will
 * get, not from this process's config, because they are allowed to differ.
 */
export async function cabecalho(extra = {}) {
  const os = await import('os');
  const { execFileSync } = await import('child_process');
  let commit = 'desconhecido';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // A bench run outside a checkout is still a valid run; it just cannot name the code.
  }
  return {
    commit,
    node: process.version,
    plataforma: `${os.platform()} ${os.release()}`,
    cpus: os.cpus().length,
    memoriaGB: round(os.totalmem() / 1024 ** 3, 1),
    poolMax: process.env.DATABASE_POOL_MAX ?? '10 (padrão)',
    lockTimeout: '5s (fixo em sync.service.js)',
    ...extra,
  };
}

export function imprimirCabecalho(h) {
  console.log('');
  console.log('='.repeat(78));
  for (const [k, v] of Object.entries(h)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log('='.repeat(78));
}
