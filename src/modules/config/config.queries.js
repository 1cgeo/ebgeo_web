// Path: src/modules/config/config.queries.js

// Active resources of one category, ordered for stable payload output.
export const LIST_BY_CATEGORY = `
  SELECT id, name, config
  FROM resources
  WHERE category = $1 AND active = true
  ORDER BY sort_order
`;
