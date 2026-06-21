// Path: e2e-ui/state.js

/**
 * @fileoverview Reads the cross-process state written by global-setup.js so specs
 * know the backend base URL and whether to skip (backend unavailable).
 */

import fs from 'node:fs';
import { STATE_FILE } from './constants.js';

/**
 * @returns {{ skip: boolean, baseUrl?: string, pid?: number, dbName?: string, reason?: string }}
 */
export function readState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { skip: true, reason: 'no e2e state file (globalSetup did not run)' };
    }
}
