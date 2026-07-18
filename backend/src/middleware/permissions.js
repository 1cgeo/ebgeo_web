// Path: src/middleware/permissions.js
import { query } from '../database/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Permission hierarchy levels (higher number = more access).
 * read < comment < write < manage < owner. `comment` (Comentarista) sees the atlas and
 * may only act on spatial comments; `manage` (co-Gestor) can share + configure the atlas.
 */
const PERMISSION_LEVELS = {
  read: 1,
  comment: 2,
  write: 3,
  manage: 4,
  owner: 5,
};

/**
 * Resolves the permission level for a user on an atlas.
 * Pure function for testing.
 * @param {Object} params
 * @param {string|null} params.userId - Current user ID (null for anonymous)
 * @param {string} params.ownerId - Atlas owner ID
 * @param {Object|null} params.share - User's share record { permission: 'read'|'comment'|'write'|'manage' }
 * @param {boolean} params.isPublic - Whether atlas is public
 * @returns {string|null} Permission level: 'owner', 'manage', 'write', 'comment', 'read', or null
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
 * @param {'read' | 'comment' | 'write' | 'manage' | 'owner'} requiredLevel - Minimum permission
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

      // Global admins have full (owner-level) access to every atlas so they can
      // support/debug and manage any user's project.
      if (req.user?.role === 'admin') {
        req.atlasPermission = 'owner';
        req.atlasId = atlasId;
        req.atlasOwnerId = atlas.owner_id;
        return next();
      }

      // Fetch user's share if they have one
      // Skip share lookup for public tokens (non-UUID user IDs)
      let share = null;
      if (userId && UUID_RE.test(userId)) {
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
