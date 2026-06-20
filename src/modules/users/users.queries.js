// Path: src/modules/users/users.queries.js

export const FIND_USER_BY_ID = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar, created_at, last_login_at
  FROM users
  WHERE id = $1 AND is_active = true
`;

export const FIND_USER_WITH_PASSWORD = `
  SELECT id, password_hash
  FROM users
  WHERE id = $1 AND is_active = true
`;

export const UPDATE_USER_PROFILE = `
  UPDATE users
  SET nome = COALESCE($2, nome),
      posto_graduacao = COALESCE($3, posto_graduacao),
      organizacao_militar = COALESCE($4, organizacao_militar),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, username, nome, posto_graduacao, organizacao_militar, created_at, last_login_at
`;

export const UPDATE_USER_PASSWORD = `
  UPDATE users
  SET password_hash = $2, updated_at = NOW()
  WHERE id = $1
`;

export const SEARCH_USERS = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar
  FROM users
  WHERE is_active = true
    AND (
      LOWER(username) LIKE LOWER($1)
      OR LOWER(nome) LIKE LOWER($1)
    )
  ORDER BY nome
  LIMIT 20
`;

// ============================================
// Admin queries
// ============================================

export const LIST_ALL_USERS = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at, last_login_at
  FROM users
  ORDER BY created_at DESC
`;

export const LIST_ACTIVE_USERS = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at, last_login_at
  FROM users
  WHERE is_active = true
  ORDER BY nome
`;

export const FIND_USER_BY_ID_ADMIN = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at, updated_at, last_login_at
  FROM users
  WHERE id = $1
`;

export const CHECK_USERNAME_EXISTS = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1)
`;

export const CHECK_USERNAME_EXISTS_EXCLUDING = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2
`;

export const INSERT_USER_ADMIN = `
  INSERT INTO users (username, password_hash, nome, posto_graduacao, organizacao_militar, role)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at
`;

export const UPDATE_USER_ADMIN = `
  UPDATE users
  SET username = COALESCE($2, username),
      nome = COALESCE($3, nome),
      posto_graduacao = COALESCE($4, posto_graduacao),
      organizacao_militar = COALESCE($5, organizacao_militar),
      role = COALESCE($6, role),
      is_active = COALESCE($7, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at, updated_at, last_login_at
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
  UPDATE users
  SET is_active = true, updated_at = NOW()
  WHERE id = $1
  RETURNING id, username, nome, posto_graduacao, organizacao_militar, role, is_active, created_at
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
  SELECT id, username, nome, posto_graduacao, organizacao_militar,
         organization_id, org_role, role
  FROM users WHERE api_key = $1 AND is_active = true
`;
