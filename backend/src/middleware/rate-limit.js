// Path: src/middleware/rate-limit.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config.js';
import logger from '../utils/logger.js';
import { redactUrl } from '../utils/redact-url.js';
import { clientAddress } from './request-logger.js';

/**
 * Ceiling for the `username` field of a denial record. It is the `max(100)` the login and
 * register schemas already declare, so a legitimate name is never cut; anything longer is
 * by construction not a name anyone owns. The cap is not cosmetic: the value arrives from
 * an ANONYMOUS caller inside a body worth up to 10mb, and an unbounded field in a line
 * written once per denial is a disk-fill vector of its own.
 */
const USERNAME_LOG_MAX = 100;

/**
 * The `username` as it should appear in a denial record, or `''` when there is none.
 *
 * It is normalized EXACTLY as `authLimiter.keyGenerator` normalizes it (`toLowerCase`,
 * non-strings collapsed to `''`), because the field has to name the bucket that actually
 * refused. A field carrying a different string than the key would read like an answer while
 * pointing at the wrong bucket.
 *
 * Two hazards are dealt with here and nowhere else. The value is attacker-chosen text, so
 * control characters are dropped: `JSON.stringify` escapes them on the way into the
 * `.jsonl`, but `npm run diag -- linhas` prints the record to a terminal, and a newline or
 * an ANSI escape smuggled into a username would forge log lines on that screen. And the
 * slice comes BEFORE the per-character work, so a 10mb body cannot buy 10mb of work per
 * denial.
 *
 * @param {{body?: {username?: unknown}}} req - the Express request.
 * @returns {string} normalized, control-free, bounded; `''` when absent or not a string.
 */
export function usernameForLog(req) {
  const raw = req?.body?.username;
  if (typeof raw !== 'string') return '';
  const cortado = raw.slice(0, USERNAME_LOG_MAX + 1).toLowerCase();
  let limpo = '';
  for (const ch of cortado) {
    const code = ch.codePointAt(0);
    if (code > 0x1f && code !== 0x7f) limpo += ch;
  }
  return limpo.length > USERNAME_LOG_MAX ? `${limpo.slice(0, USERNAME_LOG_MAX)}...` : limpo;
}

/**
 * Whether THIS refusal is the one worth a line: the first of its window, for its key.
 *
 * ONE LINE PER WINDOW, NOT ONE PER REFUSAL, because the alternative hands the attacker
 * control of the log's volume. The limiter exists to contain a burst, but the handler runs
 * on EVERY request above the ceiling (the counter keeps climbing), so "one line per
 * refusal" writes the whole burst back into the `.jsonl`, which is a file on the backend's
 * disk. Ten thousand attempts a minute become ten thousand lines and the limiter turns into
 * the amplifier. Worse, the 9.999 that follow carry no new fact: they are the same sentence
 * repeated.
 *
 * The refusal that carries information is the FIRST one: "this address crossed this route's
 * ceiling". Nothing about the volume is lost, and that is what settles the decision: the
 * firehose in `request-logger.js` already stamps one line per request with `statusCode: 429`
 * and the same `ip`, so counting the burst stays possible there. What this line adds is what
 * that one cannot have (which limiter, which key), and adding it once per window is enough.
 *
 * The aggregation is DERIVED, not stored, which is the other half. A private map of "already
 * warned about this key" would need pruning, and it would grow with an attacker walking
 * addresses: that trades a burst on disk for a burst on the heap. The per-window counter
 * already exists inside the limiter's own store and `req.rateLimit.used` exposes it, so
 * `used === limit + 1` identifies the first refusal with no state on this side at all.
 *
 * TWO edges, both erring towards SPEAKING. With no readable `req.rateLimit` (an unexpected
 * shape after a library upgrade) it returns `true`: a limiter that goes mute under load is
 * the very defect this file exists to fix, and an extra line is cheap next to a silent
 * refusal. And under `skipSuccessfulRequests` (the `refreshLimiter`) the counter goes DOWN
 * when a legitimate request succeeds, so the condition can hold again inside one window.
 * That is acceptable by construction: every repetition requires a SUCCESSFUL request in
 * between, which is the signature of a legitimate client and not of a burst.
 *
 * @param {{limit?: unknown, used?: unknown}} [info] - `req.rateLimit`.
 * @returns {boolean}
 */
export function shouldLogDenial(info) {
  const { limit, used } = info || {};
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return true;
  return used === limit + 1;
}

