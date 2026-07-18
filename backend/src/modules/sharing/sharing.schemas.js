// Path: src/modules/sharing/sharing.schemas.js
import Joi from 'joi';

// Grantable per-atlas permissions. `owner` is NOT grantable here (it comes from
// atlas.owner_id; ownership changes only via the transfer route).
const GRANTABLE_PERMISSIONS = ['read', 'comment', 'write', 'manage'];

export const addUserShareSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});

export const updateUserShareSchema = Joi.object({
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});
