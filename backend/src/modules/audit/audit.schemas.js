// Path: src/modules/audit/audit.schemas.js
import Joi from 'joi';

export const listAuditSchema = Joi.object({
  action: Joi.string().max(50),
  actorId: Joi.string().uuid(),
  targetType: Joi.string().max(20),
  // `string`, nunca `uuid`: desde a 020 o alvo é heterogêneo (slug de catálogo,
  // UUID de projeto 360, a chave `app_config`), e um `.uuid()` aqui recusaria
  // justamente os alvos que a migração passou a permitir.
  targetId: Joi.string().max(255),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});
