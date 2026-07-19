// Path: src/modules/zones/zones.service.js
import { query, tx } from '../../database/index.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as Q from './zones.queries.js';

/**
 * Rejects a geometry that PostGIS cannot parse or that is topologically invalid
 * (self-intersection, unclosed ring) with a 422 — defense beyond the Joi shape.
 */
async function assertValidGeom(geom) {
  let valid;
  try {
    const { rows } = await query(Q.VALIDATE_GEOM, [JSON.stringify(geom)]);
    valid = rows[0]?.valid;
  } catch {
    throw new ValidationError('Invalid GeoJSON geometry');
  }
  if (!valid) throw new ValidationError('Invalid zone geometry (ST_IsValid failed)');
}

export async function listZones() {
  const { rows } = await query(Q.LIST_ZONES);
  return rows;
}

export async function getZone(id) {
  const { rows } = await query(Q.FIND_ZONE, [id]);
  if (rows.length === 0) throw new NotFoundError('Zone');
  return rows[0];
}

// A zone's GEOMETRY is an access boundary: whether a private place name is visible
// depends on whether it falls inside a zone the caller holds permission on. Redrawing
// a polygon therefore changes who sees what, exactly as granting or revoking would,
// and used to leave no record. Only setZonePermissions audited, which made the gap
// easy to miss — the permission LIST was tracked while the SHAPE it applies to was not.
// Each audit shares the transaction of the change it describes.

export async function createZone(data, createdBy, req = null) {
  await assertValidGeom(data.geom);
  return tx(async (t) => {
    const zone = await t.one(Q.INSERT_ZONE, [
      data.name || null,
      data.description || null,
      JSON.stringify(data.geom),
      createdBy,
    ]);
    await createAudit(req, {
      action: 'ZONE_CREATE', actorId: createdBy, targetType: 'ZONE',
      targetId: zone.id, targetName: zone.name ?? null,
    }, t);
    return zone;
  });
}

export async function updateZone(id, data, actorId = null, req = null) {
  await assertValidGeom(data.geom);
  return tx(async (t) => {
    const zone = await t.oneOrNone(Q.UPDATE_ZONE, [
      id,
      data.name || null,
      data.description || null,
      JSON.stringify(data.geom),
    ]);
    if (!zone) throw new NotFoundError('Zone');
    await createAudit(req, {
      action: 'ZONE_UPDATE', actorId, targetType: 'ZONE',
      targetId: id, targetName: zone.name ?? null,
    }, t);
    return zone;
  });
}

export async function deleteZone(id, actorId = null, req = null) {
  return tx(async (t) => {
    const removed = await t.oneOrNone(Q.DELETE_ZONE, [id]);
    if (!removed) throw new NotFoundError('Zone');
    await createAudit(req, {
      action: 'ZONE_DELETE', actorId, targetType: 'ZONE', targetId: id,
    }, t);
    return { success: true };
  });
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
