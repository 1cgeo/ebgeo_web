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

export const LIST_USER_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username,
         COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END) as user_permission
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

export const UPDATE_ATLAS = `
  UPDATE atlas
  SET name = COALESCE($2, name),
      description = COALESCE($3, description),
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
