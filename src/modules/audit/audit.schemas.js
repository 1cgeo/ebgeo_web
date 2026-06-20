// Path: src/modules/audit/audit.schemas.js
import Joi from 'joi';

export const listAuditSchema = Joi.object({
  action: Joi.string().max(50),
  actorId: Joi.string().uuid(),
  targetType: Joi.string().max(20),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});
