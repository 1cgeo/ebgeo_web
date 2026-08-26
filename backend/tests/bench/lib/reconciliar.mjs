// Path: tests/bench/lib/reconciliar.mjs
//
// THE PART OF THE BENCH THAT CAN FAIL.
//
// A write bench that only reports latency approves data loss. Every number in this folder is
// descriptive — no threshold, no assertion — and that is right for a stopwatch. It is wrong for
// correctness: under contention the interesting outcomes are exactly the ones a stopwatch cannot
// see. So each run ends here, comparing what the SERVER SAID against what the LEDGER HOLDS, and
// these checks DO fail the run.
//
// WHY THE ACK IS NOT THE PROOF. The ack is the writing tool's own echo. `results[].success` is
// built in the same function that did the write, from its own local array, before the process
// ever re-reads a row. Confirming a write by the response of the call that performed it is the
// most expensive recurring mistake in this repository's ledger. The independent path is a fresh
// connection reading `operations`.
//
// THE FOUR CHECKS, AND WHAT EACH ONE WOULD CATCH:
//
//   P1  Every acked op is in the ledger.
//       Catches: an ack emitted for an operation whose INSERT matched zero rows, or whose
//       transaction rolled back after the ack was pushed onto the local array.
//
//   P2  Every op with NO verdict is absent from the ledger.
//       The 5 s `lock_timeout` fires BEFORE the first INSERT of the batch, so a 503 (REST) or an
//       `error` frame (socket) must leave nothing behind. Catches a partially applied batch
//       reported as a total failure — the shape that makes a client's retry duplicate work.
//
//   P3  Every refused op is absent from the ledger.
//       A per-op denial (`operationDenialReason`, `lockedMapDenialReason`, integrity violation)
//       acks with `success: false` and never inserts. Catches a refusal that wrote anyway.
//
//   P4  The incremental reader saw every committed op.
//       This is the advisory lock's whole purpose, stated as a set difference. See `leitor.mjs`.
//
// COMPARISON IS BY `op_id`. Never by row count, never by version contiguity: `server_version`
// comes from a sequence shared across atlases, so gaps are normal and counting rows in a table
// that other scenarios also write would be a check that cannot fail.

import pg from 'pg';

/**
 * @param {Object} opts
 * @param {string} opts.dsn
 * @param {string[]} opts.atlasIds - Only these atlases are read, so scenarios never contaminate
 *   each other's reconciliation.
 * @param {Object} opts.registro - From `criarRegistro()`, after the run.
 * @param {{ vistos: Set<string> }} [opts.leitura] - From `leitorIncremental().parar()`.
 * @returns {Promise<{ ok: boolean, provas: Object[], resumo: Object }>}
 */
export async function reconciliar({ dsn, atlasIds, registro, leitura = null }) {
  const cliente = new pg.Client({ connectionString: dsn });
  await cliente.connect();
  let noLedger;
  let linhas;
  try {
    const { rows } = await cliente.query(
      'SELECT op_id, server_version FROM operations WHERE atlas_id = ANY($1::uuid[])',
      [atlasIds]
    );
    linhas = rows.length;
    noLedger = new Set(rows.map((r) => r.op_id));
  } finally {
    await cliente.end().catch(() => {});
  }

  const provas = [];

  // P1
  const ackedAusentes = [...registro.acked].filter((id) => !noLedger.has(id));
  provas.push(prova(
    'P1 ack no ledger',
    ackedAusentes.length === 0,
    `${registro.acked.size} ops com ack, ${ackedAusentes.length} ausentes do ledger`,
    ackedAusentes
  ));

  // P2
  const semVeredictoPresentes = [...registro.semVeredito].filter((id) => noLedger.has(id));
  provas.push(prova(
    'P2 sem veredito, sem escrita',
    semVeredictoPresentes.length === 0,
    `${registro.semVeredito.size} ops sem veredito, ${semVeredictoPresentes.length} gravadas mesmo assim`,
    semVeredictoPresentes
  ));

  // P3
  const recusadasPresentes = [...registro.recusados.keys()].filter((id) => noLedger.has(id));
  provas.push(prova(
    'P3 recusada, sem escrita',
    recusadasPresentes.length === 0,
    `${registro.recusados.size} ops recusadas, ${recusadasPresentes.length} gravadas mesmo assim`,
    recusadasPresentes
  ));

  // P4 — only meaningful when a reader ran, and only over ops this run itself sent. Ops seeded
  // before the reader's start cursor are outside its window by construction.
  if (leitura) {
    const commitadasDesteRun = [...registro.enviados].filter((id) => noLedger.has(id));
    const naoVistas = commitadasDesteRun.filter((id) => !leitura.vistos.has(id));
    provas.push(prova(
      'P4 cursor sem perda',
      naoVistas.length === 0,
      `${commitadasDesteRun.length} ops commitadas, ${naoVistas.length} nunca chegaram ao cursor`
        + (leitura.snapshots ? ` (${leitura.snapshots} snapshots quebraram a cadeia)` : ''),
      naoVistas
    ));
  }

  const ok = provas.every((p) => p.ok);
  return {
    ok,
    provas,
    resumo: {
      enviados: registro.enviados.size,
      acked: registro.acked.size,
      idempotentes: registro.idempotentes.size,
      recusados: registro.recusados.size,
      semVeredito: registro.semVeredito.size,
      linhasNoLedger: linhas,
      // Sent minus what the ledger holds. Under a clean run with 503s this equals the number of
      // ops the writers must retry, and it is the cost of contention expressed in lost work.
      aRetentar: [...registro.enviados].filter((id) => !noLedger.has(id)).length,
    },
  };
}

function prova(nome, ok, mensagem, amostra) {
  return { nome, ok, mensagem, amostra: amostra.slice(0, 5) };
}

/** Prints the block and returns the exit code the bench should use. */
export function imprimirProvas(resultado) {
  console.log('');
  console.log('  RECONCILIACAO (estas provas reprovam a rodada)');
  for (const p of resultado.provas) {
    console.log(`    ${p.ok ? 'OK  ' : 'FALHA'} ${p.nome.padEnd(26)} ${p.mensagem}`);
    if (!p.ok && p.amostra.length > 0) {
      console.log(`         exemplos: ${p.amostra.join(', ')}`);
    }
  }
  console.log('');
  console.log('  CONTABILIDADE');
  for (const [k, v] of Object.entries(resultado.resumo)) {
    console.log(`    ${k.padEnd(18)} ${v}`);
  }
  return resultado.ok ? 0 : 1;
}
