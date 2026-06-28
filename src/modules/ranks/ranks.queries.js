// Path: src/modules/ranks/ranks.queries.js

export const LIST_RANKS = `
  SELECT id, code, nome, nome_abrev, sort_order, is_active, created_at, updated_at
  FROM ranks
  ORDER BY sort_order, nome
`;

export const FIND_RANK = `
  SELECT id, code, nome, nome_abrev, sort_order, is_active, created_at, updated_at
  FROM ranks WHERE id = $1
`;

export const INSERT_RANK = `
  INSERT INTO ranks (nome, nome_abrev, sort_order)
  VALUES ($1, $2, $3)
  RETURNING id, code, nome, nome_abrev, sort_order, is_active, created_at, updated_at
`;

export const UPDATE_RANK = `
  UPDATE ranks
  SET nome = COALESCE($2, nome),
      nome_abrev = COALESCE($3, nome_abrev),
      sort_order = COALESCE($4, sort_order),
      is_active = COALESCE($5, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, code, nome, nome_abrev, sort_order, is_active, created_at, updated_at
`;

// Soft delete: a rank may be referenced by users.rank_id, so we deactivate (hide from the
// signup dropdown) instead of hard-deleting.
export const DEACTIVATE_RANK = `
  UPDATE ranks SET is_active = false, updated_at = NOW()
  WHERE id = $1 RETURNING id
`;