/**
 * Builds the object handed to pino when a limiter refuses.
 *
 * Separated from the handler so the SHAPE is testable: under `NODE_ENV=test` the logger
 * runs at level `silent`, so a test spying on pino's output would report green with the
 * whole record gone. Same split, and for the same reason, as `queryLogPayload` in
 * `src/database/index.js`.
 *
 * `reqId` is what ties this line to the one in `request-logger.js`, which is this house's
 * log join contract. `url` is built by the SAME expression as there (`originalUrl`, never
 * `req.url`, passed through `redactUrl`), so the two lines also match by string.
 *
 * THERE IS NO `statusCode` HERE, AND THAT IS DELIBERATE. Adding one would look like an
 * improvement and would cost the fix that `reqId` exists for: `ehErro`
 * (`src/utils/diag-consulta.js`) admits any record with `statusCode >= 400`, so this line
 * would enter `/diag/erros` as a SECOND defect for a request that already contributes one
 * through the firehose, and `fundirPorRequisicao` cannot fold them because neither carries
 * `err`. That is exactly the double count the report was fixed for in 2026-08-30.
 *
 * The consequence to state out loud, so nobody looks for this line in the wrong place: it
 * is NOT in `npm run diag -- erros` nor in the Diagnóstico tab. It is read raw, with
 * `npm run diag -- linhas --filtro <endereço>`, which is the surface that keeps every field.
 * What `/diag/erros` does show for the same event is the firehose line (`statusCode: 429`),
 * whose `ip` `mapearGrupo` currently trims out of the example.
 *
 * `username` appears ONLY on the limiter whose KEY includes it, and both sides of that
 * choice are worth writing down. For: it is the only field that separates "an attacker
 * sweeping a thousand accounts" from "one person mistyping their own password", and the two
 * demand opposite responses from whoever reads the log. Against: it is arbitrary text from
 * an anonymous caller (handled in `usernameForLog`) and it is personal data about a possibly
 * innocent THIRD PARTY, because the name is chosen by the attacker, not by the account's
 * owner. What breaks the tie is the conditional presence: where the field appears it names
 * part of the key that actually refused; where the bucket is address-only it stays OUT
 * rather than suggesting a per-account segmentation that does not exist. The same retention
 * window that bounds `ip` bounds this field.
 *
 * @param {string} name - which limiter refused.
 * @param {import('express').Request} req
 * @param {{keyedByUsername?: boolean}} [opts]
 * @returns {object} the pino payload.
 */
export function limiterDenialPayload(name, req, { keyedByUsername = false } = {}) {
  const info = req?.rateLimit || {};
  const payload = {
    reqId: req?.id,
    limiter: name,
    // The address comes from `clientAddress`, the SAME function the request line uses, and
    // the declaration made there holds here: it is personal data, it is the only way to
    // answer "who is trying to get in", and `LOGIN_FAILED` is NOT in `audit_trail` because
    // `audit_trail.actor_id` is NOT NULL and a failed attempt has no actor to record. So
    // for a refused login burst there is no record ANYWHERE except the `.jsonl`: whoever
    // looks in the audit trail will not find it. The file's age-based retention
    // (`LOG_RETENTION_DAYS`, default 30) is what bounds how long it is kept.
    //
    // Raw, WITHOUT the `ipKeyGenerator(req.ip, 56)` normalization: collapsing the /56 prefix
    // exists to stop an IPv6 client from walking its own allocation and buying a fresh
    // bucket per request, and it is the right thing to KEY on. To answer who tried, it
    // throws away exactly the precision the answer needs.
    ip: clientAddress(req),
    method: req?.method,
    url: redactUrl(req?.originalUrl || req?.url),
    limit: Number.isFinite(info.limit) ? info.limit : null,
    used: Number.isFinite(info.used) ? info.used : null,
  };
  if (keyedByUsername) payload.username = usernameForLog(req);
  return payload;
}

/**
 * The 429 handler, per limiter.
 *
 * It used to be a single shared handler, and it was MUTE: it refused and nobody ever learned
 * that it had. It became a factory because the line has to say WHICH limiter fired, and that
 * is the one thing `req` does not carry (the route alone is not enough: `/auth/register`
 * mounts TWO, `registerLimiter` and `authLimiter`, measuring different things).
 *
 * The response envelope stays byte-identical, because it is contract documented in
 * `docs/wiki/erros-api.md`. `logger.warn` is the same level at which the firehose already
 * writes a 429, which is `statusCode >= 400`.
 *
 * @param {string} name
 * @param {{keyedByUsername?: boolean}} [opts]
 * @returns {import('express').RequestHandler}
 */
