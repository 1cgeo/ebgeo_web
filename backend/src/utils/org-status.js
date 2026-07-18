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

// P1 — a deactivated or demoted user must lose access IMMEDIATELY, not merely when
// the current access token expires. The JWT's `is_active`/`role`/`org_role` claims
// are up to JWT_ACCESS_EXPIRY=15min stale, and the sliding-session renewal used to
// copy those stale claims forward forever, so a deactivated user who kept polling
// renewed indefinitely and a demoted admin kept `role: admin`.
//
// This single joined read replaces the narrower `orgIsActive` call on the strict
// `auth` path (same one-query cost) and is also consulted before any sliding renewal.
const LIVE_AUTH_STATE = `
  SELECT u.is_active AS user_is_active,
         u.role,
         u.org_role,
         u.organization_id,
         COALESCE(o.is_active, true) AS org_is_active
  FROM users u
  LEFT JOIN organizations o ON o.id = u.organization_id
  WHERE u.id = $1
`;

/**
 * Reads the authorization-relevant state of a user straight from the DB.
 *
 * An unknown organization row is treated as active (same rule as `orgIsActive`):
 * that is an anomaly, not a deliberate deactivation, and must not lock users out.
 * A missing USER row, by contrast, is decisive — the account is gone.
 *
 * @param {string} userId
 * @returns {Promise<{userIsActive: boolean, role: string, orgRole: string,
 *   organizationId: string|null, orgIsActive: boolean}|null>} null when no such user.
 */
export async function getLiveAuthState(userId) {
  if (!userId) return null;
  const { rows } = await query(LIVE_AUTH_STATE, [userId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    userIsActive: r.user_is_active === true,
    role: r.role || 'user',
    orgRole: r.org_role || 'viewer',
    organizationId: r.organization_id ?? null,
    orgIsActive: r.org_is_active === true,
  };
}
