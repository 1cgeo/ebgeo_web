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

// Nullable text columns use a "provided" FLAG (see UPDATE_USER_PROFILE, which solved
// this first and documents why: "COALESCE alone could never clear to NULL"). COALESCE
// collapses the two meanings of null — "field absent from the PATCH" and "clear this
// field" — into one, so the API accepted null (the Joi schemas say .allow(null, ''))
// and silently kept the old value, answering 200 with the un-cleared row. The client
// then confirms a deletion that never happened.
export const UPDATE_RANK = `
  UPDATE ranks
  SET nome = COALESCE($2, nome),
      nome_abrev = CASE WHEN $6 THEN $3 ELSE nome_abrev END,
      sort_order = COALESCE($4, sort_order),
      is_active = COALESCE($5, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, code, nome, nome_abrev, sort_order, is_active, created_at, updated_at
`;

// Soft delete: a rank may be referenced by users.rank_id, so we deactivate (hide from the
// signup dropdown) instead of hard-deleting.
//
// `RETURNING` BRINGS THE NAME BACK, and that is not decoration: the audit trail records
// `target_name` as the name AT THE TIME OF THE ACT, so a rank renamed afterwards still
// reads correctly in the trail. The sibling module shows the cost of the cheap version —
// its DEACTIVATE only does `RETURNING id`, so every `ORG_DELETE` line carries a naked
// UUID and whoever reads the trail has to go look the name up somewhere else.
export const DEACTIVATE_RANK = `
  UPDATE ranks SET is_active = false, updated_at = NOW()
  WHERE id = $1 RETURNING id, nome
`;
