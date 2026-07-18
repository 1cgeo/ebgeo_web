// Path: src/modules/zones/zones.schemas.js
import Joi from 'joi';

const geoJsonPolygon = Joi.object({
  type: Joi.string().valid('Polygon').required(),
  coordinates: Joi.array().items(Joi.array().items(Joi.array().items(Joi.number()))).required(),
}).unknown(true);

export const createZoneSchema = Joi.object({
  name: Joi.string().max(100).allow(null, ''),
  description: Joi.string().allow(null, ''),
  geom: geoJsonPolygon.required(),
});

// PUT /:id replaces the whole zone (name/description/geom), same shape as create.
export const updateZoneSchema = createZoneSchema;

export const setPermissionsSchema = Joi.object({
  users: Joi.array().items(Joi.string().uuid()).default([]),
  groups: Joi.array().items(Joi.string().uuid()).default([]),
});

export const zoneIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
