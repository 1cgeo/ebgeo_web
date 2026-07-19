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
 * Strict limiter for credential routes (login/refresh/register).
 * Keyed by IP + username so brute-force against one account is throttled
 * without one noisy IP locking out everyone.
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
