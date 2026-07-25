// Path: src/modules/config/config.queries.js

// Admin config overrides (single-row partial config; see config_settings).
export const GET_CONFIG_OVERRIDES = `
  SELECT value FROM config_settings WHERE key = $1
`;

// Lock-and-read of the single override row, for the read-modify-write of PUT /config/admin.
//
// It is an UPSERT and not a `SELECT ... FOR UPDATE` for one reason: `FOR UPDATE` locks ROWS,
// and on the very first save there is no row to lock — two admins would both read "no row",
// both merge onto `{}` and the second `ON CONFLICT DO UPDATE` would silently overwrite the
// first. Inserting the empty placeholder makes the contended object exist, so the loser blocks
// on the unique index instead of racing past it.
//
// `DO UPDATE SET key = config_settings.key` is a deliberate no-op write: `ON CONFLICT DO
// NOTHING` would NOT lock the existing row (it just skips), whereas `DO UPDATE` takes the row
// lock and holds it until the transaction ends. `RETURNING value` then yields the CURRENT
// document (the no-op SET leaves `value` untouched), so the lock and the read are one
// statement and no window exists between them.
export const LOCK_CONFIG_OVERRIDES = `
  INSERT INTO config_settings (key, value)
  VALUES ($1, '{}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET key = config_settings.key
  RETURNING value
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
