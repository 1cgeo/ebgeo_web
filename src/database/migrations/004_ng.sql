-- Path: src/database/migrations/004_ng.sql
-- Baseline: gazetteer PostGIS (schema ng) — read-only reference data isolada do
-- atlas JSONB, com controle de acesso embutido na query (zonas geográficas +
-- permissões de modelo). Consolida 011 (PostGIS/nomes/edificacoes/catalogo_3d),
-- 016 (model permissions) e 017 (geographic access). PostGIS exige superusuário.
-- 7-criteria search, f_unaccent, tipo_peso, DBSCAN clusters, catalogo_3d full-text.

-- ============================================================================
-- 1) Extensions (idempotente). pgcrypto já criado em 001; postgis/pg_trgm/
--    unaccent vivem só aqui (e em sv360) — por isso ng exige superusuário.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Schema
CREATE SCHEMA IF NOT EXISTS ng;

-- 3) IMMUTABLE unaccent wrapper (native unaccent is only STABLE → not indexable)
CREATE OR REPLACE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- ============================================================================
-- 4) nomes_geograficos (SRID 4674 — SIRGAS 2000). access_level + índice/estatística
--    da fatia pública vêm do CREATE (antes ALTER na migração 017).
-- ============================================================================
CREATE TABLE ng.nomes_geograficos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         VARCHAR(255) NOT NULL,
  municipio    VARCHAR(255),
  estado       VARCHAR(255),
  tipo         VARCHAR(255),
  cluster_id   INTEGER,
  tipo_peso    FLOAT DEFAULT 0.1,
  geom         GEOMETRY(POINT, 4674) NOT NULL,
  -- access_level por último (após geom): preserva a ordem cumulativa original
  -- (017 era ADD COLUMN) p/ COPY posicional do FME não desalinhar colunas.
  access_level VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_level IN ('public','private'))
);
CREATE INDEX idx_ng_geom ON ng.nomes_geograficos USING GIST (geom);
CREATE INDEX idx_ng_nome_unaccent_trgm
  ON ng.nomes_geograficos USING GIN (ng.f_unaccent(nome) gin_trgm_ops);
CREATE INDEX idx_ng_tipo ON ng.nomes_geograficos (tipo);
CREATE INDEX idx_ng_cluster ON ng.nomes_geograficos (nome, tipo, cluster_id);
CREATE INDEX idx_ng_tipo_peso ON ng.nomes_geograficos (tipo_peso DESC);
CREATE INDEX idx_nomes_public ON ng.nomes_geograficos (id) WHERE access_level = 'public';
ALTER TABLE ng.nomes_geograficos ALTER COLUMN access_level SET STATISTICS 1000;

-- ============================================================================
-- 5) edificacoes (SRID 4326 — intentionally different from nomes)
-- ============================================================================
CREATE TABLE ng.edificacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          VARCHAR(255),
  municipio     VARCHAR(255),
  estado        VARCHAR(255),
  tipo          VARCHAR(255),
  altitude_base NUMERIC,
  altitude_topo NUMERIC,
  geom          GEOMETRY(POLYGON, 4326) NOT NULL,
  -- access_level por último (após geom): mesma razão de nomes_geograficos.
  access_level  VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_level IN ('public','private')),
  CHECK (altitude_base <= altitude_topo)
);
CREATE INDEX idx_edif_geom ON ng.edificacoes USING GIST (geom);
CREATE INDEX idx_edif_alt ON ng.edificacoes (altitude_base, altitude_topo);
CREATE INDEX idx_edificacoes_public ON ng.edificacoes (id) WHERE access_level = 'public';
ALTER TABLE ng.edificacoes ALTER COLUMN access_level SET STATISTICS 1000;

-- ============================================================================
-- 6) catalogo_3d (full-text PT-BR). access_level + índice público vêm do CREATE
--    (antes ALTER na migração 016).
-- ============================================================================
CREATE TABLE ng.catalogo_3d (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     VARCHAR(255) NOT NULL,
  description              TEXT,
  municipio                VARCHAR(255),
  estado                   VARCHAR(255),
  thumbnail                VARCHAR(1024),
  palavras_chave           TEXT[],
  url                      VARCHAR(1024),
  lon                      NUMERIC,
  lat                      NUMERIC,
  height                   NUMERIC,
  heading                  NUMERIC,
  pitch                    NUMERIC,
  roll                     NUMERIC,
  type                     VARCHAR(50) CHECK (type IN ('Tiles 3D','Modelos 3D','Nuvem de Pontos')),
  heightoffset             NUMERIC,
  maximumscreenspaceerror  NUMERIC,
  data_criacao             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector            TSVECTOR,
  style                    JSONB,
  access_level             VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'private'))
);
CREATE INDEX idx_cat3d_search ON ng.catalogo_3d USING GIN (search_vector);
CREATE INDEX idx_cat3d_criacao ON ng.catalogo_3d (data_criacao DESC);
CREATE INDEX idx_cat3d_type ON ng.catalogo_3d (type);
CREATE INDEX idx_catalogo_3d_public ON ng.catalogo_3d(id) WHERE access_level = 'public';

