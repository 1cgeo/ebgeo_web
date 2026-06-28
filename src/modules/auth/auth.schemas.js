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
  // Optional: when provided, the account is created pending and must confirm via e-mail
  // before login. When absent, the account is immediately active (username-only).
  email: Joi.string().email().max(255),
  // FKs: posto (ranks) + OM (organizations). Empty string is normalized to null in the service.
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
});

export const verifyEmailSchema = Joi.object({
  token: Joi.string().uuid().required(),
});

export const resendVerificationSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
});
