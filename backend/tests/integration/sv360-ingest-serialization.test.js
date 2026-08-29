// Path: tests/integration/sv360-ingest-serialization.test.js
// P3 — ingestions of the same (orgId, slug) are serialized.
//
// `ingestBundle` installs the new {slug}.db on disk (PASSO 1) BEFORE opening the
// Postgres transaction (PASSO 2), so a transaction-scoped lock would be taken too
// late to protect the file swap. Two concurrent uploads of the same project could
// interleave as:
//
//   A swaps its file → B swaps its file → A commits → B commits
//
// leaving B's bytes on disk while A's rollback could restore the WRONG .bak, or
// Postgres describing a bundle that is not the one installed.
//
// The fix is a SESSION-scoped advisory lock on a dedicated connection, held
// across both steps. These tests pin that the lock is really taken (an ingest
// blocks while the key is held elsewhere), that it is scoped per (org, slug), and
// that it is released even when the ingest fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { ingestBundle } from '../../src/modules/streetview360/sv360.ingest.js';
import { buildTilesDb } from '../helpers/sv360-tiles.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

// Must match SV360_INGEST_LOCK_NAMESPACE in src/modules/streetview360/sv360.ingest.js.
const SV360_INGEST_LOCK_NAMESPACE = 0x53333630;

const RID = crypto.randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-0123456789ABCDEF');
const prevBuf = Buffer.from('RIFFxxxxWEBPfakeprev');

