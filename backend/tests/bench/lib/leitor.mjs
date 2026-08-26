// Path: tests/bench/lib/leitor.mjs
//
// The INCREMENTAL READER: one client that pulls `GET /api/v1/atlas/:id/sync/:version` in a loop
// while the writers hammer the same atlas.
//
// THIS IS THE ONLY DIRECT TEST OF THE ADVISORY LOCK'S PURPOSE. The comment on the lock in
// `pushOperations` states the failure it prevents, in full: two pushes can interleave so that
// `server_version` order diverges from COMMIT order, and the incremental cursor
// (`WHERE server_version > $lastVersion`) then skips the op that committed late — lost for
// good, silently. Latency numbers say nothing about that. A reader that follows the cursor for
// the whole run and ends up missing an op id that IS in the ledger reproduces it exactly.
//
// COMPARE BY `op_id`, NEVER BY VERSION CONTIGUITY. `server_version` comes from a sequence shared
// across atlases, so a gap in the numbering is another atlas's op, not a lost one. This repo
// already paid for that confusion once: gap detection by non-contiguity caused a `sync_request`
// storm and was removed. The reader here records ids and lets `reconciliar.mjs` do set algebra.
//
// THE FIRST PULL IS A SNAPSHOT, AND IT IS SKIPPED ON PURPOSE. Version 0 (or anything below
// `min_version`) returns the whole atlas instead of a list of operations. The reader starts from
// the CURRENT version taken before the load begins, so everything it sees afterwards is genuinely
// incremental.

/**
 * Follows the incremental cursor until `parar()` is called.
 *
 * @param {Object} opts
 * @param {string} opts.base
 * @param {string} opts.token
 * @param {string} opts.atlasId
 * @param {number} opts.desdeVersao - Starting cursor. Use the atlas's current version.
 * @param {number} [opts.intervaloMs=200]
 * @param {import('./metricas.mjs').Serie} [opts.serie]
 * @returns {{ parar: () => Promise<{ vistos: Set<string>, ultimaVersao: number, puxadas: number,
 *   snapshots: number }> }}
 */
export function leitorIncremental({
  base, token, atlasId, desdeVersao, intervaloMs = 200, serie = null,
}) {
  const vistos = new Set();
  let versao = desdeVersao;
  let puxadas = 0;
  let snapshots = 0;
  let vivo = true;

  const laco = (async () => {
    while (vivo) {
      const t0 = performance.now();
      try {
        const r = await fetch(`${base}/api/v1/atlas/${atlasId}/sync/${versao}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const corpo = await r.json().catch(() => null);
        serie?.registrar(performance.now() - t0, r.status);
        puxadas += 1;
        if (r.status === 200 && corpo?.data) {
          const d = corpo.data;
          if (d.isSnapshot) {
            // A snapshot means the cursor fell behind `min_version` (a cleanup ran). It is a
            // legitimate outcome, not an error, but it BREAKS the id-by-id chain, so the run
            // reports it instead of quietly folding it in.
            snapshots += 1;
            versao = d.currentVersion ?? versao;
          } else {
            for (const op of d.operations ?? []) if (op.id) vistos.add(op.id);
            if (typeof d.currentVersion === 'number') versao = d.currentVersion;
          }
        }
      } catch (err) {
        serie?.registrarErro(err);
      }
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  })();

  return {
    async parar() {
      // One last pull AFTER the writers stopped: without it the reader is always one interval
      // behind, and the tail of the run would look like loss that never happened.
      vivo = false;
      await laco;
      try {
        const r = await fetch(`${base}/api/v1/atlas/${atlasId}/sync/${versao}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const corpo = await r.json().catch(() => null);
        if (r.status === 200 && corpo?.data && !corpo.data.isSnapshot) {
          for (const op of corpo.data.operations ?? []) if (op.id) vistos.add(op.id);
          if (typeof corpo.data.currentVersion === 'number') versao = corpo.data.currentVersion;
          puxadas += 1;
        }
      } catch {
        // The final pull is best-effort; the ledger comparison still runs.
      }
      return { vistos, ultimaVersao: versao, puxadas, snapshots };
    },
  };
}

/** Reads the atlas's current sync version straight from the API, for use as a start cursor. */
export async function versaoAtual(base, token, atlasId) {
  const r = await fetch(`${base}/api/v1/atlas/${atlasId}/sync/0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const corpo = await r.json();
  if (r.status !== 200) throw new Error(`Não consegui ler a versão atual: ${r.status}`);
  return corpo.data.currentVersion ?? 0;
}
