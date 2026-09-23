// Path: tests/bench/escrita-conflito.bench.mjs
//
// E7 — TODOS EDITANDO AS MESMAS FEICOES. O custo da contenda de linha, e quem ganha no fim.
//
// Rode a mao:
//   node tests/bench/escrita-conflito.bench.mjs
//   node tests/bench/escrita-conflito.bench.mjs --escritores 8 --alvos 20 --lotes 20 --ops 20
//
// Both stages submit protocol-v2 patches to existing features. Each writer observes its
// initial entity versions through the real snapshot and advances them only from server receipts.
// Shared targets therefore exercise both accepted edits and explicit field conflicts; the
// refusal rate is a result, not lost data and not an invisible last-writer-wins overwrite.
//
// The database check compares each target with its last APPLIED operation. Conflicted edits
// have durable receipts but do not enter `operations` or overwrite the feature. The two stages
// have the same attempted push count, while snapshots and accepted/refused work can differ.
// This is a contention/consistency experiment, not a pure row-lock microbenchmark.
//
import { comBancada, medir, fechar, arg, aquecer } from './lib/bancada.mjs';
import {
  semearCenario, autenticar, novoAtlas, semearFeicoes, DSN_PADRAO,
} from './lib/semear.mjs';
import { escritorRest, criarRegistro } from './lib/escritor.mjs';
import { Serie } from './lib/metricas.mjs';
import pg from 'pg';

const ESCRITORES = arg('escritores', 8);
const ALVOS = arg('alvos', 20);
const LOTES = arg('lotes', 20);
const OPS = arg('ops', 20);

/**
 * Compares the converged row against the ledger's last arrival, target by target.
 *
 * The ledger is read on a FRESH connection, and the winner is decided by `server_version`, which
 * is the same order the server told every peer to converge to. Nothing here trusts an ack.
 */
async function conferirConvergencia({ dsn, atlasId, alvos }) {
  const cliente = new pg.Client({ connectionString: dsn });
  await cliente.connect();
  try {
    const { rows } = await cliente.query(
      `
      WITH ultima AS (
        SELECT DISTINCT ON (entity_id)
               entity_id,
               server_version,
               changes -> 'properties' ->> 'descricao' AS descricao_do_ledger
        FROM operations
        WHERE atlas_id = $1 AND entity_id = ANY($2::uuid[]) AND op_type = 'update'
        ORDER BY entity_id, server_version DESC
      )
      SELECT u.entity_id,
             u.server_version,
             u.descricao_do_ledger,
             f.properties ->> 'descricao' AS descricao_na_tabela
      FROM ultima u
      JOIN features f ON f.id = u.entity_id
      `,
      [atlasId, alvos]
    );
    const divergentes = rows.filter(
      (r) => r.descricao_do_ledger !== r.descricao_na_tabela
    );
    return { conferidos: rows.length, divergentes };
  } finally {
    await cliente.end().catch(() => {});
  }
}

await comBancada(
  {
    titulo: 'E7 — contenda de linha: alvos disjuntos contra alvos comuns',
    extraCabecalho: {
      escritores: ESCRITORES,
      alvosComuns: ALVOS,
      lotes: LOTES,
      opsPorLote: OPS,
    },
  },
  async (ctx) => {
    const cenario = await semearCenario({ dsn: DSN_PADRAO, escritores: ESCRITORES, atlas: 0 });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);

    const aquecimento = await novoAtlas({ cenario, nome: 'Aquecimento' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: aquecimento.id,
      mapId: aquecimento.mapas[0],
    });

    const resultados = [];
    const notasExtra = [];

    for (const modo of ['disjuntos', 'comuns']) {
      const atlas = await novoAtlas({ cenario, nome: `Alvos ${modo}` });
      const mapId = atlas.mapas[0];

      // O mesmo NUMERO de feicoes nos dois modos, para que a semeadura nao seja a diferenca.
      const total = ALVOS * (modo === 'disjuntos' ? ESCRITORES : 1);
      const feicoes = await semearFeicoes({ mapId, quantidade: total });

      const registro = criarRegistro();
      const serie = new Serie(modo);

      const tarefas = tokens.map(({ token }, i) => () =>
        escritorRest({
          base: ctx.base,
          token,
          atlasId: atlas.id,
          mapId,
          lotes: LOTES,
          opsPorLote: OPS,
          alvos: modo === 'comuns'
            ? feicoes
            : feicoes.slice(i * ALVOS, (i + 1) * ALVOS),
          serie,
          registro,
        })
      );

      const r = await medir({
        ctx,
        rotulo: modo,
        atlasIds: [atlas.id],
        registro,
        serie,
        tarefas,
      });

      const conv = await conferirConvergencia({
        dsn: ctx.dsn,
        atlasId: atlas.id,
        alvos: feicoes,
      });
      r.linha.convConferidos = conv.conferidos;
      r.linha.convDivergentes = conv.divergentes.length;
      // A convergencia entra na conta do codigo de saida: um estado final que nao corresponde a
      // nenhuma ordem de chegada e um defeito, nao um numero.
      if (conv.conferidos === 0 || conv.divergentes.length > 0) {
        r.reconciliacao.ok = false;
        r.reconciliacao.provas.push({
          nome: 'P5 estado aplicado conferido',
          ok: false,
          mensagem: `${conv.divergentes.length} de ${conv.conferidos} alvos nao batem com a ultima op do ledger`,
          amostra: conv.divergentes.slice(0, 5).map((d) => d.entity_id),
        });
        r.linha.provas = 'FALHA';
      }

      resultados.push(r);
      notasExtra.push(
        `${modo}: ${conv.conferidos} alvos conferidos contra o ledger, ${conv.divergentes.length} divergentes`
      );
      console.log(`  ... modo ${modo} concluido`);
    }

    const COLUNAS_E7 = [
      'degrau', 'lotes', 'ok', '503', 'p50', 'p95', 'p99', 'max',
      'lotes/s', 'ops/s', 'lockPico', 'conexPico',
      'convConferidos', 'convDivergentes', 'provas',
    ];

    return fechar(resultados, [
      'Os dois degraus tentam a mesma quantidade de patches v2, a partir de versoes realmente observadas.',
      'conflitos e o subconjunto de recusados que o protocolo preservou sem sobrescrever trabalho concorrente.',
      'Leituras iniciais e a proporcao de recusas mudam o trabalho efetivo: comparar latencias exige essas contagens.',
      'convConferidos deve ser positivo e convDivergentes zero: estado final igual a ultima op APLICADA.',
      ...notasExtra,
    ], COLUNAS_E7);
  }
);
