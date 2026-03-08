// Path: src/modules/resources/resources.queries.js

export const LIST_ALL = `
  SELECT id, category, name, description, config, sort_order, created_at, updated_at
  FROM resources
  WHERE active = true
  ORDER BY category, sort_order, name
`;

export const LIST_BY_CATEGORY = `
  SELECT id, category, name, description, config, sort_order, created_at, updated_at
  FROM resources
  WHERE category = $1 AND active = true
  ORDER BY sort_order, name
`;

export const FIND_BY_ID = `
  SELECT id, category, name, description, config, active, sort_order, created_at, updated_at
  FROM resources
  WHERE id = $1
`;

export const INSERT = `
  INSERT INTO resources (id, category, name, description, config, sort_order)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  RETURNING *
`;

export const UPDATE = `
  UPDATE resources
  SET name = COALESCE($2, name),
      description = COALESCE($3, description),
      config = COALESCE($4::jsonb, config),
      sort_order = COALESCE($5, sort_order),
      updated_at = NOW()
  WHERE id = $1
  RETURNING *
`;

export const SOFT_DELETE = `
  UPDATE resources
  SET active = false, updated_at = NOW()
  WHERE id = $1
  RETURNING *
`;

