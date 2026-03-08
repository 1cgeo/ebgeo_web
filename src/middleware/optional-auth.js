// Path: src/middleware/optional-auth.js
import jwt from 'jsonwebtoken';
import config from '../config.js';

/**
 * Optional JWT verification middleware.
 * Same as auth.js but does NOT return 401 if no token.
 * Sets req.user = null if no valid token.
 * Used for public atlas routes where auth is optional.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      nome: payload.nome,
      posto_graduacao: payload.posto,
    };
  } catch (err) {
    req.user = null;
  }

  next();
}
