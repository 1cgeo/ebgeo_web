// Path: src/middleware/flexible-auth.js
// Global NON-BLOCKING auth: reads credentials from x-api-key (header/query),
// cookie `token`, or Authorization: Bearer; populates req.user or leaves it
// undefined (the route decides via strict `auth`). Sliding session: renews the
// cookie when the JWT is close to expiry. Never blocks the anonymous path.
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { extractBearerToken } from './auth.js';
import { query } from '../database/index.js';
import { FIND_USER_BY_API_KEY } from '../modules/users/users.queries.js';
import { issueAccessToken, msUntilExpiry } from '../modules/auth/auth.service.js';
import { env } from '../utils/environment.js';

const SLIDING_THRESHOLD_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapDbUser(row) {
  return {
    id: row.id,
    username: row.username,
    nome: row.nome,
    posto_graduacao: row.posto_graduacao,
    role: row.role || 'user',
    organization_id: row.organization_id ?? null,
    org_role: row.org_role || 'viewer',
  };
}

function mapPayload(p) {
  return {
    id: p.sub,
    username: p.username,
    nome: p.nome,
    posto_graduacao: p.posto,
    role: p.role || 'user',
    organization_id: p.organization_id ?? null,
    org_role: p.org_role || 'viewer',
  };
}

export async function flexibleAuth(req, res, next) {
  try {
    const apiKey = req.get('x-api-key') || req.query?.api_key;
    if (apiKey) {
      if (UUID_RE.test(apiKey)) {
        const { rows } = await query(FIND_USER_BY_API_KEY, [apiKey]);
        if (rows[0]) {
          req.user = mapDbUser(rows[0]);
          req.authVia = 'api_key';
        }
      }
      return next();
    }

    const token = req.cookies?.token || extractBearerToken(req);
    if (!token) return next();

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret, { algorithms: config.jwt.algorithms });
    } catch {
      return next(); // invalid token — anonymous (strict routes will 401)
    }

    req.user = mapPayload(payload);
    req.authVia = 'jwt';

    // Sliding session: renew if close to expiry.
    if (msUntilExpiry(payload) < SLIDING_THRESHOLD_MS) {
      res.cookie('token', issueAccessToken(req.user), env.cookieOptions());
    }
    return next();
  } catch {
    return next(); // never block
  }
}
