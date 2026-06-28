// Path: src/modules/catalog/catalog.schemas.js
import Joi from 'joi';

export const createSchema = Joi.object({
  id: Joi.string().max(100).required(),
  name: Joi.string().max(255).required(),
  description: Joi.string().allow('', null),
  config: Joi.object().default({}),
  sort_order: Joi.number().integer().default(0),
});

export const updateSchema = Joi.object({
  name: Joi.string().max(255),
  description: Joi.string().allow('', null),
  config: Joi.object(),
  sort_order: Joi.number().integer(),
}).min(1);

export const idParamsSchema = Joi.object({
  id: Joi.string().max(100).required(),
});
