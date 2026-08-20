// Path: src/middleware/validate.js

/**
 * The one set of Joi options every border uses.
 *
 * EXPORTED because the WebSocket border does not go through this middleware and has to validate
 * `sync.schemas.js` by hand (`collab.handlers.js` `validateOps`). While that call passed no
 * options, the SAME schema behaved differently on the two doors: `stripUnknown` defaults to false,
 * so a tightening written for the HTTP path silently did nothing over the socket. Two doors, one
 * option object.
 */
export const VALIDATION_OPTIONS = {
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
