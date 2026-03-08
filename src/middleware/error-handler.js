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
