// Path: tests/integration/sv360-ingest-lock-timeout.repro.test.js
// REGRESSÃO — achado #18: o `pg_advisory_lock` da ingestão 360 esperava SEM
// `lock_timeout`, retendo uma conexão do pool indefinidamente.
//
// Causa raiz: `ingestBundle` abre um `task()` (= uma conexão TOMADA DO POOL) e
// chama `SELECT pg_advisory_lock($1, hashtext($2))` sem limite de tempo. Enquanto
// espera, a conexão fica presa. Com `config.db.poolMax` = 10, dez uploads
// concorrentes do MESMO (org, slug) esgotam o pool e TODA a API para — inclusive
// `GET /api/config`, que é fail-fast no boot do frontend.
//
// É recorrência da lição registrada no livro-razão (2026-07-18): o push de sync
// tomava advisory lock sem timeout e um cliente sozinho esgotava o pool; lá a
// correção foi `SET LOCAL lock_timeout` + mapear SQLSTATE 55P03 para
// `ServiceUnavailableError` (503 retentável). A ingestão 360 não herdou a proteção.
//
// Nota: aqui o lock é de SESSÃO (não `pg_advisory_xact_lock`) porque a ordem real
// da ingestão é swap do ARQUIVO primeiro (PASSO 1) e transação do Postgres depois
// (PASSO 2) — um lock transacional seria tomado tarde demais para proteger o swap.
// Por isso o `lock_timeout` é aplicado numa transação curta que envolve APENAS a
// aquisição: o `SET LOCAL` é revertido no COMMIT (nada vaza para a conexão do
// pool) enquanto o lock de sessão sobrevive ao commit.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { task } from '../../src/database/index.js';
import { ingestBundle } from '../../src/modules/streetview360/sv360.ingest.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

// Deve casar com SV360_INGEST_LOCK_NAMESPACE em src/modules/streetview360/sv360.ingest.js.
const SV360_INGEST_LOCK_NAMESPACE = 0x53333630;

const RID = randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Teto do teste: MAIOR que o lock_timeout da ingestão (5s) e menor que qualquer
// espera "infinita". Sem o fix a ingestão nunca resolve e a corrida vira 'HUNG'.
const HANG_DEADLINE_MS = 12000;

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const fullBuf = Buffer.from('RIFFxxxxWEBP-locktimeout-full-0123456789');
const prevBuf = Buffer.from('RIFFxxxxWEBP-locktimeout-prev');

describe('sv360 ingest — advisory lock com lock_timeout (#18)', () => {
  let db, orgId, tmpRoot;
  const SLUG = `lockto-${RID}`;
  const diskPaths = new Set();

  function bundle() {
    const photoId = uuidv5(`${SLUG}/p.jpg`);
    const manifest = {
      schemaVersion: 1,
      project: { slug: SLUG, name: `Lock ${SLUG}`, center_lat: -23.5, center_long: -46.6 },
      photos: [
        {
          id: photoId,
          original_name: `${SLUG}.jpg`,
          display_name: SLUG,
          sequence_number: 1,
          lat: -23.5,
          lon: -46.6,
          ele: 700,
          heading: 0,
          camera_height: 1.6,
          full_size_bytes: fullBuf.length,
          preview_size_bytes: prevBuf.length,
        },
      ],
      targets: [],
      deleted_photos: [],
    };
    const p = path.join(tmpRoot, `${SLUG}-${randomUUID().slice(0, 4)}.db`);
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, fullBuf, prevBuf);
    sdb.close();
    diskPaths.add(path.resolve(config.sv360.dbDir, `${orgId}__${SLUG}.db`));
    return { manifest, dbTmpPath: p };
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    tmpRoot = path.join(os.tmpdir(), `sv360-lockto-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
  });

  after(async () => {
    try {
      await db.query('SELECT pg_advisory_unlock_all()');
    } catch {
      /* best effort */
    }
    await closeStore().catch(() => {});
    for (const p of diskPaths) {
      for (const suffix of ['', '.bak', '.tmp', '-wal', '-shm']) {
        try {
          rmSync(p + suffix, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    await teardownTestEnv(db);
  });

  it('a ingestão bloqueada no lock FALHA com 503 em vez de reter a conexão para sempre', async () => {
    const { manifest, dbTmpPath } = bundle();
    const destPath = path.resolve(config.sv360.dbDir, `${orgId}__${SLUG}.db`);

    // Um contendor segura a chave exata da ingestão numa conexão independente.
    await db.query('SELECT pg_advisory_lock($1, hashtext($2))', [
      SV360_INGEST_LOCK_NAMESPACE,
      `sv360:${orgId}:${SLUG}`,
    ]);

    try {
      const outcome = await Promise.race([
        ingestBundle({ manifest, dbTmpPath, orgId, source: 'upload' }).then(
          () => 'RESOLVED',
          (err) => err
        ),
        sleep(HANG_DEADLINE_MS).then(() => 'HUNG'),
      ]);

      assert.notEqual(
        outcome,
        'HUNG',
        'a ingestão não pode esperar indefinidamente segurando uma conexão do pool'
      );
      assert.notEqual(outcome, 'RESOLVED', 'a ingestão não pode passar por cima do lock alheio');
      assert.equal(
        outcome.statusCode,
        503,
        'contenção deve virar 503 retentável (ServiceUnavailableError), não 500'
      );
      assert.match(String(outcome.message), /ocupad|Tente novamente/i);

      // O timeout dispara ANTES do PASSO 1: nada foi escrito no disco.
      assert.equal(existsSync(destPath), false, 'nenhum {slug}.db instalado no caminho abortado');
      assert.equal(existsSync(`${destPath}.tmp`), false, 'nenhum resíduo .tmp');
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, hashtext($2))', [
        SV360_INGEST_LOCK_NAMESPACE,
        `sv360:${orgId}:${SLUG}`,
      ]);
    }
  });

  it('o lock_timeout não vaza para as conexões do pool', async () => {
    // O GUC é de SESSÃO: se fosse setado com `SET` puro e não revertido, a conexão
    // voltaria ao pool com lock_timeout=5s e queries alheias passariam a estourar
    // 55P03 espúrio. Amostra várias conexões simultâneas do pool do app.
    const probes = await Promise.all(
      Array.from({ length: 8 }, () =>
        task(async (c) => {
          const row = await c.one('SHOW lock_timeout');
          await sleep(50); // segura a conexão para forçar conexões distintas
          return row.lock_timeout;
        })
      )
    );
    for (const value of probes) {
      assert.equal(value, '0', 'lock_timeout deve permanecer no default da sessão do pool');
    }
  });

  it('sem contenção a ingestão continua funcionando normalmente', async () => {
    const { manifest, dbTmpPath } = bundle();
    const result = await ingestBundle({ manifest, dbTmpPath, orgId, source: 'upload' });
    assert.equal(result.slug, SLUG);
    assert.equal(result.photoCount, 1);
  });
});
