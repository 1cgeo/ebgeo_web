// Path: src/middleware/nomes-access-log.js
// Structured access log for the gazetteer endpoints (auditing). Replaces the
// flat api-access.log of the original microservice with Pino structured logs.
import logger from '../utils/logger.js';

export function nomesAccessLog(req, _res, next) {
  logger.info(
    {
      category: 'nomes_access',
      userId: req.user?.id ?? null,
      ip: req.ip,
      path: req.path,
      query: req.query,
    },
    'nomes access'
  );
  next();
}
