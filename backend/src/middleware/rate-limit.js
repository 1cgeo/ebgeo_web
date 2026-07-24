// Path: src/middleware/rate-limit.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config.js';

const handler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitas tentativas. Tente novamente mais tarde.',
    },
  });
};

// In the test suite the in-memory store would accumulate across the whole run
// (the app is imported once), so we skip by default to avoid cross-test 429s.
// A dedicated test can set RATE_LIMIT_FORCE=1 (read live, per request) to
// exercise the limiter against an isolated key.
const skip = () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1';

// `validate: false` used to disable EVERY built-in check, including `trustProxy`
// and `xForwardedForHeader` — the two whose whole job is to shout when `req.ip` is
// the proxy's address and the keys are therefore worthless. They were silenced
// while the condition they detect was live. Only the noisy-in-test checks are
// disabled now, so a future misconfiguration is reported instead of hidden.
const validate = {
  // The suite drives the limiter through supertest on a loopback address; these two
  // would warn on every run without indicating a real problem.
  trustProxy: !config.isTest,
  xForwardedForHeader: !config.isTest,
};

/**
 * Strict limiter for the credential routes that DECLARE a `username` — /login and
 * /register, and only those. Keyed by IP + username so brute-force against one
 * account is throttled without one noisy IP locking out everyone.
 *
 * It used to guard /refresh, /verify-email and /resend-verification as well. None of
 * those three has a `username` in its schema, so all three keyed to the bare string
 * `${ip}:` and drained ONE shared bucket (one instance = one store), with two
 * opposite failures: honest sessions were denied (a burst of e-mail traffic spent the
 * budget /refresh needs, and /refresh is the steady-state route of every logged-in
 * session), while an attacker escaped entirely by injecting a random `username` into
 * the body — the limiter reads req.body BEFORE Joi strips unknown keys, so an
 * undeclared field bought a fresh bucket per request. Each of the three now has its
 * own IP-keyed limiter below.
 */
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler,
  // `ipKeyGenerator` normalizes the address before it becomes a key. For IPv6 it
  // collapses the /56 prefix, without which a client could walk addresses inside
  // its own allocation and get a fresh bucket per request — free brute force. This
  // only started mattering once `trust proxy` made `req.ip` the real client again;
  // while every request keyed off the proxy, the flaw was masked by a worse one.
  // `|| ''` only replaces FALSY values: a number, array or object sails past it and
  // then `.toLowerCase()` throws. express-rate-limit forwards that through next(), so
  // it reaches errorHandler with no statusCode and answers 500 — on a
  // PRE-AUTHENTICATION route, reachable by anyone, and before Joi has run (validate
  // sits after the limiter). A malformed body must be a 4xx from validation, never a
  // server fault from the throttler.
  keyGenerator: (req) => {
    const raw = req.body?.username;
    const username = typeof raw === 'string' ? raw.toLowerCase() : '';
    return `${ipKeyGenerator(req.ip, 56)}:${username}`;
  },
  skip,
});

/**
 * Builds a limiter for a credential route with NO username to key on, with its own
 * store so its traffic never drains a sibling route's budget. Keyed by address via
 * the library default (`ipKeyGenerator(req.ip, 56)`, the same normalization the
 * authLimiter applies by hand) — meaningful only because `trust proxy` makes `req.ip`
 * the client rather than nginx.
 *
 * @param {{ skipSuccessfulRequests?: boolean }} [opts]
 * @returns {Function} An express-rate-limit middleware.
 */
function credentialIpLimiter({ skipSuccessfulRequests = false } = {}) {
  return rateLimit({
    windowMs: config.rateLimit.authWindowMs,
    max: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    validate,
    handler,
    skipSuccessfulRequests,
    skip,
  });
}

/**
 * /auth/refresh. Only FAILED refreshes count.
 *
 * An address is a coarse key here: behind a corporate/NAT egress — the documented
 * deployment is a military network behind nginx — every user shares one. Each active
 * session refreshes about once per access-token lifetime (15 min by default), so a
 * ceiling sized for credential guessing is spent by ordinary use: the 11th honest
 * refresh in a window was a 429, and the frontend turns ANY refresh error into a
 * definitive logout (api-client `refresh()` clears the tokens without reading the
 * status). Skipping successful requests keeps the full budget pointed at what the
 * limiter is actually for — repeated failures, i.e. someone guessing tokens — and
 * charges nothing to a client that just proved it holds a valid one.
 */
export const refreshLimiter = credentialIpLimiter({ skipSuccessfulRequests: true });

/**
 * /auth/verify-email. Its own bucket: a flood of resend requests must not consume
 * the budget of the user trying to confirm an address from the same network.
 */
export const verifyEmailLimiter = credentialIpLimiter();

/**
 * /auth/resend-verification. The one route here worth attacking: it sends e-mail and
 * answers differently for a known address, so it is both an amplifier and an account
 * oracle. Keyed by address precisely because the previous per-`username` key was
 * attacker-chosen and therefore unlimited.
 */
export const resendVerificationLimiter = credentialIpLimiter();

/**
 * Looser limiter for the public-link route (no body). By IP only.
 */
export const publicLinkLimiter = rateLimit({
  windowMs: config.rateLimit.publicWindowMs,
  max: config.rateLimit.publicMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler,
  skip,
});

/**
 * Busca do gazetteer (`GET /nomes/busca`). Rota ANÔNIMA por decisão de produto —
 * é a busca do caminho sem login — e por isso a única defesa contra varredura é
 * o teto por endereço. Store próprio: dividir balde com o link público faria uma
 * feature esgotar a cota da outra.
 *
 * O teto é folgado de propósito (ver o porquê em `backend/src/config.js`): o que
 * ele corta é a varredura sequencial, não o uso humano.
 */
export const gazetteerLimiter = rateLimit({
  windowMs: config.rateLimit.gazetteerWindowMs,
  max: config.rateLimit.gazetteerMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler,
  skip,
});
