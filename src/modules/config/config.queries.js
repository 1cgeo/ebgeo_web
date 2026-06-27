// Path: src/modules/config/config.queries.js

// Active resources of one category, ordered for stable payload output.
export const LIST_BY_CATEGORY = `
  SELECT id, name, config
  FROM resources
  WHERE category = $1 AND active = true
  ORDER BY sort_order
`;

// Admin config overrides (single-row partial config; see config_settings).
export const GET_CONFIG_OVERRIDES = `
  SELECT value FROM config_settings WHERE key = $1
`;

export const UPSERT_CONFIG_OVERRIDES = `
  INSERT INTO config_settings (key, value, updated_by, updated_at)
  VALUES ($1, $2::jsonb, $3, NOW())
  ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = NOW()
  RETURNING value
`;

export const CLEAR_CONFIG_OVERRIDES = `
  DELETE FROM config_settings WHERE key = $1
`;
