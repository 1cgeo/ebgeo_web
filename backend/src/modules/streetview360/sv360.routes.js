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
import { flexibleAuth } from '../../middleware/flexible-auth.js';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
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
// diskStorage STREAMS the (multi-GB) images.db to a tmp path on the SAME volume
// as SV360_DB_DIR (so the later .tmp->dest rename is atomic, not cross-device).
// The manifest + thumbnail are small; all three land in tmp and are cleaned by
// the controller's finally. Field names: manifest / imagesDb / thumbnail.
const ALLOWED_FIELD_MIME = {
  manifest: ['application/json', 'application/octet-stream', 'text/plain'],
  imagesDb: ['application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3', ''],
  thumbnail: ['image/webp', 'application/octet-stream'],
};

const uploadStorage = multer.diskStorage({
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
  limits: { fileSize: config.sv360.maxUploadBytes, files: 3 },
  fileFilter: (req, file, cb) => {
    const allowed = ALLOWED_FIELD_MIME[file.fieldname];
    if (!allowed) return cb(new BadRequestError(`Unexpected upload field: ${file.fieldname}`));
    if (allowed.includes(file.mimetype)) return cb(null, true);
    // octet-stream is the catch-all for SQLite/binary; if the client mislabels,
    // accept anything for imagesDb (validated as SQLite later by validateImagesDb).
    if (file.fieldname === 'imagesDb') return cb(null, true);
    return cb(new BadRequestError(`Invalid mime for ${file.fieldname}: ${file.mimetype}`));
  },
}).fields([
  { name: 'manifest', maxCount: 1 },
  { name: 'imagesDb', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// flexibleAuth (auth OPTIONAL) is applied to the whole router so reads stay
// anon-friendly even when mounted standalone in tests. Write routes ADD the
// STRICT `auth` middleware locally (401 if no/invalid token); `auth` is a no-op
// when req.user is already populated by flexibleAuth, so double-running is safe.
router.use(flexibleAuth);

// --- reads (stage 1) -------------------------------------------------------

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
  ctrl.tilesGeojson
);

// Vector tiles (MVT) — the LIVE source the frontend now consumes (vector source).
// Express captures the literal '.pbf' suffix off :y. z/x/y are validated as
// integers (z 0..24; x/y < 2^z) → a malformed tile coord is a clean 400 BEFORE the
// query (validateTileParams throws BadRequestError, NOT the Joi→422 path). Declared
// alongside the static reads, BEFORE '/photos/:uuid', so 'tiles' is never a slug.
router.get('/tiles/:z/:x/:y.pbf', validateTileParams, ctrl.mvtTile);

// Express strips the literal '.webp' suffix; :slug holds just the project slug.
router.get(
  '/thumbnails/:slug.webp',
  validate({ params: schemas.thumbnailSlugParamSchema }),
  ctrl.getThumbnail
);

router.get('/projects', ctrl.listProjects);

router.get('/projects/:slug', validate({ params: schemas.slugParamSchema }), ctrl.getProject);

// Floors of a project (the floor selector). Same flexibleAuth read policy as
// '/projects/:slug'. The service resolves the project through the access-filtered
// GET_PROJECT_BY_SLUG and 404s a hidden one, so this route adds no new way in. The
// path has one more segment than '/projects/:slug', so declaration order is not
// load-bearing here; it sits next to its sibling for readability.
router.get(
  '/projects/:slug/floors',
  validate({ params: schemas.slugParamSchema }),
  ctrl.getProjectFloors
);

// Declared before '/photos/:uuid' so 'by-name' is not matched as a uuid.
router.get(
  '/photos/by-name/:nome',
  validate({ params: schemas.nomeParamSchema }),
  ctrl.getPhotoByName
);

router.get('/photos/:uuid', validate({ params: schemas.uuidParamSchema }), ctrl.getPhoto);

router.get(
  '/photos/:uuid/image',
  validate({ params: schemas.uuidParamSchema, query: schemas.imageQuerySchema }),
  ctrl.getPhotoImage
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

// --- admin / ingestion (stage 3a) ------------------------------------------
// STRICT `auth` (anon → 401). Ownership (admin global vs om_data_admin) is
// enforced in the SERVICE. The upload runs multer BEFORE the handler (multipart,
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
// anyone with NO write capability at all — a same-org viewer / a bare `user`. This
// is a cheap pre-filter (NOT the per-org ownership check, which still runs in the
// service): a global admin or any org_role ∈ {owner, admin, editor} passes here;
// everyone else gets a drained 403 with no bytes written to disk. Closes the
// authenticated disk-fill DoS.
function requireUploadCapability(req, res, next) {
  const u = req.user;
  const ok =
    !!u &&
    (u.role === 'admin' || ['owner', 'admin', 'editor'].includes(u.org_role));
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

router.delete(
  '/admin/projects/:slug',
  auth,
  validate({ params: aschemas.slugParamSchema, query: aschemas.orgScopeQuerySchema }),
  actrl.deleteProject
);

// LAST: frozen { error: '...' } envelope for this module's routes.
router.use(sv360ErrorHandler);

export { router as sv360Routes };
