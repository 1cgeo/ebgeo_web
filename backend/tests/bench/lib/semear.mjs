// Path: tests/bench/lib/semear.mjs
//
// Builds the bench database and its cast: writers, atlases, maps, shares, tokens.
//
// SEEDING GOES THROUGH SQL, NEVER THROUGH THE API. Creating thirty atlases over HTTP would put
// the setup on the same clock as the measurement, and setup is not what we are measuring. The
// factories in `tests/helpers/fixtures.js` already write these rows correctly (they know about
// `map_order`, the rank FK and the `users_producer_scope_check` bicondicional), and they accept
// any handle with `.query(sql, params)` — a plain `pg.Client` is exactly that. Reusing them
// means a schema change breaks the suite and the bench together instead of only the suite.
//
// TOKENS ARE MINTED BY THE REAL LOGIN ROUTE, ONCE PER WRITER. Signing JWTs here would duplicate
// the issuer and drift from it silently. One login per user is also well inside `authLimiter`,
// which is keyed by ip+username — and in any case the bench server runs with the limiters off.
//
// THE DATABASE IS DEDICATED, AND THAT IS NOT A PREFERENCE. Two runs sharing a database truncate
// each other's rows, and the failure looks like a defect in the code under test. The default
// name below is used by nothing else in this repository.

import pg from 'pg';
import { randomUUID } from 'crypto';
import {
  createUser,
  createAtlas,
  createMap,
  createShare,
  createFeature,
} from '../../helpers/fixtures.js';

export const DSN_PADRAO =
  process.env.BENCH_DATABASE_URL
  || 'postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_bench_escrita';

const SENHA = 'Bench@1234';

/**
 * Creates the bench database (dropping it first when `recriar`) and applies migrations.
 *
 * `recriar` is the default because a write bench COUNTS rows: reconciliation compares the op
 * ids a writer claims to have sent against the `operations` table, and leftovers from an
 * earlier run would make that comparison meaningless.
 */
