// Path: src/modules/sync/sync.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import * as ctrl from './sync.controller.js';
import * as schemas from './sync.schemas.js';

const router = Router({ mergeParams: true });

// Admin cleanup endpoints (must come before /:version to avoid catch-all)
router.get('/admin/stats', auth, requireAdmin, ctrl.getCleanupStats);
router.post('/admin/cleanup', auth, requireAdmin, validate({ body: schemas.cleanupSchema }), ctrl.cleanupOperations);

// Sync operations
router.post('/', auth, requireAtlasPermission('write'), validate({ body: schemas.pushSchema }), ctrl.pushOperations);
router.get('/:version', auth, requireAtlasPermission('read'), ctrl.pullOperations);

export { router as syncRoutes };
