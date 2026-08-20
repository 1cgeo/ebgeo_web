// Path: src/modules/nomes/assets3d-acesso.js
// CAN THIS CALLER HAVE THE BYTES OF THIS PRIVATE RESOURCE — the decision, memoized.
//
// The rule itself is not written here and must never be: it is `fn_can_see_resource`, the
// same SQL function every other read of a private resource goes through. What lives here is
// the MEMO, and the memo exists for one measured reason: Cesium fans a tileset out into one
// request per tile per LOD, and answering each of them with a database round trip would put
// that fan-out in the same ten-connection pool as the sync, as `/api/config` (whose failure
// blocks boot) and as the collab socket. `assets3d-regime.js` already keeps the PUBLIC
// models off this path entirely; what remains is one decision per (caller, resource), not
// one per request.
//
// THE ATLAS UUID IS NOT A PASSWORD. `?atlasId=` says only WHICH loan the caller wants to
// use; who says they may use it is `requireAtlasPermission('read')`, the same gate
// `requireAtlasScopeWhenPresent` runs for the 360 and for `/resource-access/visible`, and it
// is what confines a public-link visitor to the atlas their own token was minted for. It is
// invoked here as a function rather than mounted as middleware for a reason that IS the
// point of this file: mounted, it would run a query on every request including the public
// ones, which is the cost this design exists to avoid.
//
// WHAT THE MEMO COSTS, said out loud: a revocation is honoured up to `TTL_MS` late. That is
// the same shape of lag the product already carries in two places — a JWT keeps a demoted
// role for up to 15 minutes, and the collab heartbeat reconciles authorization every ~30 s —
// and this window is the smaller of the two. It is also cleared eagerly by
// `invalidarAcessoDeAssets3d()`, hung on the same catalog/visibility write that drops the
// regime index, so the flip that matters most (public -> private) is not subject to it.
//
// The memo is NOT gated by NODE_ENV. A security cache switched off under test is a cache
// whose "denied" tests would pass by vacuity, which is the empty-coverage class the
// constitution names; the tests here exercise the same code the deploy runs.

import { one } from '../../database/index.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { principalUserId, atlasScopeId } from '../../utils/principal.js';
import { AppError, NotFoundError, ServiceUnavailableError } from '../../utils/errors.js';
import * as Q from '../resource-access/resource-access.queries.js';
import { regimeDoCaminho } from './assets3d-regime.js';

/** Revocation lag ceiling. Below the collab heartbeat's ~30 s and far below the JWT's 15 min. */
const TTL_MS = 30_000;
/** Bounds the memo against a caller walking many ids; eviction is oldest-first insertion order. */
const MAX_ENTRADAS = 5000;

/** @type {Map<string, {promise: Promise<boolean>, expiresAt: number}>} */
const memo = new Map();

/** Drops every memoized decision. Idempotent, synchronous. */
export function invalidarAcessoDeAssets3d() {
  memo.clear();
}

const gateDeLeituraDeAtlas = requireAtlasPermission('read');

/**
 * Does this caller reach this atlas at `read`?
 *
 * Runs the REAL gate, not a copy of it: owner, share, `is_public`, the global-admin
 * shortcut and the public-link visitor confinement all live inside it, and a second
 * definition of "this caller reaches this atlas" is exactly the debt `resource-access.js`
 * refuses to contract. Its `NotFoundError` / `ForbiddenError` become `false` here because
 * this is a predicate, not a route; anything else propagates, because a database failure
 * must not read as "denied".
 *
 * @param {import('express').Request} req
 * @param {string} atlasId
 * @returns {Promise<boolean>}
 */
function alcancaAtlas(req, atlasId) {
  return new Promise((resolve, reject) => {
    // `requireAtlasPermission` reads `req.params`; the route carries the atlas in the QUERY
    // (a path parameter would collide with the wildcard that IS the asset path).
    req.params.atlasId = atlasId;
    gateDeLeituraDeAtlas(req, {}, (err) => {
      if (!err) return resolve(true);
      if (err instanceof AppError) return resolve(false);
      return reject(err);
    });
  });
}

/**
 * The principal, as a memo key.
 *
 * `principalUserId` is null for BOTH an anonymous caller and a public-link visitor, and
 * collapsing the two would be a real defect rather than an inelegance: an anonymous caller
 * reaches a public atlas, while a visitor holding another atlas's token does not, so the two
 * get different answers for the same `?atlasId=` and must not share a cache line.
 *
 * @param {object} [user] - req.user
 * @returns {string}
 */
