// Path: src/modules/nomes/assets3d.controller.js
// Serves immutable 3D assets. THREE stores behind one path, tried in this order:
//
//   0. a per-model `.3dtiles` (reserved `m/<slug>/` prefix) — the converted acquis, one
//      SQLite per model, addressed through the catalog row of that model;
//   1. the flat SQLite store `assets(rel_path, data)` — whatever was imported as raw bytes;
//   2. the filesystem `dir` — the fallback, and where the walk-through scenes live.
//
// All three use ETag O(1)/304/Range. Both SQLite paths materialize the BLOB in the heap, so
// they are bounded by a semaphore; the FS path streams.
//
// WHY THE THIRD STORE SHARES THIS ROUTE instead of getting its own: the privacy gate below
// indexes catalog rows BY PATH, so a model published under this prefix is gated with no
// change at all. A route of its own would have needed a second inversion of the same
// catalog — a second answer to one question, which is how one of them goes stale.
//
// THE REGIME FOLLOWS THE RESOURCE, NOT THE ROUTE (F11). Until this phase the route was
// public end to end and the wiki said so plainly: the protection was "whoever does not
// know the URL does not download", and a URL is a bad secret — it travels in the additive
// payload, and anyone who legitimately receives it can pass the path on.
//
// One path, two regimes, decided per request from an in-memory index
// (`assets3d-regime.js`), with NO query on the request path:
//
//   PUBLIC  — 200 with no credential, `public, immutable`, byte for byte what it was
//             before. This is the majority case and it must not regress in anything:
//             same status, same ETag, same Range, same header.
//   PRIVATE — through the gate (`assets3d-acesso.js`), then `private, immutable` plus
//             `Vary`, which is cacheable in the browser and never in a shared cache.
//
// 404 AND NOT 403/401 for a caller who may not see it, following the house ladder that
// `sv360.service.js` states in as many words ("Throws NotFoundError (NOT Forbidden) …, so
// a hidden project is indistinguishable from a nonexistent one"). A 403 here would confirm
// the existence of the very model whose existence is the private part.
//
// THE GATE RUNS BEFORE THE 304, and that ordering is deliberate even though the 304 is the
// hot case (0.3 ms) and the semaphore is acquired after it for exactly the opposite reason:
// answering 304 to an unauthorized caller confirms both the model's existence and its ETag.
// What keeps that affordable is that the gate is two in-memory lookups for a public path
// and a memoized decision for a private one.
import { asyncHandler } from '../../utils/async-handler.js';
import { streamFileToResponse } from '../../utils/stream-file.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import { createSemaphore } from '../../utils/semaphore.js';
import config from '../../config.js';
import * as store from './assets3d.store.js';
import * as assets3dService from './assets3d.service.js';
import * as models3dStore from '../models3d/models3d.store.js';
import { resolverModelo3d } from '../models3d/models3d.index.js';
import {
  parsePedidoDeModelo,
  computeTileETag,
  tipoDe,
  ehDocumento,
} from '../models3d/models3d.service.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
// `private` and not `no-store`: the browser SHOULD keep the tiles of a private model for the
// session (that is what makes LOD streaming viable), and what must never happen is a shared
// cache replaying one authorized response to the next caller. Same two constants, same
// reasoning and same `Vary` as `sv360.controller.js`, which took this decision first.
const IMMUTABLE_PRIVADO = 'private, max-age=31536000, immutable';
// Exported so a test can occupy the permit deterministically (the abort-while-
// queued regression needs real contention, which no amount of client timing can
// guarantee). Nothing in src/ imports it.
export const sem = createSemaphore(config.assets3d.maxInflight);

// Parses "bytes=start-end" against `size`. Returns {start,end} | 'invalid' | null.
function parseRange(range, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m) return 'invalid';
  let start = m[1] !== '' ? parseInt(m[1], 10) : null;
  let end = m[2] !== '' ? parseInt(m[2], 10) : null;
  if (start === null && end === null) return 'invalid';
  if (start === null) {
    start = size - end;
    end = size - 1;
  }
  if (end === null || end >= size) end = size - 1;
  if (start > end || start < 0 || start >= size) return 'invalid';
  return { start, end };
}

