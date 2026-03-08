// Path: src/modules/sync/sync.schemas.js
import Joi from 'joi';

export const cleanupSchema = Joi.object({
  keepFromVersion: Joi.number().integer().min(0),
  keepDays: Joi.number().integer().min(1).max(365).default(7),
}).or('keepFromVersion', 'keepDays');
