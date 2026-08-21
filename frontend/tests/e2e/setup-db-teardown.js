// Path: tests/e2e/setup-db-teardown.js

/**
 * @fileoverview Per-file teardown for the direct SQL connection of `helpers/db.js`.
 *
 * `globalSetup`'s teardown runs in the Vitest MAIN process; the pg-promise pool that
 * `registerAndLogin` opens lives in the test FORK, where nothing would ever close it. A
 * pool left open can keep the fork alive past the end of the run, which shows up as a
 * suite that "passes" and then hangs — so the close is anchored to a lifecycle hook that
 * definitely runs in the same process as the socket.
 *
 * Per FILE rather than per RUN because `setupFiles` execute once per test file. The
 * connection is lazy, so a file that never registers a user never opens (and never
 * closes) anything.
 */

import { afterAll } from 'vitest';
import { closeDb } from './helpers/db.js';

afterAll(async () => {
    await closeDb();
});
