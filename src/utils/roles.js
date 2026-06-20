// Path: src/utils/roles.js
// Maps the backend's two orthogonal axes (global role + per-atlas permission)
// to the frontend's UserRole vocabulary {owner, admin, editor, viewer}.
// No data migration: atlas_shares.permission stays read/write.

/**
 * @param {('owner'|'write'|'read'|null)} permission - per-atlas permission
 * @param {('user'|'admin'|undefined)} globalRole - global JWT role
 * @returns {('owner'|'admin'|'editor'|'viewer')}
 */
export function toFrontendRole(permission, globalRole) {
  if (globalRole === 'admin') return 'admin';
  if (permission === 'owner') return 'owner';
  if (permission === 'write') return 'editor';
  return 'viewer'; // 'read', public, or none
}
