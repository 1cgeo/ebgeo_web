#!/usr/bin/env node
// Path: scripts/fp-scene-register.js
// Registers the first-person 3D scene of the Sala Historica General Malan in the
// `tilesets` catalog table, which is where GET /api/config reads the 3D acquis
// from. It is the operator-facing twin of typing the same JSON into the Painel do
// Administrador (aba Catalogo), and it exists only to spare that typing.
//
// WHY `tilesets` AND NOT A TABLE OF ITS OWN. The scene is discriminated inside the
// `config` JSONB by `viewer: 'firstPerson'`; `listTilesets()` spreads that config
// verbatim, so no schema, no migration and no new /api/config key are involved.
// Reusing the table also buys two behaviours for free that a separate section
// would have lost in silence: the per-atlas allowlist `available_3d_models`
// already filters `config.tilesets` by id, and `config.hasTilesets()` is what
// enables the "Modelos 3D" bottom control at all.
//
// WHY THIS IS A SCRIPT AND NOT A MIGRATION. The seeded demo tileset was removed and
// the rule settled in `005_catalogo.sql`: the catalog is a point of CONFIGURATION,
// never a place for seeded content. A migration runs in every environment, so a seeded
// scene would make every fresh install promise 28,6 MB of assets it does not
// have, and the failure is the silent one — the pin appears, the click 404s and
// the viewer falls back to 2D without a word. A script under scripts/ runs
// nowhere on its own, so it is the permitted path.
//
// THE ASSETS ARE NOT INSTALLED BY THIS SCRIPT. Put the `museu-1cgeo/` tree on
// disk FIRST, then register it, so the row never promises bytes that are missing:
//   - production: under ASSETS_3D_DIR, served by GET /api/v1/assets3d/*
//     (prefer the filesystem to the SQLite store — `cena.sog` is 19,1 MB and the
//     SQLite branch materializes the whole BLOB in the heap per request, while
//     ASSETS_3D_DIR streams and honours Range);
//   - development: frontend/public/3d/primeira-pessoa/museu-1cgeo/, served by Vite.
//
// Usage. Go through the npm script: it is what passes `--env-file-if-exists=.env`,
// and calling `node scripts/fp-scene-register.js` directly dies on
// "Missing required env var: DATABASE_URL", which reads like a broken install.
//   npm run fp:register -- [--dry-run] <basePath>
//
//   <basePath>  absolute site path of the scene FOLDER. The client is handed this
//               ONE path and derives the seven addresses inside it. The two
//               canonical values:
//                 /api/v1/assets3d/primeira-pessoa/museu-1cgeo   (production)
//                 /3d/primeira-pessoa/museu-1cgeo                (dev, Vite)
//
// The basePath is REQUIRED on purpose: where the bytes live is a deployment
// decision that is still open, and a default would quietly pick one. It must be
// absolute from the site root, because `assets3dBaseUrl` — the value that would
// have resolved a relative path — is published by the backend and has zero
// readers in the frontend today.
//
// Idempotent: rerunning it against the same deployment converges on the same row
// (create when absent or soft-deleted, update when live), so it can be rerun
// after editing any field below.
//
// Testable entry point: registerFirstPersonScene(basePath, { dryRun, logger }).

import { pathToFileURL } from 'node:url';
import { pgp } from '../src/database/index.js';
import * as catalogService from '../src/modules/catalog/catalog.service.js';
import { NotFoundError } from '../src/utils/errors.js';

export const SCENE_ID = 'museu-1cgeo';
export const SCENE_NAME = 'Sala Histórica General Malan';

// Measured metadata, from the scene package's LEIAME.md. `poseInicial` came from a
// measurement on the collision octree (floor at y = -0,85, eye 1,4 m above it):
// changing it by guess puts the visitor inside the floor or floating in the air.
// `locate` is the map pin and is the ONE field meant to be corrected — it is the
// centre of Porto Alegre, not the door of the 1º CGEO.
export const SCENE_CONFIG = Object.freeze({
  viewer: 'firstPerson',
  description:
    'Acervo do 1º Centro de Geoinformação em Gaussian Splatting, percorrível a pé, com 78 peças identificadas',
  keywords: ['museu', 'sala histórica', 'malan', 'acervo', '1º CGEO'],
  data_captura: '04/08/2026',
  local: 'Porto Alegre, RS',
  locate: { lon: -51.2, lat: -30.03 },
  poseInicial: { x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 },
  velocidade: 2.4,
  fov: 60,
});

