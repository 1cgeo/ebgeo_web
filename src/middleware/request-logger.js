// Path: src/middleware/request-logger.js
import logger from '../utils/logger.js';

/**
 * Request logging middleware using Pino.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
    };

    if (res.statusCode >= 400) {
      logger.warn(logData, 'request error');
    } else {
      logger.info(logData, 'request');
    }
  });

  next();
}
