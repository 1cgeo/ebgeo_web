// Path: src/modules/streetview360/index.js
// Barrel for the StreetView 360 module (Fase 9, stage 1). Re-exports the router
// for clean wiring in app.js, plus the service namespace and the blobstore
// teardown hook (closeStore) for graceful shutdown / test teardown.
export { sv360Routes } from './sv360.routes.js';
export * as sv360Service from './sv360.service.js';
export * as sv360AdminService from './sv360.admin.service.js';
export { closeStore } from './sv360.blobstore.js';