/**
 * Runs `fn` holding one permit of the in-flight semaphore.
 *
 * The release hooks are registered BEFORE the acquire, and that ordering is the whole
 * reason this is a function instead of two copies: under contention the acquire parks in
 * the semaphore queue for an unbounded time, and a client that aborts while parked makes
 * `res` emit 'close' inside that window. A listener attached afterwards never sees it
 * (the event is not replayed) and `res.end()` on a destroyed socket returns early without
 * emitting 'finish' either — so the permit would be held forever, and `maxInflight` such
 * aborts hang the route until the process restarts. `acquired` keeps an early 'close'
 * from releasing a permit we do not own yet.
 *
 * @param {import('express').Response} res
 * @param {() => Promise<*>} fn - runs only if the client is still there
 * @returns {Promise<*>} whatever `fn` returns, or ABORTADO when the client gave up
 */
async function comVaga(res, fn) {
  let acquired = false;
  let released = false;
  let closed = false;
  const release = () => {
    if (acquired && !released) {
      released = true;
      sem.release();
    }
  };
  const onDone = () => {
    closed = true;
    release();
  };
  res.on('finish', onDone);
  res.on('close', onDone);

  await sem.acquire();
  acquired = true;
  if (closed || res.destroyed || res.writableEnded) {
    release(); // client is already gone: hand the permit back, skip the read
    return ABORTADO;
  }
  try {
    return await fn();
  } catch (err) {
    release();
    throw err;
  }
}

/** Sentinel: the client disconnected while the request waited for a permit. */
const ABORTADO = Symbol('abortado');

function setImmutableHeaders(res, etag, contentType, privado = false) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', privado ? IMMUTABLE_PRIVADO : IMMUTABLE);
  if (privado) {
    // Belt and braces for a proxy that ignores `private`: the response depended on the
    // caller's credential (Bearer or the `token` cookie, both read by the global
    // `flexibleAuth`), so it must never be reused across credentials. The RFC's
    // `Authorization` exemption does not cover the cookie case, which is why both are named.
    //
    // `res.vary()` and not `setHeader`, and the difference is a real defect rather than
    // taste: CORS already wrote `Vary: Origin` on this response and `compression` appends
    // `Accept-Encoding`, so assigning the header DROPS them — trading one cache-poisoning
    // hazard for another. `vary()` appends and de-duplicates.
    res.vary('Authorization');
    res.vary('Cookie');
  }
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', contentType);
}

/**
 * Headers for content that comes out of a per-model `.3dtiles`.
 *
 * THE `tileset.json` IS NOT IMMUTABLE, and that is the one difference from every other
 * branch of this route. A re-import replaces the whole tree: with `immutable` the browser
 * would spend a year asking for tiles that no longer exist. `no-cache` is not "do not
 * store", it is "store and revalidate", and the ETag makes the revalidation cost a 304
 * with no body. The tiles themselves keep the full year, which is only safe because
 * their `uri` carries the generation token — that is the same token this ETag is built
 * from, so a re-import changes both at once.
 *
 * @param {import('express').Response} res
 * @param {string} etag - already quoted
 * @param {string} contentType
 * @param {boolean} privado - decided per request by `gateDeAsset3d`
 * @param {boolean} documento - true for the `.json` of the tileset tree
 * @returns {void}
 */
function setModelHeaders(res, etag, contentType, privado, documento) {
  // A tile is exactly the immutable case the branch below already implements, down to the
  // `Vary`; delegating keeps ONE definition of that regime instead of a copy that drifts.
  if (!documento) return setImmutableHeaders(res, etag, contentType, privado);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', privado ? 'private, no-cache' : 'public, no-cache');
  if (privado) {
    // Same reasoning as setImmutableHeaders: `vary()` appends instead of dropping the
    // `Vary: Origin` that CORS already wrote.
    res.vary('Authorization');
    res.vary('Cookie');
  }
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', contentType);
}

