// Path: src/modules/auth/auth.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './auth.controller.js';
import * as schemas from './auth.schemas.js';

const router = Router();

router.post('/register', validate({ body: schemas.registerSchema }), ctrl.register);
router.post('/login', validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', validate({ body: schemas.refreshSchema }), ctrl.refresh);
router.post('/logout', auth, validate({ body: schemas.logoutSchema }), ctrl.logout);
router.get('/me', auth, ctrl.getMe);

export { router as authRoutes };
