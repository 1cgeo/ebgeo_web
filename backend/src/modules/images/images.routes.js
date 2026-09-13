// Path: src/modules/images/images.routes.js
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import { armazenamentoAbortavel } from '../../middleware/armazenamento-abortavel.js';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { BadRequestError } from '../../utils/errors.js';
import * as ctrl from './images.controller.js';
import * as schemas from './images.schemas.js';
import config from '../../config.js';

const router = Router({ mergeParams: true });

/**
 * Extension for the SERVER-generated blob name. The stored file is always
 * `<uuid>.<ext>`; the client's name never reaches the filesystem.
 *
 * The previous `originalname.split('.').pop()` returned the WHOLE string when the
 * name had no dot, so a 300-char upload produced a 300-char path component
 * (ENAMETOOLONG), and it happily carried a `/` into `path.join`. Bound it to a
 * short lowercase alphanumeric token instead.
 *
 * @param {string} originalname
 * @returns {string}
 */
function safeExtension(originalname) {
  const ext = extname(String(originalname || '')).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext.length > 0 && ext.length <= 8 ? ext : 'bin';
}

// Configure multer for image uploads.
//
// NAO E `multer.diskStorage`, e a troca conserta um defeito medido. Uma conexao
// derrubada no meio do upload deixava o blob parcial em disco E o `WriteStream`
// aberto, porque `req.pipe(busboy)` nao propaga a morte da ORIGEM para o
// DESTINO, entao o multer nunca fechava a requisicao. O
// `armazenamentoAbortavel` tem a mesma assinatura de opcoes e acrescenta o
// gancho de `req:close`. O porque completo esta no cabecalho de
// `src/middleware/armazenamento-abortavel.js`; a prova, em
// `tests/integration/upload-abortado-deixa-blob.repro.test.js`.
const storage = armazenamentoAbortavel({
  destination: (req, file, cb) => {
    const atlasId = req.params.atlasId;
    const dest = join(config.images.dir, atlasId);
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomUUID();
    cb(null, `${uniqueId}.${safeExtension(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // `+ 1` NAO afrouxa o limite: busboy corta quando o contador ATINGE o valor,
    // não quando o ultrapassa (`if (fileSize === fileSizeLimit)` em
    // busboy/lib/types/multipart.js:476). Com `fileSize: maxBytes` cru, um arquivo
    // de exatamente MAX_IMAGE_SIZE_MB era recusado com a mensagem
    // "Image too large (max 10MB)" — a mensagem contradizia o proprio limite, e o
    // guarda irmao em images.service.js:39 (`file.size > maxBytes`) aceitava esse
    // mesmo arquivo. Dois guardas do mesmo contrato discordando em um byte.
    // Com `maxBytes + 1` o corte cai em maxBytes+1, que e a primeira violacao real,
    // e os dois guardas passam a concordar. Fronteira fixada em
    // tests/integration/images-size-boundary.test.js.
    fileSize: config.images.maxSizeMb * 1024 * 1024 + 1,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      // BadRequestError (AppError) so the error handler returns 400, not 500.
      return cb(new BadRequestError('Invalid file type'));
    }

    // Validate the file metadata HERE, the only hook multer runs before writing a
    // single byte: this route used to have no validation at all, and an
    // originalname longer than the filename column produced a 500 plus an orphan
    // blob on disk. A Joi error is forwarded untouched → 422 VALIDATION_ERROR,
    // the same envelope the sibling /bulk route already returns for the same rule.
    const { error } = schemas.uploadFileSchema.validate({ originalname: file.originalname });
    if (error) return cb(error);

    cb(null, true);
  },
});

/**
 * Reads the attempt key out of `X-Idempotency-Key` and parks it on the request.
 *
 * IT RUNS BEFORE MULTER, and that ordering is the point: a malformed key refused here costs
 * nothing, while the same refusal one middleware later would have to delete a blob multer had
 * already written. A header and not a form field, for the same reason: a multipart field is only
 * readable after the body has been consumed.
 *
 * The Joi error is forwarded untouched, so it lands as the 422 VALIDATION_ERROR envelope the rest
 * of the module already answers with. An absent header is an ordinary request AND THERE IS NO
 * FALLBACK: since D7 (2026-09-13) a keyless upload always creates a row, even for bytes the atlas
 * already holds. Falling back to the content would answer with a row the caller never named.
 *
 * @param {import('express').Request} req - The request.
 * @param {import('express').Response} res - Unused; present for the middleware signature.
 * @param {Function} next - Continuation.
 * @returns {void}
 */
function readAttemptKey(req, res, next) {
  const header = req.get('X-Idempotency-Key');
  if (header === undefined || header === '') {
    req.attemptKey = null;
    return next();
  }
  const { error, value } = schemas.attemptKeySchema.validate({ attemptKey: header });
  if (error) return next(error);
  req.attemptKey = value.attemptKey;
  next();
}

// Wrap multer so a MulterError (e.g. LIMIT_FILE_SIZE) maps to a 400 instead of
// falling through to the generic 500 (MulterError has no statusCode). The
// fileFilter's BadRequestError is already an AppError and passes through.
function uploadSingleImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Image too large (max ${config.images.maxSizeMb}MB)`
        : `Upload error: ${err.message}`;
      return next(new BadRequestError(msg));
    }
    if (err) return next(err);
    next();
  });
}

router.get('/', auth, requireAtlasPermission('read'), ctrl.listImages);
// A ORDEM `requireAtlasPermission` → `uploadSingleImage` É CONTRATO, e o que ela vale se mede
// em DISCO: o multer escreve o arquivo antes de qualquer coisa a jusante rodar, então um gate
// depois dele deixa um blob órfão por tentativa recusada, escrito por quem não tem acesso ao
// atlas e limpo por ninguém (o controller nunca chega a rodar). É a mesma lição que o seletor
// do parser de corpo do `/bulk` já pagou em `app.js`, com memória no lugar de disco. Presa
// por `tests/integration/upload-recusado-nao-grava-blob.test.js`.
router.post('/', auth, requireAtlasPermission('write'), readAttemptKey, uploadSingleImage, ctrl.uploadImage);
router.post('/bulk', auth, requireAtlasPermission('write'), validate({ body: schemas.bulkUploadSchema }), ctrl.bulkUploadImages);
router.get('/:imageId', auth, requireAtlasPermission('read'), ctrl.getImage);
router.delete('/:imageId', auth, requireAtlasPermission('write'), ctrl.deleteImage);

export { router as imagesRoutes };
