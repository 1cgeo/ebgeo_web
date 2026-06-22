// Path: src/modules/atlas/atlas.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { publicLinkLimiter } from '../../middleware/rate-limit.js';
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
router.get('/public/:link', publicLinkLimiter, ctrl.getPublicAtlas);
router.get('/:atlasId', auth, requireAtlasPermission('read'), ctrl.getAtlas);
router.put('/:atlasId', auth, requireAtlasPermission('write'), validate({ body: schemas.updateAtlasSchema }), ctrl.updateAtlas);
router.delete('/:atlasId', auth, requireAtlasPermission('owner'), ctrl.deleteAtlas);

// Settings (co-Gestor pode configurar o atlas)
router.get('/:atlasId/settings', auth, requireAtlasPermission('read'), ctrl.getSettings);
router.patch('/:atlasId/settings', auth, requireAtlasPermission('manage'), validate({ body: schemas.atlasSettingsSchema }), ctrl.updateSettings);

// Ownership transfer (owner-only). Elege um membro como novo dono; o ex-dono vira 'manage'.
router.post('/:atlasId/transfer', auth, requireAtlasPermission('owner'), validate({ body: schemas.transferOwnershipSchema }), ctrl.transferOwnership);

// Clone
router.post('/:atlasId/clone', auth, requireAtlasPermission('read'), validate({ body: schemas.cloneAtlasSchema }), ctrl.cloneAtlas);

// Map operations
router.post('/:atlasId/maps/:mapId/duplicate', auth, requireAtlasPermission('write'), ctrl.duplicateMap);

// Mount nested routers
router.use('/:atlasId/sharing', sharingRoutes);
router.use('/:atlasId/images', imagesRoutes);
router.use('/:atlasId/sync', syncRoutes);
router.use('/:atlasId/maps', mapsRoutes);
router.use('/:atlasId/briefings', briefingsRoutes);

export { router as atlasRoutes };
