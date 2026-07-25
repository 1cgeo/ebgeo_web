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
import { getLiveAuthState } from '../utils/org-status.js';
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
    // A public-link visitor token is scoped to ONE atlas by its `atlasId` claim.
    // Dropping it here is what let a visitor of atlas A read atlas B: the claim
    // existed and was honoured by the WS gateway, but never reached
    // requireAtlasPermission, which then fell through to the generic isPublic
    // branch. Kept in sync with the identical mapping in middleware/auth.js.
    isPublic: p.isPublic === true,
    publicAtlasId: p.isPublic === true ? (p.atlasId ?? null) : null,
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
    //
    // P1 — the renewal MUST consult the live DB first. Re-signing the old claims
    // blindly turned the "≤15min stale" window into "forever": a deactivated user
    // who kept a request in flight every 15 min renewed their session indefinitely,
    // and a demoted admin carried `role: admin` forward on every renewal.
    // Public-share principals (`public-<uuid>` sub, no users row) are never renewed
    // here — their token is atlas-scoped and short-lived by design.
    //
    // What this renewal does NOT consult is `refresh_tokens`. Revoking a token
    // family (reuse detection, logout, password change) therefore does not stop the
    // slide: a holder requesting once every <15 min renews forever, and only
    // is_active on the user/org ends it. Stated here because this is the code that
    // makes the revocation inert — see the SCOPE note in auth.service.js refresh().
    if (msUntilExpiry(payload) < SLIDING_THRESHOLD_MS && UUID_RE.test(payload.sub || '')) {
      const live = await getLiveAuthState(payload.sub);

      // A missing row is not a revocation (users are only soft-deleted — see the
      // matching note in auth.js); only an explicit deactivation stops the slide.
      if (live && (!live.userIsActive || !live.orgIsActive)) {
        // Dead session: stop the slide and drop the cookie. req.user is cleared so
        // this request is treated as anonymous; strict routes 401 via `auth`.
        // clearCookie must receive the same attributes MINUS maxAge (Express
        // deprecates passing it — the clear always expires immediately).
        const clearOptions = env.cookieOptions();
        delete clearOptions.maxAge;
        res.clearCookie('token', clearOptions);
        req.user = undefined;
        req.authVia = undefined;
        return next();
      }

      // Re-issue with the CURRENT claims so a demotion propagates instead of being
      // carried forward forever.
      //
      // `role` was reconciled from the start; `org_role`/`organization_id` were not,
      // and that half-fix left the exact hole the other half had closed. The renewal
      // re-signs `req.user`, whose org claims came from the OLD token, so while a
      // cookie client kept sliding an org demotion (editor -> viewer) NEVER propagated:
      // not a 15-min window, an unbounded one. `org_role` is real authorization —
      // sv360.routes.js requireUploadCapability and sv360.write.service.js decide write
      // access by it — so "bounded by the token lifetime", the cost accepted for the
      // strict path, was not what this path actually charged.
      //
      // The reconciliation is conditional on the token ALREADY CARRYING the claim, and
      // that condition is the whole reason auth-gaps auth-05 still holds: a LEGACY token
      // (minted before the org claims existed) must keep degrading to viewer/null from
      // the mapping, never being promoted out of the DB. Absent claim -> degrade;
      // present claim -> reconcile. The two rules were previously conflated, which is
      // why "never reconcile" looked like the only way to honour the first one.
      if (live) {
        req.user.role = live.role;
        if (payload.org_role !== undefined || payload.organization_id !== undefined) {
          req.user.org_role = live.orgRole;
          req.user.organization_id = live.organizationId;
        }
      }
      res.cookie('token', issueAccessToken(req.user), env.cookieOptions());
    }
    return next();
  } catch {
    return next(); // never block
  }
}
