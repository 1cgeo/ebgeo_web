// Path: src/middleware/auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { getLiveAuthState, orgIsActive } from '../utils/org-status.js';

// A principal backed by a real `users` row always has a UUID sub. Public-share
// tokens deliberately use `public-<uuid>`, which is NOT a bare UUID.
const PRINCIPAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts the Bearer token from the Authorization header.
 * @returns {string|null} The token string, or null if absent/malformed.
 */
export function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Verifies a JWT and maps its payload to a user object.
 * @returns {{ id, username, nome, posto_graduacao, role }} The user object.
 * @throws {UnauthorizedError} If the token is expired or invalid.
 */
export function verifyAndMapUser(token) {
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: config.jwt.algorithms });
    return {
      id: payload.sub,
      username: payload.username,
      nome: payload.nome,
      posto_graduacao: payload.posto,
      role: payload.role || 'user',
      // Legacy tokens (pre-org claim) fall back gracefully.
      organization_id: payload.organization_id ?? null,
      org_role: payload.org_role || 'viewer',
      // Atlas scope of a public-link visitor token. See the note in
      // flexible-auth.js mapPayload — both mappers must carry this, since either
      // one can be the path that populates req.user.
      isPublic: payload.isPublic === true,
      publicAtlasId: payload.isPublic === true ? (payload.atlasId ?? null) : null,
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }
}

/**
 * JWT verification middleware.
 * Extracts and verifies JWT from Authorization header.
 * Injects req.user = { id, username, nome, posto_graduacao, role }
 * Returns 401 if missing or invalid.
 */
export async function auth(req, res, next) {
  try {
    // May already be authenticated by the global flexibleAuth (Bearer/api-key/cookie).
    if (!req.user) {
      const token = extractBearerToken(req);
      if (!token) {
        return next(new UnauthorizedError('Missing or invalid authorization header'));
      }
      req.user = verifyAndMapUser(token); // throws UnauthorizedError on invalid/expired
    }

    // O1/P1: reconcile the token's authorization claims against the live DB on the
    // strict path (the anonymous/public flexibleAuth path is untouched). The JWT can
    // be up to JWT_ACCESS_EXPIRY=15min stale, so trusting it alone would let a
    // deactivated user keep working and a demoted admin keep `role: admin` for that
    // whole window — and, with the sliding renewal, indefinitely.
    //
    // One joined read replaces the previous org-only lookup, so the per-request cost
    // is unchanged.
    //
    // Public-share principals are exempt: their token carries a synthetic
    // `public-<uuid>` sub with no `users` row by design (atlas.service mints it), so
    // there is no DB identity to reconcile. Their authority comes from the signed
    // token's `atlasId` claim plus that atlas's is_public flag, both enforced by
    // requireAtlasPermission. That claim check was MISSING on the HTTP path until
    // 2026-07-19 while this comment already asserted it, so one visitor token read
    // every public atlas; the WS gateway had it all along. If you touch this exempt
    // branch, confirm the scope check in permissions.js still runs.
    // Same non-UUID convention already used in permissions.js.
    if (!PRINCIPAL_UUID_RE.test(req.user.id || '')) {
      return next();
    }

    const live = await getLiveAuthState(req.user.id);

    // A MISSING row is not a revocation. Users are only ever soft-deleted in this
    // system (`is_active = false`; see CLAUDE.md "Soft-delete sempre"), so an absent
    // row is an anomaly, not a deliberate deactivation — the same rule `orgIsActive`
    // applies to an unknown organization. Deactivation, the mechanism that actually
    // revokes access, is caught by the `userIsActive` check below.
    if (live) {
      if (!live.userIsActive) {
        // 401 so the client tears the session down (deactivation also revoked its
        // refresh token, so the retry fails too).
        return next(new UnauthorizedError('Account is inactive'));
      }
      if (!live.orgIsActive) {
        return next(new ForbiddenError('Organization is inactive'));
      }

      // Adopt the live GLOBAL role so `requireAdmin` can never honour a stale
      // `role: admin` claim from a since-demoted admin.
      //
      // `org_role` / `organization_id` are deliberately NOT overwritten here: the
      // token mapping owns them (a legacy token without org claims degrades to
      // viewer/null by design — see auth-gaps auth-05), and tenant moves stay
      // bounded by the ≤15min token window as previously accepted.
      req.user.role = live.role;
    } else if (req.user.organization_id && !(await orgIsActive(req.user.organization_id))) {
      // No user row to reconcile — fall back to the original org-only gate.
      return next(new ForbiddenError('Organization is inactive'));
    }

    next();
  } catch (err) {
    next(err);
  }
}
