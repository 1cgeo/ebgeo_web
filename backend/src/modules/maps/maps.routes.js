// Path: src/modules/maps/maps.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './maps.controller.js';
import * as schemas from './maps.schemas.js';

const router = Router({ mergeParams: true });

// Map read-only routes
// Most write operations (create, update, delete) are managed via sync API.
router.get('/', auth, requireAtlasPermission('read'), ctrl.listMaps);
router.get('/:mapId', auth, requireAtlasPermission('read'), ctrl.getMap);

// Atomic structural operation: merge sub-entities of source maps into :mapId.
//
// Gated at 'manage', matching map DELETE on the sync path. It used to require only
// 'write', which had it backwards: delete is SOFT and recoverable via `deleted_at`,
// while merge re-parents six child tables and records the previous `map_id` nowhere,
// so which sub-entity came from which map is lost for good. The less reversible
// operation must not need the lower permission.
router.post('/:mapId/merge', auth, requireAtlasPermission('manage'), validate({ body: schemas.mergeMapsSchema }), ctrl.mergeMaps);

export { router as mapsRoutes };
