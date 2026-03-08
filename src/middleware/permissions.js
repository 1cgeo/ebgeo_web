// Path: src/middleware/permissions.js
import { query } from '../database/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

/**
 * Permission hierarchy levels (higher number = more access).
 */
const PERMISSION_LEVELS = {
  read: 1,
  write: 2,
  owner: 3,
};

/**
 * Resolves the permission level for a user on an atlas.
 * Pure function for testing.
 * @param {Object} params
 * @param {string|null} params.userId - Current user ID (null for anonymous)
 * @param {string} params.ownerId - Atlas owner ID
 * @param {Object|null} params.share - User's share record { permission: 'read'|'write' }
 * @param {boolean} params.isPublic - Whether atlas is public
 * @returns {string|null} Permission level: 'owner', 'write', 'read', or null
 */
export function resolvePermission({ userId, ownerId, share, isPublic }) {
  // 1. Is user the atlas owner?
  if (userId && userId === ownerId) {
    return 'owner';
  }

  // 2. Is user in atlas_shares?
  if (share && share.permission) {
    return share.permission;
  }

  // 3. Is atlas public?
  if (isPublic) {
    return 'read';
  }

  // 4. None of the above
  return null;
}

/**
 * Creates middleware that checks if the authenticated user has
 * the required permission level on the atlas specified by :atlasId or :aId or :id.
 *
 * @param {'read' | 'write' | 'owner'} requiredLevel - Minimum permission
 * @returns {Function} Express middleware
 */
export function requireAtlasPermission(requiredLevel) {
  return async (req, res, next) => {
    try {
      // Extract atlasId from req.params (try :atlasId, :aId, :id)
      const atlasId = req.params.atlasId || req.params.aId || req.params.id;

      if (!atlasId) {
        return next(new NotFoundError('Atlas'));
      }

      // Fetch atlas and check if it exists
      const atlasResult = await query(
        `SELECT owner_id, is_public FROM atlas WHERE id = $1 AND deleted_at IS NULL`,
        [atlasId]
      );

      if (atlasResult.rows.length === 0) {
        return next(new NotFoundError('Atlas'));
      }

      const atlas = atlasResult.rows[0];
      const userId = req.user?.id || null;

      // Fetch user's share if they have one
      let share = null;
      if (userId) {
        const shareResult = await query(
          `SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2`,
          [atlasId, userId]
        );
        if (shareResult.rows.length > 0) {
          share = shareResult.rows[0];
        }
      }

      // Resolve permission
      const resolvedPermission = resolvePermission({
        userId,
        ownerId: atlas.owner_id,
        share,
        isPublic: atlas.is_public,
      });

      // Check if permission level is sufficient
      if (!resolvedPermission) {
        return next(new ForbiddenError('Access denied'));
      }

      const resolvedLevel = PERMISSION_LEVELS[resolvedPermission];
      const requiredLevelNum = PERMISSION_LEVELS[requiredLevel];

      if (resolvedLevel < requiredLevelNum) {
        return next(new ForbiddenError('Insufficient permissions'));
      }

      // Set permission on request for downstream use
      req.atlasPermission = resolvedPermission;
      req.atlasId = atlasId;
      req.atlasOwnerId = atlas.owner_id;

      next();
    } catch (err) {
      next(err);
    }
  };
}
