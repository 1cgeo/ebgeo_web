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
// Trash: list the caller's own soft-deleted atlases. MUST precede '/:atlasId' (literal vs param).
router.get('/trash', auth, ctrl.listTrash);
// Idem: rotas literais ANTES do parâmetro, senão '/overview' entra como um atlasId e responde 400.
// Nenhuma das duas leva `requireAtlasPermission`: elas não falam de UM atlas, e o escopo (só os
// atlas que o chamador alcança) está dentro da própria consulta, que é onde ele não escapa.
router.get('/overview', auth, ctrl.listAtlasOverview);
router.get('/presence', auth, ctrl.listAtlasPresence);
router.get('/:atlasId', auth, requireAtlasPermission('read'), ctrl.getAtlas);
router.put('/:atlasId', auth, requireAtlasPermission('write'), validate({ body: schemas.updateAtlasSchema }), ctrl.updateAtlas);
router.delete('/:atlasId', auth, requireAtlasPermission('owner'), ctrl.deleteAtlas);
// Restore is owner-checked inside the service (the atlas is soft-deleted, so requireAtlasPermission
// — which only sees live atlases — cannot gate it).
router.post('/:atlasId/restore', auth, validate({ params: schemas.atlasIdParamsSchema }), ctrl.restoreAtlas);

// Settings (co-Gestor pode configurar o atlas)
router.get('/:atlasId/settings', auth, requireAtlasPermission('read'), ctrl.getSettings);
router.patch('/:atlasId/settings', auth, requireAtlasPermission('manage'), validate({ body: schemas.atlasSettingsSchema }), ctrl.updateSettings);

// Ownership transfer (owner-only). Elege um membro como novo dono; o ex-dono vira 'manage'.
router.post('/:atlasId/transfer', auth, requireAtlasPermission('owner'), validate({ body: schemas.transferOwnershipSchema }), ctrl.transferOwnership);

// Capa do atlas. Gate em 'write', o mesmo de renomear: capa e nome são a identidade visível do
// projeto, e quem pode trocar uma pode trocar a outra. 'manage' seria a régua do compartilhamento,
// que é outra coisa.
router.put('/:atlasId/cover', auth, requireAtlasPermission('write'), validate({ body: schemas.atlasCoverSchema }), ctrl.setAtlasCover);
router.delete('/:atlasId/cover', auth, requireAtlasPermission('write'), ctrl.deleteAtlasCover);

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
