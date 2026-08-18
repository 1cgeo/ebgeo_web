// Path: src/modules/nomes/assets3d-regime.js
// WHICH BYTES UNDER /assets3d BELONG TO A PRIVATE CATALOG ROW — an in-memory index,
// rebuilt on catalog writes, NEVER queried per asset request.
//
// Why an index instead of a lookup: nothing in the storage layer ties a path to a
// resource. The SQLite store is `assets(rel_path PK, data, ...)` and the filesystem is a
// tree; the ONLY link between a served path and a catalog row is a STRING, and it runs
// one way — from the row (`config.url`, `config.basePath`) to the path. Inverting it per
// request would mean a query per request, and Cesium issues one request per tile per LOD.
// So the inversion is computed once and kept, and the invalidation hangs on the same write
// that already invalidates the /api/config memo (`config.cache.js`).
//
// FOUR THINGS THIS INDEX DELIBERATELY DOES NOT REACH, named here so nobody reads its
// coverage as complete:
//
//  1. A catalog URL that this route does not serve. Of the three canonical prefixes in
//     this repository only `/api/v1/assets3d/...` passes through here; `/3d/...` and
//     `/catalogo/modelos_catalogo/...` are served by nginx or by Vite in dev. Their paths
//     still ENTER the index (a request that arrives here with that path is gated), but a
//     deploy that serves them from the web server bypasses this file entirely. "The
//     private 3D bytes are closed" is true of this route, not of nginx.
//  2. `ng.catalogo_3d`. It is a SECOND catalog of 3D models, with its own `url` column and
//     its own access axis (`access_level` + `ng.model_permissions`), unrelated to the
//     F8-F10 axis these four tables live on. Gating it here would mean a second
//     authorization predicate, which is the debt this whole axis exists not to contract.
//     It stays a NAMED hole in the census.
//  3. A row whose path sits at the ROOT of the asset tree. Its prefix would be empty and
//     would match every request; such an entry is dropped in BOTH directions (a private
//     root would deny the whole route, a public root would shadow every private prefix).
//  4. Anything the catalog does not describe. A path no row claims is PUBLIC, which is
//     exactly today's behavior and is what keeps the public model from regressing.
//
// `active` IS NOT FILTERED, and that is not an oversight: a soft-deleted private row keeps
// its bytes on disk, so dropping it from the index would turn "delete a private tileset"
// into "publish its bytes". Whether the caller still reaches a soft-deleted resource is
// decided downstream by `fn_can_see_resource`, which is where that question belongs.

import path from 'node:path';
import { query } from '../../database/index.js';
import { CATALOG_TABLES, assertProductionTypeOf } from '../catalog/catalog.tables.js';
import config from '../../config.js';

// The catalog fields that address a FOLDER (everything under them belongs to the row) and
// the ones that address a SINGLE FILE. The split is the point: a tileset's `config.url` is
// the `tileset.json` at the root of its tree, so the tree is `dirname(url)`, while a
// first-person scene declares the folder itself (`basePath`). The preview clip and the
// thumbnail are file-addressed because they routinely live OUTSIDE the model's folder (the
// seeded PCL model put its preview in a shared `/3d/videos/`), where a folder rule would
// either miss them or drag every neighbour in with them.
const CAMPOS_DE_PASTA = Object.freeze(['basePath']);
const CAMPOS_DE_ARQUIVO = Object.freeze(['previewVideo', 'previewThumbnail', 'thumbnail']);
const CAMPO_RAIZ_DE_ARVORE = 'url';

// One rebuild, one round trip. The table names come from the frozen whitelist, never from a
// request, which is the rule every other interpolated table name in this codebase follows
// (pg cannot bind a table name as a parameter).
const INDICE_SQL = CATALOG_TABLES
  .map((t) => `SELECT '${assertProductionTypeOf(t)}'::text AS tipo, id::text AS id, access_level, config FROM ${t}`)
  .join('\n  UNION ALL\n  ');

/** Backstop only. The mechanism is invalidation on write; this bounds a write path nobody wired. */
const TTL_MS = 60_000;

/** @type {{ promise: Promise<Array>, expiresAt: number }|null} */
let entrada = null;
/** @type {Array|null} The last index that BUILT, kept so a database blip does not close the route. */
let ultimoBom = null;

