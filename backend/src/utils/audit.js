// Path: src/utils/audit.js
// Business audit helper. The optional 3rd arg `t` makes the audit participate in
// the business transaction (rolls back together). Distinct from operational logging.
import { query as dbQuery } from '../database/index.js';
import { INSERT_AUDIT } from '../modules/audit/audit.queries.js';

/**
 * Records a business audit event.
 * @param {object|null} req - Express req (reads ip/user-agent). May be a partial { ip, get }.
 * @param {object} params - { action, actorId, targetType?, targetId?, targetName?, details? }
 * @param {object} [t] - optional pg-promise transaction task → same transaction.
 */
export async function createAudit(req, params, t) {
  const ip = req?.ip || 'system';
  const userAgent = req?.get ? req.get('user-agent') : null;
  const args = [
    params.action,
    params.actorId,
    params.targetType ?? null,
    params.targetId ?? null,
    params.targetName ?? null,
    params.details ? JSON.stringify(params.details) : null,
    ip,
    userAgent,
  ];
  if (t) {
    await t.none(INSERT_AUDIT, args);
  } else {
    await dbQuery(INSERT_AUDIT, args);
  }
}
