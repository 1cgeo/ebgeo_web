-- Path: src/database/migrations/014_api_keys.sql
-- Machine-to-machine API keys: live key on the hot users row + rotation history.
ALTER TABLE users ADD COLUMN api_key UUID UNIQUE;

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
