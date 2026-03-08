// Path: src/modules/resources/resources.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './resources.controller.js';
import * as schemas from './resources.schemas.js';

const router = Router();

// Leitura - qualquer usuário autenticado
router.get('/', auth, validate({ query: schemas.querySchema }), ctrl.list);
router.get('/:id', auth, ctrl.get);

// Escrita - apenas admin
router.post('/', auth, requireAdmin, validate({ body: schemas.createSchema }), ctrl.create);
router.put('/:id', auth, requireAdmin, validate({ body: schemas.updateSchema }), ctrl.update);
router.delete('/:id', auth, requireAdmin, ctrl.remove);

export { router as resourcesRoutes };
