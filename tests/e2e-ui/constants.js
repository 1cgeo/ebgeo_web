// Path: e2e-ui/constants.js

/**
 * @fileoverview Shared constants for the Playwright browser-E2E layer.
 * The app is served by Vite (webServer in playwright.config.js) and the real
 * ebgeo_backend is spawned by the global setup with CORS allowing the app origin.
 */

import os from 'node:os';
import path from 'node:path';

/** Fixed Vite dev port for the app under test (strictPort in playwright.config.js). */
export const APP_PORT = 4321;
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;

/** Port the spawned backend listens on (distinct from the vitest E2E port 3911). */
export const BACKEND_PORT = 3912;

/** Absolute path to the backend repo (sibling of ebgeo_web). */
export const BACKEND_DIR = 'C:/Users/diniz/OneDrive/Desktop/Desenvolvimento/ebgeo_backend';

/**
 * Cross-process handoff file: globalSetup writes {skip,baseUrl,pid,dbName} here,
 * the specs read baseUrl/skip, and globalTeardown reads pid/dbName. Lives in the
 * OS temp dir so it never pollutes the repo.
 */
export const STATE_FILE = path.join(os.tmpdir(), 'ebgeo-ui-e2e-state.json');
