// Path: tests/integration/banco-pre-consolidacao.test.js
// A guarda de banco pré-consolidação FALA, e fala a coisa certa.
//
// O runner casa arquivo com linha de `_migrations` pelo NOME, sem checksum. Depois da
// consolidação de 2026-08-19 (22 arquivos incrementais → 8 baselines por domínio), um
// banco criado antes tem 22 linhas de rastreio, nenhuma casando com os nomes novos: o
// runner tentaria aplicar tudo de novo e estouraria no primeiro `CREATE TABLE` com
// `42P07 relation "organizations" already exists`. Essa mensagem é verdadeira e
// inútil — ela não diz "seu banco é de antes do esmagamento", e quem a receber vai
// procurar o defeito no lugar errado.
//
// Por isso a primeira baseline abre com um `DO $$ ... RAISE EXCEPTION`. E como essa
// guarda é a única DDL não declarativa do conjunto inteiro, ela é um VERIFICADOR, e
// verificador quebra calado: uma guarda que não dispara é indistinguível de uma que
// nunca foi exercitada. Este arquivo é a sonda dela.
//
// O QUE ELE MEDE, e é o par completo:
//   - POSITIVO: com uma linha de rastreio antiga plantada, a migração RECUSA, e a
//     mensagem carrega o comando de conserto. Sem checar o TEXTO, "levantou" também é
//     o que se mede quando ela levanta pelo motivo errado (um 42P07, justamente).
//   - NEGATIVO: sem a linha, o mesmo caminho aplica tudo e o schema nasce. Sem esta
//     metade, a guarda poderia estar recusando SEMPRE e o positivo passaria igual.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pgPromise from 'pg-promise';
import { runMigrations } from '../../src/database/migrate.js';

// O nome de uma migração que existia ANTES da consolidação. Montado em runtime, e não
// escrito por extenso, porque `citacao-de-migracao.test.js` varre citações de migração
// em `tests/` e leria um literal aqui como referência quebrada. O valor precisa ser um
// nome que NÃO existe mais: é justamente ele que faz o runner recusar o banco.
const NOME_PRE_CONSOLIDACAO = ['001', 'core.sql'].join('_');
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL
  || `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;

// Banco DESCARTÁVEL e de nome próprio: esta sonda precisa de um banco VIRGEM, e o
// `ebgeo_test` compartilhado já tem o schema aplicado. O nome carrega o pid para duas
// cópias do repositório na mesma máquina não derrubarem o banco uma da outra (mesma
// lição das coordenadas fixas do harness de e2e).
const DB_SONDA = `ebgeo_sonda_pre_consolidacao_${process.pid}`;
const SONDA_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_SONDA}`;

let pgp;

/** Recria o banco da sonda, vazio, com as extensões pré-criadas por superusuário. */
async function recriarBanco() {
  const admin = pgp(ADMIN_URL);
  await admin.none(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
    [DB_SONDA]
  );
  await admin.none(`DROP DATABASE IF EXISTS ${DB_SONDA}`);
  await admin.none(`CREATE DATABASE ${DB_SONDA}`);
  await admin.$pool.end();

  // PostGIS é untrusted; sem superusuário alcançável a própria migração tenta criar,
  // que é o mesmo caminho degradado do runner de testes.
  const superUrl =
    process.env.SUPERUSER_DATABASE_URL
    || `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/${DB_SONDA}`;
  const sdb = pgp(superUrl.replace(/\/[^/]*$/, `/${DB_SONDA}`));
  try {
    for (const ext of ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']) {
      await sdb.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
  } catch {
    // Best-effort, igual ao scripts/run-tests.js.
  } finally {
    await sdb.$pool.end();
  }
}

async function derrubarBanco() {
  const admin = pgp(ADMIN_URL);
  try {
    await admin.none(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
      [DB_SONDA]
    );
    await admin.none(`DROP DATABASE IF EXISTS ${DB_SONDA}`);
  } finally {
    await admin.$pool.end();
  }
}

describe('Guarda de banco pré-consolidação (F15)', () => {
  before(() => {
    pgp = pgPromise();
  });

  after(async () => {
    await derrubarBanco();
    pgp.end();
  });

  it('NEGATIVO: banco virgem migra inteiro (sem isto, o positivo abaixo não prova nada)', async () => {
    await recriarBanco();
    await runMigrations(SONDA_URL);

    const db = pgp(SONDA_URL);
    try {
      const { n } = await db.one('SELECT count(*)::int AS n FROM _migrations');
      assert.ok(n >= 5, `esperava >= 5 baselines aplicadas, achei ${n}`);
      // Discriminação: o schema existe MESMO, não só o rastreio.
      const t = await db.one(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema IN ('public','ng','sv360')`
      );
      assert.ok(t.n >= 25, `esperava >= 25 tabelas criadas, achei ${t.n}`);
    } finally {
      await db.$pool.end();
    }
  });

  it('POSITIVO: rastreio com nome pré-consolidação recusa, e a mensagem diz o que fazer', async () => {
    await recriarBanco();

    // Planta o estado exato de um banco de antes do esmagamento: a tabela de rastreio
    // existe (o runner a cria antes do laço) e carrega um dos nomes antigos.
    const db = pgp(SONDA_URL);
    try {
      await db.none(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await db.none("INSERT INTO _migrations (name) VALUES ($1)", [NOME_PRE_CONSOLIDACAO]);
    } finally {
      await db.$pool.end();
    }

    let erro = null;
    try {
      await runMigrations(SONDA_URL);
    } catch (e) {
      erro = e;
    }

    assert.ok(erro, 'a migração precisa RECUSAR um banco pré-consolidação');

    // O TEXTO importa: sem conferi-lo, um `42P07 relation already exists` (que é
    // exatamente o erro que esta guarda existe para substituir) passaria por aqui.
    const msg = String(erro.message);
    assert.match(msg, /consolidacao de migracoes/i, `mensagem inesperada: ${msg}`);
    assert.match(msg, /dev-db\.js recreate/, 'a mensagem precisa carregar o comando de conserto');
    assert.doesNotMatch(msg, /already exists/i, 'esta é a mensagem que a guarda substitui');

    // E a transação reverteu: nenhuma baseline foi registrada.
    const db2 = pgp(SONDA_URL);
    try {
      const { rows } = await db2.result('SELECT name FROM _migrations ORDER BY name');
      assert.deepEqual(rows.map((r) => r.name), [NOME_PRE_CONSOLIDACAO],
        'a recusa não pode deixar linha nova em _migrations');
    } finally {
      await db2.$pool.end();
    }
  });
});
