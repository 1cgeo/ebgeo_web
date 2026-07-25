// Path: src/modules/atlas/atlas.queries.js

export const INSERT_ATLAS = `
  INSERT INTO atlas (name, description, owner_id)
  VALUES ($1, $2, $3)
  RETURNING *
`;

export const FIND_ATLAS_BY_ID = `
  SELECT * FROM atlas
  WHERE id = $1 AND deleted_at IS NULL
`;

// `user_permission` MUST resolve exactly like `resolvePermission` (middleware/permissions.js),
// which is the single source of the five-level hierarchy read < comment < write < manage < owner:
// it checks OWNERSHIP FIRST, then the share row. This query used to invert that
// (`COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`), so a share row won over
// ownership. Nothing forbids such a row — addUserShare has no guard against atlas.owner_id — and
// the owner then appeared as a plain reader OF THEIR OWN ATLAS: this projection is what gates the
// project-picker UI ('Meus atlas' tab, canWrite, canOwn), so the owner silently lost rename /
// trash / share while keeping the underlying rights (server-side authz checks the owner first and
// was never affected).
//
// `owner` is the TOP of the hierarchy, so it dominates every share level by construction; the
// CHECK on atlas_shares.permission caps a share at 'manage'. Every other level is surfaced
// VERBATIM — never collapse this into a closed list ('write'|'owner'), which is exactly how the
// co-Gestor ('manage', above 'write') was silenced before.
export const LIST_USER_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username,
         CASE WHEN a.owner_id = $1 THEN 'owner' ELSE s.permission END as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN atlas_shares s ON s.atlas_id = a.id AND s.user_id = $1
  WHERE a.deleted_at IS NULL
    AND (
      a.owner_id = $1
      OR s.user_id = $1
    )
  ORDER BY a.updated_at DESC
`;

// Nullable text columns use a "provided" FLAG (see UPDATE_USER_PROFILE, which solved
// this first and documents why: "COALESCE alone could never clear to NULL"). COALESCE
// collapses the two meanings of null — "field absent from the PATCH" and "clear this
// field" — into one, so the API accepted null (the Joi schemas say .allow(null, ''))
// and silently kept the old value, answering 200 with the un-cleared row. The client
// then confirms a deletion that never happened.
export const UPDATE_ATLAS = `
  UPDATE atlas
  SET name = COALESCE($2, name),
      description = CASE WHEN $5 THEN $3 ELSE description END,
      map_order = COALESCE($4::uuid[], map_order),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

export const SOFT_DELETE_ATLAS = `
  UPDATE atlas
  SET deleted_at = NOW(),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING id
`;

// The caller's OWN trashed atlases (only the owner soft-deletes, so only the owner sees/restores).
export const LIST_DELETED_USER_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username, 'owner' as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.deleted_at IS NOT NULL
    AND a.owner_id = $1
  ORDER BY a.deleted_at DESC
`;

// Every trashed atlas, for a global admin (bugs-backend #95). A restore path nobody can SEE is
// not a path: the atlases this exists for are precisely the ones whose owner is deactivated, so
// they appear in no user's bin. `user_permission` is 'owner' because that is what
// `requireAtlasPermission` already grants an admin on every atlas — the listing must not claim
// less access than the gate gives, which is the mistake LIST_USER_ATLAS documents above.
// `owner_nome`/`owner_username` are what makes another user's atlas identifiable in the list.
export const LIST_ALL_DELETED_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username, 'owner' as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.deleted_at IS NOT NULL
  ORDER BY a.deleted_at DESC
`;

// Restore is scoped to (id, owner, soft-deleted) so the ownership check is atomic: a non-owner or a
// non-deleted/absent atlas matches zero rows → the service raises 404.
//
// The `owner_id = $2` scope IS the access control of POST /:atlasId/restore — the one route of the
// module with no `requireAtlasPermission`, because that middleware only sees live atlases. It has
// been loosened by accident before. Never widen THIS query; the admin path below is a separate
// statement, chosen by an explicit branch in the service.
export const RESTORE_ATLAS = `
  UPDATE atlas
  SET deleted_at = NULL,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
  RETURNING *
`;

// Global-admin restore (bugs-backend #95, owner's decision). Deliberately a SECOND statement
// rather than a nullable `($2 IS NULL OR owner_id = $2)` on the one above: an anti-IDOR predicate
// that can be switched off by passing null is one bad argument away from being off, and the
// argument comes from a controller. Two statements make "no owner scope" a thing you have to
// write down. The caller is `req.user.role === 'admin'`, which `auth` re-reads from the database
// on every request, so a demoted admin cannot reach it with a stale claim.
//
// It exists because a trashed atlas was otherwise UNREACHABLE: the deactivation queries
// (users.queries.js COUNT_USER_ATLAS / TRANSFER_ATLAS_OWNERSHIP) both filter `deleted_at IS NULL`,
// so an atlas in the bin is neither counted nor transferred when its owner is deactivated. It stays
// owned by an inactive account that the `auth` middleware refuses, and the owner scope here meant
// nobody at all could bring it back.
export const RESTORE_ATLAS_ADMIN = `
  UPDATE atlas
  SET deleted_at = NULL,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NOT NULL
  RETURNING *
`;

export const UPDATE_ATLAS_SETTINGS = `
  UPDATE atlas
  SET settings = settings || $2::jsonb,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

export const FIND_ATLAS_BY_PUBLIC_LINK = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.public_link = $1 AND a.deleted_at IS NULL AND a.is_public = true
`;

export const UPDATE_PUBLIC_LINK = `
  UPDATE atlas
  SET is_public = $2,
      public_link = $3,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

export const GET_ATLAS_MAPS_SUMMARY = `
  SELECT id, name, created_at, updated_at
  FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;
