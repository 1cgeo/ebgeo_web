// Path: src/modules/sharing/sharing.queries.js

export const GET_SHARING_CONFIG = `
  SELECT a.is_public, a.public_link,
         COALESCE(
           json_agg(
             json_build_object(
               'userId', s.user_id,
               'username', u.username,
               'nome', u.nome,
               'permission', s.permission,
               'addedAt', s.added_at
             )
           ) FILTER (WHERE s.id IS NOT NULL),
           '[]'
         ) as shares
  FROM atlas a
  LEFT JOIN atlas_shares s ON s.atlas_id = a.id
  LEFT JOIN users u ON u.id = s.user_id
  WHERE a.id = $1 AND a.deleted_at IS NULL
  GROUP BY a.id
`;

export const INSERT_USER_SHARE = `
  INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = EXCLUDED.permission
  RETURNING *
`;

export const UPDATE_USER_SHARE = `
  UPDATE atlas_shares
  SET permission = $3
  WHERE atlas_id = $1 AND user_id = $2
  RETURNING *
`;

export const DELETE_USER_SHARE = `
  DELETE FROM atlas_shares
  WHERE atlas_id = $1 AND user_id = $2
  RETURNING id
`;

export const FIND_USER_BY_ID = `
  SELECT id FROM users WHERE id = $1 AND is_active = true
`;
