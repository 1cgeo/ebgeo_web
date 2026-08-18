// Path: src/modules/nomes/assets3d.routes.js
// Asset serving. ONE path, and the regime is decided PER REQUEST from the resource the path
// belongs to, not from the route: a public model is served exactly as it always was (200 with
// no credential, `public, immutable`), a private one goes through the gate and comes back
// `private` — or 404, which is what a hidden model has to be indistinguishable from.
//
// ONE gate, and it is one because none of the existing ones could be mounted here.
// `requireAtlasScopeWhenPresent` and `assertCanSeeResource` each cost a query, and this is
// the route where a query per request IS the failure: Cesium fans a tileset out into a
// request per tile per LOD, and putting that fan-out on the ten-connection pool would make
// it compete with the sync, with the collab socket and with `GET /api/config`, whose failure
// blocks boot. `gateDeAsset3d` answers a PUBLIC path from memory and calls `next()` having
// touched nothing; only a private path reaches the (memoized) decision, which composes the
// two gates above rather than redefining either. `flexibleAuth` is global (`app.js`) and has
// already resolved the principal, for free.
import { Router } from 'express';
import * as ctrl from './assets3d.controller.js';
import { gateDeAsset3d } from './assets3d-acesso.js';

const router = Router();

router.get('/*', gateDeAsset3d, ctrl.serveAsset);

export { router as assets3dRoutes };
