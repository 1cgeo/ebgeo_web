// Path: src/modules/maps/maps.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './maps.controller.js';

const router = Router({ mergeParams: true });

// Map read-only routes
// All write operations (create, update, delete) are managed via sync API (POST /atlas/:id/sync)
router.get('/', auth, requireAtlasPermission('read'), ctrl.listMaps);
router.get('/:mapId', auth, requireAtlasPermission('read'), ctrl.getMap);

export { router as mapsRoutes };
