// Path: src/middleware/validate.js
import { ValidationError } from '../utils/errors.js';

/**
 * Creates middleware that validates request data against Joi schemas.
 * @param {Object} schemas - { body?, params?, query? } Joi schemas
 * @returns {Function} Express middleware
 */
export function validate(schemas) {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true, // Remove unknown keys from the validated data
    };

    try {
      if (schemas.body) {
        const { error, value } = schemas.body.validate(req.body, validationOptions);
        if (error) {
          throw error;
        }
        req.body = value;
      }

      if (schemas.params) {
        const { error, value } = schemas.params.validate(req.params, validationOptions);
        if (error) {
          throw error;
        }
        req.params = value;
      }

      if (schemas.query) {
        const { error, value } = schemas.query.validate(req.query, validationOptions);
        if (error) {
          throw error;
        }
        req.query = value;
      }

      next();
    } catch (error) {
      if (error.isJoi) {
        // Pass Joi error to error handler
        next(error);
      } else {
        next(new ValidationError('Validation failed'));
      }
    }
  };
}