/**
 * Drops the index so the next asset request rebuilds it.
 *
 * Called from `invalidateAppConfigCache()`, which every catalog / visibility write already
 * calls. It does NOT clear `ultimoBom`: that copy is the fallback for a rebuild that FAILS,
 * and throwing it away would trade a stale answer for no answer at all.
 *
 * The one window this leaves open, written down rather than hidden: a row flipped
 * public -> private whose very next rebuild fails keeps being served under the old regime
 * until some rebuild succeeds. It takes the database breaking inside the seconds after that
 * write, and the alternative (fail closed on any blip) takes the public models down with it.
 */
export function invalidarRegimeDeAssets3d() {
  entrada = null;
}

/**
 * @returns {string} The path with no leading slash, no `.`/`..` segments, no repeated slashes,
 *   and no backslash pretending not to be a separator.
 *
 * THE BACKSLASH IS FOLDED ON EVERY HOST, not only on Windows, and the reason is that this
 * index and the branch that serves the bytes must not disagree about what a path IS. The
 * filesystem branch resolves with `path.resolve`, whose separator set is the HOST's, so on
 * Windows `priv\tileset.json` reads as `priv/tileset.json` and is served, while an index that
 * normalized POSIX-only saw one opaque segment, matched no row, and called it public. Measured,
 * that spelling handed a private tileset to an anonymous caller with `public, immutable`.
 * Folding it here is host-independent by construction and errs closed: a genuine Linux filename
 * containing a backslash can only be judged MORE private than it is, never less.
 */
function normalizarRel(bruto) {
  const semQuery = String(bruto ?? '').split('?')[0].split('#')[0];
  let decodificado = semQuery;
  try {
    decodificado = decodeURIComponent(semQuery);
  } catch {
    // A malformed escape is not a path we can normalize. Keeping the raw form can only fail
    // to MATCH, and a path no row claims is a path the store and the filesystem will 404.
  }
  return path.posix.normalize(`/${decodificado.replace(/\\/g, '/')}`).replace(/^\/+/, '');
}

/**
 * The form paths are COMPARED in: normalized, then case-folded.
 *
 * Case-folding is the other half of the same lesson as the backslash above. `path.resolve` is
 * as case-insensitive as the host filesystem, so on Windows and on macOS `PRIV/tileset.json`
 * serves the bytes of `priv/tileset.json`, and an index comparing exact strings matched no row
 * and answered "public" — the private model, to an anonymous caller, with a full year of shared
 * caching. Deciding the regime by host semantics would mean a rule that is true on the
 * developer's machine and false on the deploy, which is precisely how a filter ends up applied
 * to one branch and not the other.
 *
 * The direction of the error is the point: folding can only make MORE spellings resolve to a
 * private row. The one case it would cost is two catalog rows whose paths differ ONLY in case,
 * one public and one private, where the public one would be gated and its anonymous readers
 * denied. That is a catalog collision, it is already resolved toward `private` by the tie-break
 * in `montarIndice`, and a wrong denial is recoverable in a way a wrong disclosure is not.
 *
 * @param {string} rel - An already-normalized path.
 * @returns {string}
 */
function chaveDeCasamento(rel) {
  return rel.toLowerCase();
}

/**
 * A catalog URL as a path in the SAME vocabulary as `req.params[0]`, or null.
 *
 * Null for an absolute URL (`https://…`, `//host/…`): a row pointing at another origin is
 * not served by this route, and turning `https://x/y` into the prefix `https:/x/y` would
 * plant an entry that could only ever match by accident.
 *
 * @param {*} bruto
 * @returns {string|null}
 */
function relDaUrl(bruto) {
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  const s = bruto.trim();
  if (s.includes('://') || s.startsWith('//')) return null;
  const base = config.assets3d.baseUrl.replace(/\/+$/, '');
  const semBase = base && s.startsWith(`${base}/`) ? s.slice(base.length) : s;
  const rel = normalizarRel(semBase);
  return rel === '' || rel === '.' ? null : rel;
}

/**
 * The flat entry list, longest `alvo` first, so the FIRST match is the winner.
 *
 * `chave` is the comparison form (see `chaveDeCasamento`) and is precomputed here rather than
 * per request: the match runs on every asset request and the index changes only on a catalog
 * write, so folding the whole index on each of Cesium's thousands of tile requests would put
 * the cost on exactly the side this design keeps empty.
 *
 * @param {Array<{tipo: string, id: string, access_level: string, config: object}>} linhas
 * @returns {Array<{alvo: string, chave: string, arquivo: boolean, privado: boolean, tipo: string, resourceId: string}>}
 */
