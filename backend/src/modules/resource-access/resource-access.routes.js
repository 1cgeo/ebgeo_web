// Path: src/modules/resource-access/resource-access.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './resource-access.controller.js';
import * as schemas from './resource-access.schemas.js';

const router = Router();

/**
 * PATCH /api/v1/resource-access/:type/:id/visibility
 *
 * Marcar um recurso como privado é ato de ADMINISTRAÇÃO do catálogo, não de
 * compartilhamento: quem tem concessão pode repassar acesso, e não decidir que o
 * recurso deixou de ser público para todo mundo. Daí `requireAdmin` e não o gate
 * de compartilhar.
 */
router.patch(
  '/:type/:id/visibility',
  auth,
  requireAdmin,
  validate({ params: schemas.resourceParamsSchema, body: schemas.visibilitySchema }),
  ctrl.setVisibility,
);

export { router as resourceAccessRoutes };
