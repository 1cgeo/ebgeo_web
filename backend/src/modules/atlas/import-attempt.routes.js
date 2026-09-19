// Path: src/modules/atlas/import-attempt.routes.js
import { Router } from 'express';
import Joi from 'joi';
import { auth, requireAccountPrincipal } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { importSchema } from './atlas.schemas.js';
import { bulkUploadSchema } from '../images/images.schemas.js';
import * as service from './import-attempt.service.js';

export const importAttemptRoutes = Router();
const params = Joi.object({ attemptId: Joi.string().uuid().required() });
importAttemptRoutes.use(auth, requireAccountPrincipal, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
importAttemptRoutes.post('/', validate({ body: Joi.object({
  id: Joi.string().uuid().required(), sourceKey: Joi.string().pattern(/^[0-9a-f]{64}$/).required(),
  payload: importSchema.required(), imageIds: Joi.array().items(Joi.string().uuid()).unique().max(1000).required(),
}) }), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await service.beginImport(req.user.id, req.body) });
}));
importAttemptRoutes.get('/:attemptId', validate({ params }), asyncHandler(async (req, res) => {
  res.json({ data: await service.readImport(req.user.id, req.params.attemptId) });
}));
importAttemptRoutes.delete('/:attemptId', validate({ params }), asyncHandler(async (req, res) => {
  await service.discardImport(req.user.id, req.params.attemptId);
  res.status(204).end();
}));
importAttemptRoutes.post('/:attemptId/images', validate({ params, body: bulkUploadSchema }), asyncHandler(async (req, res) => {
  res.json({ data: await service.stageImportImages(req.user.id, req.params.attemptId, req.body.images) });
}));
importAttemptRoutes.post('/:attemptId/commit', validate({ params }), asyncHandler(async (req, res) => {
  const result = await service.commitImport(req.user.id, req.params.attemptId, { auditRequest: req });
  res.status(201).json({ data: result.atlas });
}));
