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

// Restore is scoped to (id, owner, soft-deleted) so the ownership check is atomic: a non-owner or a
// non-deleted/absent atlas matches zero rows → the service raises 404.
export const RESTORE_ATLAS = `
  UPDATE atlas
  SET deleted_at = NULL,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
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
