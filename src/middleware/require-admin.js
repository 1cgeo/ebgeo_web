// Path: src/middleware/require-admin.js
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

/**
 * Middleware that requires the authenticated user to have admin role.
 * Must be used after the auth middleware.
 */
export function requireAdmin(req, res, next) {
  // No credential is an authentication problem (401), not authorization (403) —
  // matches the `authorize` middleware in require-org-role.js.
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.role !== 'admin') {
    return next(new ForbiddenError('Admin access required'));
  }

  next();
}
