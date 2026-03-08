// Path: src/modules/auth/auth.schemas.js
import Joi from 'joi';

export const loginSchema = Joi.object({
  username: Joi.string().required().max(100),
  password: Joi.string().required().min(6).max(100),
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const logoutSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export const registerSchema = Joi.object({
  username: Joi.string().required().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Username can only contain letters, numbers, dots, underscores and hyphens',
    }),
  password: Joi.string().required().min(6).max(100),
  nome: Joi.string().required().max(255),
  posto_graduacao: Joi.string().max(50).allow(null, ''),
  organizacao_militar: Joi.string().max(255).allow(null, ''),
});
