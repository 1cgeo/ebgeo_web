// Path: src/modules/nomes/assets3d.routes.js
// PUBLIC asset serving (no auth). Discovery is gated by the authenticated catalog.
import { Router } from 'express';
import * as ctrl from './assets3d.controller.js';

const router = Router();

router.get('/*', ctrl.serveAsset);

export { router as assets3dRoutes };
