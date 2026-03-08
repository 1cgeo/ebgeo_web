// Path: src/middleware/auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * JWT verification middleware.
 * Extracts and verifies JWT from Authorization header.
 * Injects req.user = { id, username, nome, posto_graduacao, role }
 * Returns 401 if missing or invalid.
 */
export function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      nome: payload.nome,
      posto_graduacao: payload.posto,
      role: payload.role || 'user',
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token expired'));
    }
    return next(new UnauthorizedError('Invalid token'));
  }
}
