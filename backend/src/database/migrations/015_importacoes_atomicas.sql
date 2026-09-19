-- Private, expiring import preparations. Atlas visibility starts only at final commit.
CREATE TABLE atlas_import_attempts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key VARCHAR(64) NOT NULL CHECK (source_key ~ '^[0-9a-f]{64}$'),
  payload JSONB,
  image_ids UUID[] NOT NULL DEFAULT '{}',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day'
);
CREATE INDEX atlas_import_attempt_owner ON atlas_import_attempts(user_id, expires_at);
CREATE TABLE atlas_import_images (
  attempt_id UUID NOT NULL REFERENCES atlas_import_attempts(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  content_hash VARCHAR(64) NOT NULL,
  bytes BYTEA NOT NULL,
  PRIMARY KEY(attempt_id, id)
);