export const serveAsset = asyncHandler(async (req, res, next) => {
  const rel = req.params[0];
  // Decided by `gateDeAsset3d`, which is mounted on the route and has already denied the
  // caller who may not be here. Missing means the handler was reached without its gate,
  // which is a wiring mistake, and the safe reading of a wiring mistake is the closed one.
  const privado = req.assetPrivado !== false;

  // --- 0) Per-model `.3dtiles` store (`m/<slug>/<key>`) ---
  // The whole acquis of converted models is served from here: one file per model, the
  // Cesium `.3dtiles` format, addressed by a reserved prefix so the gate above keeps
  // working unchanged (see models3d.service.js).
  const pedido = parsePedidoDeModelo(rel);
  if (pedido) {
    const modelo = await resolverModelo3d(pedido.id);
    // A model the catalog does not publish (no row, or `active = false`) has to be
    // indistinguishable from one that never existed — the same ladder sv360 states in as
    // many words, and the reason a 403 would be wrong here: it would confirm the
    // existence of the very model whose existence is the private part.
    if (!modelo || !modelo.ativo) return next(new NotFoundError('3D model'));
    if (!pedido.chave) return next(new BadRequestError('Invalid key'));

    const etag = computeTileETag(modelo.id, pedido.chave, modelo.buildToken);
    setModelHeaders(res, etag, tipoDe(pedido.chave), privado, ehDocumento(pedido.chave));
    // Free 304: the ETag is derived from (model, key, token), so revalidation never
    // opens the file. That is the branch this whole design exists to keep cheap.
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    return comVaga(res, async () => {
      const buf = await models3dStore.readMedia(modelo.dbFilename, pedido.chave);
      if (!buf) return next(new NotFoundError('3D asset'));
      // Range is parsed AFTER the read here, unlike the two branches below: there is no
      // O(1) size for a key inside a `.3dtiles` (the format stores no length column), and
      // paying a second query to learn it would cost more than the slice it saves. Range
      // is not how Cesium fetches tiles anyway; it is honoured for completeness.
      const range = req.headers.range ? parseRange(req.headers.range, buf.length) : null;
      if (range === 'invalid') {
        return res.status(416).setHeader('Content-Range', `bytes */${buf.length}`).end();
      }
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buf.length}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
        return res.end(buf.subarray(range.start, range.end + 1));
      }
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    });
  }

  // --- 1) SQLite store (BLOB in heap → semaphore; 304 BEFORE reading the BLOB) ---
  const meta = store.getAssetMeta(rel);
  if (meta) {
    setImmutableHeaders(res, meta.etag, meta.content_type, privado);
    if (req.headers['if-none-match'] === meta.etag) return res.status(304).end();

    const range = req.headers.range ? parseRange(req.headers.range, meta.size_bytes) : null;
    if (range === 'invalid') {
      return res.status(416).setHeader('Content-Range', `bytes */${meta.size_bytes}`).end();
    }

    return comVaga(res, async () => {
      const buf = await store.getAssetData(rel); // read BLOB on a worker thread
      if (!buf) return next(new NotFoundError('3D asset'));
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${meta.size_bytes}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
        return res.end(buf.subarray(range.start, range.end + 1));
      }
      res.setHeader('Content-Length', meta.size_bytes);
      return res.end(buf);
    });
  }

  // --- 2) Filesystem fallback (stream; no semaphore needed) ---
  const fmeta = await assets3dService.resolveAsset(rel); // throws NotFound/Forbidden
  setImmutableHeaders(res, fmeta.etag, fmeta.contentType, privado);
  if (req.headers['if-none-match'] === fmeta.etag) return res.status(304).end();

  const range = req.headers.range ? parseRange(req.headers.range, fmeta.size) : null;
  if (range === 'invalid') {
    return res.status(416).setHeader('Content-Range', `bytes */${fmeta.size}`).end();
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fmeta.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return streamFileToResponse(res, next, fmeta.path, { start: range.start, end: range.end });
  }
  res.setHeader('Content-Length', fmeta.size);
  return streamFileToResponse(res, next, fmeta.path);
});
