// Path: src/middleware/rate-limit.js
import rateLimit from 'express-rate-limit';
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
  validate: false,
  handler,
  keyGenerator: (req) => `${req.ip}:${(req.body?.username || '').toLowerCase()}`,
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
  validate: false,
  handler,
  skip,
});
