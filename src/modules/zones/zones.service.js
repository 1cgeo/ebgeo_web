// Path: src/modules/zones/zones.service.js
import { query, tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as Q from './zones.queries.js';

export async function listZones() {
  const { rows } = await query(Q.LIST_ZONES);
  return rows;
}

export async function getZone(id) {
  const { rows } = await query(Q.FIND_ZONE, [id]);
  if (rows.length === 0) throw new NotFoundError('Zone');
  return rows[0];
}

export async function createZone(data, createdBy) {
  const { rows } = await query(Q.INSERT_ZONE, [
    data.name || null,
    data.description || null,
    JSON.stringify(data.geom),
    createdBy,
  ]);
  return rows[0];
}

export async function deleteZone(id) {
  const { rows } = await query(Q.DELETE_ZONE, [id]);
  if (rows.length === 0) throw new NotFoundError('Zone');
  return { success: true };
}

export async function getZonePermissions(id) {
  const [users, groups] = await Promise.all([
    query(Q.GET_ZONE_USER_PERMS, [id]),
    query(Q.GET_ZONE_GROUP_PERMS, [id]),
  ]);
  return { users: users.rows.map((r) => r.user_id), groups: groups.rows.map((r) => r.group_id) };
}

/**
 * Replace-set of zone permissions (users + groups) in one transaction,
 * auditing the diff. An empty array means "remove all" (intentional).
 */
export async function setZonePermissions(req, zoneId, { users = [], groups = [] }) {
  return tx(async (t) => {
    const before = {
      users: (await t.any(Q.GET_ZONE_USER_PERMS, [zoneId])).map((r) => r.user_id),
      groups: (await t.any(Q.GET_ZONE_GROUP_PERMS, [zoneId])).map((r) => r.group_id),
    };
    await t.none(Q.DELETE_ZONE_USER_PERMS, [zoneId]);
    await t.none(Q.DELETE_ZONE_GROUP_PERMS, [zoneId]);
    if (users.length) await t.none(Q.INSERT_ZONE_USER_PERMS, [zoneId, users]);
    if (groups.length) await t.none(Q.INSERT_ZONE_GROUP_PERMS, [zoneId, groups]);

    await createAudit(req, {
      action: 'PERMISSION_GRANT', actorId: req.user.id, targetType: 'ZONE', targetId: zoneId,
      details: { before, after: { users, groups } },
    }, t);

    return { users, groups };
  });
}
