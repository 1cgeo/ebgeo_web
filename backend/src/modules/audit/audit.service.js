// Path: src/modules/audit/audit.service.js
import { query } from '../../database/index.js';
import * as Q from './audit.queries.js';

export async function listAudit({ action, actorId, targetType, page, limit }) {
  const offset = (page - 1) * limit;
  const filters = [action ?? null, actorId ?? null, targetType ?? null];
  const [data, count] = await Promise.all([
    query(Q.LIST_AUDIT, [...filters, limit, offset]),
    query(Q.COUNT_AUDIT, filters),
  ]);
  return { total: count.rows[0].total, page, limit, data: data.rows };
}
