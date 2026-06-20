// Path: src/middleware/error-handler.js
import logger from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errors.js';
import config from '../config.js';

/**
 * Centralized error handler middleware.
 * Must be registered last in the middleware chain.
 */
export function errorHandler(err, req, res, next) {
  // Log all errors
  logger.error({
    err,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
  }, 'Request error');

  // Handle Joi validation errors
  if (err.isJoi) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      },
    });
  }

  // Handle our custom AppError
  if (err instanceof AppError) {
    const response = {
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (err instanceof ValidationError && err.details) {
      response.error.details = err.details;
    }

    return res.status(err.statusCode).json(response);
  }

  // Map common PostgreSQL error codes (SQLSTATE) to clean 4xx responses instead
  // of leaking a raw 500. Messages are generic on purpose — the driver's text can
  // expose column/constraint names, so we never forward err.message here.
  const PG_ERROR_MAP = {
    '23505': { statusCode: 409, code: 'CONFLICT', message: 'Resource already exists' },
    '23503': { statusCode: 409, code: 'CONFLICT', message: 'Referenced resource not found or still in use' },
    '23502': { statusCode: 400, code: 'BAD_REQUEST', message: 'Missing required field' },
    '23514': { statusCode: 400, code: 'BAD_REQUEST', message: 'Value violates a constraint' },
    '22P02': { statusCode: 400, code: 'BAD_REQUEST', message: 'Malformed value (invalid id or type)' },
    '22003': { statusCode: 400, code: 'BAD_REQUEST', message: 'Numeric value out of range' },
  };
  if (typeof err.code === 'string' && PG_ERROR_MAP[err.code]) {
    const mapped = PG_ERROR_MAP[err.code];
    return res.status(mapped.statusCode).json({
      error: { code: mapped.code, message: mapped.message },
    });
  }

  // Handle unknown errors
  const statusCode = err.statusCode || 500;
  const response = {
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isDev ? err.message : 'Something went wrong',
    },
  };

  // Include stack trace in development
  if (config.isDev) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}
