// Path: src/modules/audit/audit.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as auditService from './audit.service.js';

export const listAudit = asyncHandler(async (req, res) => {
  const result = await auditService.listAudit(req.query);
  res.json({ data: result });
});
