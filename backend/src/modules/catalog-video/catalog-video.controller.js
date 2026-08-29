// Path: src/modules/catalog-video/catalog-video.controller.js
// Serve do vídeo de prévia hospedado, com Range/ETag/304 e streaming, como o `/sv360/thumbnails`.
// Público-por-URL: o token no nome do arquivo é a capacidade (ver o cabeçalho do store).
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import { streamFileToResponse } from '../../utils/stream-file.js';
import * as store from './catalog-video.store.js';

// Cópia local do parser de Range do 360 (privado lá). `'invalid'` -> 416.
function parseRange(range, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m) return 'invalid';
  let start = m[1] !== '' ? parseInt(m[1], 10) : null;
  let end = m[2] !== '' ? parseInt(m[2], 10) : null;
  if (start === null && end === null) return 'invalid';
  if (start === null) { start = size - end; end = size - 1; }
  if (end === null || end >= size) end = size - 1;
  if (start > end || start < 0 || start >= size) return 'invalid';
  return { start, end };
}

/**
 * GET /api/v1/catalog-videos/:file — serve o vídeo. Imutável e público: o nome carrega o token,
 * então o arquivo é único e a URL é a capacidade. 404 para nome fora da forma ou arquivo ausente.
 */
export const serveVideo = asyncHandler(async (req, res, next) => {
  const filePath = store.resolveVideoPath(req.params.file);
  if (!filePath || !existsSync(filePath)) return next(new NotFoundError('Video'));

  const st = await stat(filePath);
  const etag = `"${req.params.file}-${st.size}"`;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', store.contentTypeOf(filePath));

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