function impressaoDoPrincipal(user) {
  const id = principalUserId(user);
  if (id) return id;
  if (user?.isPublic) return `publico:${user.publicAtlasId ?? ''}`;
  return 'anonimo';
}

/**
 * The decision itself. Two questions, in this order, and the order is the gate:
 * first "does this caller reach the atlas they are invoking", then "does the resource reach
 * this caller". Asking only the second would make the atlas UUID a password.
 *
 * `'private'` is passed as the access level instead of being read back from the row: the
 * caller only gets here because the regime index said the path belongs to a PRIVATE row, and
 * re-reading it would be a second query to answer a question already answered. It also fails
 * in the safe direction — a row that became public since the last rebuild is denied, not
 * leaked, until the index catches up.
 *
 * @param {import('express').Request} req
 * @param {string|null} userId
 * @param {string|null} atlasId
 * @param {{tipo: string, resourceId: string}} alvo
 * @returns {Promise<boolean>}
 */
async function decidir(req, userId, atlasId, alvo) {
  if (atlasId && !(await alcancaAtlas(req, atlasId))) return false;
  const linha = await one(Q.CAN_SEE_RESOURCE, [userId, atlasId, alvo.tipo, alvo.resourceId, 'private']);
  return linha.ok === true;
}

/**
 * THE GATE OF THE ASSET ROUTE — the only middleware on it, and the one that lets there be
 * only one.
 *
 * It is mounted rather than buried in the controller so the route DECLARES its gate, which
 * is how every other read surface in this codebase is auditable (`tests/unit/
 * superficies-de-recurso-censo.test.js` reads the route file). What it must not become is
 * the shape the other gates have: `requireAtlasScopeWhenPresent` and `assertCanSeeResource`
 * each cost a query, and this route is the one where a query per request is the design
 * failure. So the first thing it does is an in-memory lookup, and for a PUBLIC path — the
 * majority, and every path no catalog row claims — it calls `next()` having touched nothing.
 *
 * It leaves `req.assetPrivado` for the controller, which decides the cache regime from it.
 *
 * @type {import('express').RequestHandler}
 */
export function gateDeAsset3d(req, res, next) {
  Promise.resolve().then(async () => {
    let regime;
    try {
      regime = await regimeDoCaminho(req.params[0]);
    } catch {
      // No index and no way to build one. Serving would leak and denying would take the
      // public models down, so neither is answered: 503 says "I cannot decide", out loud.
      return next(new ServiceUnavailableError('Catálogo indisponível'));
    }
    req.assetPrivado = regime.privado;
    if (!regime.privado) return next();
    if (await assetLiberado(req, regime)) return next();
    return next(new NotFoundError('3D asset'));
  }).catch(next);
}

/**
 * May this request have the bytes of this private resource?
 *
 * @param {import('express').Request} req
 * @param {{tipo: string, resourceId: string}} alvo - From `regimeDoCaminho`.
 * @returns {Promise<boolean>}
 */
export async function assetLiberado(req, alvo) {
  const userId = principalUserId(req.user);
  const atlasId = atlasScopeId(req.query?.atlasId);
  const chave = `${impressaoDoPrincipal(req.user)}|${atlasId ?? '-'}|${alvo.tipo}|${alvo.resourceId}`;

  const agora = Date.now();
  const guardada = memo.get(chave);
  if (guardada && guardada.expiresAt > agora) {
    const ok = await guardada.promise;
    if (ok && atlasId) req.atlasId = atlasId;
    return ok;
  }

  const promise = decidir(req, userId, atlasId, alvo);
  const fresca = { promise, expiresAt: agora + TTL_MS };
  memo.set(chave, fresca);
  // A rejected decision is never remembered: a database blip must not deny for 30 s.
  promise.catch(() => {
    if (memo.get(chave) === fresca) memo.delete(chave);
  });
  if (memo.size > MAX_ENTRADAS) {
    const maisAntiga = memo.keys().next().value;
    if (maisAntiga !== chave) memo.delete(maisAntiga);
  }

  const ok = await promise;
  // `req.atlasId` is what `respostaEscopada` reads, and it is set only when the loan was
  // actually honoured: an atlas in focus that did NOT decide the answer must not close the
  // cache of a response it had no part in.
  if (ok && atlasId) req.atlasId = atlasId;
  return ok;
}
