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
         u.organization_id, o.nome AS organizacao_militar, u.role, u.org_role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  ORDER BY u.created_at DESC
`;

export const LIST_ACTIVE_USERS = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.org_role,
         u.producer_org_id, u.is_active,
         u.email, u.email_verified, u.created_at, u.last_login_at
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.is_active = true
  ORDER BY u.nome
`;

export const FIND_USER_BY_ID_ADMIN = `
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.org_role,
         u.producer_org_id, u.is_active,
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
    INSERT INTO users (username, password_hash, nome, rank_id, organization_id, role, org_role,
                       producer_org_id)
    VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, COALESCE($7, 'viewer'), $8::uuid)
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.org_role,
         u.producer_org_id, u.is_active, u.created_at
  FROM new_user u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

// rank_id/organization_id/producer_org_id use a "provided" flag (see UPDATE_USER_PROFILE) so an
// explicit null clears the column; an omitted field is left unchanged.
//
// O ESCOPO DE PRODUCAO PRECISA DA BANDEIRA, e nao de um COALESCE como o papel: sem
// ela nao ha como LIMPAR a coluna ao rebaixar um produtor, e o CHECK bicondicional
// (`users_producer_scope_check`) recusaria o UPDATE inteiro com 23514 — que sai como
// um 400 generico, sem dizer que o problema e um escopo orfao.
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
        org_role = COALESCE($11, org_role),
        producer_org_id = CASE WHEN $13 THEN $12::uuid ELSE producer_org_id END,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  )
  SELECT u.id, u.username, u.nome, u.rank_id, r.nome AS posto_graduacao,
         u.organization_id, o.nome AS organizacao_militar, u.role, u.org_role,
         u.producer_org_id, u.is_active,
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

// After a transfer, the new owner must not also hold a share row on the same atlas:
// LIST_USER_ATLAS resolves COALESCE(share, owner), so the share would outrank the
// synthesized 'owner' and report the new owner with their previous, lesser
// permission. Ownership comes from owner_id alone.
export const DELETE_SHARES_FOR_NEW_OWNER = `
  DELETE FROM atlas_shares WHERE atlas_id = ANY($1::uuid[]) AND user_id = $2
`;

export const COUNT_USER_ATLAS = `
  SELECT COUNT(*) as count FROM atlas WHERE owner_id = $1 AND deleted_at IS NULL
`;

// Revoke all active refresh tokens for a user (on password change/reset/deactivate)
// AND stamp the session cut-off that the live auth path actually reads.
//
// Revoking the family alone was inert against a principal holding a live access token:
// nothing on the request path reads `refresh_tokens`, and the sliding renewal in
// flexible-auth.js re-issued that token indefinitely (bugs-backend #35).
// `users.sessions_valid_from` is what `getLiveAuthState` reads, and `auth` /
// `flexibleAuth` / the collab handshake use it to refuse any token whose `iat`
// predates it.
//
// One statement, not two: a data-modifying CTE runs exactly once and to completion
// regardless of the outer query, so revocation and marker can never drift apart.
//
// DEACTIVATION (`deleteUser`) is already barred by `users.is_active` on every live
// path, so the marker is REDUNDANT there. It is written anyway, deliberately: the
// invariant is "mass revocation always sets the cut-off", and an invariant with one
// documented exception is an invariant nobody can rely on — the next caller of this
// query gets the effect without having to know which of the four cases it is.
//
// Kept byte-identical to the copy in auth.queries.js (reuse detection calls that one).
export const REVOKE_ALL_USER_TOKENS = `
  WITH revoked AS (
    UPDATE refresh_tokens SET revoked_at = NOW()
    WHERE user_id = $1 AND revoked_at IS NULL
    RETURNING id
  )
  UPDATE users SET sessions_valid_from = NOW() WHERE id = $1
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
         u.organization_id, o.nome AS organizacao_militar, u.org_role, u.producer_org_id, u.role
  FROM users u
  LEFT JOIN ranks r ON r.id = u.rank_id
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.api_key = $1 AND u.is_active = true
`;
