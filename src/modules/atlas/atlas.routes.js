// Path: src/modules/atlas/atlas.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './atlas.controller.js';
import * as schemas from './atlas.schemas.js';

// Sub-routers (nested resources)
import { sharingRoutes } from '../sharing/index.js';
import { imagesRoutes } from '../images/index.js';
import { syncRoutes } from '../sync/index.js';
import { mapsRoutes } from '../maps/index.js';
import { briefingsRoutes } from '../briefings/index.js';

const router = Router();

// Atlas CRUD
router.get('/', auth, ctrl.listAtlas);
router.post('/', auth, validate({ body: schemas.createAtlasSchema }), ctrl.createAtlas);
router.post('/import', auth, validate({ body: schemas.importSchema }), ctrl.importAtlas);
router.get('/public/:link', ctrl.getPublicAtlas);
router.get('/:atlasId', auth, requireAtlasPermission('read'), ctrl.getAtlas);
router.put('/:atlasId', auth, requireAtlasPermission('write'), validate({ body: schemas.updateAtlasSchema }), ctrl.updateAtlas);
router.delete('/:atlasId', auth, requireAtlasPermission('owner'), ctrl.deleteAtlas);

// Settings
router.get('/:atlasId/settings', auth, requireAtlasPermission('read'), ctrl.getSettings);
router.patch('/:atlasId/settings', auth, requireAtlasPermission('owner'), validate({ body: schemas.atlasSettingsSchema }), ctrl.updateSettings);

// Clone
router.post('/:atlasId/clone', auth, requireAtlasPermission('read'), validate({ body: schemas.cloneAtlasSchema }), ctrl.cloneAtlas);

// Mount nested routers
router.use('/:atlasId/sharing', sharingRoutes);
router.use('/:atlasId/images', imagesRoutes);
router.use('/:atlasId/sync', syncRoutes);
router.use('/:atlasId/maps', mapsRoutes);
router.use('/:atlasId/briefings', briefingsRoutes);

export { router as atlasRoutes };
