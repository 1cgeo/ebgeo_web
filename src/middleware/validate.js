// Path: src/middleware/validate.js

const VALIDATION_OPTIONS = {
  abortEarly: false,
  stripUnknown: true,
};

const SOURCES = ['body', 'params', 'query'];

/**
 * Creates middleware that validates request data against Joi schemas.
 * @param {Object} schemas - { body?, params?, query? } Joi schemas
 * @returns {Function} Express middleware
 */
export function validate(schemas) {
  return (req, res, next) => {
    for (const source of SOURCES) {
      if (!schemas[source]) continue;

      const { error, value } = schemas[source].validate(req[source], VALIDATION_OPTIONS);
      if (error) {
        return next(error);
      }
      req[source] = value;
    }

    next();
  };
}
