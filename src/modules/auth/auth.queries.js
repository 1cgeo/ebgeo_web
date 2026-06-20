// Path: src/modules/auth/auth.queries.js

export const FIND_USER_BY_USERNAME = `
  SELECT id, username, password_hash, nome, posto_graduacao, organizacao_militar,
         organization_id, org_role, is_active, role
  FROM users
  WHERE LOWER(username) = LOWER($1)
`;

export const FIND_USER_BY_ID = `
  SELECT id, username, nome, posto_graduacao, organizacao_militar,
         organization_id, org_role, role, created_at, last_login_at
  FROM users
  WHERE id = $1 AND is_active = true
`;

export const UPDATE_LAST_LOGIN = `
  UPDATE users SET last_login_at = NOW() WHERE id = $1
`;

export const INSERT_REFRESH_TOKEN = `
  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  VALUES ($1, $2, $3)
  RETURNING id
`;

export const FIND_REFRESH_TOKEN = `
  SELECT id, user_id, expires_at
  FROM refresh_tokens
  WHERE token_hash = $1 AND revoked_at IS NULL
`;

// Includes revoked tokens, so the service can detect reuse of a revoked token.
export const FIND_REFRESH_TOKEN_ANY = `
  SELECT id, user_id, expires_at, revoked_at
  FROM refresh_tokens
  WHERE token_hash = $1
`;

export const REVOKE_REFRESH_TOKEN = `
  UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1
`;

export const REVOKE_ALL_USER_TOKENS = `
  UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL
`;

export const CHECK_USERNAME_EXISTS = `
  SELECT id FROM users WHERE LOWER(username) = LOWER($1)
`;

export const INSERT_USER = `
  INSERT INTO users (username, password_hash, nome, posto_graduacao, organizacao_militar, role, organization_id)
  VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::uuid, '00000000-0000-0000-0000-000000000001'::uuid))
  RETURNING id, username, nome, posto_graduacao, organizacao_militar, organization_id, org_role, role, created_at
`;
