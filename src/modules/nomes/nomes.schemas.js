// Path: src/modules/nomes/nomes.schemas.js
import Joi from 'joi';

export const buscaSchema = Joi.object({
  q: Joi.string().min(3).max(200).required(),
  lat: Joi.number().required(),
  lon: Joi.number().required(),
  zoom: Joi.number().integer().min(1).max(20).optional(),
});

export const feicoesSchema = Joi.object({
  lat: Joi.number().required(),
  lon: Joi.number().required(),
  z: Joi.number().required(),
});

export const catalogoSchema = Joi.object({
  q: Joi.string().max(200).allow('').optional(),
  page: Joi.number().integer().min(1).default(1),
  nr_records: Joi.number().integer().min(1).max(100).default(10),
});
