// Path: src/modules/audit/audit.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './audit.controller.js';
import * as schemas from './audit.schemas.js';

const router = Router();

router.get('/', auth, requireAdmin, validate({ query: schemas.listAuditSchema }), ctrl.listAudit);

export { router as auditRoutes };
