// Path: src/modules/models3d/models3d.index.js
// WHICH FILE SERVES WHICH MODEL — an in-memory index, rebuilt on catalog writes,
// NEVER queried per asset request.
//
// The reason is the one `assets3d-regime.js` states for its own index and it is the
// same route: Cesium turns one tileset into a request per tile per LOD, so a query on
// that path would land the whole fan-out on the ten-connection pool, next to the sync,
// the collab socket and `GET /api/config`, whose failure blocks boot. The acquis is
// dozens of rows, so the whole thing is read at once and kept.
//
// WHAT IT CARRIES, AND WHAT IT DELIBERATELY DOES NOT. It carries the address
// (`dbFilename`), the generation token (half of the ETag) and whether the catalog row is
// `active`. It does NOT carry `access_level`: who may read a path is decided by
// `assets3d-regime.js` + `assets3d-acesso.js`, which already index every catalog row by
// path, and a second copy of that answer here would be the duplicated closed list the
// constitution forbids — with the stale copy deciding who sees what.
//
// INVALIDATION HANGS ON `invalidateAppConfigCache()`, the same hook the regime index
// uses, and for the reason written there: two invalidations reachable only by
// remembering both is how one of them goes stale.
import { query } from '../../database/index.js';
import { LIST_MODELS_3D } from './models3d.queries.js';

/** Backstop only; the mechanism is invalidation on write. */
const TTL_MS = 60_000;

/** @type {{ promise: Promise<Map<string, object>>, expiresAt: number }|null} */
let entrada = null;
/** @type {Map<string, object>|null} Last index that BUILT, kept so a blip does not 404 the acquis. */
let ultimoBom = null;

/**
 * Drops the index so the next request rebuilds it.
 *
 * It does NOT clear `ultimoBom`, for the same reason the regime index does not: that
 * copy is the fallback for a rebuild that FAILS, and throwing it away trades a stale
 * answer for no answer. The window this leaves open, written down rather than hidden: a
 * model whose file was just swapped and whose very next rebuild fails keeps being served
 * under the previous token until some rebuild succeeds. The bytes are still the ones on
 * disk (the store re-stats the file on every read); only the ETag would lag.
 * @returns {void}
 */
export function invalidarIndiceDeModelos3d() {
  entrada = null;
}

/** Forgets everything, including the fallback. Tests only. */
export function _zerarIndiceDeModelos3d() {
  entrada = null;
  ultimoBom = null;
}

async function montarIndice() {
  // `query()` devolve { rows, rowCount }, e não o array: é a forma que o helper do
  // repositório escolheu para compatibilidade com `pg`.
  const { rows } = await query(LIST_MODELS_3D);
  const mapa = new Map();
  for (const l of rows) {
    mapa.set(l.model_id, {
      id: l.model_id,
      dbFilename: l.db_filename,
      buildToken: l.build_token,
      modelType: l.model_type,
      ativo: l.active === true,
    });
  }
  ultimoBom = mapa;
  return mapa;
}

function indice() {
  const agora = Date.now();
  if (entrada && entrada.expiresAt > agora) return entrada.promise;
  const promise = montarIndice().catch((err) => {
    // A rebuild that fails must not poison the memo: drop the entry so the next request
    // tries again, and answer from the last good copy rather than closing the route.
    if (entrada && entrada.promise === promise) entrada = null;
    if (ultimoBom) return ultimoBom;
    throw err;
  });
  entrada = { promise, expiresAt: agora + TTL_MS };
  return promise;
}

/**
 * Resolves a model id to the file that serves it.
 * @param {string} id - the slug, i.e. the `tilesets` primary key
 * @returns {Promise<{id:string, dbFilename:string, buildToken:string, modelType:string, ativo:boolean}|null>}
 */
export async function resolverModelo3d(id) {
  if (!id) return null;
  const mapa = await indice();
  return mapa.get(id) ?? null;
}
