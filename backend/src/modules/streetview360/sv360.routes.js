// Path: src/modules/streetview360/sv360.routes.js
// Routes for the StreetView 360 module (Fase 9, stage 1, read-only).
// All reads use flexibleAuth (auth OPTIONAL): enabled projects are public, so
// anonymous reads work. flexibleAuth is already registered globally in app.js;
// it is applied here defensively so the router also behaves correctly when
// mounted standalone in tests.
//
// Route ordering: GET /photos/by-name/:nome MUST be declared BEFORE
// GET /photos/:uuid, otherwise Express captures 'by-name' as :uuid.
//
// The sv360ErrorHandler is mounted LAST so module errors are translated to the
// frozen { error: '...' } envelope before reaching the global error handler.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { armazenamentoAbortavel } from '../../middleware/armazenamento-abortavel.js';
import { flexibleAuth } from '../../middleware/flexible-auth.js';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { uploadVideo } from '../catalog-video/catalog-video.upload.js';
import { validate } from '../../middleware/validate.js';
import {
  liftOptionalAtlasId, requireAtlasScopeWhenPresent,
} from '../../middleware/resource-access.js';
import { BadRequestError, ForbiddenError } from '../../utils/errors.js';
import config from '../../config.js';
import * as ctrl from './sv360.controller.js';
import * as wctrl from './sv360.write.controller.js';
import * as actrl from './sv360.admin.controller.js';
import * as schemas from './sv360.schemas.js';
import * as wschemas from './sv360.write.schemas.js';
import * as aschemas from './sv360.admin.schemas.js';
import { sv360ErrorHandler } from './sv360-error.js';

const router = Router();

// Validates the MVT tile coords (:z/:x/:y) against tileParamsSchema and converts a
// Joi failure into a BadRequestError (400) — the MVT contract wants 400 for a
// malformed tile, NOT the module's generic Joi→422 path. On success the coerced
// integers are written back to req.params so the controller reads numbers.
function validateTileParams(req, res, next) {
  const { error, value } = schemas.tileParamsSchema.validate(req.params, {
    abortEarly: false,
  });
  if (error) return next(new BadRequestError(error.details?.[0]?.message || 'Invalid tile'));
  req.params = { ...req.params, ...value };
  next();
}

// --- multer (bundle upload) -------------------------------------------------
// The disk storage STREAMS the (multi-GB) images.db to a tmp path on the SAME volume
// as SV360_DB_DIR (so the later .tmp->dest rename is atomic, not cross-device).
// The manifest + thumbnail are small; the three fields land in tmp and are cleaned
// by the controller's finally. Field names: manifest / tilesDb / thumbnail.
//
// `tilesDb` É O ARQUIVO SQLITE DE PIXEL DO PROJETO ({slug}_tiles.db, as pirâmides),
// e desde o tiles-only (2026-08-29) é o único: a `{slug}.db` de blob e o campo
// `imagesDb` saíram. Toda foto passou a ter pirâmide, então `validatePyramidCoverage`
// recusa na borda o bundle que chegue sem ela.
const ALLOWED_FIELD_MIME = {
  manifest: ['application/json', 'application/octet-stream', 'text/plain'],
  tilesDb: ['application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3', ''],
  thumbnail: ['image/webp', 'application/octet-stream'],
};

