-- Path: src/database/migrations/017_geographic_access.sql
-- Geographic access control over the read-only `ng` schema (nomes/edificacoes)
-- + model permissions wiring. Authorization is embedded in the search SQL
-- (defense in depth) via the single predicate ng.fn_user_zone_geoms.
--
-- Naming note: membership stays in ng.user_groups (user_id, group_id) — the
-- stub created by 016 (which the catalog query already joins). This migration
-- adds the GROUPS ENTITY ng.groups and wires FKs to it.

-- 1) Groups entity (metadata). Membership lives in ng.user_groups (016).
CREATE TABLE IF NOT EXISTS ng.groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) access_level on the spatial reference tables (default public = no regression).
ALTER TABLE ng.nomes_geograficos
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (access_level IN ('public','private'));
ALTER TABLE ng.edificacoes
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (access_level IN ('public','private'));

-- 3) Geographic access zones (POLYGON, SRID 4674 to match nomes). ST_Contains
--    requires matching SRID; edificacoes (4326) is transformed at query time.
CREATE TABLE ng.geographic_access_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100),
    description TEXT,
    geom        GEOMETRY(POLYGON, 4674) NOT NULL,
    created_by  UUID,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_zones_geom ON ng.geographic_access_zones USING GIST (geom);

CREATE TABLE ng.zone_permissions (
    zone_id    UUID NOT NULL REFERENCES ng.geographic_access_zones(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, user_id)
);
CREATE INDEX idx_zone_permissions_user ON ng.zone_permissions(user_id);

CREATE TABLE ng.zone_group_permissions (
    zone_id    UUID NOT NULL REFERENCES ng.geographic_access_zones(id) ON DELETE CASCADE,
    group_id   UUID NOT NULL REFERENCES ng.groups(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, group_id)
);
CREATE INDEX idx_zone_group_permissions_group ON ng.zone_group_permissions(group_id);

-- 4) Single reusable predicate: the zone geometries visible to a user.
--    Anonymous (p_user NULL) -> empty -> only public rows survive.
CREATE OR REPLACE FUNCTION ng.fn_user_zone_geoms(p_user UUID)
RETURNS TABLE(id UUID, geom geometry) LANGUAGE sql STABLE AS $$
  SELECT z.id, z.geom
  FROM ng.geographic_access_zones z
  WHERE p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM ng.zone_permissions zp
            WHERE zp.zone_id = z.id AND zp.user_id = p_user)
    OR EXISTS (SELECT 1 FROM ng.zone_group_permissions zgp
               JOIN ng.user_groups ug ON ug.group_id = zgp.group_id
               WHERE zgp.zone_id = z.id AND ug.user_id = p_user)
  );
$$;

-- 5) Partial indexes for the hot (public) slice + planner statistics.
CREATE INDEX IF NOT EXISTS idx_nomes_public
  ON ng.nomes_geograficos (id) WHERE access_level = 'public';
CREATE INDEX IF NOT EXISTS idx_edificacoes_public
  ON ng.edificacoes (id) WHERE access_level = 'public';
ALTER TABLE ng.nomes_geograficos ALTER COLUMN access_level SET STATISTICS 1000;
ALTER TABLE ng.edificacoes ALTER COLUMN access_level SET STATISTICS 1000;

-- 6) Physical FK for model group permissions (016 left it logical).
ALTER TABLE ng.model_group_permissions
  ADD CONSTRAINT fk_model_group_perms_group
  FOREIGN KEY (group_id) REFERENCES ng.groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_model_group_permissions_group
  ON ng.model_group_permissions(group_id);
