// Path: src/modules/ranks/ranks.schemas.js
import Joi from 'joi';

export const createRankSchema = Joi.object({
  nome: Joi.string().required().max(255),
  nome_abrev: Joi.string().max(50).allow(null, ''),
  sort_order: Joi.number().integer().default(0),
});

export const updateRankSchema = Joi.object({
  nome: Joi.string().max(255),
  nome_abrev: Joi.string().max(50).allow(null, ''),
  sort_order: Joi.number().integer(),
  is_active: Joi.boolean(),
}).min(1);

export const rankIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
