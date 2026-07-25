// Path: src/modules/config/config.routes.js
// GET / is PUBLIC (no auth) — the app must work identically for anonymous users.
// The /admin routes are global-admin only (system config overrides).
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './config.controller.js';
import * as schemas from './config.admin.schemas.js';
import { configLimiter } from '../../middleware/rate-limit.js';

const router = Router();

// The limiter guards the ANONYMOUS route only. The /admin routes below are behind `auth` +
// `requireAdmin`, so they already have an identity to hold responsible and a much smaller
// population; throttling them by IP would only put every admin of one OM in a single bucket.
router.get('/', configLimiter, ctrl.getConfig);

// Admin: read the editable config + write overrides (app/features/map2d/map3d/service URLs).
router.get('/admin', auth, requireAdmin, ctrl.getAdminConfig);
router.put('/admin', auth, requireAdmin, validate({ body: schemas.configOverridesSchema }), ctrl.updateConfigOverrides);
router.delete('/admin', auth, requireAdmin, ctrl.clearConfigOverrides);

export { router as configRoutes };
