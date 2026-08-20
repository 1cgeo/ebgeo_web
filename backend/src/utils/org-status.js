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
//
// It also carries `sessions_valid_from`, the marker that finally gives
// mass revocation an effect this path can see. Before it, `REVOKE_ALL_USER_TOKENS`
// ended the ability to ROTATE and nothing else: nobody on the request path reads
// `refresh_tokens`, so a holder of a live access token kept working and — because the
// sliding renewal re-issues at <5 min from expiry — kept renewing indefinitely. It
// rides on THIS query on purpose: the read is already made on every strict request,
// every sliding renewal and every WS handshake, so the check costs nothing extra.
const LIVE_AUTH_STATE = `
  SELECT u.is_active AS user_is_active,
         u.role,
         u.org_role,
         u.organization_id,
         u.producer_org_id,
         u.sessions_valid_from,
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
 *   organizationId: string|null, producerOrgId: string|null, orgIsActive: boolean,
 *   sessionsValidFrom: Date|null}|null>} null when no such user.
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
    producerOrgId: r.producer_org_id ?? null,
    orgIsActive: r.org_is_active === true,
    sessionsValidFrom: r.sessions_valid_from ?? null,
  };
}

/**
 * Whether an access token was issued BEFORE the user's session cut-off, i.e. whether
 * mass revocation (reuse detection, password change, admin reset, deactivation) has
 * since declared every earlier session dead.
 *
 * THE COMPARISON IS `<=`, NOT `<`, AND THE UNITS ARE SECONDS. A JWT `iat` is a UNIX
 * timestamp in SECONDS (`jwt.sign` floors it); `sessions_valid_from` is a TIMESTAMPTZ
 * with sub-second precision. Comparing the two directly, in different units, is the
 * bug waiting to happen. Truncate the marker to the resolution `iat` actually has, and
 * then one second is genuinely AMBIGUOUS: for a token whose `iat` equals the marker's
 * second, nothing in the token can say whether it was minted before or after the cut.
 * Someone has to decide what happens to that second.
 *
 * It loses. `iat <= floor(cut)` — the ambiguous second is refused. Reasons, in order:
 *
 *   1. FAIL CLOSED. This is a theft remediation. The alternative (`<`, keeping the
 *      ambiguous second) leaves a hole that is invisible, untestable from the outside,
 *      and silent — the control simply does not apply and nothing says so.
 *   2. THE OVER-REJECTION IS SELF-HEALING, THE UNDER-REJECTION IS NOT. A legitimate
 *      token caught by the ambiguous second gets a 401; the client already handles
 *      exactly that (api-client.js: refresh, then clearTokens + auth-lost → re-login),
 *      and the very next second is clean. Cost: at most one extra sign-in, inside a
 *      one-second coincidence. The other way round, a revoked token just keeps working.
 *   3. THE PREMISE FOR LENIENCY IS NOT TRUE HERE. The usual argument for `<` is "the
 *      flow that revoked issues a new pair right afterwards and would kill it". No
 *      flow in this codebase does: `updatePassword` and `resetPassword` return
 *      `{success:true}` with no tokens, `deleteUser` returns none, and reuse detection
 *      throws 401. Nothing mints a token in the same statement that revokes.
 *   4. IT MAKES THE PROPERTY TESTABLE. With `<`, the natural reproduction of the bug
 *      (log in, trigger revocation, replay the access token) runs inside a single
 *      wall-clock second and comes back 200 — a fix that cannot be demonstrated by the
 *      test that demonstrated the bug. Pinned by
 *      tests/integration/refresh-reuse-session-scope.repro.test.js.
 *
 * Discriminating case in tests/unit/sessions-valid-from.test.js: `iat` EQUAL to the
 * marker's second must be refused. That single assertion is what separates `<=` from
 * `<`; everything else in that file passes under both.
 *
 * Permissive on anomalies, matching the rest of this module: a NULL marker (every
 * account until something revokes it) and an absent/unparseable `iat` both pass. NULL
 * must never mean "everything is invalid".
 *
 * @param {number|null|undefined} iat - The JWT `iat` claim, in seconds.
 * @param {Date|string|null|undefined} sessionsValidFrom - The marker, or null.
 * @returns {boolean} True when the token does not provably postdate the cut-off and
 *   must therefore be refused.
 */
export function tokenPredatesSessionCut(iat, sessionsValidFrom) {
  if (!sessionsValidFrom) return false;
  if (!Number.isFinite(iat)) return false;
  const cutMs = sessionsValidFrom instanceof Date
    ? sessionsValidFrom.getTime()
    : new Date(sessionsValidFrom).getTime();
  if (!Number.isFinite(cutMs)) return false;
  return iat <= Math.floor(cutMs / 1000);
}
