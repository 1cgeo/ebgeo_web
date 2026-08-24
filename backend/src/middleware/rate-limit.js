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
 * `POST /auth/forgot-password`. Own bucket, keyed by ADDRESS.
 *
 * It is the sibling of `resendVerificationLimiter` and needs the limit for the same two reasons
 * at once, both sharper here: it is an e-mail AMPLIFIER (the address is chosen by an anonymous
 * caller and the server mails it) and it is the residual account ORACLE (the response is uniform,
 * so what remains readable is the TIME difference between the branch that mails and the branch
 * that does not, and only a ceiling on attempts bounds how well that can be measured).
 *
 * Own store, not shared with the resend limiter: a flood of one must not spend the budget of the
 * other, and these are the two routes a locked-out person needs most.
 */
export const forgotPasswordLimiter = credentialIpLimiter();

/**
 * `POST /auth/reset-password`. Own bucket, keyed by ADDRESS.
 *
 * What it bounds is GUESSING THE CODE. The code is a v4 uuid (122 bits), so guessing is not the
 * realistic attack, but the route is anonymous, it answers differently for a live code, and it
 * writes a password: it is the last place in the product that should be unlimited. Failed and
 * successful attempts both count, unlike `/auth/refresh`, because a successful reset is a
 * once-in-a-while event and nobody legitimately does it in bursts.
 */
export const resetPasswordLimiter = credentialIpLimiter();

/**
 * `PUT /users/me/email`. Own bucket, keyed by ADDRESS.
 *
 * The caller is AUTHENTICATED here, which changes what the limiter is for but does not remove the
 * need: the route mails an address the caller types, so it remains an amplifier, and the branch
 * where the address belongs to someone else notifies a stranger's mailbox. Bounding it by address
 * rather than by account is deliberate — one compromised session behind one address is the shape
 * of the abuse.
 */
export const emailChangeLimiter = credentialIpLimiter();

/**
 * `POST /auth/register`, keyed by ADDRESS. Runs BEFORE `authLimiter` on that route;
 * the two measure different things and both are wanted.
 *
 * What this one covers that `authLimiter` cannot: on a registration route the
 * `username` is chosen by the caller and by definition does not exist yet, so the
 * `${ip}:${username}` key buys a FRESH bucket on every request. N registrations from
 * one address with N distinct names all pass. That is mass account creation and, worse,
 * an e-mail amplifier — the collision branch of `register()` sends
 * `sendAccountExistsEmail` to an address the caller picked. `authLimiter` stays mounted
 * because it still throttles repetition against one specific name.
 *
 * NOT built from `credentialIpLimiter()`, which pins the auth window/max: registration
 * needs its own numbers (see `config.rateLimit.registerWindowMs`). Own store, like every
 * limiter in this file, so its traffic never drains a sibling route's budget.
 */
export const registerLimiter = rateLimit({
  windowMs: config.rateLimit.registerWindowMs,
  max: config.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler,
  skip,
});

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

/**
 * GET /api/config. Keyed by address (the route has no body and no identity) via the library
 * default, which applies the same `ipKeyGenerator(req.ip, 56)` IPv6 normalization the auth
 * limiter does by hand — meaningful only because `trust proxy` makes `req.ip` the client.
 *
 * Its own store: sharing one with the gazetteer or the public link would let a burst of either
 * spend the budget that BOOT needs, and boot is the one thing that must not fail here (the
 * frontend is fail-fast on this endpoint — no config, no app, not even anonymously).
 *
 * The ceiling (`RATE_LIMIT_CONFIG_MAX`, default 600/min) is deliberately the loosest in the
 * project; the reasoning for the number is in `src/config.js` next to the knob. What actually
 * removes the DoS leverage is the memoization in `modules/config/config.cache.js` — after it, a
 * burst costs zero queries instead of eight each. This limiter caps the residual (bandwidth,
 * JSON serialization) and is the backstop for the very first request of a cold cache.
 *
 * Nasceu num arquivo próprio dentro do módulo de config porque este aqui estava sendo editado
 * em paralelo, e foi dobrado para cá em 2026-07-25 assim que as duas edições pousaram (aquele
 * arquivo não existe mais, e por isso o caminho dele não é citado aqui). As três helpers acima eram cópias verbatim lá, e duas cópias do envelope 429 (que
 * é contrato documentado em `docs/wiki/erros-api.md`) divergem com o tempo: é o mesmo
 * "dois padrões para a mesma coisa" que esta auditoria já fechou em atlas/organizations/ranks.
 */
export const configLimiter = rateLimit({
  windowMs: config.rateLimit.configWindowMs,
  max: config.rateLimit.configMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler,
  skip,
});
