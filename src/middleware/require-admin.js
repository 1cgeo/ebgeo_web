// Path: src/middleware/require-admin.js
import { ForbiddenError } from '../utils/errors.js';

/**
 * Middleware that requires the authenticated user to have admin role.
 * Must be used after the auth middleware.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(new ForbiddenError('Authentication required'));
  }

  if (req.user.role !== 'admin') {
    return next(new ForbiddenError('Admin access required'));
  }

  next();
}
