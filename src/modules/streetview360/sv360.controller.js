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
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import { createSemaphore } from '../../utils/semaphore.js';
import config from '../../config.js';
import * as svc from './sv360.service.js';
import * as blobstore from './sv360.blobstore.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const sem = createSemaphore(config.sv360.maxInflight);

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

function setImmutableHeaders(res, etag, contentType) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', IMMUTABLE);
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
  const filePath = await svc.resolveThumbnailPath(req.params.slug, req.user);
  if (!filePath) return next(new NotFoundError('Thumbnail'));

  const st = await stat(filePath);
  const etag = `"${req.params.slug}-${st.size}-${Math.trunc(st.mtimeMs)}"`;
  setImmutableHeaders(res, etag, 'image/webp');

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
    return createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  }
  res.setHeader('Content-Length', st.size);
  return createReadStream(filePath).pipe(res);
});

// GET /sv360/photos/:uuid/image?quality=full|preview — ETag O(1) / 304 / Range.
export const getPhotoImage = asyncHandler(async (req, res, next) => {
  const quality = req.query?.quality === 'preview' ? 'preview' : 'full';
  const d = await svc.getPhotoImageMeta(req.params.uuid, quality, req.user);

  setImmutableHeaders(res, d.etag, d.contentType);

  // 304 BEFORE any SQLite touch and BEFORE acquiring the semaphore (the ETag is
  // Postgres-derived → O(1)). Range/Content-Length, however, are derived from the
  // ACTUAL blob length AFTER the read (below) — NOT from Postgres `size_bytes`.
  // In steady state they match (validateImagesDb enforces it at ingest), but the
  // blob lives in the {slug}.db file while the size lives in Postgres, so during
  // the ingest swap↔commit window (or any drift) a same-name image replacement
  // could make them diverge. Trusting the buffer length keeps every 200/206
  // response protocol-correct (Content-Length always == body) regardless.
  if (req.headers['if-none-match'] === d.etag) return res.status(304).end();

  await sem.acquire();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      sem.release();
    }
  };
  res.on('finish', release);
  res.on('close', release);
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
