// Path: src/utils/audit.js
// Business audit helper. The optional 3rd arg `t` makes the audit participate in
// the business transaction (rolls back together). Distinct from operational logging.
import { query as dbQuery } from '../database/index.js';
import { INSERT_AUDIT } from '../modules/audit/audit.queries.js';
import logger from './logger.js';

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

/**
 * Records a business audit event WITHOUT the power to fail the caller.
 *
 * Exists for the two paths where the audit line is worth less than the operation it
 * describes, and where a throw would be actively harmful:
 *
 *  - LOGIN. The audit runs AFTER the credential has already been accepted and the
 *    refresh token persisted. A throw here would answer 500 to a caller whose
 *    password was correct, while a wrong password still answers 401 — which is the
 *    login oracle that `DUMMY_HASH` exists to kill, rebuilt out of the audit table.
 *  - LOGOUT. The route answers 204 for every outcome on purpose
 *    (`auth.controller.js`); letting the trail decide the status would put back the
 *    distinction that comment spends thirty lines removing.
 *
 * NO TRANSACTION ARGUMENT, and that is the point rather than an omission: a failed
 * statement aborts the surrounding Postgres transaction, so "swallow the error"
 * inside a `tx` would swallow the error and still roll the business write back —
 * the worst of both. Transactional audit uses `createAudit(req, params, t)`.
 *
 * @param {object|null} req
 * @param {object} params - Same shape as `createAudit`.
 */
export async function createAuditBestEffort(req, params) {
  try {
    await createAudit(req, params);
  } catch (err) {
    logger.error({ err, action: params?.action }, 'Audit write failed (best-effort path)');
  }
}
