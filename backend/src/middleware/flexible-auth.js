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
import { getLiveAuthState, tokenPredatesSessionCut } from '../utils/org-status.js';
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
    producer_org_id: row.producer_org_id ?? null,
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
    // `org_role` NAO E MAPEADO (D7, 2026-08-20). O eixo saiu do banco e do token; um
    // token legado ainda carrega a claim e ela e IGNORADA, sem campo em `req.user`
    // para onde ir. Mantido em sincronia com middleware/auth.js verifyAndMapUser.
    //
    // Escopo de PRODUCAO. Ausente (token legado) = null. Mantido em sincronia com
    // o mapeamento identico de middleware/auth.js.
    producer_org_id: p.producer_org_id ?? null,
    // A public-link visitor token is scoped to ONE atlas by its `atlasId` claim.
    // Dropping it here is what let a visitor of atlas A read atlas B: the claim
    // existed and was honoured by the WS gateway, but never reached
    // requireAtlasPermission, which then fell through to the generic isPublic
    // branch. Kept in sync with the identical mapping in middleware/auth.js.
    isPublic: p.isPublic === true,
    publicAtlasId: p.isPublic === true ? (p.atlasId ?? null) : null,
    // Issued-at, carried so the strict `auth` middleware can apply the session cut-off
    // (`users.sessions_valid_from`) on a request this mapper populated. Kept in sync
    // with the identical mapping in middleware/auth.js.
    tokenIssuedAt: p.iat ?? null,
  };
}

export async function flexibleAuth(req, res, next) {
  try {
    // An api key is an ATTEMPT, not a choice of mechanism. Until 2026-07-25 the mere PRESENCE of
    // `x-api-key`/`?api_key=` short-circuited with an unconditional `return next()`, so a key that
    // was malformed or simply absent from `users` skipped the cookie/Bearer branch entirely and the
    // request continued as anonymous. On a flexible-only route that is a silent demotion of a valid
    // session (in `/nomes/busca` the user stops seeing their own private names), and on a strict
    // route a cookie session became 401 — both triggerable by anyone who can get the victim to open
    // `...?api_key=anything`, since the trigger lives in the query string. Only a key that RESOLVES
    // wins the precedence; anything else falls through.
    //
    // A LIVENESS DA OM DE LOTACAO VIAJA DENTRO DE `FIND_USER_BY_API_KEY`, e nao ha checagem
    // dela aqui de proposito: o JOIN com `organizations` ja existia na consulta, entao o
    // termo e de graca, e um chamador novo daquela consulta herda a regra sem ter de
    // lembrar dela. NAO "otimize" o JOIN para fora: a chave voltaria a valer para quem a
    // desativacao da OM ja expulsou de toda rota estrita, e essa e a diferenca que
    // importa aqui, porque a familia de rotas SO-FLEXIVEIS e justamente a das leituras de
    // recurso privado (sv360, nomes, assets3d). Chave que resolve = principal vivo.
    const apiKey = req.get('x-api-key') || req.query?.api_key;
    if (apiKey && UUID_RE.test(apiKey)) {
      const { rows } = await query(FIND_USER_BY_API_KEY, [apiKey]);
      if (rows[0]) {
        req.user = mapDbUser(rows[0]);
        req.authVia = 'api_key';
        return next();
      }
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
    // This renewal still does not consult `refresh_tokens` — it consults the SESSION
    // CUT-OFF instead (`users.sessions_valid_from`), which mass
    // revocation writes in the same statement that stamps the family. That closes what
    // made this the worst half of bugs-backend #35: until 2026-07-25 the only thing
    // that could stop the slide was `is_active` on the user or the org, so after
    // detecting refresh-token REUSE — the signal of theft — the stolen token renewed
    // here indefinitely, one request every <15 min, for as long as the account lived.
    // The alarm fired and turned nothing off. Now the cut-off refuses the renewal and
    // drops the cookie, and the strict `auth` middleware refuses the token itself.
    if (msUntilExpiry(payload) < SLIDING_THRESHOLD_MS && UUID_RE.test(payload.sub || '')) {
      const live = await getLiveAuthState(payload.sub);

      // A missing row is not a revocation (users are only soft-deleted — see the
      // matching note in auth.js); only an explicit deactivation or a session cut-off
      // stops the slide.
      const revoked = live && tokenPredatesSessionCut(payload.iat, live.sessionsValidFrom);
      if (live && (!live.userIsActive || !live.orgIsActive || revoked)) {
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
      // `role` was reconciled from the start; the ORG claims were not, and that
      // half-fix left the exact hole the other half had closed. The renewal re-signs
      // `req.user`, whose org claims came from the OLD token, so while a cookie client
      // kept sliding an org move NEVER propagated: not a 15-min window, an unbounded one.
      //
      // THIS PARAGRAPH USED TO BE ABOUT `org_role`, AND SAYING SO IS THE POINT. It once
      // named two sites that decided write access by it (sv360.routes.js
      // requireUploadCapability and sv360.write.service.js); phase F6 replaced the
      // self-declared posting with the GRANTED production scope (`producer_org_id`), and
      // 2026-08-20 (D7) removed the axis from the column, the token and the client. What
      // is left to reconcile here is `organization_id` alone — LOTAÇÃO, display only, but
      // a claim that is re-signed forever without ever being re-read is a lie the cookie
      // tells about the account.
      //
      // The reconciliation is conditional on the token ALREADY CARRYING the claim, and
      // that condition is the whole reason auth-gaps auth-05 still holds: a LEGACY token
      // (minted before the org claim existed) must keep degrading to null from the
      // mapping, never being promoted out of the DB. Absent claim -> degrade; present
      // claim -> reconcile. The two rules were previously conflated, which is why "never
      // reconcile" looked like the only way to honour the first one.
      //
      // THE CONDITION LOST ITS `org_role` DISJUNCT, and dropping it is not cosmetic: while it
      // was there, a legacy token carrying `org_role` and NO `organization_id` would have its
      // posting promoted from the DB, which is exactly what auth-05 forbids. An unknown claim
      // is ignored; reacting to one is the defect.
      if (live) {
        req.user.role = live.role;
        if (payload.organization_id !== undefined) {
          req.user.organization_id = live.organizationId;
        }
        // Unconditional, as in the strict `auth` and for the same reason: without it the
        // re-issued cookie would carry the stale production scope indefinitely, which is
        // exactly the defect of the OM axis described above.
        req.user.producer_org_id = live.producerOrgId;
      }
      res.cookie('token', issueAccessToken(req.user), env.cookieOptions());
    }
    return next();
  } catch {
    return next(); // never block
  }
}
