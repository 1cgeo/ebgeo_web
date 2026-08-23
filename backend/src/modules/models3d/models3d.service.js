// Path: src/modules/models3d/models3d.service.js
// The pure part of serving a converted model: how a request path becomes (model, key),
// what content type a key has, and what its ETag is. No I/O, so it is unit-testable
// without a database or a file.

/**
 * Normalizes the wildcard part of the URL into the form stored as `media.key`.
 *
 * This is NOT filesystem traversal defense — there is no filesystem on the other side —
 * it is key hygiene: "a/../b.glb" and "b.glb" must not become two cache entries for one
 * object. Express has already decoded `req.params[0]`, so there is no second decode here:
 * decoding twice breaks a key holding a literal percent ("Data/100%.glb" arrives decoded,
 * and a second pass sees a malformed escape and 400s a file that exists).
 * @param {string} bruto - wildcard path, already URL-decoded
 * @returns {string|null} the key, or null when the request must be refused
 */
export function normalizeKey(bruto) {
  if (!bruto) return null;
  let chave = String(bruto).split('?')[0].replace(/\\/g, '/');
  if (chave.startsWith('/')) chave = chave.slice(1);
  if (chave === '' || chave.includes('\0')) return null;
  if (chave.split('/').some((p) => p === '..' || p === '.')) return null;
  return chave;
}

/**
 * THE RESERVED PREFIX inside the assets3d route. A request whose path starts with it is
 * addressed to a per-model `.3dtiles`; everything else keeps the two branches that were
 * already there (the flat SQLite store, then the filesystem).
 *
 * Why a prefix inside the existing route instead of a route of its own: the privacy gate
 * (`assets3d-regime.js` + `assets3d-acesso.js`) indexes catalog rows BY PATH, deriving
 * the tree of a tileset from `dirname(config.url)`. A row published as
 * `/api/v1/assets3d/m/<slug>/tileset.json` is gated by that index with no change at all,
 * while a second route would have needed its own inversion of the same catalog — the
 * kind of second answer to one question that goes stale in silence.
 */
export const PREFIXO_MODELO = 'm/';

/**
 * Content type per extension. `model/gltf-binary` is the IANA type for .glb; b3dm has no
 * registered type and goes out as octet-stream (it only appears in a model imported
 * without conversion, which is the exception path).
 */
const TIPOS = Object.freeze({
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.b3dm': 'application/octet-stream',
  '.pnts': 'application/octet-stream',
  '.i3dm': 'application/octet-stream',
  '.cmpt': 'application/octet-stream',
  '.subtree': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

/**
 * @param {string} chave
 * @returns {string} the content type, octet-stream when the extension is unknown
 */
export function tipoDe(chave) {
  const ponto = chave.lastIndexOf('.');
  if (ponto < 0) return 'application/octet-stream';
  return TIPOS[chave.slice(ponto).toLowerCase()] || 'application/octet-stream';
}

/** True for the one kind of content in a model that is NOT immutable. */
export function ehDocumento(chave) {
  return chave.toLowerCase().endsWith('.json');
}

/**
 * FNV-1a, 32 bits, 8 hex chars. Non-cryptographic and cheap: it is a validator, and
 * there is no adversary here to resist.
 * @param {string} str
 * @returns {string}
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * ETag of one key, derived WITHOUT reading the BLOB.
 *
 * A tile is immutable within a generation, so (model, key, token) identifies the
 * content. That is what makes the 304 branch free: it never touches SQLite, which is the
 * only cost on this route that matters.
 * @param {string} modelId @param {string} chave @param {string} token
 * @returns {string} quoted, ready for the ETag header
 */
export function computeTileETag(modelId, chave, token) {
  return `"${modelId}-${fnv1a(chave)}-${token}"`;
}

/**
 * Splits a request path into (model id, key), or null when it is not addressed to a
 * per-model store.
 *
 * Returns `{ id, chave: null }` for a path that names a model but no key (or an invalid
 * one), so the caller can answer 404/400 for a model it OWNS instead of falling through
 * to the flat store, where the same path would 404 for the wrong reason.
 * @param {string} rel - the wildcard part of the URL, already URL-decoded
 * @returns {{id: string, chave: string|null}|null}
 */
export function parsePedidoDeModelo(rel) {
  const bruto = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!bruto.startsWith(PREFIXO_MODELO)) return null;
  const resto = bruto.slice(PREFIXO_MODELO.length);
  const barra = resto.indexOf('/');
  if (barra <= 0) return null; // "m/" or "m/slug" address no key at all
  const id = resto.slice(0, barra);
  // Anchored on an alphanumeric FIRST character, and that is not cosmetic: a dot-only
  // class accepts `..`, so `m/../etc/passwd` parsed as the model named `..`. Nothing
  // downstream would have opened that path (`db_filename` comes from Postgres and goes
  // through `path.basename`), but a request that names no model must not be answered as
  // if it named one.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null;
  return { id, chave: normalizeKey(resto.slice(barra + 1)) };
}
