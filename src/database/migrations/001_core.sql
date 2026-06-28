-- Path: src/database/migrations/001_core.sql
-- Baseline: identidade e auth — extensão pgcrypto, organizations, users (campos
-- militares BR + multi-org + papéis + api_key), refresh_tokens, api_key_history,
-- audit_trail. Consolidação do histórico incremental 001/012/013/014/015 num
-- único baseline aditivo (sem PostGIS — core migra sem superusuário).

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()

-- ============================================================================
-- ORGANIZATIONS (multi-org; precede users por causa da FK organization_id)
-- ============================================================================
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    sigla       VARCHAR(50),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org padrão determinística (id fixo para backfill idempotente + testes).
INSERT INTO organizations (id, nome, slug, sigla)
VALUES ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default', 'DEFAULT')
ON CONFLICT (slug) DO NOTHING;

-- Organizações militares (OMs) — a lista controlada de organizações que o cadastro usa
-- (FK users.organization_id). O admin curam o resto pela aba "Pessoal" (módulo organizations).
INSERT INTO organizations (nome, slug, sigla) VALUES
  ('Diretoria de Serviço Geográfico',                          'dsg',    'DSG'),
  ('Centro de Imagens e Informações Geográficas do Exército',  'cigex',  'CIGEx'),
  ('1º Centro de Geoinformação',                               '1-cgeo', '1º CGEO'),
  ('2º Centro de Geoinformação',                               '2-cgeo', '2º CGEO'),
  ('3º Centro de Geoinformação',                               '3-cgeo', '3º CGEO'),
  ('4º Centro de Geoinformação',                               '4-cgeo', '4º CGEO'),
  ('5º Centro de Geoinformação',                               '5-cgeo', '5º CGEO')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- RANKS (postos/graduações — lista controlada do cadastro, FK users.rank_id;
-- seed de dominio.tipo_posto_grad, code -> sort_order, nome_abrev = abreviação).
-- ============================================================================
CREATE TABLE ranks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        SMALLINT,
    nome        VARCHAR(255) NOT NULL,
    nome_abrev  VARCHAR(50),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ranks_active ON ranks(sort_order) WHERE is_active;

INSERT INTO ranks (code, nome, nome_abrev, sort_order) VALUES
  (1,  'Civil',                  'Civ',     1),
  (2,  'Mão de Obra Temporária', 'MOT',     2),
  (3,  'Soldado EV',             'Sd EV',   3),
  (4,  'Soldado EP',             'Sd EP',   4),
  (5,  'Cabo',                   'Cb',      5),
  (6,  'Terceiro Sargento',      '3º Sgt',  6),
  (7,  'Segundo Sargento',       '2º Sgt',  7),
  (8,  'Primeiro Sargento',      '1º Sgt',  8),
  (9,  'Subtenente',             'ST',      9),
  (10, 'Aspirante',              'Asp',    10),
  (11, 'Segundo Tenente',        '2º Ten', 11),
  (12, 'Primeiro Tenente',       '1º Ten', 12),
  (13, 'Capitão',                'Cap',    13),
  (14, 'Major',                  'Maj',    14),
  (15, 'Tenente Coronel',        'TC',     15),
  (16, 'Coronel',                'Cel',    16),
  (17, 'General de Brigada',     'Gen Bda',17),
  (18, 'General de Divisão',     'Gen Div',18),
  (19, 'General de Exército',    'Gen Ex', 19);

-- ============================================================================
-- USERS
-- rank_id (FK ranks) é o posto/graduação; organization_id (FK organizations) é a OM.
-- Ambos NULLABLE (contas sem dados / tokens legados degradam para null).
-- ============================================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(100) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user','admin')),

    -- Personal info (Brazilian military context)
    nome                VARCHAR(255) NOT NULL,
    rank_id             UUID REFERENCES ranks(id),

    -- Multi-org: organization_id é a OM (FK); papel org-scoped (vocabulário UserRole do frontend).
    organization_id     UUID REFERENCES organizations(id),
    org_role            VARCHAR(20) NOT NULL DEFAULT 'viewer'
                          CHECK (org_role IN ('owner','admin','editor','viewer')),

    -- Chave de API M2M (live key na linha quente; histórico/rotação à parte).
    api_key             UUID UNIQUE,

    -- Self-registration e-mail confirmation. NULLABLE: username stays the login key, and
    -- accounts created without an e-mail (admin-created, legacy, M2M) are immediately active.
    -- When email IS NOT NULL, login is gated on email_verified (see auth.service login).
    email               VARCHAR(255),
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_users_username_lower ON users(LOWER(username));
-- Case-insensitive unique e-mail (partial: NULL e-mails are allowed and not unique-constrained).
CREATE UNIQUE INDEX idx_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_organization ON users(organization_id);

-- ============================================================================
-- REFRESH TOKENS (for logout revocation support)
-- ============================================================================
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

-- ============================================================================
-- EMAIL VERIFICATION TOKENS (self-registration confirmation). The token UUID is
-- the secret carried in the verification link; it is single-use (consumed_at) and
-- expiring (expires_at). Cascades on user delete.
-- ============================================================================
CREATE TABLE email_verification_tokens (
    token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);

-- ============================================================================
-- API KEY HISTORY (rotação/revogação das chaves M2M)
-- ============================================================================
CREATE TABLE api_key_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    api_key     UUID NOT NULL,
    created_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id),
    UNIQUE (user_id, api_key)
);
CREATE INDEX idx_api_key_history_user ON api_key_history(user_id);

-- ============================================================================
-- AUDIT TRAIL (trilha de negócio queryable, transacional). actor_id SEM FK para
-- o log sobreviver a um delete de usuário. Distinto do log operacional (arquivos).
-- ============================================================================
CREATE TABLE audit_trail (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action      VARCHAR(50) NOT NULL
                CHECK (action IN (
                  'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
                  'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
                  'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
                  'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE'
                )),
    actor_id    UUID NOT NULL,
    target_type VARCHAR(20) CHECK (target_type IN ('USER','GROUP','MODEL','ZONE','SYSTEM','ATLAS','ORG')),
    target_id   UUID,
    target_name VARCHAR(255),
    details     JSONB,
    ip          VARCHAR(45) NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_target ON audit_trail(target_type, target_id);
CREATE INDEX idx_audit_action ON audit_trail(action);
CREATE INDEX idx_audit_created ON audit_trail(created_at DESC);
CREATE INDEX idx_audit_created_act ON audit_trail(created_at DESC, action);
CREATE INDEX idx_audit_details_gin ON audit_trail USING GIN (details);
