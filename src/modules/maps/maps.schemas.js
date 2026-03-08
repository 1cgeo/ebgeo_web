// Path: src/modules/maps/maps.schemas.js
import Joi from 'joi';

export const createMapSchema = Joi.object({
  name: Joi.string().required().max(255),
  base_layer: Joi.string().max(100).default('carta-topografica'),
  center_lat: Joi.number().min(-90).max(90),
  center_long: Joi.number().min(-180).max(180),
  zoom: Joi.number().min(0).max(22),
  bearing: Joi.number().default(0),
  pitch: Joi.number().min(0).max(85).default(0),
  notes_title: Joi.string().allow(null, ''),
  notes_description: Joi.string().allow(null, ''),
  analysis_layers: Joi.object().default({}),
  catalog_layers: Joi.array().default([]),
});

export const updateMapSchema = Joi.object({
  name: Joi.string().max(255),
  base_layer: Joi.string().max(100),
  center_lat: Joi.number().min(-90).max(90),
  center_long: Joi.number().min(-180).max(180),
  zoom: Joi.number().min(0).max(22),
  bearing: Joi.number(),
  pitch: Joi.number().min(0).max(85),
  notes_title: Joi.string().allow(null, ''),
  notes_description: Joi.string().allow(null, ''),
  analysis_layers: Joi.object(),
  catalog_layers: Joi.array(),
});

export const mapIdParamsSchema = Joi.object({
  atlasId: Joi.string().uuid().required(),
  mapId: Joi.string().uuid().required(),
});
