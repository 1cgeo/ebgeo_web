// Path: src/middleware/nomes-access-log.js
// Structured access log for the gazetteer endpoints (auditing). Replaces the
// flat api-access.log of the original microservice with Pino structured logs.
import logger from '../utils/logger.js';

export function nomesAccessLog(req, _res, next) {
  // Log WHICH filters were used, not their values: for a military gazetteer the raw
  // search terms and click coordinates are sensitive and should not land in
  // operational logs (which may ship to aggregators). The audit_trail table is the
  // place for value-level auditing if ever required.
  logger.info(
    {
      category: 'nomes_access',
      userId: req.user?.id ?? null,
      ip: req.ip,
      path: req.path,
      queryKeys: Object.keys(req.query ?? {}),
    },
    'nomes access'
  );
  next();
}
