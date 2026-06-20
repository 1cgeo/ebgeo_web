-- Path: src/database/migrations/018_sv360_schema.sql
-- StreetView 360 (Fase 9, STAGE 1 — read-only): schema `sv360` for panorama
-- projects/photos/targets metadata + soft-delete tombstones. Binaries (webp)
-- live in per-project {slug}.db SQLite stores, NOT here — only metadata +
-- PostGIS point. PostGIS already created by 011, so GEOMETRY(POINT,4326) works.
-- Forward-only / additive. gen_random_uuid() PKs except sv360.photos.id, which
-- is the CLIENT-supplied deterministic UUID v5 string (D9.6) — NO default.

-- 1) Schema
CREATE SCHEMA IF NOT EXISTS sv360;

-- 2) projects (mission/OM-scoped panorama set). FK to public.organizations with
--    NO ON DELETE — reassign before any hard-delete (same rule as atlas.owner_id).
--    entry_photo_id is a soft/logical reference to a photos.id string (the photo
--    may not exist yet during ingestion), so it is NOT a DB FK.
CREATE TABLE sv360.projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    center_lat      DOUBLE PRECISION,
    center_long     DOUBLE PRECISION,
    entry_photo_id  TEXT,
    photo_count     INTEGER NOT NULL DEFAULT 0,
    db_filename     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'enabled'
        CHECK (status IN ('enabled','disabled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, slug)
);
CREATE INDEX idx_sv360_projects_org ON sv360.projects(organization_id);

-- 3) photos (per-photo panorama metadata + flat calibration + PostGIS point).
--    id is the client-supplied UUID v5 string (TEXT, NO gen_random_uuid default).
CREATE TABLE sv360.photos (
    id                   TEXT PRIMARY KEY,
    project_id           UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    original_name        TEXT NOT NULL,
    display_name         TEXT,
    sequence_number      INTEGER NOT NULL,
    lat                  DOUBLE PRECISION NOT NULL,
    lon                  DOUBLE PRECISION NOT NULL,
    ele                  DOUBLE PRECISION,
    heading              DOUBLE PRECISION NOT NULL DEFAULT 0,
    camera_height        DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_x      DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_y      DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_z      DOUBLE PRECISION NOT NULL DEFAULT 0,
    distance_scale       DOUBLE PRECISION NOT NULL DEFAULT 1,
    marker_scale         DOUBLE PRECISION NOT NULL DEFAULT 1,
    floor_level          INTEGER NOT NULL DEFAULT 0,
    full_size_bytes      BIGINT NOT NULL DEFAULT 0,
    preview_size_bytes   BIGINT NOT NULL DEFAULT 0,
    calibration_reviewed BOOLEAN NOT NULL DEFAULT false,
    capture_date         TIMESTAMPTZ,
    geom                 GEOMETRY(POINT, 4326),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, sequence_number)
);
CREATE INDEX idx_sv360_photos_project       ON sv360.photos(project_id);
CREATE INDEX idx_sv360_photos_geom          ON sv360.photos USING GIST (geom);
CREATE INDEX idx_sv360_photos_original_name ON sv360.photos(original_name);

-- 3b) Keep geom consistent with lon/lat (COPY/ETL bypasses app-side projection).
CREATE OR REPLACE FUNCTION sv360.fn_photos_set_geom() RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sv360_photos_geom
  BEFORE INSERT OR UPDATE OF lon, lat ON sv360.photos
  FOR EACH ROW EXECUTE FUNCTION sv360.fn_photos_set_geom();

-- 4) targets (directed photo-to-photo adjacency graph: next/original links with
--    optional per-link overrides + visibility). Internal columns bearing_deg/
--    distance_m surface as bearing/distance in the JSON contract.
CREATE TABLE sv360.targets (
    source_id         TEXT NOT NULL REFERENCES sv360.photos(id) ON DELETE CASCADE,
    target_id         TEXT NOT NULL REFERENCES sv360.photos(id) ON DELETE CASCADE,
    distance_m        DOUBLE PRECISION,
    bearing_deg       DOUBLE PRECISION,
    is_next           BOOLEAN NOT NULL DEFAULT false,
    is_original       BOOLEAN NOT NULL DEFAULT false,
    override_bearing  DOUBLE PRECISION,
    override_distance DOUBLE PRECISION,
    override_height   DOUBLE PRECISION,
    hidden            BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (source_id, target_id)
);
CREATE INDEX idx_sv360_targets_source
  ON sv360.targets(source_id) WHERE hidden = false;

-- 5) deleted_photos (tombstone for soft-deleted photos). Stage 1 only READS this
--    to exclude tombstoned photos; stage 2 writes here. No FK — the photos row
--    may already be gone (logical reference only).
CREATE TABLE sv360.deleted_photos (
    photo_id   TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
