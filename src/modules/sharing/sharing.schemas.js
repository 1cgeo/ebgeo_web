// Path: src/modules/sharing/sharing.schemas.js
import Joi from 'joi';

export const addUserShareSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  permission: Joi.string().valid('read', 'write').required(),
});

export const updateUserShareSchema = Joi.object({
  permission: Joi.string().valid('read', 'write').required(),
});
