// Path: src/modules/organizations/organizations.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './organizations.controller.js';
import * as schemas from './organizations.schemas.js';

const router = Router();

router.get('/', auth, ctrl.listOrganizations);
router.get('/:id', auth, validate({ params: schemas.orgIdParamsSchema }), ctrl.getOrganization);
// Declarada ANTES de nada que possa capturar o segundo segmento, e depois de `/:id` sem
// prejuízo: os dois caminhos têm profundidades diferentes, então não competem. `requireAdmin`
// porque a contagem revela o efetivo e o acervo de uma OM, que não é dado de leitor comum
// (`GET /:id` acima é só `auth` porque a OM em si já sai no `/api/config` anônimo).
router.get('/:id/deactivation-impact', auth, requireAdmin, validate({ params: schemas.orgIdParamsSchema }), ctrl.getDeactivationImpact);
router.post('/', auth, requireAdmin, validate({ body: schemas.createOrganizationSchema }), ctrl.createOrganization);
router.put('/:id', auth, requireAdmin, validate({ params: schemas.orgIdParamsSchema, body: schemas.updateOrganizationSchema }), ctrl.updateOrganization);
router.delete('/:id', auth, requireAdmin, validate({ params: schemas.orgIdParamsSchema }), ctrl.deleteOrganization);

export { router as organizationsRoutes };
