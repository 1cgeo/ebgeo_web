// Path: tests/bench/lib/populacao.mjs
//
// Seeds a THOUSAND-user population and hands the coordinator the room map.
//
// THE SHAPE OF THE POPULATION IS THE EXPERIMENT. One room of a hundred, one of fifty, one of
// twenty, one of ten, and then a long tail of four and five: that is what a real deployment looks
// like, and it is also the only shape that can answer the question worth asking. A flat thousand
// users over a thousand rooms would measure the pool; a flat thousand over one room would measure
// nothing anybody has. Every metric downstream is reported BY ROOM SIZE, because an average over
// a hundred and eighty-four rooms hides the one room that matters.
//
// LOGIN IS PARALLEL HERE, AND THAT IS A DEPARTURE. `semear.mjs` logs users in serially on purpose,
// to keep bcrypt out of the pool right before a measurement. At a thousand users that costs
// minutes of wall clock, and it happens well before the steady-state window opens, so a bounded
// concurrency is the right trade. The bound stays small so the pool is not saturated for so long
// that the server's own warm-up is distorted.

import pg from 'pg';
import { randomUUID } from 'crypto';
import { createUser, createAtlas, createMap, createShare } from '../../helpers/fixtures.js';
import { DSN_PADRAO } from './semear.mjs';

const SENHA = 'Bench@1234';

/** The default 1000-user shape: 100 + 50 + 20 + 10 + 100x5 + 160x2. */
export const DISTRIBUICAO_PADRAO = [
  { tamanho: 100, quantidade: 1 },
  { tamanho: 50, quantidade: 1 },
  { tamanho: 20, quantidade: 1 },
  { tamanho: 10, quantidade: 1 },
  { tamanho: 5, quantidade: 100 },
  { tamanho: 2, quantidade: 160 },
];

export function totalDeUsuarios(distribuicao) {
  return distribuicao.reduce((s, d) => s + d.tamanho * d.quantidade, 0);
}

/**
 * Creates every user, atlas, map and share.
 *
 * A user belongs to exactly ONE room. Real people do open several atlases, but a user in two
 * rooms would make the per-room breakdown ambiguous, and ambiguity in the axis under test is
 * worse than a small loss of realism.
 *
 * @param {Object} opts
 * @param {string} [opts.dsn]
 * @param {Array<{tamanho: number, quantidade: number}>} opts.distribuicao
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{ dono: Object, salas: Array }>}
 */
export async function semearPopulacao({ dsn = DSN_PADRAO, distribuicao, log = () => {} } = {}) {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    const dono = await createUser(db, {
      username: `bench_dono_${randomUUID().slice(0, 8)}`,
      password: SENHA,
      nome: 'Dono da populacao',
    });

    const salas = [];
    let criados = 0;
    const total = totalDeUsuarios(distribuicao);

    for (const faixa of distribuicao) {
      for (let n = 0; n < faixa.quantidade; n += 1) {
        const atlas = await createAtlas(db, dono.id, {
          name: `Sala de ${faixa.tamanho} #${n}`,
        });
        const mapa = await createMap(db, atlas.id, { name: 'Mapa unico' });

        const usuarios = [];
        for (let u = 0; u < faixa.tamanho; u += 1) {
          const usuario = await createUser(db, {
            username: `bench_u${criados}_${randomUUID().slice(0, 6)}`,
            password: SENHA,
            nome: `Usuario ${criados}`,
          });
          await createShare(db, atlas.id, usuario.id, 'write', dono.id);
          usuarios.push(usuario);
          criados += 1;
          if (criados % 100 === 0) log(`  semeados ${criados}/${total} usuarios`);
        }

        salas.push({
          atlasId: atlas.id,
          mapId: mapa.id,
          tamanho: faixa.tamanho,
          usuarios,
        });
      }
    }

    return { dono, salas, senha: SENHA };
  } finally {
    await db.end().catch(() => {});
  }
}

/**
 * Logs everybody in, with bounded concurrency, and returns a token per user id.
 *
 * A failure here is fatal to the run and says so: a population test missing a tenth of its users
 * is a different experiment, not a slightly noisier one.
 */
export async function autenticarPopulacao({
  base, salas, senha = SENHA, concorrencia = 12, log = () => {},
}) {
  const todos = salas.flatMap((s) => s.usuarios);
  const tokens = new Map();
  let proximo = 0;
  let feitos = 0;

  const trabalhar = async () => {
    while (proximo < todos.length) {
      const u = todos[proximo];
      proximo += 1;
      const r = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: u.username, password: senha }),
      });
      const corpo = await r.json().catch(() => null);
      if (r.status !== 200) {
        throw new Error(`Login falhou para ${u.username}: ${r.status} ${JSON.stringify(corpo)}`);
      }
      tokens.set(u.id, corpo.data.accessToken);
      feitos += 1;
      if (feitos % 200 === 0) log(`  autenticados ${feitos}/${todos.length}`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concorrencia, todos.length) }, trabalhar)
  );
  return tokens;
}

/**
 * Splits the population across driver processes.
 *
 * ROOMS ARE DEALT ROUND-ROBIN, MEMBER BY MEMBER, so a single room's members land on several
 * workers. The alternative (one room per worker) would put the hundred-person room alone on one
 * process, and that process — not the server — would be the first thing to saturate.
 *
 * The FIRST member of each room is its observer: it timestamps every operation it receives, which
 * is how delivery lag is measured. One per room is enough, and doing it on all of them would cost
 * more than the load itself.
 */
export function fatiar({ salas, tokens, trabalhadores }) {
  const fatias = Array.from({ length: trabalhadores }, () => []);
  let i = 0;
  for (const sala of salas) {
    sala.usuarios.forEach((u, indice) => {
      fatias[i % trabalhadores].push({
        atlasId: sala.atlasId,
        mapId: sala.mapId,
        tamanhoSala: sala.tamanho,
        token: tokens.get(u.id),
        observador: indice === 0,
      });
      i += 1;
    });
  }
  return fatias;
}
