// Path: src/modules/streetview360/sv360.controller.js
// HTTP layer for the StreetView 360 module (Fase 9, stage 1, read-only).
//
// The metadata routes return BARE objects/arrays (the 360 contract is NOT
// wrapped in {data:...}, unlike the rest of the backend — intentional/frozen).
//
// The image route mirrors assets3d.controller.js exactly:
//   1. getPhotoImageMeta → { etag, sizeBytes, dbFile, photoId } from Postgres
//      *_size_bytes only (O(1), NO BLOB read).
//   2. setImmutableHeaders.
//   3. If-None-Match === etag → 304 BEFORE touching SQLite and BEFORE the
//      semaphore acquire.
//   4. parseRange; 'invalid' → 416 with Content-Range bytes */size.
//   5. sem.acquire() (released once on res 'finish'/'close'); read the BLOB on a
//      worker thread via the blobstore.
//   6. Range → 206 + Content-Range + slice; else 200 + Content-Length + buffer.
import { stat } from 'node:fs/promises';
import { asyncHandler } from '../../utils/async-handler.js';
import { streamFileToResponse } from '../../utils/stream-file.js';
import { NotFoundError } from '../../utils/errors.js';
import { createSemaphore } from '../../utils/semaphore.js';
import config from '../../config.js';
import * as svc from './sv360.service.js';
import * as blobstore from './sv360.blobstore.js';

// A shared cache (CDN/proxy) may only store a response that every caller is
// allowed to see. An `enabled` project is public, so `public` is correct there.
// A `disabled` project is access-controlled (admin / owning org), and caching it
// publicly would let a proxy replay one authorized response to an anonymous
// caller — so those are `private` and carry `Vary` for good measure (P6).
const IMMUTABLE_PUBLIC = 'public, max-age=31536000, immutable';
const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';
// Exported ONLY so the leak repro can create real contention by holding the permit
// itself. Nothing in `src/` imports it — the twin in assets3d.controller.js does the
// same, and for the same reason: faking contention would make the test vacuous.
export const sem = createSemaphore(config.sv360.maxInflight);

// Parses "bytes=start-end" against `size`. Returns {start,end} | 'invalid'.
// Copied verbatim from assets3d.controller.js.
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

function setImmutableHeaders(res, etag, contentType, projectStatus) {
  const isPublic = projectStatus === 'enabled';
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', isPublic ? IMMUTABLE_PUBLIC : IMMUTABLE_PRIVATE);
  if (!isPublic) {
    // Belt-and-braces for a proxy that ignores `private`: the response varies by
    // caller identity, so it must not be reused across credentials.
    res.setHeader('Vary', 'Authorization, Cookie');
  }
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', contentType);
}

// GET /sv360/projects — bare array of visible projects.
export const listProjects = asyncHandler(async (req, res) => {
  res.json(await svc.listProjects(req.user));
});

// GET /sv360/projects/:slug — bare project object (404 if hidden/missing).
export const getProject = asyncHandler(async (req, res) => {
  res.json(await svc.getProject(req.params.slug, req.user));
});

// GET /sv360/photos/:uuid — bare frozen photoMetadataShape.
export const getPhoto = asyncHandler(async (req, res) => {
  res.json(await svc.getPhoto(req.params.uuid, req.user));
});

// GET /sv360/photos/by-name/:nome — bare frozen photoMetadataShape.
export const getPhotoByName = asyncHandler(async (req, res) => {
  res.json(await svc.photoByName(req.params.nome, req.user));
});

// GET /sv360/tiles/fotos.geojson — bare GeoJSON FeatureCollection of readable
// photos (access embedded in the SQL). NOT wrapped in {data} (frozen 360 shape).
export const tilesGeojson = asyncHandler(async (req, res) => {
  res.json(await svc.tilesFeatureCollection(req.user));
});

