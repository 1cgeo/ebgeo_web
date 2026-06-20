// Path: src/modules/organizations/organizations.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './organizations.controller.js';
import * as schemas from './organizations.schemas.js';

const router = Router();

router.get('/', auth, ctrl.listOrganizations);
router.get('/:id', auth, validate({ params: schemas.orgIdParamsSchema }), ctrl.getOrganization);
router.post('/', auth, requireAdmin, validate({ body: schemas.createOrganizationSchema }), ctrl.createOrganization);
router.put('/:id', auth, requireAdmin, validate({ params: schemas.orgIdParamsSchema, body: schemas.updateOrganizationSchema }), ctrl.updateOrganization);
router.delete('/:id', auth, requireAdmin, validate({ params: schemas.orgIdParamsSchema }), ctrl.deleteOrganization);

export { router as organizationsRoutes };
