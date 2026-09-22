// Path: tests/integration/catalogo-semente-imagens-existem.test.js
// Every basemap thumbnail the migrations SEED, as the database holds it after ALL of them ran,
// names a file that exists under `frontend/public/`.
//
// WHY IT EXISTS. The catalog baseline seeded the three basemap thumbnails as
// `./images/layers/*-thumb.png`, while the files in `frontend/public/images/layers/` were always
// `.webp`. Nothing failed: the value is served verbatim in `GET /api/config`, the selector asks
// for it, and the browser gets a 404 per basemap (measured on the test stack on 2026-09-22,
// 134 requests in four days). A seeded path is data that crosses the package boundary, so
// neither package's suite looked at it.
//
// WHY IT READS THE DATABASE AND NOT THE `.sql` TEXT. Since 2026-09-22 the baselines are frozen
// (the test stack on the server already applied them) and the fix lives in a LATER numbered
// migration that rewrites the seeded value. Reading the baseline text would measure a value
// the database no longer serves; the only honest measure is the row after the migrator ran.
//
// WHAT IT DOES NOT CATCH: an image path an administrator edits later (that is data, not seed),
// and a thumbnail for a basemap seeded outside the migrations.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(BACKEND, '../frontend/public');
const CATALOG_BASELINE = path.join(BACKEND, 'src/database/migrations/005_catalogo.sql');

/** A quoted, app-relative path to an image file. */
const RE_IMAGE_PATH = /^(?:\.\/|\/)?images\/\S+\.(?:png|webp|jpe?g|gif|svg|avif)$/i;

/**
 * The basemap ids seeded by the catalog baseline, read from its INSERT so that a seed added
 * there is covered without editing this file.
 * @returns {string[]}
 */
function seededBasemapIds() {
  const sql = fs.readFileSync(CATALOG_BASELINE, 'utf8');
  const insert = sql.slice(sql.indexOf('INSERT INTO basemaps'));
  const block = insert.slice(0, insert.indexOf(';'));
  return [...block.matchAll(/^\s*\('([a-z0-9-]+)',/gm)].map((m) => m[1]);
}

/** @param {string} seeded @returns {string} absolute path under frontend/public */
function publicFile(seeded) {
  return path.join(PUBLIC_DIR, seeded.replace(/^\.?\//, ''));
}

describe('basemap thumbnails seeded by the migrations, after all of them ran', () => {
  let db;

  before(async () => {
    ({ db } = await setupTestEnv());
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('the seed reader finds the basemaps of the catalog baseline (instrument control)', () => {
    const ids = seededBasemapIds();
    for (const id of ['carta-topografica', 'carta-ortoimagem', 'bdgex']) {
      assert.ok(ids.includes(id), `seed reader lost "${id}"; read: ${ids.join(', ')}`);
    }
  });

  it('every seeded thumbnail the database serves exists under frontend/public/', async () => {
    assert.ok(fs.existsSync(PUBLIC_DIR), `frontend/public not found at ${PUBLIC_DIR}`);
    const ids = seededBasemapIds();
    const { rows } = await db.query(
      "SELECT id, config->>'image' AS image FROM basemaps WHERE id = ANY($1) ORDER BY id",
      [ids],
    );
    const images = rows.filter((r) => typeof r.image === 'string' && RE_IMAGE_PATH.test(r.image));
    // Empty coverage would pass green: three seeded basemaps carry a thumbnail today.
    assert.ok(images.length >= 3, `expected at least three seeded thumbnails, found ${images.length}`);

    const missing = images
      .filter((r) => !fs.existsSync(publicFile(r.image)))
      .map((r) => `${r.id}: ${r.image}`);
    assert.deepEqual(missing, [], `seeded thumbnails with no file under frontend/public/:\n${missing.join('\n')}`);
  });
});
