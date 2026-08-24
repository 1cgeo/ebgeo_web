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
  forgotPasswordLimiter,
  resetPasswordLimiter,
} from '../../middleware/rate-limit.js';
import { canDeliverAccountMail } from '../../utils/mailer.js';
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

// PASSWORD RECOVERY BY E-MAIL, MOUNTED ONLY WHERE THE MESSAGE CAN LAND, exactly as `/register`
// is mounted only where self-registration is on. The condition is the honest half of "prever o
// e-mail": the account e-mail is optional in this product (`POST /api/v1/users` creates accounts
// without one) and SMTP is only REQUIRED at boot in production with self-registration on
// (`validateEnvVariables`, src/config.js), so a PRODUCTION deployment with no relay is a
// supported state. Mounting there would answer 200 to "enviamos um código" and mail nothing: the
// person would wait for a message that cannot arrive, which is worse than not offering recovery.
// Unmounted means 404, `features.password_reset_email` false in `GET /api/config`, and a login
// screen that offers only the administrator path — which is the rule that is true there.
//
// `canDeliverAccountMail` and not `isSmtpConfigured`, because outside production the mailer
// WRITES the code to the log instead of sending it, and that log is the delivery channel of a
// local stack. Using the narrow predicate would leave the whole flow unreachable in dev and in
// the test suite, i.e. untestable and unusable exactly where it is developed.
//
// Evaluated ONCE at module load, like `allowSelfRegistration` above: config is frozen at boot.
if (canDeliverAccountMail()) {
  router.post(
    '/forgot-password',
    forgotPasswordLimiter,
    validate({ body: schemas.forgotPasswordSchema }),
    ctrl.forgotPassword
  );
  router.post(
    '/reset-password',
    resetPasswordLimiter,
    validate({ body: schemas.resetPasswordWithTokenSchema }),
    ctrl.resetPasswordByToken
  );
}

router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', refreshLimiter, validate({ body: schemas.refreshSchema }), ctrl.refresh);
router.post('/logout', auth, validate({ body: schemas.logoutSchema }), ctrl.logout);
router.get('/me', auth, ctrl.getMe);

export { router as authRoutes };
