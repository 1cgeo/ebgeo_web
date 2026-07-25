// Path: src/database/index.js
import pgPromise from 'pg-promise';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Builds the payload of the per-query debug log.
 *
 * The VALUES of the parameters are deliberately absent. This hook runs for EVERY
 * query, and live credentials travel through `$1`: the api_key of
 * `FIND_USER_BY_API_KEY` (middleware/flexible-auth.js) and the refresh-token hash of
 * `FIND_REFRESH_TOKEN_ANY`. pino's `redact` in utils/logger.js matches by FIELD NAME
 * (`password`, `token`, `apiKey`, …) and cannot see inside a positional array, so
 * `params` was an uncovered channel: one operator raising LOG_LEVEL=debug to
 * diagnose an incident shipped API keys and token hashes to the log pipeline.
 *
 * The diagnostic value that mattered — WHICH query ran, and with how many
 * parameters — is preserved; only the values are dropped. Exported so the invariant
 * is asserted against the object the code BUILDS, not against a logger whose level
 * is 'silent' under NODE_ENV=test (which would mask everything and pass green).
 *
 * @param {{query: unknown, params: unknown}} e - pg-promise query event.
 * @returns {{query: string, paramCount: number}}
 */
export function queryLogPayload(e) {
  const query = typeof e?.query === 'string' ? e.query : String(e?.query ?? '');
  const params = e?.params;
  const paramCount = Array.isArray(params) ? params.length : params === undefined || params === null ? 0 : 1;
  return { query: query.substring(0, 80), paramCount };
}

/** pg-promise `query` hook. Separated from the payload so both are testable. */
export function logQueryEvent(e) {
  logger.debug(queryLogPayload(e), 'DB Query');
}

const initOptions = {
  query: logQueryEvent,
  error(err, e) {
    logger.error({ err, query: e.query }, 'DB Error');
  },
};

const pgp = pgPromise(initOptions);
// Apply pool sizing (poolMin/poolMax were read in config but never passed before).
const db = pgp({
  connectionString: config.db.connectionString,
  max: config.db.poolMax,
  min: config.db.poolMin,
});

/**
 * Executes a parameterized SQL query.
 * Returns array of rows (compatible with old pg usage via .rows)
 * @param {string} text - SQL query with $1, $2... placeholders
 * @param {Array} [values] - Parameter values
 * @returns {Promise<Array>} Array of rows
 */
export async function query(text, values) {
  const result = await db.any(text, values);
  // Return object with rows property for backwards compatibility
  return { rows: result, rowCount: result.length };
}

/**
 * Gets a single row. Throws if not found or multiple found.
 * @param {string} text - SQL query
 * @param {Array} [values] - Parameter values
 * @returns {Promise<Object>} Single row
 */
export function one(text, values) {
  return db.one(text, values);
}

/**
 * Gets a single row or null if not found.
 * @param {string} text - SQL query
 * @param {Array} [values] - Parameter values
 * @returns {Promise<Object|null>} Single row or null
 */
export function oneOrNone(text, values) {
  return db.oneOrNone(text, values);
}

/**
 * Gets multiple rows. Throws if none found.
 * @param {string} text - SQL query
 * @param {Array} [values] - Parameter values
 * @returns {Promise<Array>} Array of rows
 */
export function many(text, values) {
  return db.many(text, values);
}

/**
 * Gets zero or more rows.
 * @param {string} text - SQL query
 * @param {Array} [values] - Parameter values
 * @returns {Promise<Array>} Array of rows
 */
export function any(text, values) {
  return db.any(text, values);
}

/**
 * Executes query expecting no return data.
 * @param {string} text - SQL query
 * @param {Array} [values] - Parameter values
 * @returns {Promise<null>}
 */
export function none(text, values) {
  return db.none(text, values);
}

/**
 * Executes a transaction with automatic commit/rollback.
 * @param {Function} callback - Async function receiving transaction context (t)
 * @returns {Promise<any>} Result of callback
 */
export function tx(callback) {
  return db.tx(callback);
}

/**
 * Executes a task (shared connection without transaction).
 * @param {Function} callback - Async function receiving task context (t)
 * @returns {Promise<any>} Result of callback
 */
export function task(callback) {
  return db.task(callback);
}

export { db, pgp };
export default db;
