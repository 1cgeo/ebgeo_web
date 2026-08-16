// Path: src/modules/organizations/organizations.schemas.js
import Joi from 'joi';

export const createOrganizationSchema = Joi.object({
  nome: Joi.string().max(255).required(),
  slug: Joi.string().max(100).pattern(/^[a-z0-9-]+$/).required().messages({
    'string.pattern.base': 'Identificador aceita apenas letras minúsculas, números e hífen.',
  }),
  sigla: Joi.string().max(50).allow(null, ''),
});

export const updateOrganizationSchema = Joi.object({
  nome: Joi.string().max(255),
  sigla: Joi.string().max(50).allow(null, ''),
  is_active: Joi.boolean(),
});

export const orgIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
