// Path: src/modules/auth/auth.routes.js
import { Router } from 'express';
import config from '../../config.js';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rate-limit.js';
import * as ctrl from './auth.controller.js';
import * as schemas from './auth.schemas.js';

const router = Router();

// Self-registration is gated: disabled by default in production (military
// network), enabled in dev/test. When disabled the route is not mounted (404).
if (config.security.allowSelfRegistration) {
  router.post('/register', authLimiter, validate({ body: schemas.registerSchema }), ctrl.register);
}
router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', authLimiter, validate({ body: schemas.refreshSchema }), ctrl.refresh);
router.post('/logout', auth, validate({ body: schemas.logoutSchema }), ctrl.logout);
router.get('/me', auth, ctrl.getMe);

export { router as authRoutes };
