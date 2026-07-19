// Path: src/modules/users/users.schemas.js
import Joi from 'joi';

// Self-service profile edit. Deliberately does NOT accept `organization_id`:
// a user must not be able to move themselves into another tenant. After the next
// token refresh mints the new org claim, that would grant read access to the
// target org's private sv360 projects (`sv360.queries.js` filters on
// `organization_id`) and pass the org-scoped login/WS gates. Note this does NOT
// cover `ng` (nomes), which is gated per-user/per-group by zone grants
// (`ng.fn_user_zone_geoms`), not by org. Tenant membership is admin-only
// (updateUserAdminSchema).
export const updateProfileSchema = Joi.object({
  nome: Joi.string().max(255),
  rank_id: Joi.string().uuid().allow(null, ''),
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
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
  role: Joi.string().valid('user', 'admin').default('user'),
  // See the note on updateUserAdminSchema.org_role: the column had no writer at all
  // until 2026-07-19, which left the sv360 org-scoped write gate permanently closed.
  org_role: Joi.string().valid('owner', 'admin', 'editor', 'viewer').default('viewer'),
});

export const updateUserAdminSchema = Joi.object({
  username: Joi.string().min(3).max(100).pattern(/^[a-zA-Z0-9._-]+$/),
  nome: Joi.string().max(255),
  rank_id: Joi.string().uuid().allow(null, ''),
  organization_id: Joi.string().uuid().allow(null, ''),
  role: Joi.string().valid('user', 'admin'),
  is_active: Joi.boolean(),
  // Admin approval of a pending e-mail account (and the no-SMTP fallback path): flipping this true
  // unblocks login for an account that was created with an unverified e-mail.
  email_verified: Joi.boolean(),
  // Role WITHIN the user's organization, distinct from the global `role` above.
  // Until 2026-07-19 no code path in either package ever wrote this column: it was
  // read in eight places and set by none, so every user sat on the DEFAULT 'viewer'
  // forever and `canWriteProject` (sv360.write.service.js:36, which requires
  // owner/admin/editor) could never pass. Editing a 360 project was therefore
  // global-admin-only in practice and the whole org-scoped gate was dead code.
  org_role: Joi.string().valid('owner', 'admin', 'editor', 'viewer'),
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