function montarIndice(linhas) {
  const entradas = [];
  for (const linha of linhas) {
    const cfg = linha.config && typeof linha.config === 'object' ? linha.config : {};
    const recurso = {
      privado: linha.access_level === 'private',
      tipo: linha.tipo,
      resourceId: linha.id,
    };
    // The tileset tree: the row addresses `<tree>/tileset.json`, so the tree is its folder.
    const raiz = relDaUrl(cfg[CAMPO_RAIZ_DE_ARVORE]);
    if (raiz) {
      const pasta = path.posix.dirname(raiz);
      if (pasta && pasta !== '.' && pasta !== '/') entradas.push({ alvo: pasta, arquivo: false, ...recurso });
    }
    for (const campo of CAMPOS_DE_PASTA) {
      const rel = relDaUrl(cfg[campo]);
      if (rel) entradas.push({ alvo: rel, arquivo: false, ...recurso });
    }
    for (const campo of CAMPOS_DE_ARQUIVO) {
      const rel = relDaUrl(cfg[campo]);
      if (rel) entradas.push({ alvo: rel, arquivo: true, ...recurso });
    }
  }
  // Longest first, and PRIVATE first on a tie. The tie-break is the fail-closed half: two
  // rows claiming the same path is a catalog mistake, and the safe reading of a mistake is
  // the restrictive one.
  entradas.sort((a, b) => (b.alvo.length - a.alvo.length) || (Number(b.privado) - Number(a.privado)));
  for (const e of entradas) e.chave = chaveDeCasamento(e.alvo);
  return entradas;
}

/**
 * The entry a served path belongs to, or null.
 *
 * The loop lives here, in one copy, and is exported through `_internos` for the unit test to
 * call. It used to be re-implemented in that test, which is the arrangement where the matcher
 * and its own verification drift apart in the same edit: case-folding the index while the test
 * kept comparing raw strings would have left the test green over a matcher that matched
 * nothing.
 *
 * @param {Array<{chave: string, arquivo: boolean}>} indice - From `montarIndice`.
 * @param {string} rel - The served path, as the route received it.
 * @returns {object|null}
 */
function acharEntrada(indice, rel) {
  const alvo = chaveDeCasamento(normalizarRel(rel));
  for (const e of indice) {
    const casa = e.arquivo ? alvo === e.chave : (alvo === e.chave || alvo.startsWith(`${e.chave}/`));
    if (casa) return e;
  }
  return null;
}

/** @returns {Promise<Array>} The index, built at most once per invalidation. */
function lerIndice() {
  const agora = Date.now();
  if (entrada && entrada.expiresAt > agora) return entrada.promise;

  const promise = query(INDICE_SQL, []).then(({ rows }) => {
    const indice = montarIndice(rows);
    ultimoBom = indice;
    return indice;
  });

  const fresca = { promise, expiresAt: agora + TTL_MS };
  entrada = fresca;

  // A failed build must not be remembered, exactly as in `config.cache.js`: the next request
  // has to try again instead of replaying one rejection for the whole TTL.
  promise.catch(() => {
    if (entrada === fresca) entrada = null;
  });

  return promise;
}

/**
 * The access regime of ONE served path.
 *
 * LONGEST MATCH WINS, so a private model nested inside a public tree is still private and a
 * public model nested inside a private tree is still public. Matching runs on the NORMALIZED,
 * CASE-FOLDED path, because the variants (`./x`, `//x`, a collapsible `..`, a backslash, a
 * different case) miss the SQLite store's exact-equality index and are still served by the
 * filesystem branch, whose separator set and case sensitivity are the HOST's: normalizing after
 * the test would let the hole back in through the variant. See `normalizarRel` and
 * `chaveDeCasamento` for the two spellings that were measured serving private bytes.
 *
 * @param {string} rel - `req.params[0]`, as the route received it.
 * @returns {Promise<{privado: boolean, tipo?: string, resourceId?: string}>}
 * @throws When the index has never been built and cannot be. The caller answers 503: with no
 *   index there is no honest answer, and guessing means choosing between denying the public
 *   models and serving the private ones.
 */
export async function regimeDoCaminho(rel) {
  let indice;
  try {
    indice = await lerIndice();
  } catch (err) {
    if (!ultimoBom) throw err;
    indice = ultimoBom; // stale, but a stale answer beats closing the route on a blip
  }

  const e = acharEntrada(indice, rel);
  if (e) return { privado: e.privado, tipo: e.tipo, resourceId: e.resourceId };
  return { privado: false };
}

/** Test seam: the pure halves, so a unit test can assert the derivation without a database. */
export const _internos = Object.freeze({ montarIndice, relDaUrl, normalizarRel, acharEntrada });
