// Path: e2e-ui/global-teardown.js

/**
 * @fileoverview Playwright global teardown. Reads the state written by
 * global-setup.js, kills the spawned backend, and drops the throwaway DB.
 */

import fs from 'node:fs';
import { dropDatabase, killPid } from './backend.js';
import { STATE_FILE } from './constants.js';

export default async function globalTeardown() {
    let state;
    try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return;
    }
    if (!state.skip) {
        killPid(state.pid);
        await dropDatabase(state.dbName).catch(() => {});
    }
    try {
        fs.unlinkSync(STATE_FILE);
    } catch {
        // already gone
    }
}
