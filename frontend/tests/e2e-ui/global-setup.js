// Path: e2e-ui/global-setup.js

/**
 * @fileoverview Playwright global setup. Spawns the real backend ONCE (CORS set to
 * the Vite app origin) and writes the connection state to a temp file that the
 * specs and globalTeardown read. If Postgres / the backend can't come up, it
 * records {skip:true} so the specs `test.describe.skip` instead of failing.
 */

import fs from 'node:fs';
import { startBackend } from './backend.js';
import { APP_ORIGIN, BACKEND_PORT, STATE_FILE, UI_E2E_DB_NAME } from './constants.js';

export default async function globalSetup() {
    let state;
    try {
        const { baseUrl, pid, dbName } = await startBackend({
            corsOrigin: APP_ORIGIN,
            port: BACKEND_PORT,
            dbName: UI_E2E_DB_NAME,
        });
        state = { skip: false, baseUrl, pid, dbName };
        console.info(`[ui-e2e] backend up at ${baseUrl} (cors ${APP_ORIGIN})`);
    } catch (err) {
        state = { skip: true, reason: err.message };
        console.warn(`[ui-e2e] backend unavailable — UI E2E will SKIP: ${err.message}`);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}
