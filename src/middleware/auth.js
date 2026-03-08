// Path: src/middleware/auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UnauthorizedError } from '../utils/errors.js';

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
    const payload = jwt.verify(token, config.jwt.secret);
    return {
      id: payload.sub,
      username: payload.username,
      nome: payload.nome,
      posto_graduacao: payload.posto,
      role: payload.role || 'user',
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
export function auth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return next(new UnauthorizedError('Missing or invalid authorization header'));
  }

  try {
    req.user = verifyAndMapUser(token);
    next();
  } catch (err) {
    next(err);
  }
}
