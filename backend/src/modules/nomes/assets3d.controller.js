// Path: src/modules/nomes/assets3d.controller.js
// Serves immutable 3D assets, PUBLIC (discovery is gated by the authenticated
// catalog). Dual-mode: the SQLite store is tried first; the filesystem `dir` is
// the fallback. Both use ETag O(1)/304/Range. The SQLite path materializes the
// BLOB in the heap, so it is bounded by a semaphore; the FS path streams.
import { createReadStream } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import { createSemaphore } from '../../utils/semaphore.js';
import config from '../../config.js';
import * as store from './assets3d.store.js';
import * as assets3dService from './assets3d.service.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const sem = createSemaphore(config.assets3d.maxInflight);

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

function setImmutableHeaders(res, etag, contentType) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', IMMUTABLE);
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', contentType);
}

export const serveAsset = asyncHandler(async (req, res, next) => {
  const rel = req.params[0];

  // --- 1) SQLite store (BLOB in heap → semaphore; 304 BEFORE reading the BLOB) ---
  const meta = store.getAssetMeta(rel);
  if (meta) {
    setImmutableHeaders(res, meta.etag, meta.content_type);
    if (req.headers['if-none-match'] === meta.etag) return res.status(304).end();

    const range = req.headers.range ? parseRange(req.headers.range, meta.size_bytes) : null;
    if (range === 'invalid') {
      return res.status(416).setHeader('Content-Range', `bytes */${meta.size_bytes}`).end();
    }

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
      const buf = await store.getAssetData(rel); // read BLOB on a worker thread
      if (!buf) {
        release();
        return next(new NotFoundError('3D asset'));
      }
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${meta.size_bytes}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
        return res.end(buf.subarray(range.start, range.end + 1));
      }
      res.setHeader('Content-Length', meta.size_bytes);
      return res.end(buf);
    } catch (err) {
      release();
      throw err;
    }
  }

  // --- 2) Filesystem fallback (stream; no semaphore needed) ---
  const fmeta = await assets3dService.resolveAsset(rel); // throws NotFound/Forbidden
  setImmutableHeaders(res, fmeta.etag, fmeta.contentType);
  if (req.headers['if-none-match'] === fmeta.etag) return res.status(304).end();

  const range = req.headers.range ? parseRange(req.headers.range, fmeta.size) : null;
  if (range === 'invalid') {
    return res.status(416).setHeader('Content-Range', `bytes */${fmeta.size}`).end();
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fmeta.size}`);
    res.setHeader('Content-Length', range.end - range.start + 1);
    return createReadStream(fmeta.path, { start: range.start, end: range.end }).pipe(res);
  }
  res.setHeader('Content-Length', fmeta.size);
  return createReadStream(fmeta.path).pipe(res);
});
