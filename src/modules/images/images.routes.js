// Path: src/modules/images/images.routes.js
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { BadRequestError } from '../../utils/errors.js';
import * as ctrl from './images.controller.js';
import * as schemas from './images.schemas.js';
import config from '../../config.js';

const router = Router({ mergeParams: true });

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const atlasId = req.params.atlasId;
    const dest = join(config.images.dir, atlasId);
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'bin';
    const uniqueId = crypto.randomUUID();
    cb(null, `${uniqueId}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.images.maxSizeMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // BadRequestError (AppError) so the error handler returns 400, not 500.
      cb(new BadRequestError('Invalid file type'));
    }
  },
});

router.get('/', auth, requireAtlasPermission('read'), ctrl.listImages);
router.post('/', auth, requireAtlasPermission('write'), upload.single('image'), ctrl.uploadImage);
router.post('/bulk', auth, requireAtlasPermission('write'), validate({ body: schemas.bulkUploadSchema }), ctrl.bulkUploadImages);
router.get('/:imageId', auth, requireAtlasPermission('read'), ctrl.getImage);
router.delete('/:imageId', auth, requireAtlasPermission('write'), ctrl.deleteImage);

export { router as imagesRoutes };
