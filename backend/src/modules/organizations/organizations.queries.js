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

export const UPDATE_ORGANIZATION = `
  UPDATE organizations
  SET nome = COALESCE($2, nome),
      sigla = COALESCE($3, sigla),
      is_active = COALESCE($4, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, nome, slug, sigla, is_active, created_at, updated_at
`;

export const DEACTIVATE_ORGANIZATION = `
  UPDATE organizations SET is_active = false, updated_at = NOW()
  WHERE id = $1 RETURNING id
`;
