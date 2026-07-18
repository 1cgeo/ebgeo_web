// Path: src/modules/config/config.routes.js
// GET / is PUBLIC (no auth) — the app must work identically for anonymous users.
// The /admin routes are global-admin only (system config overrides).
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './config.controller.js';
import * as schemas from './config.admin.schemas.js';

const router = Router();

router.get('/', ctrl.getConfig);

// Admin: read the editable config + write overrides (app/features/map2d/map3d/service URLs).
router.get('/admin', auth, requireAdmin, ctrl.getAdminConfig);
router.put('/admin', auth, requireAdmin, validate({ body: schemas.configOverridesSchema }), ctrl.updateConfigOverrides);
router.delete('/admin', auth, requireAdmin, ctrl.clearConfigOverrides);

export { router as configRoutes };
