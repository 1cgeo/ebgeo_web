// Path: src/modules/sharing/sharing.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './sharing.controller.js';
import * as schemas from './sharing.schemas.js';

const router = Router({ mergeParams: true });

router.get('/', auth, requireAtlasPermission('owner'), ctrl.getSharingConfig);
router.post('/public', auth, requireAtlasPermission('owner'), ctrl.enablePublicSharing);
router.delete('/public', auth, requireAtlasPermission('owner'), ctrl.disablePublicSharing);
router.post('/users', auth, requireAtlasPermission('owner'), validate({ body: schemas.addUserShareSchema }), ctrl.addUserShare);
router.put('/users/:userId', auth, requireAtlasPermission('owner'), validate({ body: schemas.updateUserShareSchema }), ctrl.updateUserShare);
router.delete('/users/:userId', auth, requireAtlasPermission('owner'), ctrl.removeUserShare);

export { router as sharingRoutes };
