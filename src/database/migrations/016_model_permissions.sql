-- Path: src/database/migrations/016_model_permissions.sql
-- 3D catalog access control: access_level + per-model/per-group permissions.
-- Mirrors the structure the geographic zones will use in fase-6.

-- 1) Model access level (default public preserves current visibility).
ALTER TABLE ng.catalogo_3d
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (access_level IN ('public', 'private'));

-- 2) Direct user -> model permission.
CREATE TABLE IF NOT EXISTS ng.model_permissions (
  user_id    UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_permissions_model ON ng.model_permissions(model_id);

-- 3) Group -> model permission.
CREATE TABLE IF NOT EXISTS ng.model_group_permissions (
  group_id   UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_group_permissions_model ON ng.model_group_permissions(model_id);

-- 4) Group membership stub (populated/extended by fase-6). The access CTE joins it.
CREATE TABLE IF NOT EXISTS ng.user_groups (
  user_id  UUID NOT NULL,
  group_id UUID NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

-- 5) Partial index for the hot slice (public models).
CREATE INDEX IF NOT EXISTS idx_catalogo_3d_public
  ON ng.catalogo_3d(id) WHERE access_level = 'public';
