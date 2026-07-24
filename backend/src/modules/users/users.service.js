// Path: src/modules/users/users.service.js
import bcrypt from 'bcrypt';
import { query, tx } from '../../database/index.js';
import { NotFoundError, UnauthorizedError, ConflictError, ForbiddenError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
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
  // For nullable fields, pass [value, provided?]: an explicit null/'' clears the
  // column (value normalized to null), an omitted field leaves it unchanged.
  const { rows } = await query(Q.UPDATE_USER_PROFILE, [
    userId,
    data.nome || null,
    data.rank_id === '' ? null : (data.rank_id ?? null),
    data.rank_id !== undefined,
    data.organization_id === '' ? null : (data.organization_id ?? null),
    data.organization_id !== undefined,
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
    throw new UnauthorizedError('A senha atual está incorreta.');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password and revoke existing refresh tokens (force re-login elsewhere)
  await query(Q.UPDATE_USER_PASSWORD, [userId, newHash]);
  await query(Q.REVOKE_ALL_USER_TOKENS, [userId]);

  return { success: true };
}

/**
 * Searches users by name or username.
 */
/**
 * Escapes the LIKE wildcards so the search is LITERAL.
 *
 * Not SQL injection — the value travels as $1 — but PATTERN injection: a `%` or `_`
 * typed by the user acquired wildcard meaning. It broke ordinary searches (usernames
 * here routinely contain `_`, e.g. the `share_owner` fixtures) and turned `q = '%%'`
 * into a full-table scan bounded only by LIMIT 20. Backslash is escaped first, or it
 * would double-escape the escapes that follow.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchUsers(searchQuery) {
  const pattern = `%${escapeLike(searchQuery)}%`;
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
    throw new ConflictError('Nome de usuário já existe.');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Create user
  const { rows } = await query(Q.INSERT_USER_ADMIN, [
    data.username,
    passwordHash,
    data.nome,
    data.rank_id || null,
    data.organization_id || null,
    data.role || 'user',
    data.org_role || null, // SQL COALESCEs to 'viewer'
  ]);

  return rows[0];
}

/**
 * Updates a user (admin only).
 */
export async function updateUser(userId, data, actingUserId = null) {
  // Check if user exists
  const existing = await getUserById(userId);

  // Self-guard (defense-in-depth alongside the UI): an admin cannot deactivate or demote their OWN
  // account — that is a last-admin lockout the disabled "Desativar" button is meant to prevent.
  if (actingUserId && userId === actingUserId) {
    if (data.is_active === false) {
      throw new ConflictError('Você não pode desativar a própria conta.');
    }
    if (data.role && data.role !== 'admin' && existing.role === 'admin') {
      throw new ConflictError('Você não pode remover seu próprio papel de admin.');
    }
  }

  // Desativar por PUT era uma porta dos fundos. `deleteUser` (a rota de
  // desativação) roda três coisas que este caminho não roda: conta os atlas do
  // usuário e EXIGE um destinatário antes de soltar a posse, audita, e revoga os
  // refresh tokens. O PUT escrevia `is_active` direto no UPDATE, então desmarcar
  // o checkbox "Ativo" do formulário de edição (`frontend/src/js/admin/users-tab.js:357`)
  // desativava a conta deixando os atlas dela órfãos — donos inativos são
  // recusados no middleware `auth`, e só um admin global consegue mexer neles
  // depois. É exatamente o estado que o ConflictError de `deleteUser` existe para
  // impedir, alcançado pela porta ao lado.
  //
  // Recusar é a correção certa e não "faltou implementar a guarda aqui": o PUT não
  // tem como receber o destinatário da transferência, então não existe forma de
  // ele completar a operação com segurança. Reativar (`is_active: true`) segue
  // livre, e reenviar `false` para quem JÁ está inativo não é transição e passa —
  // senão editar o nome de um usuário inativo quebraria.
  if (data.is_active === false && existing.is_active) {
    throw new ConflictError(
      'Desative pela ação de desativação, não pela edição: ela exige um destinatário para os atlas do usuário e revoga as sessões dele.'
    );
  }

  // If changing username, check it's not taken
  if (data.username && data.username.toLowerCase() !== existing.username.toLowerCase()) {
    const { rows: usernameCheck } = await query(Q.CHECK_USERNAME_EXISTS_EXCLUDING, [data.username, userId]);
    if (usernameCheck.length > 0) {
      throw new ConflictError('Nome de usuário já existe.');
    }
  }

  const { rows } = await query(Q.UPDATE_USER_ADMIN, [
    userId,
    data.username || null,
    data.nome || null,
    data.rank_id === '' ? null : (data.rank_id ?? null),
    data.rank_id !== undefined,
    data.organization_id === '' ? null : (data.organization_id ?? null),
    data.organization_id !== undefined,
    data.role || null,
    data.is_active !== undefined ? data.is_active : null,
    data.email_verified !== undefined ? data.email_verified : null,
    data.org_role || null,
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

  // Revoke existing refresh tokens so the old password's sessions die.
  await query(Q.REVOKE_ALL_USER_TOKENS, [userId]);

  return { success: true };
}

/**
 * Deactivates a user (soft delete). Optionally transfers atlas ownership.
 * @param {string} userId - User to deactivate
 * @param {string} adminId - Admin performing the action
 * @param {string} transferToUserId - User to transfer atlas to (optional)
 */
export async function deleteUser(userId, adminId, transferToUserId = null, req = null) {
  // Can't delete yourself
  if (userId === adminId) {
    throw new ForbiddenError('Você não pode desativar a própria conta.');
  }

  // Fast-fail existence check (read) before opening the transaction.
  const user = await getUserById(userId);

  // Atomic: count atlas -> (transfer) -> soft-delete -> revoke tokens.
  // If any step fails, the whole thing rolls back (no orphaned transfer).
  return tx(async (t) => {
    const atlasCount = await t.one(Q.COUNT_USER_ATLAS, [userId]);
    const count = parseInt(atlasCount.count, 10);

    if (count > 0) {
      if (!transferToUserId) {
        throw new ConflictError(
          `O usuário possui ${count} atlas. Informe um destinatário para transferir a propriedade, senão os atlas ficariam órfãos.`
        );
      }
      // Transferring to the user being deactivated is a no-op that LOOKS like a
      // success: `TRANSFER_ATLAS_OWNERSHIP` runs `SET owner_id = $2 WHERE owner_id =
      // $1` with $1 === $2, and the target still reads is_active = true because the
      // soft delete happens further down. The service then reported N transfers that
      // never occurred, leaving a live atlas owned by an inactive account — exactly
      // what the ConflictError above exists to prevent. Nobody but a global admin
      // could act on it afterwards, since only the owner may transfer or delete an
      // atlas and an inactive owner is refused at the `auth` middleware.
      // Mirrors atlas.service.js:499, which rejects newOwnerId === currentOwnerId.
      if (transferToUserId === userId) {
        throw new ConflictError(
          'O destinatário não pode ser o próprio usuário que está sendo desativado: '
          + 'os atlas ficariam órfãos.'
        );
      }

      const target = await t.oneOrNone(Q.FIND_USER_BY_ID_ADMIN, [transferToUserId]);
      if (!target) throw new NotFoundError('User');
      if (!target.is_active) throw new ForbiddenError('Não é possível transferir o atlas para um usuário inativo.');
      // RETURNING rows -> use t.any (t.none would reject on returned rows).
      const transferred = await t.any(Q.TRANSFER_ATLAS_OWNERSHIP, [userId, transferToUserId]);

      // Drop any share the recipient already held on the atlases they just
      // inherited. Ownership comes from `owner_id` alone, but `LIST_USER_ATLAS`
      // resolves `COALESCE(s.permission, ...owner...)`, so a surviving share OUTRANKS
      // the synthesized 'owner' and the new owner is listed with their old, lesser
      // permission. The server gate stays correct (resolvePermission checks owner
      // first), but the listing lies and the frontend reads it with a closed equality
      // (`user_permission === 'owner'`), so the atlas disappears from "Meus atlas"
      // and shows as read-only under "Compartilhados".
      // Mirrors atlas.service.js:529-532, same reasoning.
      if (transferred.length > 0) {
        await t.none(Q.DELETE_SHARES_FOR_NEW_OWNER, [
          transferred.map((a) => a.id),
          transferToUserId,
        ]);
      }
    }

    const deleted = await t.oneOrNone(Q.SOFT_DELETE_USER, [userId]);
    if (!deleted) throw new NotFoundError('User');

    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]);

    // Audit participates in the same transaction (rolls back together).
    await createAudit(req, {
      action: 'USER_DELETE', actorId: adminId, targetType: 'USER',
      targetId: userId, targetName: user.nome, details: { atlasTransferred: count },
    }, t);

    return { success: true, atlasTransferred: count > 0 ? count : 0 };
  });
}

/**
 * Atomically rotates a user's API key (old key archived to api_key_history),
 * auditing within the same transaction.
 */
export async function rotateApiKey(userId, actorId, req = null) {
  return tx(async (t) => {
    // oneOrNone (not one): a nonexistent user matches 0 rows; map that to a
    // clean 404 instead of letting pg-promise's QueryResultError surface as 500.
    const row = await t.oneOrNone(Q.ROTATE_API_KEY, [userId, actorId]);
    if (!row) throw new NotFoundError('User');
    await createAudit(req, {
      action: 'API_KEY_ROTATE',
      actorId,
      targetType: 'USER',
      targetId: userId,
    }, t);
    return { apiKey: row.api_key };
  });
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
