-- Path: src/database/migrations/012_organizations.sql
-- Multi-org: first-class organizations entity (precedes multiuser activation).
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    sigla       VARCHAR(50),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deterministic default org (fixed id for idempotent backfill + tests).
INSERT INTO organizations (id, nome, slug, sigla)
VALUES ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default', 'DEFAULT')
ON CONFLICT (slug) DO NOTHING;