export async function prepararBanco({ dsn = DSN_PADRAO, recriar = true } = {}) {
  const url = new URL(dsn);
  const nome = url.pathname.replace(/^\//, '');
  const admin = new pg.Client({
    connectionString: `${url.protocol}//${url.username}:${url.password}@${url.host}/postgres`,
  });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
    if (rows.length > 0 && recriar) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [nome]
      );
      await admin.query(`DROP DATABASE ${nome}`);
    }
    if (rows.length === 0 || recriar) {
      await admin.query(`CREATE DATABASE ${nome}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }

  // Imported late and by URL: `src/database/migrate.js` pulls in `config.js`, which calls
  // `required('DATABASE_URL')` at module evaluation. Importing it before the variable is set
  // would abort the bench with a configuration error that has nothing to do with the bench.
  process.env.DATABASE_URL = dsn;
  const { runMigrations } = await import('../../../src/database/migrate.js');
  await runMigrations(dsn);
  return dsn;
}

/**
 * Seeds the cast for a scenario.
 *
 * Every writer gets `write` on every atlas, because the axis under test is CONTENTION, not
 * authorization. A writer denied by permission would show up as a fast 403 and quietly lower
 * the very latency the bench exists to raise.
 *
 * @param {Object} opts
 * @param {string} [opts.dsn]
 * @param {number} opts.escritores - How many writing users.
 * @param {number} [opts.atlas=1] - How many atlases they share.
 * @param {number} [opts.mapasPorAtlas=1]
 * @param {number} [opts.leitores=0] - Extra users with `read`, for the fan-out scenario.
 */
export async function semearCenario({
  dsn = DSN_PADRAO,
  escritores,
  atlas: quantosAtlas = 1,
  mapasPorAtlas = 1,
  leitores = 0,
} = {}) {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    const dono = await createUser(db, {
      username: `bench_dono_${randomUUID().slice(0, 8)}`,
      password: SENHA,
      nome: 'Dono da bancada',
    });

    const usuarios = [];
    for (let i = 0; i < escritores; i += 1) {
      usuarios.push(
        await createUser(db, {
          username: `bench_w${i}_${randomUUID().slice(0, 8)}`,
          password: SENHA,
          nome: `Escritor ${i}`,
        })
      );
    }

    const espectadores = [];
    for (let i = 0; i < leitores; i += 1) {
      espectadores.push(
        await createUser(db, {
          username: `bench_r${i}_${randomUUID().slice(0, 8)}`,
          password: SENHA,
          nome: `Leitor ${i}`,
        })
      );
    }

    const atlasSemeados = [];
    for (let a = 0; a < quantosAtlas; a += 1) {
      const atlas = await createAtlas(db, dono.id, { name: `Bench atlas ${a}` });
      const mapas = [];
      for (let m = 0; m < mapasPorAtlas; m += 1) {
        mapas.push(await createMap(db, atlas.id, { name: `Bench mapa ${a}.${m}` }));
      }
      for (const u of usuarios) await createShare(db, atlas.id, u.id, 'write', dono.id);
      for (const u of espectadores) await createShare(db, atlas.id, u.id, 'read', dono.id);
      atlasSemeados.push({ id: atlas.id, mapas: mapas.map((m) => m.id) });
    }

    return { dono, usuarios, espectadores, atlas: atlasSemeados, senha: SENHA };
  } finally {
    await db.end().catch(() => {});
  }
}

/**
 * Exchanges credentials for access tokens through the live server.
 *
 * Serial on purpose: bcrypt at the configured cost is the slowest thing in the login path, and
 * firing thirty of them at once would warm the pool with work that has nothing to do with the
 * measurement that follows.
 */
export async function autenticar(base, usuarios, senha = SENHA) {
  const tokens = [];
  for (const u of usuarios) {
    const r = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u.username, password: senha }),
    });
    const corpo = await r.json();
    if (r.status !== 200) {
      throw new Error(`Login falhou para ${u.username}: ${r.status} ${JSON.stringify(corpo)}`);
    }
    tokens.push({ usuario: u, token: corpo.data.accessToken });
  }
  return tokens;
}

/**
 * Creates ONE more atlas for an existing cast, shared with everybody.
 *
 * WHY EVERY DEGRAU DESERVES A VIRGIN ATLAS. Reusing one atlas across degraus makes the ledger
 * grow monotonically, so the last degrau writes against a table several times larger than the
 * first one did. The report would then show latency rising with the number of writers when part
 * of the rise is only the table. A fresh atlas per degrau removes that confound; E6 is the one
 * scenario that WANTS the table to grow, and it says so.
 *
 * @param {Object} opts
 * @param {string} [opts.dsn]
 * @param {Object} opts.cenario - The value returned by `semearCenario`.
 * @param {string} [opts.nome]
 * @param {number} [opts.mapas=1]
 */
export async function novoAtlas({ dsn = DSN_PADRAO, cenario, nome, mapas = 1 } = {}) {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    const atlas = await createAtlas(db, cenario.dono.id, {
      name: nome ?? `Bench atlas ${randomUUID().slice(0, 6)}`,
    });
    const criados = [];
    for (let m = 0; m < mapas; m += 1) {
      criados.push(await createMap(db, atlas.id, { name: `Mapa ${m}` }));
    }
    for (const u of cenario.usuarios) {
      await createShare(db, atlas.id, u.id, 'write', cenario.dono.id);
    }
    for (const u of cenario.espectadores) {
      await createShare(db, atlas.id, u.id, 'read', cenario.dono.id);
    }
    return { id: atlas.id, mapas: criados.map((m) => m.id) };
  } finally {
    await db.end().catch(() => {});
  }
}

/**
 * Seeds features straight into a map, returning their ids.
 *
 * E7 needs rows that already EXIST so its writers can contend for them with `update` ops. An
 * update whose target does not exist is a different code path (the EXISTS guard, zero rows
 * affected), and measuring that instead of contention would be measuring nothing.
 */
export async function semearFeicoes({ dsn = DSN_PADRAO, mapId, quantidade }) {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    const ids = [];
    for (let i = 0; i < quantidade; i += 1) {
      const f = await createFeature(db, mapId, {
        properties: { nome: `Alvo ${i}`, descricao: 'alvo de contenda', visivel: true },
      });
      ids.push(f.id);
    }
    return ids;
  } finally {
    await db.end().catch(() => {});
  }
}
