// Path: e2e-ui/helpers/db.js

/**
 * Read-only SQL ground-truth for the full-chain specs. The SyncLedger `server.*`
 * spans tell us the backend SAID it stored an op; this helper proves it by reading
 * the Postgres rows directly — independent of the trace ring. Runs in the Playwright
 * Node process (not the browser), against the throwaway DB `global-setup` provisioned.
 *
 * Reuses the backend's own pg-promise driver + connection-string builder (exported
 * from ../backend.js) so there is one source of truth for how the test DB is reached.
 * The connection is opened lazily and shared (workers=1); close it in global teardown
 * or the fixture's teardown with `closeDb()`.
 */

import { pgPromise, appDbUrl } from '../backend.js';

/** entityType → the `id`-keyed table that holds its row (only the simple cases). */
export const TABLE_BY_ENTITY = Object.freeze({
    feature: 'features',
    map: 'maps',
    layer: 'layers',
    group: 'groups',
    briefing: 'briefings',
    comment: 'comments',
    catalogLayer: 'catalog_layers',
});

/** Whitelist of queryable tables — guards the identifier interpolation in queryEntityRow. */
const QUERYABLE_TABLES = new Set(Object.values(TABLE_BY_ENTITY));

let _pgp = null;
let _conn = null;

/** Lazily opens (and memoizes) the shared read-only connection to the throwaway DB. */
function connect(dbName) {
    if (!_conn) {
        _pgp = pgPromise({ noWarnings: true });
        _conn = _pgp(appDbUrl(dbName));
    }
    return _conn;
}

/**
 * Builds the ground-truth query API bound to one throwaway DB.
 * @param {string} dbName - The DB name from `readState().dbName` (e.g. 'ebgeo_ui_e2e').
 */
export function createDb(dbName) {
    const conn = connect(dbName);
    return {
        /** The append-only op log row for `opId` (null if the backend never persisted it). */
        queryOperation: (opId) =>
            conn.oneOrNone('SELECT * FROM operations WHERE op_id = $1', [opId]),

        /** Every op log row touching `entityId`, oldest server_version first. */
        queryOperationsByEntity: (entityId) =>
            conn.any('SELECT * FROM operations WHERE entity_id = $1 ORDER BY server_version ASC', [entityId]),

        /**
         * The delivery receipt the backend stored for one operation — the ack VERBATIM
         * (`sync_receipts`, `004_sync.sql`): `status`, and on a refusal the `conflict` object
         * carrying the disputed units.
         *
         * WHY THE RECEIPT AND NOT THE OP LOG. Since 2026-09-13 a refused operation writes NO
         * row in `operations` (`entity-conflicts.js`), so the log alone can only say "it is not
         * here" — which reads identically for a refusal and for work lost in transit. Those are
         * opposite outcomes: one is the contract working, the other is an edit disappearing.
         * The receipt is the only place the difference is written down.
         *
         * `op_id` alone is key enough here, although the table is keyed (atlas_id, op_id):
         * operation ids are UUIDs minted by the client.
         * @param {string} opId - Operation id.
         * @returns {Promise<{result: Object}|null>} The stored ack, or null if none exists.
         */
        queryReceipt: (opId) =>
            conn.oneOrNone('SELECT result FROM sync_receipts WHERE op_id = $1', [opId]),

        /** The feature row (includes `deleted_at` — soft-delete tombstone, NOT row removal). */
        queryFeatureRow: (entityId) =>
            conn.oneOrNone('SELECT * FROM features WHERE id = $1', [entityId]),

        /** A whitelisted entity table's row by `id` (TABLE_BY_ENTITY values only). */
        queryEntityRow: (table, entityId) => {
            if (!QUERYABLE_TABLES.has(table)) {
                throw new Error(`queryEntityRow: table "${table}" is not whitelisted`);
            }
            return conn.oneOrNone(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
        },

        /** The atlas's current LWW version counter (max server_version applied). */
        queryServerVersion: (atlasId) =>
            conn.oneOrNone('SELECT current_version FROM atlas WHERE id = $1', [atlasId]),

        /** Escape hatch for ad-hoc assertions in a spec. */
        raw: conn,
    };
}

/**
 * Closes the shared connection. Safe to call when nothing was opened.
 *
 * `conn.$pool.end()`, NOT `pgp.end()`: the latter shuts down every pool in the process, so one
 * spec's teardown would poison another helper's live connection. Measured — see the note in
 * `accounts.js`.
 */
export async function closeDb() {
    if (_conn) {
        await _conn.$pool.end();
        _pgp = null;
        _conn = null;
    }
}
