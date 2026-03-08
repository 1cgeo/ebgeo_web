// Path: src/modules/users/users.service.js
import bcrypt from 'bcrypt';
import { query } from '../../database/index.js';
import { NotFoundError, UnauthorizedError, ConflictError, ForbiddenError } from '../../utils/errors.js';
import * as Q from './users.queries.js';

const SALT_ROUNDS = 12;

/**
 * Gets user profile by ID.
 */
export async function getProfile(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Updates user profile.
 */
export async function updateProfile(userId, data) {
  const { rows } = await query(Q.UPDATE_USER_PROFILE, [
    userId,
    data.nome || null,
    data.posto_graduacao !== undefined ? data.posto_graduacao : null,
    data.organizacao_militar !== undefined ? data.organizacao_militar : null,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Changes user password.
 */
export async function updatePassword(userId, currentPassword, newPassword) {
  // Get current password hash
  const { rows } = await query(Q.FIND_USER_WITH_PASSWORD, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password
  await query(Q.UPDATE_USER_PASSWORD, [userId, newHash]);

  return { success: true };
}

/**
 * Searches users by name or username.
 */
export async function searchUsers(searchQuery) {
  const pattern = `%${searchQuery}%`;
  const { rows } = await query(Q.SEARCH_USERS, [pattern]);
  return rows;
}

// ============================================
// Admin functions
// ============================================

/**
 * Lists all users (admin only).
 */
export async function listUsers(includeInactive = false) {
  const queryStr = includeInactive ? Q.LIST_ALL_USERS : Q.LIST_ACTIVE_USERS;
  const { rows } = await query(queryStr);
  return rows;
}

/**
 * Gets a user by ID (admin view - includes inactive users).
 */
export async function getUserById(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID_ADMIN, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Creates a new user (admin only).
 */
export async function createUser(data) {
  // Check if username already exists
  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  if (existing.length > 0) {
    throw new ConflictError('Username already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Create user
  const { rows } = await query(Q.INSERT_USER_ADMIN, [
    data.username,
    passwordHash,
    data.nome,
    data.posto_graduacao || null,
    data.organizacao_militar || null,
    data.role || 'user',
  ]);

  return rows[0];
}

/**
 * Updates a user (admin only).
 */
export async function updateUser(userId, data) {
  // Check if user exists
  const existing = await getUserById(userId);

  // If changing username, check it's not taken
  if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
    const { rows: usernameCheck } = await query(Q.CHECK_USERNAME_EXISTS_EXCLUDING, [data.username, userId]);
    if (usernameCheck.length > 0) {
      throw new ConflictError('Username already exists');
    }
  }

  const { rows } = await query(Q.UPDATE_USER_ADMIN, [
    userId,
    data.username || null,
    data.nome || null,
    data.posto_graduacao !== undefined ? data.posto_graduacao : null,
    data.organizacao_militar !== undefined ? data.organizacao_militar : null,
    data.role || null,
    data.is_active !== undefined ? data.is_active : null,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}

/**
 * Resets a user's password (admin only).
 */
export async function resetPassword(userId, newPassword) {
  // Check if user exists
  await getUserById(userId);

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password
  const { rows } = await query(Q.RESET_USER_PASSWORD, [userId, passwordHash]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return { success: true };
}

/**
 * Deactivates a user (soft delete). Optionally transfers atlas ownership.
 * @param {string} userId - User to deactivate
 * @param {string} adminId - Admin performing the action
 * @param {string} transferToUserId - User to transfer atlas to (optional)
 */
export async function deleteUser(userId, adminId, transferToUserId = null) {
  // Can't delete yourself
  if (userId === adminId) {
    throw new ForbiddenError('Cannot deactivate your own account');
  }

  // Check if user exists
  const user = await getUserById(userId);

  // Check if user has atlas
  const { rows: atlasCount } = await query(Q.COUNT_USER_ATLAS, [userId]);
  const count = parseInt(atlasCount[0].count, 10);

  if (count > 0) {
    if (transferToUserId) {
      // Verify transfer target exists and is active
      const targetUser = await getUserById(transferToUserId);
      if (!targetUser.is_active) {
        throw new ForbiddenError('Cannot transfer atlas to an inactive user');
      }

      // Transfer atlas ownership
      await query(Q.TRANSFER_ATLAS_OWNERSHIP, [userId, transferToUserId]);
    } else {
      // No transfer target specified, return error with count
      throw new ConflictError(`User has ${count} atlas(es). Provide transferTo parameter to transfer ownership, or the atlas will remain orphaned.`);
    }
  }

  // Soft delete user
  const { rows } = await query(Q.SOFT_DELETE_USER, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return { success: true, atlasTransferred: count > 0 ? count : 0 };
}

/**
 * Reactivates a previously deactivated user.
 */
export async function reactivateUser(userId) {
  const { rows } = await query(Q.REACTIVATE_USER, [userId]);

  if (rows.length === 0) {
    throw new NotFoundError('User');
  }

  return rows[0];
}
