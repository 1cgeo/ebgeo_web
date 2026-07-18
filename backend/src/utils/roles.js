// Path: src/utils/roles.js
// Maps the backend's two orthogonal axes (global role + per-atlas permission)
// to the frontend's UserRole vocabulary.
// Stored per-atlas permission: read | comment | write | manage. `owner` is synthesized
// from atlas.owner_id (not a stored share). Global `admin` short-circuits to 'admin'.

/**
 * @param {('owner'|'manage'|'write'|'comment'|'read'|null)} permission - per-atlas permission
 * @param {('user'|'admin'|undefined)} globalRole - global JWT role
 * @returns {('admin'|'owner'|'manager'|'editor'|'commenter'|'viewer')}
 */
export function toFrontendRole(permission, globalRole) {
  if (globalRole === 'admin') return 'admin';
  if (permission === 'owner') return 'owner';
  if (permission === 'manage') return 'manager';
  if (permission === 'write') return 'editor';
  if (permission === 'comment') return 'commenter';
  return 'viewer'; // 'read', public, or none
}