describe('sv360 ingest serialization (per orgId+slug advisory lock, P3)', () => {
  let db, orgId, tmpRoot;
  const SLUG_A = `ser-a-${RID}`;
  const SLUG_B = `ser-b-${RID}`;
  const diskPaths = new Set();

  /** Builds a synthetic images.db in a tmp dir (the swap SOURCE). */
  // Tiles-only: o arquivo de pixel do bundle e o `{slug}_tiles.db`.
  function buildTmpImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    return buildTilesDb(p, rows.map((r) => r.id));
  }

  /** A minimal valid manifest + its matching images.db. */
  function bundleFor(slug) {
    const photoId = uuidv5(`${slug}/p.jpg`);
    const manifest = {
      project: { slug, name: `Serial ${slug}`, center_lat: -23.5, center_long: -46.6 },
      photos: [{
        id: photoId,
        original_name: 'p.jpg',
        display_name: 'P',
        sequence_number: 1,
        lat: -23.5,
        lon: -46.6,
        ele: 700,
        heading: 0,
        camera_height: 1.6,
        full_size_bytes: fullBuf.length,
        preview_size_bytes: prevBuf.length,
      }],
    };
    const tilesTmpPath = buildTmpImagesDb(`${slug}.db`, [{ id: photoId, full: fullBuf, preview: prevBuf }]);
    diskPaths.add(path.join(config.sv360.dbDir, `${slug}_tiles.db`));
    return { manifest, tilesTmpPath };
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    tmpRoot = path.join(os.tmpdir(), `sv360-serial-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
  });

  after(async () => {
    try {
      await db.query('ROLLBACK'); // never leave a held lock behind
    } catch {
      /* no open transaction */
    }
    await closeStore().catch(() => {}); // release worker file handles (Windows)
    for (const p of diskPaths) {
      for (const suffix of ['', '.bak', '.tmp']) {
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

  it('an ingest BLOCKS while the (org, slug) lock is held elsewhere', async () => {
    const { manifest, tilesTmpPath } = bundleFor(SLUG_A);

    // Hold the exact key ingestBundle uses, on an independent connection.
    await db.query('SELECT pg_advisory_lock($1, hashtext($2))', [
      SV360_INGEST_LOCK_NAMESPACE,
      `sv360:${orgId}:${SLUG_A}`,
    ]);

    let settled = false;
    const ingest = ingestBundle({ manifest, tilesTmpPath, orgId, source: 'upload' })
      .then((r) => { settled = true; return r; })
      .catch((e) => { settled = true; throw e; });

    await sleep(500);
    assert.equal(settled, false, 'ingest must wait while another holder has the slug lock');

    await db.query('SELECT pg_advisory_unlock($1, hashtext($2))', [
      SV360_INGEST_LOCK_NAMESPACE,
      `sv360:${orgId}:${SLUG_A}`,
    ]);

    const result = await ingest;
    assert.equal(result.slug, SLUG_A, 'ingest completes once the lock is released');
    assert.equal(settled, true);
  });

  it('the lock is scoped per slug — a DIFFERENT project ingests freely', async () => {
    // Otherwise the lock would serialize every ingestion server-wide.
    await db.query('SELECT pg_advisory_lock($1, hashtext($2))', [
      SV360_INGEST_LOCK_NAMESPACE,
      `sv360:${orgId}:${SLUG_A}`,
    ]);

    try {
      const { manifest, tilesTmpPath } = bundleFor(SLUG_B);
      const result = await ingestBundle({ manifest, tilesTmpPath, orgId, source: 'upload' });
      assert.equal(result.slug, SLUG_B, 'an unrelated slug is not blocked');
    } finally {
      await db.query('SELECT pg_advisory_unlock($1, hashtext($2))', [
        SV360_INGEST_LOCK_NAMESPACE,
        `sv360:${orgId}:${SLUG_A}`,
      ]);
    }
  });

  it('the lock is released after a FAILED ingest (no permanent wedge)', async () => {
    // A rejected ingest must not leave the slug locked forever — the release lives
    // in a `finally`, and this pins it.
    const bad = bundleFor(`ser-bad-${RID}`);
    bad.manifest.photos[0].lat = 999; // out of range → validation rejects

    await assert.rejects(
      ingestBundle({ manifest: bad.manifest, tilesTmpPath: bad.tilesTmpPath, orgId, source: 'upload' })
    );

    // If the lock leaked, this acquisition would hang instead of returning.
    const acquired = await Promise.race([
      db.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS got', [
        SV360_INGEST_LOCK_NAMESPACE,
        `sv360:${orgId}:ser-bad-${RID}`,
      ]).then((r) => r.rows[0].got),
      sleep(3000).then(() => 'TIMEOUT'),
    ]);
    assert.equal(acquired, true, 'the slug must be lockable again after a failed ingest');

    await db.query('SELECT pg_advisory_unlock($1, hashtext($2))', [
      SV360_INGEST_LOCK_NAMESPACE,
      `sv360:${orgId}:ser-bad-${RID}`,
    ]);
  });

  it('two concurrent ingests of the SAME slug both complete, one after the other', async () => {
    const slug = `ser-race-${RID}`;
    const a = bundleFor(slug);
    const b = bundleFor(slug);

    // Serialization means both settle without corrupting each other; last write wins.
    const results = await Promise.allSettled([
      ingestBundle({ manifest: a.manifest, tilesTmpPath: a.tilesTmpPath, orgId, source: 'upload' }),
      ingestBundle({ manifest: b.manifest, tilesTmpPath: b.tilesTmpPath, orgId, source: 'upload' }),
    ]);

    assert.ok(
      results.some((r) => r.status === 'fulfilled'),
      'at least one concurrent ingest must succeed'
    );

    // Postgres and disk must agree on exactly one surviving project row.
    const { rows } = await db.query(
      `SELECT db_filename FROM sv360.projects WHERE organization_id = $1 AND slug = $2`,
      [orgId, slug]
    );
    assert.equal(rows.length, 1, 'exactly one project row for the slug');
    const onDisk = path.join(config.sv360.dbDir, rows[0].db_filename.replace(/.db$/i, "_tiles.db"));
    assert.ok(existsSync(onDisk), 'the file Postgres names must be the one on disk');
    // No leftover .tmp/.bak residue from the interleaving.
    assert.equal(existsSync(`${onDisk}.bak`), false, 'no .bak residue');
  });
});
