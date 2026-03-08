-- Path: src/database/migrations/001_core.sql
-- Core tables: extensions, users, authentication

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(100) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'user',

    -- Personal info (Brazilian military context)
    nome                VARCHAR(255) NOT NULL,
    posto_graduacao     VARCHAR(50),
    organizacao_militar VARCHAR(255),

    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_users_username_lower ON users(LOWER(username));
CREATE INDEX idx_users_role ON users(role);

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
