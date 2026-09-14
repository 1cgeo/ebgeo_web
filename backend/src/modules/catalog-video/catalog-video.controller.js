// Path: src/modules/catalog-video/catalog-video.controller.js
// Serve do vídeo de prévia hospedado, com Range/ETag/304 e streaming, como o `/sv360/thumbnails`.
//
// GATEADO POR RECURSO DESDE 2026-09-14 (decisão D14, achado R6). Ele era público-por-URL: o token
// de 16 bytes no nome do arquivo ERA a capacidade, e marcar o recurso privado não movia byte
// nenhum, porque nada re-cunhava aquele nome. A URL de um recurso que já foi público circulou
// dentro do `/api/config`, que é o documento anônimo e cacheável.
//
// O GATE NÃO REIMPLEMENTA NADA: `FIND_RESOURCE_BY_PREVIEW_VIDEO` carrega o MESMO predicado que a
// listagem e o item de cada família usam, dentro do `WHERE`. Linha nenhuma é 404, e as duas
// causas ("não existe" e "você não vê") são indistinguíveis de propósito.
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import { streamFileToResponse } from '../../utils/stream-file.js';
import { oneOrNone } from '../../database/index.js';
import { principalUserId, atlasScopeId } from '../../utils/principal.js';
import config from '../../config.js';
import * as store from './catalog-video.store.js';
import { FIND_RESOURCE_BY_PREVIEW_VIDEO } from './catalog-video.queries.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const IMMUTABLE_PRIVADO = 'private, max-age=31536000, immutable';

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
 * O CABEÇALHO DE CACHE, decidido pelo eixo de acesso do recurso DONO.
 *
 * IMUTÁVEL NOS DOIS RAMOS, porque o token no nome torna o arquivo único: o que muda é o ESCOPO.
 * Um vídeo de recurso privado saindo `public` seria reposto por um cache compartilhado a quem
 * não o alcança, que é exatamente a porta dos fundos que o gate acabou de fechar. É a mesma
 * forma de `setImmutableHeaders` (`modules/nomes/assets3d.controller.js`), e a razão do `vary()`
 * é a mesma: o CORS já escreveu `Vary: Origin` e o `compression` acrescenta `Accept-Encoding`,
 * então ATRIBUIR o cabeçalho os derrubaria, trocando um risco de cache por outro.
 *
 * Os DOIS nomes são citados porque a isenção do RFC para `Authorization` não cobre o cookie, e
 * `flexibleAuth` lê os dois.
 *
 * @param {import('express').Response} res
 * @param {boolean} privado
 */
function setVideoHeaders(res, privado) {
  res.setHeader('Cache-Control', privado ? IMMUTABLE_PRIVADO : IMMUTABLE);
  if (privado) {
    res.vary('Authorization');
    res.vary('Cookie');
  }
}

/**
 * GET /api/v1/catalog-videos/:file — serve o vídeo do recurso que o chamador enxerga.
 *
 * 404 para nome fora da forma, para arquivo que recurso nenhum referencia (o que inclui o nome
 * ANTIGO de um vídeo re-cunhado), para recurso que o chamador não vê e para arquivo ausente.
 */
export const serveVideo = asyncHandler(async (req, res, next) => {
  const filePath = store.resolveVideoPath(req.params.file);
  if (!filePath) return next(new NotFoundError('Video'));

  // A CONSULTA VEM ANTES DO DISCO, e a ordem não é estilo: perguntar ao sistema de arquivos
  // primeiro faria a resposta distinguir "existe e você não vê" de "não existe" pelo tempo,
  // sobre um nome que o chamador escolhe. O 404 só vale como esconderijo se as duas causas
  // percorrerem o mesmo caminho.
  const dono = await oneOrNone(FIND_RESOURCE_BY_PREVIEW_VIDEO, [
    `${config.catalogVideo.baseUrl}/${req.params.file}`,
    principalUserId(req.user),
    atlasScopeId(req.query?.atlasId),
  ]);
  if (!dono || !existsSync(filePath)) return next(new NotFoundError('Video'));

  const st = await stat(filePath);
  const etag = `"${req.params.file}-${st.size}"`;
  res.setHeader('Accept-Ranges', 'bytes');
  setVideoHeaders(res, dono.access_level !== 'public');
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
