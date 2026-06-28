// Path: src/modules/ranks/ranks.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './ranks.controller.js';
import * as schemas from './ranks.schemas.js';

const router = Router();

router.get('/', auth, ctrl.listRanks);
router.get('/:id', auth, validate({ params: schemas.rankIdParamsSchema }), ctrl.getRank);
router.post('/', auth, requireAdmin, validate({ body: schemas.createRankSchema }), ctrl.createRank);
router.put('/:id', auth, requireAdmin, validate({ params: schemas.rankIdParamsSchema, body: schemas.updateRankSchema }), ctrl.updateRank);
router.delete('/:id', auth, requireAdmin, validate({ params: schemas.rankIdParamsSchema }), ctrl.deleteRank);

export { router as ranksRoutes };
