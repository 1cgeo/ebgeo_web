// Path: src/utils/org-status.js
// O1 — "deactivating an organization bars its members immediately". Authorization
// for org members is reconciled LIVE against the DB (not the JWT, whose org claim
// can be up to JWT_ACCESS_EXPIRY=15min stale). Used by the strict `auth` middleware,
// login, refresh, and the WS gateway/heartbeat.
//
// Org-less / legacy tokens (organization_id null) are exempt — they have no org to
// deactivate. An unknown org id (row missing) is treated as active: that is an
// anomaly, not a deliberate deactivation, and we must not lock such users out.
import { query } from '../database/index.js';

/**
 * @param {string|null|undefined} organizationId
 * @returns {Promise<boolean>} true when the member may proceed (no org, or org active).
 */
export async function orgIsActive(organizationId) {
  if (!organizationId) return true;
  const { rows } = await query('SELECT is_active FROM organizations WHERE id = $1', [organizationId]);
  if (rows.length === 0) return true;
  return rows[0].is_active === true;
}
