// Path: src/modules/sharing/sharing.queries.js

export const GET_SHARING_CONFIG = `
  SELECT a.is_public, a.public_link, a.owner_id,
         owner.username AS owner_username, owner.nome AS owner_nome,
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
  JOIN users owner ON owner.id = a.owner_id
  LEFT JOIN atlas_shares s ON s.atlas_id = a.id
  LEFT JOIN users u ON u.id = s.user_id
  WHERE a.id = $1 AND a.deleted_at IS NULL
  GROUP BY a.id, owner.username, owner.nome
`;

export const INSERT_USER_SHARE = `
  INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = EXCLUDED.permission
  RETURNING *
`;

// Returns the PREVIOUS permission alongside the new row: a permission change is only
// auditable if the record says what it changed FROM. The self-join reads the pre-UPDATE
// snapshot (Postgres evaluates the FROM against the rows as they were), which keeps it
// a single atomic statement instead of a read-then-write pair.
export const UPDATE_USER_SHARE = `
  UPDATE atlas_shares s
  SET permission = $3
  FROM atlas_shares prev
  WHERE s.atlas_id = $1 AND s.user_id = $2
    AND prev.atlas_id = s.atlas_id AND prev.user_id = s.user_id
  RETURNING s.*, prev.permission AS previous_permission
`;

export const DELETE_USER_SHARE = `
  DELETE FROM atlas_shares
  WHERE atlas_id = $1 AND user_id = $2
  RETURNING id
`;

export const FIND_USER_BY_ID = `
  SELECT id FROM users WHERE id = $1 AND is_active = true
`;
