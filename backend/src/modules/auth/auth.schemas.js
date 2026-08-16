// Path: src/modules/auth/auth.schemas.js
import Joi from 'joi';

/**
 * LOGIN DELIBERATELY HAS NO PASSWORD LENGTH RULE, unlike every schema below.
 *
 * A minimum is a REGISTRATION policy: it decides which passwords may be created. Enforcing it
 * again at login only decides which passwords may be TYPED, and that is wrong three ways.
 * It locks out any account whose password predates the rule (admin-created, seeded, migrated).
 * It answers a short guess with a 422 naming the policy while a long guess gets a flat 401,
 * so the response shape leaks the rule to anyone unauthenticated. And it misleads the real
 * user: someone who mistypes a short password is told the password is too short, which reads
 * as "your account needs a longer password" rather than "that is not your password".
 *
 * `required()` stays: an absent password is a malformed request, not a failed login.
 */
export const loginSchema = Joi.object({
  username: Joi.string().required().max(100),
  password: Joi.string().required().max(100),
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
      'string.pattern.base': 'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.',
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
