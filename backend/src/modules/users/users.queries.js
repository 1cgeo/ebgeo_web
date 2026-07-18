// Path: src/modules/users/users.queries.js
//
// users.rank_id (FK ranks) and users.organization_id (FK organizations) are the stored values;
// posto_graduacao / organizacao_militar are DERIVED display names via LEFT JOIN, so the API/UI
// keep seeing strings while storage is normalized. Write queries take the FK ids and re-join in a
// CTE so RETURNING still emits the derived names.

export const FIND_USER_BY_ID = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1 AND u.is_active = true
`;

export const FIND_USER_WITH_PASSWORD = `
  SELECT id, password_hash
  FROM users
  WHERE id = $1 AND is_active = true
`;

// Nullable FK fields (rank_id/organization_id) use a "provided" flag so an explicit null CLEARS the
// column, while an omitted field is left unchanged. (COALESCE alone could never clear to NULL.)
export const UPDATE_USER_PROFILE = `
  WITH upd AS (
    UPDATE users
    SET nome = COALESCE($2, nome),
        rank_id = CASE WHEN $4 THEN $3::uuid ELSE rank_id END,
        organization_id = CASE WHEN $6 THEN $5::uuid ELSE organization_id END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.created_at, u.last_login_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

export const UPDATE_USER_PASSWORD = `
  UPDATE users
  SET password_hash = $2, updated_at = NOW()
  WHERE id = $1
`;

export const SEARCH_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.is_active = true
    AND (
      LOWER(u.username) LIKE LOWER($1)
      OR LOWER(u.nome) LIKE LOWER($1)
      OR LOWER(r.nome) LIKE LOWER($1)
      OR LOWER(o.nome) LIKE LOWER($1)
    )
  ORDER BY u.nome
  LIMIT 20
`;

// ============================================
// Admin queries
// ============================================

export const LIST_ALL_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  ORDER BY u.created_at DESC
`;

export const LIST_ACTIVE_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.is_active = true
  ORDER BY u.nome
`;

export const FIND_USER_BY_ID_ADMIN = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active,
         u.email, u.email_verified, u.created_at, u.updated_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1
`;

export const CHECK_USERNAME_EXISTS = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1)
`;

export const CHECK_USERNAME_EXISTS_EXCLUDING = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2
`;

export const INSERT_USER_ADMIN = `
  WITH new_user AS (
    INSERT INTO users (username, password_hash, nome, rank_id, organization_id, role)
    VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6)
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active, u.created_at
  FROM new_user u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// rank_id/organization_id use a "provided" flag (see UPDATE_USER_PROFILE) so an explicit null clears
// the column; an omitted field is left unchanged.
export const UPDATE_USER_ADMIN = `
  WITH upd AS (
    UPDATE users
    SET username = COALESCE($2, username),
        nome = COALESCE($3, nome),
        rank_id = CASE WHEN $5 THEN $4::uuid ELSE rank_id END,
        organization_id = CASE WHEN $7 THEN $6::uuid ELSE organization_id END,
        role = COALESCE($8, role),
        is_active = COALESCE($9, is_active),
        email_verified = COALESCE($10, email_verified),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active,
         u.email, u.email_verified, u.created_at, u.updated_at, u.last_login_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

export const RESET_USER_PASSWORD = `
  UPDATE users
  SET password_hash = $2, updated_at = NOW()
  WHERE id = $1
  RETURNING id
`;

export const SOFT_DELETE_USER = `
  UPDATE users
  SET is_active = false, updated_at = NOW()
  WHERE id = $1
  RETURNING id
`;

export const REACTIVATE_USER = `
  WITH upd AS (
    UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.is_active, u.created_at
  FROM upd u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

export const TRANSFER_ATLAS_OWNERSHIP = `
  UPDATE atlas
  SET owner_id = $2, updated_at = NOW()
  WHERE owner_id = $1 AND deleted_at IS NULL
  RETURNING id
`;

export const COUNT_USER_ATLAS = `
  SELECT COUNT(*) as count FROM atlas WHERE owner_id = $1 AND deleted_at IS NULL
`;

// Revoke all active refresh tokens for a user (on password change/reset/deactivate).
export const REVOKE_ALL_USER_TOKENS = `
  UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL
`;

// Atomic API key rotation: archive the old key + issue a new one in one statement.
export const ROTATE_API_KEY = `
  WITH old AS (
    INSERT INTO api_key_history (user_id, api_key, created_at, revoked_at, revoked_by)
    SELECT id, api_key, NULL::timestamptz, NOW(), $2
    FROM users WHERE id = $1 AND api_key IS NOT NULL
    RETURNING 1
  )
  UPDATE users SET api_key = gen_random_uuid(), updated_at = NOW()
  WHERE id = $1
  RETURNING api_key
`;

export const FIND_USER_BY_API_KEY = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.org_role, u.role
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.api_key = $1 AND u.is_active = true
`;
