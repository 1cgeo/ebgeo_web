// Path: tests/bench/lib/sonda-pg.mjs
//
// Samples `pg_stat_activity` from a SIDE connection while a degrau runs.
//
// WHAT IT IS ACTUALLY FOR. `pushOperations` takes `pg_advisory_xact_lock` per atlas
// (`src/modules/sync/sync.service.js`), so concurrent writers on the same atlas form a QUEUE.
// From the outside that queue is invisible: the driver sees latency and cannot tell waiting on
// a lock from slow work. Postgres reports it directly — a backend blocked on the advisory lock
// shows `wait_event_type = 'Lock'`, `wait_event = 'advisory'`. This sampler is the only
// instrument in the bench that can distinguish the two, and it needs no change to `src/`.
//
// THE SECOND NUMBER IS THE POOL. The same code comment that motivates the 5 s `lock_timeout`
// spells out the failure it prevents: a connection is HELD while waiting, so contention on one
// atlas converts into pool exhaustion for the whole process. Counting backends by state is how
// that claim gets measured instead of quoted.
//
// SAMPLING IS NOT INTEGRATION. A 250 ms sampler sees a snapshot, never every wait. The peak it
// reports is a LOWER BOUND on the true peak, and reports must say so rather than print it as
// "the maximum".

import pg from 'pg';

const INTERVALO_MS = 250;

const CONSULTA = `
  SELECT state,
         wait_event_type AS tipo_espera,
         wait_event      AS espera,
         count(*)::int   AS n,
         COALESCE(max(EXTRACT(EPOCH FROM (now() - query_start))), 0)::float AS mais_antiga_s
  FROM pg_stat_activity
  WHERE datname = $1 AND pid <> pg_backend_pid()
  GROUP BY 1, 2, 3
`;

export function nomeDoBanco(dsn) {
  return new URL(dsn).pathname.replace(/^\//, '');
}

/**
 * Starts sampling. Call `parar()` to stop and get the aggregate.
 *
 * @param {string} dsn - Connection string of the BENCH database.
 * @returns {Promise<{ parar: () => Promise<Object> }>}
 */
export async function amostrarPg(dsn) {
  const banco = nomeDoBanco(dsn);
  const cliente = new pg.Client({ connectionString: dsn });
  await cliente.connect();

  const agregado = {
    amostras: 0,
    picoConexoes: 0,
    picoAtivas: 0,
    picoEsperandoLock: 0,
    picoOciosasEmTransacao: 0,
    somaEsperandoLock: 0,
    maiorEsperaS: 0,
    esperasVistas: new Map(),
  };

  let vivo = true;
  const laco = (async () => {
    while (vivo) {
      try {
        const { rows } = await cliente.query(CONSULTA, [banco]);
        const total = rows.reduce((s, r) => s + r.n, 0);
        const ativas = rows.filter((r) => r.state === 'active').reduce((s, r) => s + r.n, 0);
        const emTx = rows
          .filter((r) => r.state === 'idle in transaction')
          .reduce((s, r) => s + r.n, 0);
        const noLock = rows
          .filter((r) => r.tipo_espera === 'Lock')
          .reduce((s, r) => s + r.n, 0);

        for (const r of rows) {
          if (!r.tipo_espera) continue;
          const chave = `${r.tipo_espera}/${r.espera ?? '-'}`;
          agregado.esperasVistas.set(chave, (agregado.esperasVistas.get(chave) ?? 0) + r.n);
          if (r.mais_antiga_s > agregado.maiorEsperaS) agregado.maiorEsperaS = r.mais_antiga_s;
        }

        agregado.amostras += 1;
        agregado.somaEsperandoLock += noLock;
        agregado.picoConexoes = Math.max(agregado.picoConexoes, total);
        agregado.picoAtivas = Math.max(agregado.picoAtivas, ativas);
        agregado.picoEsperandoLock = Math.max(agregado.picoEsperandoLock, noLock);
        agregado.picoOciosasEmTransacao = Math.max(agregado.picoOciosasEmTransacao, emTx);
      } catch {
        // A sampler that throws must not kill the run it is only watching.
      }
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
  })();

  return {
    async parar() {
      vivo = false;
      await laco;
      await cliente.end().catch(() => {});
      return {
        amostras: agregado.amostras,
        picoConexoes: agregado.picoConexoes,
        picoAtivas: agregado.picoAtivas,
        picoEsperandoLock: agregado.picoEsperandoLock,
        picoOciosasEmTransacao: agregado.picoOciosasEmTransacao,
        mediaEsperandoLock:
          agregado.amostras > 0
            ? Math.round((agregado.somaEsperandoLock / agregado.amostras) * 10) / 10
            : 0,
        maiorConsultaS: Math.round(agregado.maiorEsperaS * 10) / 10,
        esperas: Object.fromEntries(agregado.esperasVistas),
      };
    },
  };
}
