-- Path: src/database/migrations/007_map_grid_style.sql
-- gridStyle (§26 Grade UTM): persist the per-map grid style. Previously the
-- `gridStyle` sync alias was a silent no-op (no column to write to).
ALTER TABLE maps
  ADD COLUMN IF NOT EXISTS grid_style JSONB NOT NULL DEFAULT '{}';