// GET /sv360/tiles/:z/:x/:y.pbf — a server-rendered Mapbox Vector Tile (MVT) with
// two layers ('fotos' points + 'fotos_linha' trajectory lines). Access is embedded
// in the SQL (anon never sees a disabled project). The tile MAY be empty (no
// features in the bbox) — that is a valid 200 response (an empty Buffer is a valid
// MVT). Cache-Control is SHORT (NOT immutable): tiles change as projects are
// ingested/tombstoned/toggled. z/x/y are validated as integers by the route schema.
const MVT_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile';
const MVT_CACHE_CONTROL = 'public, max-age=60';
export const mvtTile = asyncHandler(async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const tile = await svc.mvtTile(z, x, y, req.user);
  res.setHeader('Content-Type', MVT_CONTENT_TYPE);
  res.setHeader('Cache-Control', MVT_CACHE_CONTROL);
  res.setHeader('Content-Length', tile.length);
  return res.status(200).end(tile);
});

// GET /sv360/thumbnails/:slug.webp — serves the per-project {slug}.webp from the
// filesystem with the assets3d ETag-O(1)/304/Range/immutable contract. The .webp
// is a small file, so it STREAMS from the FS (no semaphore). 404 if the project is
// missing/hidden OR the thumbnail file is absent. ETag derives from fs.stat
// (size + mtime) — there is no Postgres *_size_bytes for the thumbnail.
export const getThumbnail = asyncHandler(async (req, res, next) => {
  const thumb = await svc.resolveThumbnailPath(req.params.slug, req.user);
  if (!thumb) return next(new NotFoundError('Thumbnail'));
  const { filePath, projectStatus } = thumb;

  const st = await stat(filePath);
  const etag = `"${req.params.slug}-${st.size}-${Math.trunc(st.mtimeMs)}"`;
  setImmutableHeaders(res, etag, 'image/webp', projectStatus);

  // 304 short-circuit BEFORE any read.
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const range = req.headers.range ? parseRange(req.headers.range, st.size) : null;
  if (range === 'invalid') {
    return res.status(416).setHeader('Content-Range', `bytes */${st.size}`).end();
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return streamFileToResponse(res, next, filePath, { start: range.start, end: range.end });
  }
  res.setHeader('Content-Length', st.size);
  return streamFileToResponse(res, next, filePath);
});

// GET /sv360/photos/:uuid/image?quality=full|preview — ETag O(1) / 304 / Range.
export const getPhotoImage = asyncHandler(async (req, res, next) => {
  const quality = req.query?.quality === 'preview' ? 'preview' : 'full';
  const d = await svc.getPhotoImageMeta(req.params.uuid, quality, req.user);

  setImmutableHeaders(res, d.etag, d.contentType, d.projectStatus);

  // 304 BEFORE any SQLite touch and BEFORE acquiring the semaphore (the ETag is
  // Postgres-derived → O(1)). Range/Content-Length, however, are derived from the
  // ACTUAL blob length AFTER the read (below) — NOT from Postgres `size_bytes`.
  // In steady state they match (validateImagesDb enforces it at ingest), but the
  // blob lives in the {slug}.db file while the size lives in Postgres, so during
  // the ingest swap↔commit window (or any drift) a same-name image replacement
  // could make them diverge. Trusting the buffer length keeps every 200/206
  // response protocol-correct (Content-Length always == body) regardless.
  if (req.headers['if-none-match'] === d.etag) return res.status(304).end();

  // Same ordering hazard as `assets3d.controller.js`, and the same fix: the
  // release hooks go up BEFORE `await sem.acquire()`. Under contention the
  // acquire parks in the semaphore queue for an unbounded time, and a client
  // that aborts while parked makes `res` emit 'close' inside that window — a
  // listener attached afterwards never sees it, because the event is not
  // replayed. The permit would then be held forever, and `SV360_MAX_INFLIGHT`
  // such aborts hang photo serving until the process restarts.
  // `acquired` keeps an early 'close' from releasing a permit we do not own yet.
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
    return;
  }
  try {
    const buf = await blobstore.getImage(d.dbFile, d.photoId, quality); // BLOB on a worker thread
    if (!buf) {
      release();
      return next(new NotFoundError('Image'));
    }
    const size = buf.length; // authoritative: the bytes we will actually send
    const range = req.headers.range ? parseRange(req.headers.range, size) : null;
    if (range === 'invalid') {
      return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      return res.end(buf.subarray(range.start, range.end + 1));
    }
    res.setHeader('Content-Length', size);
    return res.end(buf);
  } catch (err) {
    release();
    throw err;
  }
});
