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
import crypto from 'node:crypto';
import { asyncHandler } from '../../utils/async-handler.js';
import { streamFileToResponse } from '../../utils/stream-file.js';
import { NotFoundError } from '../../utils/errors.js';
import { createSemaphore } from '../../utils/semaphore.js';
import config from '../../config.js';
import * as svc from './sv360.service.js';
import * as blobstore from './sv360.blobstore.js';

// A shared cache (CDN/proxy) may only store a response that every caller is
// allowed to see. An `enabled` AND `public` project is genuinely public, so
// `public` is correct there. Anything else is access-controlled — a `disabled`
// project (admin / producing org) or a `private` one (grant / atlas loan) — and
// caching it publicly would let a proxy replay one authorized response to an
// anonymous caller, so those are `private` and carry `Vary` (P6).
//
// ESTE PARÁGRAFO CITAVA UM EIXO SÓ até a fase F9 ("an `enabled` project is public"),
// e a decisão logo abaixo o seguia à risca: a imagem de um projeto `enabled + private`
// saía `public, immutable` por um ano. O eixo de privacidade nasceu na F6 e nem a
// prosa nem o código o tinham aprendido.
const IMMUTABLE_PUBLIC = 'public, max-age=31536000, immutable';
const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';

// A RESPOSTA DEPENDEU DE QUEM PEDIU?
//
// Duas fontes, e a segunda nasceu na fase F9. `req.user` sempre valeu: o corpo de um
// tile embute papel e escopo de produção, então marcá-lo `public` autorizaria um cache
// compartilhado a repor o tile de um membro para um anônimo. `req.atlasId` é o atlas em
// foco DEPOIS de `requireAtlasScopeWhenPresent` tê-lo confirmado — e ele é a fonte que
// alcança o caso que `req.user` sozinho NÃO alcança: um atlas `is_public` dá `read` a
// chamador ANÔNIMO, então, com o empréstimo ligado, uma resposta anônima pode carregar
// panorama emprestado. Sem este segundo termo, essa resposta sairia `public` e o
// empréstimo vazaria pelo cache, que é a porta dos fundos exata que a fase fecha.
//
// A propriedade que isto preserva, e que vale escrever por extenso: RESPOSTA QUE
// DEPENDEU DE EMPRÉSTIMO NUNCA É PUBLICAMENTE CACHEÁVEL. O teste conservador (todo
// atlas em foco fecha o cache, mesmo quando o empréstimo não acrescentou nada) é
// deliberado: o alternativo exigiria o SQL devolver "esta linha veio do braço de
// empréstimo", uma segunda definição do predicado dentro da consulta que ele mesmo é.
function respostaEscopada(req) {
  return Boolean(req.user) || Boolean(req.atlasId);
}

// Rotas JSON: `private, no-cache` quando a resposta dependeu de quem pediu.
//
// Elas nunca emitiram Cache-Control nenhum, o que autoriza um proxy compartilhado a
// aplicar cache HEURÍSTICO — aceitável enquanto o corpo era o mesmo para todos, e não
// mais depois que ele passa a variar por concessão e por empréstimo. `no-cache` (e não
// `no-store`) de propósito: o navegador continua guardando e REVALIDANDO pelo ETag
// fraco que o Express deriva do CORPO, que já incorpora o conjunto de visibilidade por
// construção. Resposta pública continua sem cabeçalho, como sempre esteve.
function marcarEscopoJson(req, res) {
  if (!respostaEscopada(req)) return;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization, Cookie');
}

// Tiles (MVT e o geojson legado): 60 s, `public` só quando nada na resposta dependeu
// de quem pediu.
function marcarEscopoDeTile(req, res, maxAge) {
  if (respostaEscopada(req)) {
    res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
    res.setHeader('Vary', 'Authorization, Cookie');
  } else {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  }
}
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

// OS DOIS EIXOS DECIDEM O ESCOPO DE CACHE, e até a fase F9 só um deles decidia.
//
// `projectStatus === 'enabled'` sozinho marcava `public, max-age=1ano, immutable` a
// imagem de um projeto `enabled + private` — um recurso que só alcança quem tem
// concessão ou empréstimo, entregue a um cache compartilhado para repor a qualquer um
// pelo ano seguinte. O eixo de PRIVACIDADE nasceu na F6 e esta linha não o aprendeu.
//
// `enabled + public` continua público, e essa é a razão de não ser preciso consultar o
// empréstimo aqui: um recurso público nunca DEPENDEU de empréstimo para ser entregue.
// Se qualquer dos dois eixos disser outra coisa, a resposta é `private` + `Vary`.
function setImmutableHeaders(res, etag, contentType, projectStatus, accessLevel) {
  const isPublic = projectStatus === 'enabled' && accessLevel === 'public';
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
  const projetos = await svc.listProjects(req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json(projetos);
});