/**
 * Validates the site-absolute scene folder path.
 *
 * Refuses anything the client cannot resolve on its own: a relative path (nothing
 * would rebase it), an absolute URL (the frontend's own allowlist accepts only
 * `https?:`, `//` and `/`), and a trailing slash (the seven inner addresses are
 * joined onto this string).
 * @param {string} basePath
 * @returns {string} the normalized basePath
 */
export function assertBasePath(basePath) {
  const value = typeof basePath === 'string' ? basePath.trim() : '';
  if (value === '') throw new Error('basePath is required');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new Error(`basePath must be a site path, not an absolute URL: ${value}`);
  }
  if (!value.startsWith('/')) {
    throw new Error(`basePath must start with "/" (it is resolved from the site root): ${value}`);
  }
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Creates or updates the scene's row in `tilesets`.
 *
 * `createCatalogItem` conflicts on a LIVE id and resurrects a soft-deleted one, so
 * the branch below is what makes a rerun converge instead of throwing 409.
 * @param {string} basePath - site-absolute path of the scene folder
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false] - print the payload and write nothing
 * @param {Object} [opts.logger] - { info, warn, error } (default: console)
 * @returns {Promise<{action: 'created'|'updated'|'dry-run', id: string, row: Object|null}>}
 */
export async function registerFirstPersonScene(basePath, opts = {}) {
  const logger = opts.logger || console;
  const dryRun = opts.dryRun === true;
  const base = assertBasePath(basePath);

  const payload = {
    id: SCENE_ID,
    name: SCENE_NAME,
    // The `description` COLUMN is what the admin listing shows; `listTilesets()`
    // returns `{ id, name, ...config }` and DROPS the column, so the same text has
    // to live inside `config` to reach the client at all.
    description: SCENE_CONFIG.description,
    config: { ...SCENE_CONFIG, basePath: base },
    sort_order: 0,
  };

  if (dryRun) {
    logger.info?.(
      `[fp-scene-register] DRY RUN — nothing written. Payload for tilesets:\n${JSON.stringify(payload, null, 2)}`
    );
    return { action: 'dry-run', id: SCENE_ID, row: null };
  }

  let live = null;
  try {
    live = await catalogService.getCatalogItem('tilesets', SCENE_ID);
  } catch (err) {
    // A soft-deleted (or absent) id 404s here and is handled by createCatalogItem,
    // which resurrects it as a full overwrite. Any other error is real.
    if (!(err instanceof NotFoundError)) throw err;
  }

  if (live) {
    const row = await catalogService.updateCatalogItem('tilesets', SCENE_ID, payload);
    logger.info?.(`[fp-scene-register] updated tilesets/${SCENE_ID} (basePath=${base})`);
    return { action: 'updated', id: SCENE_ID, row };
  }

  const row = await catalogService.createCatalogItem('tilesets', payload);
  logger.info?.(`[fp-scene-register] created tilesets/${SCENE_ID} (basePath=${base})`);
  return { action: 'created', id: SCENE_ID, row };
}

// ---------------------------------------------------------------------------
// CLI wrapper (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const basePath = argv.filter((a) => !a.startsWith('--'))[0];

  if (!basePath) {
    console.error(
      'Usage: node scripts/fp-scene-register.js [--dry-run] <basePath>\n' +
        '\n' +
        '  <basePath>   site-absolute path of the scene FOLDER, one of:\n' +
        '                 /api/v1/assets3d/primeira-pessoa/museu-1cgeo   (production, ASSETS_3D_DIR)\n' +
        '                 /3d/primeira-pessoa/museu-1cgeo                (development, Vite public/)\n' +
        '  --dry-run    print the catalog payload and write nothing\n' +
        '\n' +
        'Install the museu-1cgeo/ tree at that address BEFORE registering it:\n' +
        'a row pointing at absent bytes gives a pin that appears and a click that 404s.\n'
    );
    process.exit(1);
  }

  registerFirstPersonScene(basePath, { dryRun })
    .then(async ({ action }) => {
      await pgp.end();
      console.log(
        `\nfp-scene-register: ${action}.` +
          (action === 'dry-run'
            ? ''
            : ` Confirme com GET /api/config (a entrada deve trazer viewer: "firstPerson")` +
              ` e com GET ${assertBasePath(basePath)}/voxel/voxel-meta.json, que precisa devolver JSON.`)
      );
      process.exit(0);
    })
    .catch(async (err) => {
      await pgp.end().catch(() => {});
      console.error('fp-scene-register failed:', err?.message || err);
      process.exit(1);
    });
}
