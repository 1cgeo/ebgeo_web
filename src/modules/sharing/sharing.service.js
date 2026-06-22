// Path: src/modules/sharing/sharing.service.js
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
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

export async function enablePublicSharing(atlasId) {
  return atlasService.enablePublicSharing(atlasId);
}

export async function disablePublicSharing(atlasId) {
  return atlasService.disablePublicSharing(atlasId);
}

export async function addUserShare(atlasId, userId, permission, addedBy) {
  // Verify user exists
  const userResult = await query(Q.FIND_USER_BY_ID, [userId]);
  if (userResult.rows.length === 0) {
    throw new NotFoundError('User');
  }

  const { rows } = await query(Q.INSERT_USER_SHARE, [atlasId, userId, permission, addedBy]);
  return rows[0];
}

export async function updateUserShare(atlasId, userId, permission) {
  const { rows } = await query(Q.UPDATE_USER_SHARE, [atlasId, userId, permission]);
  if (rows.length === 0) {
    throw new NotFoundError('Share');
  }
  return rows[0];
}

export async function removeUserShare(atlasId, userId) {
  const { rows } = await query(Q.DELETE_USER_SHARE, [atlasId, userId]);
  if (rows.length === 0) {
    throw new NotFoundError('Share');
  }
  return true;
}
