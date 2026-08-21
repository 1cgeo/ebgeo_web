// Path: tests/e2e/helpers/db.js

/**
 * @fileoverview SQL ground-truth for the contract E2E leg, against the throwaway DB
 * `global-setup.js` provisioned (connection string published as `EBGEO_E2E_DB_URL`).
 *
 * WHY THIS EXISTS AT ALL — the fileoverview of `auth-session.e2e.test.js` used to say
 * this leg has "no direct DB access", and that stopped being possible: self-registration
 * REQUIRES an e-mail, so every account created through `POST /auth/register` is born
 * pending and cannot log in until the `?verify=` link is followed. The token in that link
 * is delivered by e-mail, and this harness has no relay — the only place it exists is the
 * `email_verification_tokens` row.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: flip `users.email_verified` by hand. That would be a
 * shortcut around the very route it depends on, and would leave `POST /auth/verify-email`
 * unexercised across the whole leg. This module only READS the token; the confirmation
 * itself goes through the public route (see `registerAndLogin` in `harness.js`).
 *
 * `pg-promise` is a backend dependency, so it is resolved from the backend's
 * `node_modules`, exactly as `global-setup.js` does. The connection is opened lazily and
 * memoized; `closeDb()` is wired to an `afterAll` by `tests/e2e/setup-db-teardown.js`, so
 * a file that never registers a user never opens a socket.
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const BACKEND_DIR =
    process.env.EBGEO_BACKEND_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../backend');

const backendRequire = createRequire(pathToFileURL(`${BACKEND_DIR}/package.json`).href);
const pgPromise = backendRequire('pg-promise');

let _pgp = null;
let _conn = null;

/**
 * Lazily opens (and memoizes) the shared connection to the throwaway e2e DB.
 * @returns {Object} A pg-promise database object.
 */
function connect() {
    if (!_conn) {
        const url = process.env.EBGEO_E2E_DB_URL;
        if (!url) {
            throw new Error(
                'EBGEO_E2E_DB_URL is unset — global-setup did not run, or the run was skipped'
            );
        }
        _pgp = pgPromise({ noWarnings: true });
        _conn = _pgp(url);
    }
    return _conn;
}

/**
 * The newest live (unconsumed, unexpired) verification token for a username.
 *
 * Newest first because `POST /auth/resend-verification` issues an additional row for the
 * same user: taking an arbitrary one would confirm with a token the user no longer holds
 * in a spec that exercises resend.
 *
 * @param {string} username
 * @returns {Promise<string>} The token UUID.
 * @throws {Error} If no live token exists for that username.
 */
export async function pendingVerificationToken(username) {
    const row = await connect().oneOrNone(
        `SELECT t.token
           FROM email_verification_tokens t
           JOIN users u ON u.id = t.user_id
          WHERE LOWER(u.username) = LOWER($1)
            AND t.consumed_at IS NULL
            AND t.expires_at > NOW()
          ORDER BY t.created_at DESC
          LIMIT 1`,
        [username]
    );
    if (!row) {
        throw new Error(`no live verification token for "${username}"`);
    }
    return row.token;
}

/** Closes the memoized connection + driver. Safe to call when nothing was opened. */
export async function closeDb() {
    if (_pgp) {
        _pgp.end();
        _pgp = null;
        _conn = null;
    }
}
