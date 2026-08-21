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

/**
 * Promotes a freshly registered account to the global `admin` role.
 *
 * WHY THIS IS SQL AND NOT A ROUTE, unlike the verification token above (whose route the
 * harness deliberately goes through): there IS no route. Creating or promoting an admin
 * requires an existing admin, and this leg starts from an empty database whose only door
 * is `POST /auth/register` — every account it can make is a plain `user`. The chicken and
 * egg has no route-shaped solution, so the write is honest here rather than hidden.
 *
 * The gate that reads this (`requireAuditReader`) resolves the role IN THE DATABASE, not
 * from the JWT, so an already-issued token picks the new role up immediately — no second
 * login needed, and that property is itself part of what the audit spec exercises.
 *
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function promoteToAdmin(username) {
    const row = await connect().oneOrNone(
        `UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER($1) RETURNING id`,
        [username]
    );
    if (!row) throw new Error(`cannot promote "${username}": no such user`);
}

/**
 * Seeds PUBLIC catalog rows for the ids a spec is about to reference in a sync op.
 *
 * WHY A SPEC NEEDS THIS AT ALL, and it is a behaviour change, not a test smell: since
 * 2026-08-21 the sync write gate refuses an op whose resource reference the author cannot
 * see, and `fn_can_see_resource` treats a MISSING row as one you cannot see, so that
 * "absent" and "forbidden" stay indistinguishable (the same anti-enumeration rule the atlas
 * routes follow). Three specs of this leg pushed references to ids that never existed
 * anywhere — `tileset-alpha`, `ortofoto`, freshly generated photo names — and were silently
 * relying on the gate not being there. The fix is a real row, not a hole in the gate.
 *
 * `ON CONFLICT DO NOTHING` because this leg runs every spec file against ONE throwaway
 * database, so two files asking for the same id is normal, not a collision.
 *
 * @param {{tilesets?: string[], basemaps?: string[], dataLayers?: string[], analysisLayers?: string[]}} ids
 * @returns {Promise<void>}
 */
export async function seedPublicCatalogRefs(ids = {}) {
    const TABELAS = {
        tilesets: 'tilesets',
        basemaps: 'basemaps',
        dataLayers: 'data_layers',
        analysisLayers: 'analysis_layers',
    };
    const db = connect();
    for (const [chave, tabela] of Object.entries(TABELAS)) {
        for (const id of ids[chave] ?? []) {
            await db.none(
                `INSERT INTO ${tabela} (id, name, config, sort_order, access_level)
                 VALUES ($1, $2, '{}'::jsonb, 900, 'public')
                 ON CONFLICT (id) DO NOTHING`,
                [id, `Fixture ${id}`]
            );
        }
    }
}

/**
 * Seeds a PUBLIC 360 project owning one photo per name given.
 *
 * The names are the photos' `original_name`, which is what `streetview360_data.photo_name`
 * stores and what the write gate translates to a project id — a 360 reference is a NAME, not
 * an id, and that translation is the reason this helper cannot be folded into the one above.
 *
 * @param {string[]} photoNames
 * @returns {Promise<{projectId: string, orgId: string}>}
 */
export async function seedPublic360Photos(photoNames = []) {
    const db = connect();
    const sufixo = Math.abs(Date.parse(new Date().toISOString()) % 1e8).toString(36)
        + photoNames.join('').length.toString(36);
    const slug = `e2e-360-${sufixo}`;
    const org = await db.one(
        `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
        [`OM e2e 360 ${sufixo}`, `om-e2e-360-${sufixo}`, 'FX']
    );
    const proj = await db.one(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                     center_lat, center_long, photo_count)
         VALUES ($1, $2, $3, $4, 'enabled', 'public', -22.9, -43.2, $5) RETURNING id`,
        [org.id, slug, `Projeto e2e ${sufixo}`, `${org.id}__${slug}.db`, photoNames.length]
    );
    let sequencia = 0;
    for (const nome of photoNames) {
        sequencia += 1;
        await db.none(
            `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
             VALUES ($1, $2, $3, $4, -22.9, -43.2)`,
            [`e2e-foto-${sufixo}-${sequencia}`, proj.id, nome, sequencia]
        );
    }
    return { projectId: proj.id, orgId: org.id };
}

/** Closes the memoized connection + driver. Safe to call when nothing was opened. */
export async function closeDb() {
    if (_pgp) {
        _pgp.end();
        _pgp = null;
        _conn = null;
    }
}