//
// NAO E `multer.diskStorage`, E AQUI O DEFEITO ERA PIOR QUE NA ROTA DE IMAGENS.
// O teto e de 2 GiB POR ARQUIVO e sao QUATRO campos, entao uma conexao derrubada
// no meio deixava ate quatro tmp gigantes em disco e ate quatro `WriteStream`
// abertos. A limpeza desta rota mora num `finally` de controller
// (`sv360.admin.controller.js:87-94`) que, com o multer pendurado em
// `pendingWrites`, NUNCA e alcancado: o controller nem chega a rodar. O
// `armazenamentoAbortavel` devolve ao multer o erro que o `pipe` comeu, entao a
// requisicao volta a terminar e o `finally` volta a existir. Ver o cabecalho de
// `src/middleware/armazenamento-abortavel.js`.
const uploadStorage = armazenamentoAbortavel({
  destination: (req, file, cb) => {
    try {
      mkdirSync(config.sv360.tmpDir, { recursive: true });
      cb(null, config.sv360.tmpDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const uploadBundle = multer({
  storage: uploadStorage,
  limits: { fileSize: config.sv360.maxUploadBytes, files: 4 },
  fileFilter: (req, file, cb) => {
    const allowed = ALLOWED_FIELD_MIME[file.fieldname];
    if (!allowed) return cb(new BadRequestError(`Unexpected upload field: ${file.fieldname}`));
    if (allowed.includes(file.mimetype)) return cb(null, true);
    // octet-stream is the catch-all for SQLite/binary; if the client mislabels,
    // accept anything for the tiles SQLite field (validated as SQLite later by
    // lerPiramides / validatePyramidCoverage).
    if (file.fieldname === 'tilesDb') return cb(null, true);
    return cb(new BadRequestError(`Invalid mime for ${file.fieldname}: ${file.mimetype}`));
  },
}).fields([
  { name: 'manifest', maxCount: 1 },
  { name: 'tilesDb', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// Troca só da thumbnail (fora do bundle): UM campo, teto pequeno (5 MiB, como o
// `MAX_THUMBNAIL_BYTES` do serviço, que ainda confere por magic bytes antes de gravar).
// Reusa o mesmo storage abortável do bundle.
const uploadThumbnail = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'thumbnail') return cb(new BadRequestError(`Unexpected upload field: ${file.fieldname}`));
    return cb(null, true); // o serviço valida WebP por magic bytes
  },
}).fields([{ name: 'thumbnail', maxCount: 1 }]);

// flexibleAuth (auth OPTIONAL) is applied to the whole router so reads stay
// anon-friendly even when mounted standalone in tests. Write routes ADD the
// STRICT `auth` middleware locally (401 if no/invalid token); `auth` is a no-op
// when req.user is already populated by flexibleAuth, so double-running is safe.
router.use(flexibleAuth);

// --- reads (stage 1) -------------------------------------------------------
//
// O ESCOPO DE ATLAS (`?atlasId=`), E POR QUE SÃO TRÊS MIDDLEWARES E NÃO UM.
//
// O predicado de leitura do 360 (`sv360AccessPredicate`) sempre teve DOIS bracos de
// concessão: a pessoal (`resource_grants`) e a de EMPRÉSTIMO (`atlas_resources`), e o
// segundo depende de um atlas em foco. Até a fase F9 nenhum controller preenchia esse
// parâmetro, então o braco estava morto sobre HTTP e um panorama emprestado a um atlas
// nunca aparecia para os membros dele.
//
// Ligar o eixo exige DUAS condições, e nenhuma é opcional:
//
//   1. O UUID DO ATLAS NÃO AUTORIZA. `validate` fecha a borda (não-UUID vira 422 antes
//      de qualquer cast), `liftOptionalAtlasId` sobe o parâmetro para `req.params`
//      (que é onde os gates de atlas leem) e `requireAtlasScopeWhenPresent` roda o
//      `requireAtlasPermission('read')` de verdade quando ha atlas — dono, share,
//      `is_public`, e o CONFINAMENTO do visitante de link público ao atlas do próprio
//      token. Sem o terceiro, saber o UUID seria o modelo de segurança.
//
//   2. NADA QUE DEPENDEU DO EMPRÉSTIMO E PUBLICAMENTE CACHEÁVEL. Quem cuida disso e o
//      controller (`respostaEscopada`), porque a decisão é por RESPOSTA e não por
//      rota; e o ETag do tile passa a ser derivado do CORPO, que incorpora o conjunto
//      de visibilidade por construção.
//
// A ORDEM DOS TRÊS E CONTRATO, e e a mesma de `GET /resource-access/visible`.
//
// AS ROTAS DE FOTO (`/photos/...`) ENTRARAM DEPOIS, e a ordem importou: enquanto as
// consultas delas (GET_PHOTO_BY_ID, GET_PHOTO_BY_NAME, GET_PHOTO_SIZES, NEARBY_PHOTOS)
// não carregavam `sv360AccessPredicate` nenhum, fiar um `atlasId` ali teria sido fiar um
// parâmetro num predicado inexistente — cobertura aparente. As quatro ganharam o
// predicado no mesmo trabalho que pôs estes três middlewares aqui, então o eixo é real:
// um panorama privado só sai por foto para quem o alcança, e o empréstimo por atlas vale
// para a foto como já valia para a listagem e para o tile.

// STATIC read routes (tiles / thumbnails) declared BEFORE any ':param' route so
// 'tiles' / 'thumbnails' are never captured as a slug/uuid. Both are flexibleAuth
// (read): the access rule lives in the SQL (tiles) and the service (thumbnail).
// LEGACY GeoJSON feed (the live source is the MVT route below). It stays anonymous
// like the MVT — the read filter is embedded in the SQL and covered by a negative
// test — but it is now BOUNDED: `validate` applies the bbox/limit contract, so the
// query can no longer serialize the whole photo table on one pool connection
// (achado 65). NOTE: there is still no rate limiter on any sv360 route.
router.get(
  '/tiles/fotos.geojson',
  validate({ query: schemas.tilesGeojsonQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.tilesGeojson
);

// Vector tiles (MVT) — the LIVE source the frontend now consumes (vector source).
// Express captures the literal '.pbf' suffix off :y. z/x/y are validated as
// integers (z 0..24; x/y < 2^z) → a malformed tile coord is a clean 400 BEFORE the
// query (validateTileParams throws BadRequestError, NOT the Joi→422 path). Declared
// alongside the static reads, BEFORE '/photos/:uuid', so 'tiles' is never a slug.
router.get(
  '/tiles/:z/:x/:y.pbf',
  validate({ query: schemas.atlasScopeQuerySchema }),
  validateTileParams,
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.mvtTile
);

// Express strips the literal '.webp' suffix; :slug holds just the project slug.
router.get(
  '/thumbnails/:slug.webp',
  validate({ params: schemas.thumbnailSlugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getThumbnail
);

router.get(
  '/projects',
  validate({ query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.listProjects
);

// STATIC path, and it MUST stay above '/projects/:slug'. Express matches routes in
// DECLARATION ORDER and has no preference for a literal segment over a parametric
// one — unlike the origin's Fastify (find-my-way), whose comment on this same route
// says order does not matter. Declared after, 'review-stats' would be captured as a
// :slug and answer 404 'Project not found' for a slug nobody asked about.
router.get(
  '/projects/review-stats',
  validate({ query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.reviewStats
);

router.get(
  '/projects/:slug',
  validate({ params: schemas.slugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getProject
);

// Floors of a project (the floor selector). Same flexibleAuth read policy as
// '/projects/:slug'. The service resolves the project through the access-filtered
// GET_PROJECT_BY_SLUG and 404s a hidden one, so this route adds no new way in. The
// path has one more segment than '/projects/:slug', so declaration order is not
// load-bearing here; it sits next to its sibling for readability.
router.get(
  '/projects/:slug/floors',
  validate({ params: schemas.slugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getProjectFloors
);

// --- calibration reads (stage 2b) ------------------------------------------
// Same flexibleAuth read policy as their siblings: each one resolves the project
// through the access-filtered GET_PROJECT_BY_SLUG and 404s a hidden one, so none
// of them opens a new way in. All have one more path segment than
// '/projects/:slug', so declaration order is not load-bearing among them.

// The calibration list of a project + its review counters.
router.get(
  '/projects/:slug/photos',
  validate({ params: schemas.slugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getProjectPhotos
);

// Everything the calibration map draws for one project.
router.get(
  '/projects/:slug/map',
  validate({ params: schemas.slugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getProjectMap
);

// The capture runs of a project. Empty for every project until the derivation
// from original_name has an ETL behind it.
router.get(
  '/projects/:slug/runs',
  validate({ params: schemas.slugParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getProjectRuns
);

// STATIC path, and it MUST stay above '/photos/:uuid'. THIS IS THE TRAP: Express
// matches in declaration order, so declared after, 'nearest' is captured as :uuid
// and validated by uuidParamSchema, which answers 422 — NOT the 404 this route
// promises for "no photo near this point". The map client does
// `if (!response.ok) return null`, so it swallows both codes identically and the
// broken clicks would look exactly like empty ones. The regression test pins the
// 404, not merely "not 200".
router.get(
  '/photos/nearest',
  validate({ query: schemas.nearestQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.nearestPhoto
);

// Declared before '/photos/:uuid' so 'by-name' is not matched as a uuid.
router.get(
  '/photos/by-name/:nome',
  validate({ params: schemas.nomeParamSchema, query: schemas.atlasScopeQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getPhotoByName
);

router.get(
  '/photos/:uuid',
  validate({ params: schemas.uuidParamSchema, query: schemas.photoQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getPhoto
);

// Same-project photos not yet linked to :uuid (the "connect these two" tool).
router.get(
  '/photos/:uuid/nearby',
  validate({ params: schemas.uuidParamSchema, query: schemas.nearbyPhotosQuerySchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.nearbyPhotos
);

// PIRÂMIDE DA PANORÂMICA — o descritor e os tiles. Mesmo gate de leitura da rota de
// imagem acima (flexibleAuth do router + escopo de atlas), porque é a MESMA foto saindo
// por outra porta: predicado numa consulta não protege as outras.
//
// Declaradas ANTES de '/photos/:uuid/image' não é necessário (os caminhos não se
// capturam), mas ficam juntas de propósito: quem mexer no gate de uma tem a outra à
// vista.
router.get(
  '/photos/:uuid/tiles.json',
  validate({ params: schemas.uuidParamSchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getPhotoPyramid
);

router.get(
  '/photos/:uuid/tiles/:level/:x/:y',
  validate({ params: schemas.tileParamSchema }),
  liftOptionalAtlasId,
  requireAtlasScopeWhenPresent,
  ctrl.getPhotoTile
);

// --- writes (stage 2) ------------------------------------------------------
// STRICT `auth` (not flexibleAuth) — credentials required. Ownership (404→403
// ladder) is enforced in the SERVICE, after loading photo→project. Static /
// collection routes (batch-calibration) are declared BEFORE the param routes so
// 'batch-calibration' is never captured as a :uuid; the write routes are anyway
// method-disjoint from the GET /photos/:uuid reads above.

// Batch (static path) — declare before /photos/:uuid... param routes.
router.post(
  '/photos/batch-calibration',
  auth,
  validate({ body: wschemas.batchCalibrationBodySchema }),
  wctrl.batchCalibration
);

// Aggregate + granular calibration.
router.put(
  '/photos/:uuid/calibration',
  auth,
  validate({ params: schemas.uuidParamSchema, body: wschemas.calibrationBodySchema }),
  wctrl.updateCalibration
);
router.put(
  '/photos/:uuid/rotation-x',
  auth,
  validate({ params: schemas.uuidParamSchema, body: wschemas.rotationXBodySchema }),
  wctrl.updateRotationX
);
router.put(
  '/photos/:uuid/rotation-z',
  auth,
  validate({ params: schemas.uuidParamSchema, body: wschemas.rotationZBodySchema }),
  wctrl.updateRotationZ
);
router.put(
  '/photos/:uuid/reviewed',
  auth,
  validate({ params: schemas.uuidParamSchema, body: wschemas.reviewedBodySchema }),
  wctrl.updateReviewed
);

// Targets — visibility (param :uuid + :targetId). Declared before the
// less-specific create/delete so the targetId param schema validates both ids.
router.put(
  '/photos/:uuid/targets/:targetId/visibility',
  auth,
  validate({ params: wschemas.targetIdParamSchema, body: wschemas.targetVisibilityBodySchema }),
  wctrl.setTargetVisibility
);
router.delete(
  '/photos/:uuid/targets/:targetId',
  auth,
  validate({ params: wschemas.targetIdParamSchema }),
  wctrl.deleteTarget
);
router.post(
  '/photos/:uuid/targets',
  auth,
  validate({ params: schemas.uuidParamSchema, body: wschemas.createTargetBodySchema }),
  wctrl.createTarget
);

// Photo soft-delete (tombstone).
router.delete(
  '/photos/:uuid',
  auth,
  validate({ params: schemas.uuidParamSchema }),
  wctrl.softDeletePhoto
);

// --- batch writes by PROJECT / by RUN (stage 2b) ---------------------------
// STRICT `auth`, like every other write here: the ORIGIN has no authentication at
// all on these endpoints, so the authorization is NEW work, not a port. Ownership
// runs in the SERVICE (404 if the project is not even readable, then 403 if
// readable but not writable), so a hidden project stays indistinguishable from a
// nonexistent one. The paths below are method-disjoint from the GET reads on the
// same '/projects/:slug/...' prefix, so they add no ordering hazard.

// One rotation default for every live photo of a project.
router.put(
  '/projects/:slug/batch-calibration',
  auth,
  validate({ params: schemas.slugParamSchema, body: wschemas.batchRotationBodySchema }),
  wctrl.batchCalibrateProject
);

// Clears the review flag of every live photo of a project.
router.post(
  '/projects/:slug/reset-reviewed',
  auth,
  validate({ params: schemas.slugParamSchema }),
  wctrl.resetProjectReviewed
);

// One rotation default for every live photo of a capture run.
router.put(
  '/runs/:runId/batch-calibration',
  auth,
  validate({ params: wschemas.runIdParamSchema, body: wschemas.batchRotationBodySchema }),
  wctrl.batchCalibrateRun
);

// --- admin / ingestion (stage 3a) ------------------------------------------
// STRICT `auth` (anon → 401). Ownership is enforced in the SERVICE, by
// `canWriteProject` (sv360.write.service.js): global admin, OR the PRODUCER of the
// owning OM (`user.producer_org_id === project.organization_id`). This line named
// `om_data_admin`, an axis removed with its column in 2026-08-20; lotação
// (`organization_id`) authorizes nothing, production scope does. The upload runs multer BEFORE the handler (multipart,
// the manifest is validated in the service after reading the tmp file — NOT via
// `validate`, which only sees the parsed multipart body). The static
// '/admin/projects/upload' and '/admin/projects' paths are declared before the
// ':slug' param routes so they are never captured as a slug.

// Forwards an error to next() but DRAINS the multipart request body first.
// Rejecting before reading the upload stream resets the connection (ECONNRESET) on
// the client; draining lets the client finish sending so it sees the clean 4xx.
function drainThen(req, err, next) {
  if (req.method === 'POST' && /multipart\/form-data/i.test(req.headers['content-type'] || '')) {
    req.on('end', () => next(err));
    req.on('error', () => next(err));
    req.resume(); // drain to /dev/null
    return;
  }
  next(err);
}

// Strict auth that DRAINS the multipart request body on rejection (clean 401).
function authDraining(req, res, next) {
  auth(req, res, (err) => {
    if (!err) return next();
    drainThen(req, err, next);
  });
}

// FIX-4: reject (403) BEFORE multer streams up to SV360_MAX_UPLOAD_BYTES to disk
// anyone with NO write capability at all — a bare `user`. This is a cheap
// pre-filter (NOT the per-org ownership check, which still runs in the service): a
// global admin or a PRODUCER passes here; everyone else gets a drained 403 with no
// bytes written to disk. Closes the authenticated disk-fill DoS.
//
// A troca de `org_role` por `producer_org_id` FECHA o pré-filtro em vez de só
// renomeá-lo: `org_role` é crachá dentro de uma OM auto-declarada, então qualquer
// conta que se dissesse editora de qualquer OM passava por aqui e escrevia até 2 GiB
// em disco antes do 403 do serviço. O escopo de produção só um administrador
// concede. O papel é o do token, e este é caminho de `auth` estrito, que o
// reconcilia contra o banco antes de chegar aqui.
function requireUploadCapability(req, res, next) {
  const u = req.user;
  const ok = !!u && (u.role === 'admin' || Boolean(u.producer_org_id));
  if (ok) return next();
  drainThen(req, new ForbiddenError('Upload requires write capability'), next);
}

router.post(
  '/admin/projects/upload',
  authDraining,
  requireUploadCapability,
  uploadBundle,
  actrl.uploadProject
);

router.get(
  '/admin/projects',
  auth,
  validate({ query: aschemas.listAdminQuerySchema }),
  actrl.listProjects
);

router.patch(
  '/admin/projects/:slug/status',
  auth,
  validate({
    params: aschemas.slugParamSchema,
    body: aschemas.statusBodySchema,
    query: aschemas.orgScopeQuerySchema,
  }),
  actrl.updateProjectStatus
);

// METADADO do projeto (hoje só `previewVideo`), vizinha da rota de status e com o MESMO
// gate (`loadWritableProject` no serviço) das irmãs. Esta linha já afirmou que a ordem
// importava ("`:slug` engoliria `/status`"), e não importa: o `:slug` do Express não casa
// `/`, então as duas rotas são disjuntas em qualquer ordem. Restrição fantasma custa ao
// próximo que reordenar.
router.patch(
  '/admin/projects/:slug',
  auth,
  validate({
    params: aschemas.slugParamSchema,
    body: aschemas.projectMetadataBodySchema,
    query: aschemas.orgScopeQuerySchema,
  }),
  actrl.updateProjectMetadata
);

// TRANSFERE A OM DONA (só-admin). Segmento próprio (`/owner-org`), disjunto de `/status`
// e do `:slug` nu, pela mesma razão dos vizinhos. `requireAdmin` porque mover acervo entre
// OMs é ato de sistema; o serviço reafirma.
router.patch(
  '/admin/projects/:slug/owner-org',
  auth,
  requireAdmin,
  validate({
    params: aschemas.slugParamSchema,
    body: aschemas.ownerOrgBodySchema,
    query: aschemas.orgScopeQuerySchema,
  }),
  actrl.transferProjectOwner
);

// TROCA A THUMBNAIL (multipart, campo `thumbnail`). Gate de posse no serviço
// (`loadWritableProject`), como as outras escritas; `auth` estrito na borda.
router.post(
  '/admin/projects/:slug/thumbnail',
  auth,
  uploadThumbnail,
  validate({ params: aschemas.slugParamSchema, query: aschemas.orgScopeQuerySchema }),
  actrl.replaceThumbnail
);

// ENVIO/REMOÇÃO do vídeo de prévia (arquivo hospedado, não URL colada). Mesmo gate das irmãs.
router.post(
  '/admin/projects/:slug/preview-video',
  auth,
  uploadVideo,
  validate({ params: aschemas.slugParamSchema, query: aschemas.orgScopeQuerySchema }),
  actrl.uploadPreviewVideo
);
router.delete(
  '/admin/projects/:slug/preview-video',
  auth,
  validate({ params: aschemas.slugParamSchema, query: aschemas.orgScopeQuerySchema }),
  actrl.removePreviewVideo
);

router.delete(
  '/admin/projects/:slug',
  auth,
  validate({ params: aschemas.slugParamSchema, query: aschemas.orgScopeQuerySchema }),
  actrl.deleteProject
);

// LAST: frozen { error: '...' } envelope for this module's routes.
router.use(sv360ErrorHandler);

export { router as sv360Routes };