// GET /sv360/projects/:slug — bare project object (404 if hidden/missing).
export const getProject = asyncHandler(async (req, res) => {
  const projeto = await svc.getProject(req.params.slug, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json(projeto);
});

// GET /sv360/projects/:slug/floors: the project's floor list, WRAPPED in
// { floors: [...] } (this one key is the frozen contract; the bare-array shape of
// the neighbouring reads does not apply here). A project without floors answers
// { floors: [] } with 200, never 404, which is reserved for a slug that does not
// exist or that the caller may not see (svc.listProjectFloors enforces the same
// read rule as getProject).
export const getProjectFloors = asyncHandler(async (req, res) => {
  const floors = await svc.listProjectFloors(req.params.slug, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json({ floors });
});

// GET /sv360/photos/:uuid[?include_hidden=true] — bare frozen photoMetadataShape.
// Without the flag the targets array is the visible-only one it has always been.
export const getPhoto = asyncHandler(async (req, res) => {
  const foto = await svc.getPhoto(req.params.uuid, req.user, {
    includeHidden: req.query?.include_hidden === true,
    atlasId: req.atlasId ?? null,
  });
  marcarEscopoJson(req, res);
  res.json(foto);
});

// GET /sv360/photos/nearest?lon=&lat= — the photo nearest to a point, WRAPPED in
// { photo } (this one key is the contract the map client reads; the bare-object
// shape of the neighbouring reads does not apply here). 404 when nothing is near.
//
// THE ROUTE ORDER IS LOAD-BEARING, see sv360.routes.js: declared AFTER
// '/photos/:uuid' this handler would never run, 'nearest' would be validated as a
// uuid and the answer would be 422 instead of 404. The client does
// `if (!response.ok) return null`, so the defect would be completely silent.
export const nearestPhoto = asyncHandler(async (req, res, next) => {
  const photo = await svc.nearestPhoto(
    req.query.lon, req.query.lat, req.user, req.atlasId ?? null
  );
  if (!photo) return next(new NotFoundError('Photo'));
  marcarEscopoJson(req, res);
  return res.json({ photo });
});

// GET /sv360/photos/:uuid/nearby?radius=&floor= — same-project photos not yet
// linked to :uuid, nearest first, WRAPPED in { photos }.
export const nearbyPhotos = asyncHandler(async (req, res) => {
  const photos = await svc.nearbyUnlinkedPhotos(
    req.params.uuid,
    { radius: req.query?.radius, floor: req.query?.floor },
    req.user,
    req.atlasId ?? null
  );
  marcarEscopoJson(req, res);
  res.json({ photos });
});

// GET /sv360/projects/review-stats — { stats: { <slug>: { total, reviewed } } }.
// STATIC path, declared BEFORE '/projects/:slug' (see sv360.routes.js).
export const reviewStats = asyncHandler(async (req, res) => {
  const stats = await svc.reviewStatsAllProjects(req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json({ stats });
});

// GET /sv360/projects/:slug/photos — the calibration list + its review counters.
export const getProjectPhotos = asyncHandler(async (req, res) => {
  const dados = await svc.projectCalibrationPhotos(req.params.slug, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json(dados);
});

// GET /sv360/projects/:slug/map — everything the calibration map draws.
export const getProjectMap = asyncHandler(async (req, res) => {
  const mapa = await svc.projectMap(req.params.slug, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json(mapa);
});

// GET /sv360/projects/:slug/runs — the capture runs, WRAPPED in { runs }. Empty
// until the run derivation ETL (scripts/sv360-derive-runs.js) runs over the project.
export const getProjectRuns = asyncHandler(async (req, res) => {
  const runs = await svc.projectRuns(req.params.slug, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json({ runs });
});

// GET /sv360/photos/by-name/:nome — bare frozen photoMetadataShape.
export const getPhotoByName = asyncHandler(async (req, res) => {
  const foto = await svc.photoByName(req.params.nome, req.user, req.atlasId ?? null);
  marcarEscopoJson(req, res);
  res.json(foto);
});

// GET /sv360/tiles/fotos.geojson — bare GeoJSON FeatureCollection of readable
// photos (access embedded in the SQL). NOT wrapped in {data} (frozen 360 shape).
//
// LEGACY feed, kept bounded rather than unbounded (achado 65): ?bbox + ?limit are
// validated by the route schema and always applied (default = the hard cap). The
// live contract is the MVT route below, which is bbox-native. Cacheable like the
// MVT — but only PUBLICLY when the caller is anonymous: for a credentialed caller
// the body includes their org's disabled projects, so a shared cache must not reuse
// it across identities.
const GEOJSON_MAX_AGE = 60;
export const tilesGeojson = asyncHandler(async (req, res) => {
  const fc = await svc.tilesFeatureCollection(req.user, {
    bbox: req.query?.bbox,
    limit: req.query?.limit,
    atlasId: req.atlasId ?? null,
  });
  marcarEscopoDeTile(req, res, GEOJSON_MAX_AGE);
  res.json(fc);
});

// GET /sv360/tiles/:z/:x/:y.pbf — a server-rendered Mapbox Vector Tile (MVT) with
// two layers ('fotos' points + 'fotos_linha' trajectory lines). Access is embedded
// in the SQL (anon never sees a disabled project). The tile MAY be empty (no
// features in the bbox) — that is a valid 200 response (an empty Buffer is a valid
// MVT). Cache-Control is SHORT (NOT immutable): tiles change as projects are
// ingested/tombstoned/toggled. z/x/y are validated as integers by the route schema.
// P6 — the cache scope must follow the ACCESS scope, exactly like the image route
// (IMMUTABLE_PRIVATE + Vary) and like tilesGeojson above. The tile body varies by
// req.user: the query embeds isAdmin/orgId and includes `disabled` projects for a
// caller allowed to see them. Marking that response `public` authorizes a shared
// cache to store one member's tile — disabled-project photos inside — and replay it
// to an anonymous caller for the next 60s, with the application never consulted.
// Anonymous tiles carry only public data and stay publicly cacheable, so the
// legitimate CDN cache is preserved.
const MVT_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile';
const MVT_MAX_AGE = 60;
export const mvtTile = asyncHandler(async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const tile = await svc.mvtTile(z, x, y, req.user, req.atlasId ?? null);
  res.setHeader('Content-Type', MVT_CONTENT_TYPE);
  marcarEscopoDeTile(req, res, MVT_MAX_AGE);

  // O ETag DO TILE, E POR QUE ELE É UM HASH DO CORPO.
  //
  // Esta rota não tinha ETag nenhum: `res.end()` não passa pelo `res.send` do Express,
  // que é quem derivaria um. Com o empréstimo ligado isso deixou de ser só uma
  // revalidação perdida: um ETag que identificasse a TILE (z/x/y) e não o CONJUNTO DE
  // VISIBILIDADE faria um 304 confirmar conteúdo através de escopos diferentes — o
  // mesmo vazamento do `Cache-Control: public`, pela porta dos fundos.
  //
  // O hash do corpo incorpora a visibilidade POR DEFINIÇÃO, sem uma consulta a mais e
  // sem inventar uma segunda chave de escopo (que seria uma segunda definição de "o que
  // este chamador vê", a dívida que `sv360AccessPredicate` acabou de pagar). O corpo já
  // está calculado quando os cabeçalhos sobem; o pior tile medido tem 697 kB, e um
  // SHA-1 disso custa ~1 ms.
  //
  // FRACO (`W/`) de propósito: os bytes do tile são determinísticos para um texto de
  // consulta dado, mas a ORDEM das feições dentro de `ST_AsMVT` não tem `ORDER BY`, de
  // modo que uma reescrita da consulta pode trocar os bytes com o MESMO conjunto de
  // feições. Um ETag forte prometeria identidade de bytes que a consulta não garante; o
  // preço de um `W/` é uma revalidação perdida por reescrita, e não uma promessa falsa.
  // Pela mesma razão, nenhum teste pode afirmar um ETag literal.
  const etag = `W/"${crypto.createHash('sha1').update(tile).digest('base64url')}"`;
  res.setHeader('ETag', etag);
  // O 304 é seguro AQUI e não seria em lugar nenhum antes: o corpo já foi produzido sob
  // o escopo DESTE chamador, então um `If-None-Match` que casa só pode ter vindo de uma
  // resposta que ele mesmo tinha direito de receber.
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  res.setHeader('Content-Length', tile.length);
  return res.status(200).end(tile);
});

// GET /sv360/thumbnails/:slug.webp — serves the per-project {slug}.webp from the
// filesystem with the assets3d ETag-O(1)/304/Range/immutable contract. The .webp
// is a small file, so it STREAMS from the FS (no semaphore). 404 if the project is
// missing/hidden OR the thumbnail file is absent. ETag derives from fs.stat
// (size + mtime) — there is no Postgres *_size_bytes for the thumbnail.
export const getThumbnail = asyncHandler(async (req, res, next) => {
  const thumb = await svc.resolveThumbnailPath(req.params.slug, req.user, req.atlasId ?? null);
  if (!thumb) return next(new NotFoundError('Thumbnail'));
  const { filePath, projectStatus, projectAccessLevel } = thumb;

  const st = await stat(filePath);
  const etag = `"${req.params.slug}-${st.size}-${Math.trunc(st.mtimeMs)}"`;
  setImmutableHeaders(res, etag, 'image/webp', projectStatus, projectAccessLevel);

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
  const d = await svc.getPhotoImageMeta(
    req.params.uuid, quality, req.user, req.atlasId ?? null
  );

  setImmutableHeaders(res, d.etag, d.contentType, d.projectStatus, d.projectAccessLevel);

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
      // The immutable headers went up BEFORE the read (the ETag is O(1) from
      // Postgres), so they are already on this response — and this 404 is the one
      // outcome for which they are wrong. Postgres announcing a photo whose blob is
      // absent is TRANSIENT by construction: it is the residual crash window between
      // PASSO 1 and the PASSO 2 commit (sv360.ingest.js) or a file being restored.
      // Left in place, `public, max-age=31536000, immutable` lets a browser or CDN
      // pin that 404 for a YEAR, so the photo stays "missing" for its viewers long
      // after the drift healed. Content-Type: image/webp on a JSON error body is the
      // same mistake in miniature.
      res.removeHeader('ETag');
      res.removeHeader('Content-Type');
      res.setHeader('Cache-Control', 'no-store');
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
