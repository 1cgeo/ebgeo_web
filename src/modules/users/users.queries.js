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
