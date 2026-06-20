// Path: src/middleware/require-org-role.js
// Factory: requires the authenticated user to have one of the given org roles
// (global admins always pass).
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    if (req.user.role === 'admin') return next();
    if (!roles.includes(req.user.org_role)) {
      return next(new ForbiddenError('Insufficient role'));
    }
    next();
  };
}
