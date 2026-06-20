-- Path: src/database/migrations/013_users_org_and_roles.sql
-- users: organization_id FK (nullable, backfilled), org_role, and a CHECK on the
-- global role. organizacao_militar (free text) is preserved during transition.

ALTER TABLE users ADD COLUMN organization_id UUID REFERENCES organizations(id);

-- Backfill: match free-text organizacao_militar to organizations.nome (ci).
UPDATE users u
SET organization_id = o.id
FROM organizations o
WHERE u.organization_id IS NULL
  AND u.organizacao_militar IS NOT NULL
  AND LOWER(TRIM(u.organizacao_militar)) = LOWER(TRIM(o.nome));

-- Unmatched / NULL -> default org.
UPDATE users
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

CREATE INDEX idx_users_organization ON users(organization_id);

-- Org-scoped role (mirrors the frontend UserRole vocabulary).
ALTER TABLE users
  ADD COLUMN org_role VARCHAR(20) NOT NULL DEFAULT 'viewer'
  CHECK (org_role IN ('owner','admin','editor','viewer'));

-- Restrict the global role (was free text). Normalize legacy rows first.
UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('user','admin');
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));
