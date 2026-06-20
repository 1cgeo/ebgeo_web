// Path: src/middleware/auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { orgIsActive } from '../utils/org-status.js';

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

    // O1: a deactivated organization bars its members IMMEDIATELY. The JWT's org
    // claim can be up to 15 min stale, so reconcile against the live DB here (on
    // the strict path only — the anonymous/public flexibleAuth path is untouched).
    if (req.user.organization_id && !(await orgIsActive(req.user.organization_id))) {
      return next(new ForbiddenError('Organization is inactive'));
    }

    next();
  } catch (err) {
    next(err);
  }
}
