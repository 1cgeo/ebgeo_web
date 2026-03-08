// Path: src/middleware/optional-auth.js
import { extractBearerToken, verifyAndMapUser } from './auth.js';

/**
 * Optional JWT verification middleware.
 * Same as auth but does NOT return 401 if no token.
 * Sets req.user = null if no valid token.
 * Used for public atlas routes where auth is optional.
 */
export function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = verifyAndMapUser(token);
  } catch {
    req.user = null;
  }

  next();
}
