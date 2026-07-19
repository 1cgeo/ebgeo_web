-- 007_audit_zone_actions.sql
--
-- Widens the audit_trail.action CHECK with ZONE_CREATE / ZONE_UPDATE / ZONE_DELETE.
--
-- WHY a zone edit deserves its own audit action, rather than being folded into an
-- existing one: a zone's GEOMETRY is an access boundary, not decoration. Which users
-- can read which private place names is decided by whether a name falls inside a zone
-- they hold permission on. So redrawing a polygon silently changes who can see what,
-- with the same effect as granting or revoking access — and, until now, with no
-- record at all. `setZonePermissions` already audited (PERMISSION_GRANT), which made
-- the gap easy to miss: the permission LIST was tracked while the SHAPE it applies to
-- was not.
--
-- Reusing PERMISSION_GRANT/REVOKE would have been wrong (a create is not a grant) and
-- SHARING_CHANGE is atlas vocabulary. Distinct actions keep the trail filterable,
-- which is the whole point of the column.
--
-- Widening a CHECK is a safe, backward-compatible change: every value accepted before
-- is still accepted, so existing rows and existing writers are unaffected. This is the
-- same widening exception applied by 006 (UUID -> TEXT), not a redefinition. The
-- constraint has to be dropped and re-added because Postgres has no ALTER CONSTRAINT
-- for CHECK expressions.

ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check;

ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_check
  CHECK (action IN (
    'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
    'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
    'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
    'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE',
    'ZONE_CREATE','ZONE_UPDATE','ZONE_DELETE'
  ));
