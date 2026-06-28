// Path: src/modules/resources/resources.schemas.js
import Joi from 'joi';

const CATEGORIES = [
  'basemap',
  'analysis_layer',
  'data_layer',
  'tileset',
  'streetview_marker',
  'posto',
  'organizacao_militar',
];

export const createSchema = Joi.object({
  id: Joi.string().max(100).required(),
  category: Joi.string().valid(...CATEGORIES).required(),
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

export const querySchema = Joi.object({
  category: Joi.string().valid(...CATEGORIES),
});
