// Path: src/modules/sharing/sharing.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import * as ctrl from './sharing.controller.js';
import * as schemas from './sharing.schemas.js';

const router = Router({ mergeParams: true });

// Sharing is a co-Gestor ('manage') capability, not owner-only. A manager can grant up to
// 'manage' (the share enum max — 'owner' is NOT grantable) and remove other members, but can
// never touch the owner. Tentar remover o dono responde **404**, não um no-op silencioso: esta
// linha dizia "a no-op on them" até 2026-07-25 e mentia sobre o service que ela mesma monta,
// o que importa porque um cliente escrito contra o comentário trataria a recusa como sucesso.
// Ownership changes only via the owner-only transfer route.
router.get('/', auth, requireAtlasPermission('manage'), ctrl.getSharingConfig);
router.post('/public', auth, requireAtlasPermission('manage'), ctrl.enablePublicSharing);
router.delete('/public', auth, requireAtlasPermission('manage'), ctrl.disablePublicSharing);
router.post('/users', auth, requireAtlasPermission('manage'), validate({ body: schemas.addUserShareSchema }), ctrl.addUserShare);
router.put('/users/:userId', auth, requireAtlasPermission('manage'), validate({ body: schemas.updateUserShareSchema }), ctrl.updateUserShare);
router.delete('/users/:userId', auth, requireAtlasPermission('manage'), ctrl.removeUserShare);

export { router as sharingRoutes };
