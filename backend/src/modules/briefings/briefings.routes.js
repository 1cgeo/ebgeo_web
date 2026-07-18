// Path: src/modules/briefings/briefings.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './briefings.controller.js';

const router = Router({ mergeParams: true });

// Briefings read-only routes
// All write operations (create, update, delete) are managed via sync API (POST /atlas/:id/sync)
router.get('/', auth, requireAtlasPermission('read'), ctrl.listBriefings);
router.get('/:briefingId', auth, requireAtlasPermission('read'), ctrl.getBriefing);

export { router as briefingsRoutes };
