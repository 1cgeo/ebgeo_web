// Path: src/modules/organizations/organizations.schemas.js
import Joi from 'joi';

export const createOrganizationSchema = Joi.object({
  nome: Joi.string().max(255).required(),
  slug: Joi.string().max(100).pattern(/^[a-z0-9-]+$/).required().messages({
    'string.pattern.base': 'slug can only contain lowercase letters, numbers and hyphens',
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
