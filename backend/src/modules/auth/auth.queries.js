// Path: src/modules/auth/auth.queries.js

// posto_graduacao / organizacao_militar are DERIVED display names from the rank_id / organization_id
// FKs (so the token claim + UI keep seeing strings while storage is normalized).
export const FIND_USER_BY_USERNAME = `
  SELECT u.id, u.username, u.password_hash, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.org_role, u.is_active, u.role,
         u.email, u.email_verified
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE LOWER(u.username) = LOWER($1)
`;

export const FIND_USER_BY_ID = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.org_role, u.role,
         u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1 AND u.is_active = true
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

export const CHECK_EMAIL_EXISTS = `
  SELECT id FROM users WHERE LOWER(email) = LOWER($1)
`;

export const FIND_USER_BY_EMAIL = `
  SELECT id, username, nome, email, email_verified
  FROM users WHERE LOWER(email) = LOWER($1)
`;

// rank_id is the posto FK; organization_id is the OM FK (COALESCE -> default org). The CTE re-joins
// ranks/organizations so RETURNING still emits the derived posto_graduacao / organizacao_militar names.
export const INSERT_USER = `
  WITH new_user AS (
    INSERT INTO users (username, password_hash, nome, rank_id, role, organization_id, email, email_verified)
    VALUES ($1, $2, $3, $4::uuid, $5, COALESCE($6::uuid, '00000000-0000-0000-0000-000000000001'::uuid), $7, $8)
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.org_role, u.role,
         u.created_at, u.email, u.email_verified
  FROM new_user u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// ============================================
// Email verification tokens
// ============================================

export const INSERT_VERIFICATION_TOKEN = `
  INSERT INTO email_verification_tokens (user_id, expires_at)
  VALUES ($1, $2)
  RETURNING token
`;

// Atomic claim (L4): the UPDATE itself is the mutual exclusion. `consumed_at IS
// NULL` in the WHERE means exactly ONE concurrent caller can transition the row,
// and RETURNING tells that winner what it claimed. A read-then-write pair could
// let two requests both pass the check and both consume the same token.
// `expires_at` comes back so expiry is judged on the row we actually claimed.
export const CLAIM_VERIFICATION_TOKEN = `
  UPDATE email_verification_tokens
  SET consumed_at = NOW()
  WHERE token = $1 AND consumed_at IS NULL
  RETURNING user_id, expires_at
`;

export const MARK_EMAIL_VERIFIED = `
  UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1
`;
