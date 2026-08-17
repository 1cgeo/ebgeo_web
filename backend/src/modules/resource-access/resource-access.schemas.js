// Path: src/modules/resource-access/resource-access.schemas.js
import Joi from 'joi';
import { RESOURCE_TYPES } from './resource-access.types.js';

/** `:type/:id` — o tipo é validado na BORDA porque ele escolhe nome de tabela. */
export const resourceParamsSchema = Joi.object({
  type: Joi.string().valid(...RESOURCE_TYPES).required(),
  id: Joi.string().min(1).max(255).required(),
});

export const visibilitySchema = Joi.object({
  accessLevel: Joi.string().valid('public', 'private').required(),
});
