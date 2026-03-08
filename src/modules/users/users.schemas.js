// Path: src/modules/users/users.schemas.js
import Joi from 'joi';

export const updateProfileSchema = Joi.object({
  nome: Joi.string().max(255),
  posto_graduacao: Joi.string().max(50).allow(null, ''),
  organizacao_militar: Joi.string().max(255).allow(null, ''),
});

export const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().required().min(6).max(100),
});

export const searchQuerySchema = Joi.object({
  q: Joi.string().required().min(2).max(100),
});

// ============================================
// Admin schemas
// ============================================

export const listUsersQuerySchema = Joi.object({
  includeInactive: Joi.boolean().default(false),
});

export const createUserAdminSchema = Joi.object({
  username: Joi.string().required().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Username can only contain letters, numbers, dots, underscores and hyphens',
    }),
  password: Joi.string().required().min(6).max(100),
  nome: Joi.string().required().max(255),
  posto_graduacao: Joi.string().max(50).allow(null, ''),
  organizacao_militar: Joi.string().max(255).allow(null, ''),
  role: Joi.string().valid('user', 'admin').default('user'),
});

export const updateUserAdminSchema = Joi.object({
  username: Joi.string().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/),
  nome: Joi.string().max(255),
  posto_graduacao: Joi.string().max(50).allow(null, ''),
  organizacao_militar: Joi.string().max(255).allow(null, ''),
  role: Joi.string().valid('user', 'admin'),
  is_active: Joi.boolean(),
});

export const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().required().min(6).max(100),
});

export const userIdParamsSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

export const deleteUserQuerySchema = Joi.object({
  transferTo: Joi.string().uuid(),
});
