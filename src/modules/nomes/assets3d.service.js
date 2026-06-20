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

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.terrain': 'application/octet-stream', // quantized-mesh
  '.pnts': 'application/octet-stream',
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
    contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
  };
}
