// Path: src/modules/nomes/nomes.schemas.js
import Joi from 'joi';

// lat/lon are bounded to valid WGS84 ranges: both queries build a point cast to
// ::geography, which PostGIS rejects for |lat|>90 / |lon|>180 with a 500 — reject
// at the validation border with a 422 instead.
export const buscaSchema = Joi.object({
  q: Joi.string().min(3).max(200).required(),
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
  zoom: Joi.number().integer().min(1).max(20).optional(),
});

export const feicoesSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
  z: Joi.number().required(),
});

export const catalogoSchema = Joi.object({
  q: Joi.string().max(200).allow('').optional(),
  page: Joi.number().integer().min(1).default(1),
  nr_records: Joi.number().integer().min(1).max(100).default(10),
});
