#!/usr/bin/env node
// Path: scripts/assets3d-import.js
// Imports a directory tree of 3D tile assets into the SQLite store served by
// GET /api/v1/assets3d/*. Usage:
//   node scripts/assets3d-import.js <sourceDir>
// The store path is ASSETS_3D_SQLITE (default ./data/assets3d.sqlite).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openWritable, putAsset } from '../src/modules/nomes/assets3d.store.js';

// MIRROR of CONTENT_TYPES in src/modules/nomes/assets3d.service.js. The two must
// move together: this one FREEZES the content_type into the SQLite row at import
// time, so a divergence here is served forever without the service ever agreeing.
// See the note over there for why `.sog`/`.bin` are explicit octet-stream.
//
// It is a mirror rather than an import because the store is deliberately
// config-free (see its header) so this CLI can run standalone, while the service
// loads `src/config.js`. Exported so the parity is asserted by a test instead of
// by this comment: tests/unit/assets3d-content-types.test.js.
export const CONTENT_TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.terrain': 'application/octet-stream',
  '.pnts': 'application/octet-stream',
  '.sog': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
};
const ctype = (p) => CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// CLI only when run directly (the sv360-import.js pattern). Importing this file
// must not open — and therefore create — the SQLite store, which `openWritable()`
// at top level did: the parity test imports it for CONTENT_TYPES alone.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('Usage: node scripts/assets3d-import.js <sourceDir>');
    process.exit(1);
  }

  const db = openWritable();
  let n = 0;
  const tx = db.transaction(() => {
    for (const file of walk(srcDir)) {
      const rel = relative(srcDir, file).split(sep).join('/'); // posix rel_path
      putAsset(db, rel, readFileSync(file), ctype(file));
      n++;
    }
  });
  tx();
  db.close();
  console.log(
    `Imported ${n} assets into the 3D SQLite store (${process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite'}).`
  );
}