export function makeLimiterHandler(name, opts = {}) {
  return (req, res) => {
    if (shouldLogDenial(req?.rateLimit)) {
      logger.warn(limiterDenialPayload(name, req, opts), 'rate limit denied');
    }
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Muitas tentativas. Tente novamente mais tarde.',
      },
    });
  };
}

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
//
// Both are worth twice what they were: now that the address is a LOG FIELD
// (`request-logger.js`), a `trust proxy` that stops matching the deploy no longer only
// degrades the limiter key, it writes nginx's address on every line of the file. These
// checks are the alarm for that case, which is why only the two that are noisy in the test
// suite stay off.
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
 *
 * It is the ONLY limiter whose denial record carries the `username`, because it is the only
 * one whose key includes it. Both sides of that choice are in `limiterDenialPayload`.
 */
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler: makeLimiterHandler('auth', { keyedByUsername: true }),
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
 * `name` is mandatory: the denial line has to name which of the six siblings fired, and a
 * default here would produce six limiters indistinguishable in the log.
 *
 * @param {{name: string, skipSuccessfulRequests?: boolean}} opts
 * @returns {Function} An express-rate-limit middleware.
 */
function credentialIpLimiter({ name, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: config.rateLimit.authWindowMs,
    max: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    validate,
    handler: makeLimiterHandler(name),
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
 *
 * It is the only one whose counter can go DOWN inside a window, and therefore the only one
 * that can record more than one denial per window; see `shouldLogDenial`.
 */
export const refreshLimiter = credentialIpLimiter({
  name: 'refresh',
  skipSuccessfulRequests: true,
});

/**
 * /auth/verify-email. Its own bucket: a flood of resend requests must not consume
 * the budget of the user trying to confirm an address from the same network.
 */
export const verifyEmailLimiter = credentialIpLimiter({ name: 'verify-email' });

/**
 * /auth/resend-verification. The one route here worth attacking: it sends e-mail and
 * answers differently for a known address, so it is both an amplifier and an account
 * oracle. Keyed by address precisely because the previous per-`username` key was
 * attacker-chosen and therefore unlimited.
 */
export const resendVerificationLimiter = credentialIpLimiter({ name: 'resend-verification' });

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
export const forgotPasswordLimiter = credentialIpLimiter({ name: 'forgot-password' });

/**
 * `POST /auth/reset-password`. Own bucket, keyed by ADDRESS.
 *
 * What it bounds is GUESSING THE CODE. The code is a v4 uuid (122 bits), so guessing is not the
 * realistic attack, but the route is anonymous, it answers differently for a live code, and it
 * writes a password: it is the last place in the product that should be unlimited. Failed and
 * successful attempts both count, unlike `/auth/refresh`, because a successful reset is a
 * once-in-a-while event and nobody legitimately does it in bursts.
 */
export const resetPasswordLimiter = credentialIpLimiter({ name: 'reset-password' });

/**
 * `PUT /users/me/email`. Own bucket, keyed by ADDRESS.
 *
 * The caller is AUTHENTICATED here, which changes what the limiter is for but does not remove the
 * need: the route mails an address the caller types, so it remains an amplifier, and the branch
 * where the address belongs to someone else notifies a stranger's mailbox. Bounding it by address
 * rather than by account is deliberate — one compromised session behind one address is the shape
 * of the abuse.
 */
export const emailChangeLimiter = credentialIpLimiter({ name: 'email-change' });

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
 *
 * Its denial record does NOT carry the `username`, even though the route has one in the
 * body: the bucket here is address-only, and a name field next to it would suggest a
 * per-account segmentation that does not exist. The attempted name stays readable on the
 * `authLimiter` line, which is the one that does segment by it.
 */
export const registerLimiter = rateLimit({
  windowMs: config.rateLimit.registerWindowMs,
  max: config.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler: makeLimiterHandler('register'),
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
  handler: makeLimiterHandler('public-link'),
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
  handler: makeLimiterHandler('gazetteer'),
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
 *
 * The fold still pending is `src/modules/diag/diag.rate-limit.js`, which keeps its own copy of
 * the envelope and therefore stays MUTE on refusal. `makeLimiterHandler` is exported so that
 * fold is a one-line change.
 */
export const configLimiter = rateLimit({
  windowMs: config.rateLimit.configWindowMs,
  max: config.rateLimit.configMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate,
  handler: makeLimiterHandler('config'),
  skip,
});
