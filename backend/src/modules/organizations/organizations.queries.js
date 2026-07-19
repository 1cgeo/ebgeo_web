// Path: src/modules/organizations/organizations.queries.js

export const LIST_ORGANIZATIONS = `
  SELECT id, nome, slug, sigla, is_active, created_at, updated_at
  FROM organizations
  ORDER BY nome
`;

export const FIND_ORGANIZATION = `
  SELECT id, nome, slug, sigla, is_active, created_at, updated_at
  FROM organizations WHERE id = $1
`;

export const CHECK_SLUG = `SELECT id FROM organizations WHERE slug = $1`;

export const INSERT_ORGANIZATION = `
  INSERT INTO organizations (nome, slug, sigla)
  VALUES ($1, $2, $3)
  RETURNING id, nome, slug, sigla, is_active, created_at, updated_at
`;

// Nullable text columns use a "provided" FLAG (see UPDATE_USER_PROFILE, which solved
// this first and documents why: "COALESCE alone could never clear to NULL"). COALESCE
// collapses the two meanings of null — "field absent from the PATCH" and "clear this
// field" — into one, so the API accepted null (the Joi schemas say .allow(null, ''))
// and silently kept the old value, answering 200 with the un-cleared row. The client
// then confirms a deletion that never happened.
export const UPDATE_ORGANIZATION = `
  UPDATE organizations
  SET nome = COALESCE($2, nome),
      sigla = CASE WHEN $5 THEN $3 ELSE sigla END,
      is_active = COALESCE($4, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, nome, slug, sigla, is_active, created_at, updated_at
`;

export const DEACTIVATE_ORGANIZATION = `
  UPDATE organizations SET is_active = false, updated_at = NOW()
  WHERE id = $1 RETURNING id
`;
