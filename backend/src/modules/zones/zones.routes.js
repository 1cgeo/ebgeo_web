// Path: src/modules/zones/zones.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './zones.controller.js';
import * as schemas from './zones.schemas.js';

const router = Router();

router.get('/', auth, requireAdmin, ctrl.listZones);
router.post('/', auth, requireAdmin, validate({ body: schemas.createZoneSchema }), ctrl.createZone);
router.get('/:id', auth, requireAdmin, validate({ params: schemas.zoneIdParamsSchema }), ctrl.getZone);
router.put('/:id', auth, requireAdmin, validate({ params: schemas.zoneIdParamsSchema, body: schemas.updateZoneSchema }), ctrl.updateZone);
router.delete('/:id', auth, requireAdmin, validate({ params: schemas.zoneIdParamsSchema }), ctrl.deleteZone);
router.get('/:id/permissions', auth, requireAdmin, validate({ params: schemas.zoneIdParamsSchema }), ctrl.getZonePermissions);
router.put('/:id/permissions', auth, requireAdmin, validate({ params: schemas.zoneIdParamsSchema, body: schemas.setPermissionsSchema }), ctrl.setZonePermissions);

export { router as zonesRoutes };