-- ============================================================================
-- 7) tipo_peso trigger (EDGV hierarchy)
-- ============================================================================
CREATE OR REPLACE FUNCTION ng.calcular_tipo_peso() RETURNS TRIGGER AS $$
DECLARE t TEXT := ng.f_unaccent(lower(COALESCE(NEW.tipo, '')));
BEGIN
  NEW.tipo_peso := CASE
    WHEN t LIKE '%cidade%'                                              THEN 1.0
    WHEN t LIKE '%vila%'    OR t LIKE '%povoado%'                       THEN 0.9
    WHEN t LIKE '%rio%'     OR t LIKE '%lago%'   OR t LIKE '%represa%'  THEN 0.85
    WHEN t LIKE '%serra%'   OR t LIKE '%morro%'  OR t LIKE '%ilha%'
      OR t LIKE '%pico%'    OR t LIKE '%ponta%'  OR t LIKE '%praia%'    THEN 0.8
    WHEN t LIKE '%nome local%'                                          THEN 0.75
    WHEN t LIKE '%estrada%' OR t LIKE '%rodovia%'                       THEN 0.7
    WHEN t LIKE '%arroio%'  OR t LIKE '%canal%'  OR t LIKE '%cachoeira%' THEN 0.6
    WHEN t LIKE '%unidade de conservacao%' OR t LIKE '%terra indigena%' THEN 0.55
    WHEN t LIKE '%agro%'                                                THEN 0.5
    WHEN t LIKE '%ponte%'   OR t LIKE '%porto%'  OR t LIKE '%rodoviaria%'
      OR t LIKE '%aeroporto%'                                           THEN 0.4
    WHEN t LIKE '%saude%'   OR t LIKE '%ensino%' OR t LIKE '%seguranca%'
      OR t LIKE '%admin%'                                               THEN 0.35
    WHEN t LIKE '%energia%'                                             THEN 0.3
    WHEN t LIKE '%comercio%' OR t LIKE '%industria%' OR t LIKE '%lazer%' THEN 0.25
    WHEN t LIKE '%saneamento%' OR t LIKE '%comunicacao%' OR t LIKE '%duto%' THEN 0.2
    WHEN t LIKE '%religioso%' OR t LIKE '%cemiterio%'                   THEN 0.15
    ELSE 0.1
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calcular_tipo_peso
  BEFORE INSERT OR UPDATE OF tipo ON ng.nomes_geograficos
  FOR EACH ROW EXECUTE FUNCTION ng.calcular_tipo_peso();

-- 8) search_vector trigger for catalogo_3d (name A, description/keywords B, mun/estado C)
CREATE OR REPLACE FUNCTION ng.catalogo_3d_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('portuguese', COALESCE(NEW.name, '')), 'A')
   || setweight(to_tsvector('portuguese', COALESCE(NEW.description, '')), 'B')
   || setweight(to_tsvector('portuguese', COALESCE(array_to_string(NEW.palavras_chave, ' '), '')), 'B')
   || setweight(to_tsvector('portuguese', COALESCE(NEW.municipio, '') || ' ' || COALESCE(NEW.estado, '')), 'C');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_catalogo_3d_search
  BEFORE INSERT OR UPDATE ON ng.catalogo_3d
  FOR EACH ROW EXECUTE FUNCTION ng.catalogo_3d_search_update();

-- 9) DBSCAN cluster recompute (eps ~5km in degrees, partitioned by name+type)
CREATE OR REPLACE FUNCTION ng.recomputar_clusters() RETURNS void AS $$
  WITH clusters AS (
    SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
      OVER (PARTITION BY nome, tipo) AS cid
    FROM ng.nomes_geograficos
  )
  UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
$$ LANGUAGE sql;

-- 10) refresh_busca: MANDATORY post-load step (FME). Re-fires tipo_peso (COPY
--     bypasses BEFORE INSERT triggers) and recomputes clusters.
CREATE OR REPLACE FUNCTION ng.refresh_busca() RETURNS void AS $$
BEGIN
  UPDATE ng.nomes_geograficos SET tipo = tipo;
  PERFORM ng.recomputar_clusters();
END; $$ LANGUAGE plpgsql;

-- ============================================================================
-- 11) Geographic access control (016 + 017). Membership em ng.user_groups; a
--     entidade de grupos é ng.groups. Autorização embutida na query de busca via
--     o predicado único ng.fn_user_zone_geoms (defense in depth).
-- ============================================================================

-- 11a) Groups entity (metadata). Membership lives in ng.user_groups.
CREATE TABLE ng.groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11b) Group membership (user_id, group_id). A query de catálogo faz join aqui.
CREATE TABLE ng.user_groups (
  user_id  UUID NOT NULL,
  group_id UUID NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

-- 11c) Direct user -> model permission.
CREATE TABLE ng.model_permissions (
  user_id    UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);
CREATE INDEX idx_model_permissions_model ON ng.model_permissions(model_id);

-- 11d) Group -> model permission. group_id mantém o nome de constraint legado
--      fk_model_group_perms_group (a FK física foi adicionada na 017).
CREATE TABLE ng.model_group_permissions (
  group_id   UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, model_id),
  CONSTRAINT fk_model_group_perms_group FOREIGN KEY (group_id) REFERENCES ng.groups(id) ON DELETE CASCADE
);
CREATE INDEX idx_model_group_permissions_model ON ng.model_group_permissions(model_id);
CREATE INDEX idx_model_group_permissions_group ON ng.model_group_permissions(group_id);

-- 11e) Geographic access zones (POLYGON, SRID 4674 to match nomes). ST_Contains
--      requires matching SRID; edificacoes (4326) is transformed at query time.
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

-- 11f) Single reusable predicate: the zone geometries visible to a user.
--      Anonymous (p_user NULL) -> empty -> only public rows survive.
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
