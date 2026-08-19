-- Path: src/database/migrations/006_ng.sql
-- NG: o gazetteer PostGIS (schema `ng`) — dado de referência read-only, isolado
-- do atlas JSONB, com controle de acesso embutido na query (zonas geográficas).
-- Busca por 7 critérios, f_unaccent, tipo_peso, clusters DBSCAN.
-- PostGIS exige superusuário para criar a extensão; em teste e em dev ela é
-- pré-criada pelo runner (scripts/run-tests.js, scripts/dev-db.js).
--
-- NÃO EXISTE AQUI UM CATÁLOGO DE MODELO 3D, e a ausência é decisão registrada.
-- Houve `ng.catalogo_3d` com um par de tabelas de permissão próprias
-- (`ng.model_permissions`, `ng.model_group_permissions`) e uma rota
-- `GET /nomes/catalogo3d`: era o SEGUNDO catálogo de modelo 3D do sistema, sem
-- consumidor nenhum no frontend, e as duas tabelas de permissão não tinham
-- escritor nenhum em `src/` — o filtro existia e era inalcançável. O catálogo que
-- sobrevive é `public.tilesets`, servido por `GET /api/config` e resolvido pelo
-- visualizador, com o eixo de acesso de `resource_grants`/`atlas_resources`. O
-- importador do gazetteer carrega o acervo 3D direto em `tilesets`.
--
-- `ng.groups` e `ng.user_groups` FICAM: as zonas de acesso geográfico as usam e
-- estão vivas.

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
CREATE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- ============================================================================
-- 4) nomes_geograficos (SRID 4674 — SIRGAS 2000)
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
  -- access_level POR ÚLTIMO, DEPOIS DE `geom`, E A POSIÇÃO É CONTRATO EXTERNO:
  -- a carga do FME é um COPY POSICIONAL, e mover esta coluna para o meio
  -- desalinha as colunas de todo arquivo de carga já produzido. Ordem de coluna
  -- aqui não é estética.
  access_level VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_level IN ('public','private'))
);
CREATE INDEX idx_ng_geom ON ng.nomes_geograficos USING GIST (geom);
CREATE INDEX idx_ng_nome_unaccent_trgm
  ON ng.nomes_geograficos USING GIN (ng.f_unaccent(nome) gin_trgm_ops);
CREATE INDEX idx_ng_tipo ON ng.nomes_geograficos (tipo);
CREATE INDEX idx_ng_cluster ON ng.nomes_geograficos (nome, tipo, cluster_id);
CREATE INDEX idx_ng_tipo_peso ON ng.nomes_geograficos (tipo_peso DESC);
-- Índice parcial no lado PÚBLICO: aqui o conjunto pequeno é o outro, ao
-- contrário do catálogo, onde o privado é que é pequeno.
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
-- 6) tipo_peso (hierarquia EDGV)
-- ============================================================================
--
-- CASA PALAVRA (`\m..\M`), NUNCA SUBSTRING. Substring não respeita fronteira de
-- palavra: cemite(rio), avia(rio), aterro sanita(rio), superior (graduação),
-- veterina(rio), reservato(rio), pátio rodovia(rio)/aeroportua(rio), ferrovia(rio)
-- e artigos de vestua(rio) casavam o ramo de HIDROGRAFIA, o terceiro maior peso da
-- hierarquia. Medido contra o acervo real de 2026-07-23 (81.964 topônimos, 388
-- tipos distintos): 658 linhas classificadas como hidrografia sem ser.
--
-- `com` NÃO ENTRA como abreviação de comércio, ainda que o padrão `Xxx -` sugira:
-- é preposição, e o vocabulário está cheio de `(com fluxo)` — com ela,
-- `Laguna (com fluxo)` vira comércio. Foi medido (50 linhas), e é a razão de o
-- ramo listar só `comercio|comerc`. Quem for acrescentar abreviação aqui: rode
-- contra o acervo antes, porque NADA nesta função falha alto.
--
-- Detalhe da medição e o vocabulário completo em
-- docs/wiki/ranking-busca-toponimos.md.
CREATE FUNCTION ng.calcular_tipo_peso() RETURNS TRIGGER AS $$
DECLARE t TEXT := ng.f_unaccent(lower(COALESCE(NEW.tipo, '')));
BEGIN
  NEW.tipo_peso := CASE
    WHEN t ~ '\mcidades?\M'                                                THEN 1.0
    WHEN t ~ '\m(vilas?|povoados?|lugarejos?|nucleos?)\M'                  THEN 0.9
    WHEN t ~ '\m(rios?|lagos?|lagoas?|represas?|acudes?)\M'                THEN 0.85
    WHEN t ~ '\m(serras?|morros?|ilhas?|picos?|pontas?|praias?)\M'         THEN 0.8
    WHEN t ~ '\mnome local\M'                                              THEN 0.75
    WHEN t ~ '\m(estradas?|rodovias?)\M'                                   THEN 0.7
    WHEN t ~ '\m(arroios?|canal|canais|cachoeiras?|corredeiras?|foz)\M'    THEN 0.6
    WHEN t ~ '\m(unidade de conservacao|terras? indigenas?)\M'             THEN 0.55
    WHEN t ~ '\magro\M'                                                    THEN 0.5
    WHEN t ~ '\m(pontes?|portos?|rodoviarias?|aeroportos?)\M'              THEN 0.4
    WHEN t ~ '\m(saude|sau|ensino|ens|seguranca|seg|administra\w*)\M'      THEN 0.35
    WHEN t ~ '\m(energia|eletrica|eolica|solar|subestacao|termeletrica|hidreletrica)\M' THEN 0.3
    WHEN t ~ '\m(comercio|comerc|industria|ind|lazer)\M'                   THEN 0.25
    WHEN t ~ '\m(saneamento|saneam|sanitario|san|comunicacao|comunic|dutos?)\M' THEN 0.2
    WHEN t ~ '\m(religios\w*|rel|cemiterios?)\M'                           THEN 0.15
    ELSE 0.1
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calcular_tipo_peso
  BEFORE INSERT OR UPDATE OF tipo ON ng.nomes_geograficos
  FOR EACH ROW EXECUTE FUNCTION ng.calcular_tipo_peso();

