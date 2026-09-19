import fs from 'node:fs';
import { startBackend } from './backend.js';
import { STATE_FILE, UI_E2E_DB_NAME } from './constants.js';

export default async function setup() {
    const result = await startBackend({ corsOrigin: 'https://127.0.0.1:44431', port: 3912, dbName: UI_E2E_DB_NAME });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ skip: false, ...result }));
}
