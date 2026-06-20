// Path: src/modules/maps/maps.schemas.js
import Joi from 'joi';

export const mergeMapsSchema = Joi.object({
  sourceMapIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
});
