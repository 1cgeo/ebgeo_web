// Path: src/modules/config/config.routes.js
// PUBLIC endpoint (no auth) — the app must work identically for anonymous users.
import { Router } from 'express';
import * as ctrl from './config.controller.js';

const router = Router();

router.get('/', ctrl.getConfig);

export { router as configRoutes };
