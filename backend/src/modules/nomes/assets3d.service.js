// Path: src/modules/nomes/assets3d.service.js
// Resolves a relative asset URL to an absolute file under ASSETS_3D_DIR,
// blocking path traversal. ETag is O(1) (fs.stat — never reads the file).
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import config from '../../config.js';

const statAsync = promisify(fs.stat);
const ROOT = path.resolve(config.assets3d.dir);

// Extension -> Content-Type. The four entries below `.pnts` are the first-person
// scene's file set (Gaussian-splatting model, collision octree, item photos and
// the optional catalog preview clip).
//
// `.sog` and `.bin` are DELIBERATE explicit octet-stream entries, not omissions:
// no registered media type describes either, and they are only ever consumed as
// an ArrayBuffer by `fetch`. Listing them keeps the fallback below meaning "an
// extension nobody mapped" instead of "a mapped extension that happens to be
// binary", which is what makes a missing mapping visible.
//
// `.jpg` and `.webm` DO change behavior. A photo served as octet-stream only
// renders because the browser sniffs an `<img>`; a `<video>` does not sniff, so
// the catalog's `preview/preview.webm` would refuse to play under octet-stream.
// Exported for the parity test against the mirror in scripts/assets3d-import.js.
// The membership matters on its own, not only the value: `.sog`/`.bin` map to the
// same string the fallback returns, so a test that only called contentTypeForPath
// would stay green after someone deleted them.
export const CONTENT_TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.terrain': 'application/octet-stream', // quantized-mesh
  '.pnts': 'application/octet-stream',
  '.sog': 'application/octet-stream', // self-organizing gaussians (no registered type)
  '.bin': 'application/octet-stream', // voxel octree payload (no registered type)
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
};

/** Content-Type for a path, by extension (shared with the SQLite store/import). */
export function contentTypeForPath(p) {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

export async function resolveAsset(relUrl) {
  const target = path.resolve(ROOT, '.' + path.posix.normalize('/' + (relUrl || '')));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new ForbiddenError('Path traversal detected');
  }
  let st;
  try {
    st = await statAsync(target);
  } catch {
    throw new NotFoundError('3D asset');
  }
  if (!st.isFile()) throw new NotFoundError('3D asset');
  return {
    path: target,
    size: st.size,
    etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`, // O(1): derived from fs.stat
    // Delegated, not re-inlined: this used to repeat the CONTENT_TYPES lookup, so
    // `contentTypeForPath` had zero callers in src/ and a test on it would have
    // proven nothing about what the route actually sends.
    contentType: contentTypeForPath(target),
  };
}
