-- Path: src/database/migrations/015_audit_trail.sql
-- Business audit trail (queryable, transactional). Distinct from operational
-- logging (files). actor_id has NO FK so the log survives a user delete.
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
