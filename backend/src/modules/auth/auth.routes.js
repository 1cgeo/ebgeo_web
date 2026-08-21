// Path: src/modules/auth/auth.routes.js
import { Router } from 'express';
import config from '../../config.js';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  authLimiter,
  registerLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
} from '../../middleware/rate-limit.js';
import * as ctrl from './auth.controller.js';
import * as schemas from './auth.schemas.js';

const router = Router();

// Self-registration is gated: disabled by default in production (military
// network), enabled in dev/test. When disabled the route is not mounted (404).
//
// TWO limiters, in this order, because they key on different things. `registerLimiter`
// is by ADDRESS and is the one that bounds mass creation: the `${ip}:${username}` key of
// `authLimiter` is attacker-chosen here (the name never exists yet), so it hands out a
// fresh bucket per request. `authLimiter` stays because it still throttles repetition
// against one specific name.
if (config.security.allowSelfRegistration) {
  router.post(
    '/register',
    registerLimiter,
    authLimiter,
    validate({ body: schemas.registerSchema }),
    ctrl.register
  );
}
// One limiter per route, NOT one shared instance. `authLimiter` keys by
// `${ip}:${body.username}`, which only means something on the two routes whose schema
// declares `username`; on the other three it collapsed to `${ip}:` and the three
// drained a single bucket together — see the note in middleware/rate-limit.js.
//
// E-mail confirmation (always mounted: needed whenever an e-mail-bearing account exists).
router.post('/verify-email', verifyEmailLimiter, validate({ body: schemas.verifyEmailSchema }), ctrl.verifyEmail);
router.post('/resend-verification', resendVerificationLimiter, validate({ body: schemas.resendVerificationSchema }), ctrl.resendVerification);
router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', refreshLimiter, validate({ body: schemas.refreshSchema }), ctrl.refresh);
router.post('/logout', auth, validate({ body: schemas.logoutSchema }), ctrl.logout);
router.get('/me', auth, ctrl.getMe);

export { router as authRoutes };
