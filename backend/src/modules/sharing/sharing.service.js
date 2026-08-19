// Path: src/modules/sharing/sharing.service.js
// Every mutation here records an audit row IN THE SAME TRANSACTION as the change,
// matching users/organizations/zones. Before this, none of the five did: the actions
// 'SHARING_CHANGE', 'PERMISSION_GRANT' and 'PERMISSION_REVOKE' had been reserved in
// the audit_trail CHECK (002_auditoria.sql) from the first day and were emitted by nobody, so granting
// someone 'manage' or publishing an atlas left no trace, and an admin filtering on
// those actions got zero rows every time — a filter that could never match, which
// reads as "nothing happened" rather than "never wired".
import { query, tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import * as atlasService from '../atlas/atlas.service.js';
import * as Q from './sharing.queries.js';

export async function getSharingConfig(atlasId) {
  const { rows } = await query(Q.GET_SHARING_CONFIG, [atlasId]);
  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }
  return {
    isPublic: rows[0].is_public,
    publicLink: rows[0].public_link,
    owner: {
      userId: rows[0].owner_id,
      username: rows[0].owner_username,
      nome: rows[0].owner_nome,
    },
    shares: rows[0].shares,
  };
}

/** Audit params shared by every sharing mutation (all target the ATLAS). */
const atlasAudit = (action, atlasId, actorId, details) => ({
  action, actorId, targetType: 'ATLAS', targetId: atlasId, details,
});

export async function enablePublicSharing(atlasId, actorId = null, req = null) {
  const result = await atlasService.enablePublicSharing(atlasId);
  await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, {
    isPublic: true, publicLink: result?.publicLink ?? result?.public_link ?? null,
  }));
  return result;
}

export async function disablePublicSharing(atlasId, actorId = null, req = null) {
  const result = await atlasService.disablePublicSharing(atlasId);
  await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, { isPublic: false }));
  return result;
}

export async function addUserShare(atlasId, userId, permission, addedBy, req = null) {
  // Verify user exists
  const userResult = await query(Q.FIND_USER_BY_ID, [userId]);
  if (userResult.rows.length === 0) {
    throw new NotFoundError('User');
  }

  return tx(async (t) => {
    const share = await t.one(Q.INSERT_USER_SHARE, [atlasId, userId, permission, addedBy]);
    await createAudit(req, atlasAudit('PERMISSION_GRANT', atlasId, addedBy, {
      userId, permission,
    }), t);
    return share;
  });
}

export async function updateUserShare(atlasId, userId, permission, actorId = null, req = null) {
  return tx(async (t) => {
    const share = await t.oneOrNone(Q.UPDATE_USER_SHARE, [atlasId, userId, permission]);
    if (!share) {
      throw new NotFoundError('Share');
    }
    await createAudit(req, atlasAudit('SHARING_CHANGE', atlasId, actorId, {
      userId, permission, previousPermission: share.previous_permission,
    }), t);
    return share;
  });
}

export async function removeUserShare(atlasId, userId, actorId = null, req = null) {
  return tx(async (t) => {
    const removed = await t.oneOrNone(Q.DELETE_USER_SHARE, [atlasId, userId]);
    if (!removed) {
      throw new NotFoundError('Share');
    }
    await createAudit(req, atlasAudit('PERMISSION_REVOKE', atlasId, actorId, { userId }), t);
    return true;
  });
}
