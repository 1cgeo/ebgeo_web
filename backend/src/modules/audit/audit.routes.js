// Path: src/modules/audit/audit.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAuditReader } from '../../middleware/require-audit-reader.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './audit.controller.js';
import * as schemas from './audit.schemas.js';

const router = Router();

// A ORDEM É CONTRATO: `requireAuditReader` roda ANTES de `validate` para que o 403 de
// papel não compita com o 422 de query. Quem não lê a trilha não precisa saber que a
// query dele estava malformada.
router.get('/', auth, requireAuditReader, validate({ query: schemas.listAuditSchema }), ctrl.listAudit);

export { router as auditRoutes };
