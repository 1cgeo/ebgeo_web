#!/usr/bin/env node
// Path: scripts/assets3d-import.js
// Imports a directory tree of 3D tile assets into the SQLite store served by
// GET /api/v1/assets3d/*. Usage:
//   node scripts/assets3d-import.js <sourceDir>
// The store path is ASSETS_3D_SQLITE (default ./data/assets3d.sqlite).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';
import { openWritable, putAsset } from '../src/modules/nomes/assets3d.store.js';

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.terrain': 'application/octet-stream',
  '.pnts': 'application/octet-stream',
};
const ctype = (p) => CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

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
console.log(`Imported ${n} assets into the 3D SQLite store (${process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite'}).`);
