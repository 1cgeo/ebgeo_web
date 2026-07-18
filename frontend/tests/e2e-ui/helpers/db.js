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

/** Closes the shared connection + driver. Safe to call when nothing was opened. */
export async function closeDb() {
    if (_pgp) {
        _pgp.end();
        _pgp = null;
        _conn = null;
    }
}