-- 7) DBSCAN cluster recompute (eps ~5km in degrees, partitioned by name+type)
CREATE FUNCTION ng.recomputar_clusters() RETURNS void AS $$
  WITH clusters AS (
    SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
      OVER (PARTITION BY nome, tipo) AS cid
    FROM ng.nomes_geograficos
  )
  UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
$$ LANGUAGE sql;

-- 8) refresh_busca: PASSO OBRIGATÓRIO pós-carga (FME). Recomputa clusters e
--    re-dispara tipo_peso.
--
--    ERRATA DE 2026-07-24, paga com medição: o comentário original justificava o
--    re-fire dizendo que "COPY bypassa trigger BEFORE INSERT". NÃO PASSA — medido
--    contra o PostgreSQL desta instalação, COPY DISPARA trigger BEFORE INSERT de
--    linha; o que ele não dispara são RULES. Então o `UPDATE tipo = tipo` é
--    defensivo e idempotente, não obrigatório para o caminho de COPY: cobre carga
--    por caminho que desabilite trigger e reprocessa peso depois de mudança na
--    função. O PASSO CONTINUA OBRIGATÓRIO PELOS CLUSTERS, que nada mais recomputa.
--    Citado por docs/wiki/deploy-backend.md.
CREATE FUNCTION ng.refresh_busca() RETURNS void AS $$
BEGIN
  UPDATE ng.nomes_geograficos SET tipo = tipo;
  PERFORM ng.recomputar_clusters();
END; $$ LANGUAGE plpgsql;

-- ============================================================================
-- 9) Controle de acesso geográfico. Membership em ng.user_groups; a entidade de
--    grupos é ng.groups. A autorização é embutida na query de busca pelo
--    predicado único ng.fn_user_zone_geoms (defense in depth).
--
--    Repare que `created_by`, `user_id` e afins deste schema são UUID SEM FK para
--    `public.users`, e é deliberado: `ng` é um schema de dado de referência,
--    carregado por ETL externo, e não participa da integridade do schema da
--    aplicação. Registrado em docs/wiki/zonas-acesso-geografico.md.
-- ============================================================================

-- 9a) Groups entity (metadata). Membership lives in ng.user_groups.
CREATE TABLE ng.groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9b) Group membership (user_id, group_id).
CREATE TABLE ng.user_groups (
  user_id  UUID NOT NULL,
  group_id UUID NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

-- 9c) Geographic access zones (POLYGON, SRID 4674 to match nomes). ST_Contains
--     requires matching SRID; edificacoes (4326) is transformed at query time.
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

-- 9d) Single reusable predicate: the zone geometries visible to a user.
--     Anonymous (p_user NULL) -> empty -> only public rows survive.
CREATE FUNCTION ng.fn_user_zone_geoms(p_user UUID)
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
