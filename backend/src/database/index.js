// Path: src/database/index.js
import pgPromise from 'pg-promise';
import config from '../config.js';
import logger from '../utils/logger.js';
import { elidirSql, TETO_PADRAO } from '../utils/elidir-sql.js';

/** Ceiling of the per-query debug line, kept short because it fires on EVERY query. */
const TETO_DA_LINHA_DE_DEBUG = 80;

/**
 * Builds the payload of the per-query debug log.
 *
 * THE LEAK THIS CLOSES, AND WHY THE PREVIOUS VERSION OF IT DID NOT. This hook used to
 * drop `e.params` and truncate `e.query` at 80 characters, on the belief that the SQL
 * was a TEMPLATE (`… WHERE api_key = $1`) and the values lived in the array beside it.
 * That belief was false for this application. `pgFormatting` is left at pg-promise's
 * default (`false`, `node_modules/pg-promise/lib/main.js`), and in that regime
 * `lib/query.js` sets `params = pgFormatting ? values : undefined` and then REWRITES
 * the SQL text through `formatQuery`, substituting the literal values, BEFORE emitting
 * this event. So `e.params` is always `undefined` here, and `e.query` is the statement
 * WITH the credential inside it: the api_key of `FIND_USER_BY_API_KEY`
 * (middleware/flexible-auth.js), the refresh-token hash of `FIND_REFRESH_TOKEN_ANY`,
 * the bcrypt `password_hash` of every user write. Truncating at 80 characters is not
 * redaction: `SELECT id, username FROM users WHERE api_key = 'ebgeo_live_…` spends most
 * of its budget on the key.
 *
 * The fix is `elidirSql`, which drops the VALUES and keeps the SHAPE, which is the part
 * that had the diagnostic value all along.
 *
 * `paramCount` WAS REMOVED, not repaired. It reported `Array.isArray(params) ? … : 0`,
 * and since `params` is structurally always `undefined` on this path it published `0`
 * for every query in the application's life. The arity is not recoverable here either:
 * by the time the event fires the placeholders are gone from the text, so there is
 * nothing left to count. A field that answers `0` to every question is worse than an
 * absent one, because it looks like a measurement.
 *
 * Exported so the invariant is asserted against the object the code BUILDS, not against
 * a logger whose level is 'silent' under NODE_ENV=test (which would mask everything and
 * pass green).
 *
 * @param {{query: unknown}} e - pg-promise query event.
 * @returns {{query: string}}
 */
export function queryLogPayload(e) {
  return { query: elidirSql(e?.query, { teto: TETO_DA_LINHA_DE_DEBUG }) };
}

/** pg-promise `query` hook. Separated from the payload so both are testable. */
export function logQueryEvent(e) {
  logger.debug(queryLogPayload(e), 'DB Query');
}

/**
 * Builds the payload of the query-error log.
 *
 * Same leak as above, one level worse: `error` fires at level `error`, which is ALWAYS
 * on, so this one never needed an operator raising LOG_LEVEL to reach the file in
 * `data/logs` and its 30-day retention.
 *
 * The `err` object is handed over whole and is cleaned by `errSerializer`
 * (utils/logger.js), which is where the SECOND door lives: `lib/query.js` stamps
 * `err.query = err.query || query` and `err.params = err.params || params` on the way
 * out, and the pg driver adds `detail`/`where`/`internalQuery`, the first of which
 * spells out `Failing row contains (…)` with the whole row, `password_hash` included.
 * Splitting the work is deliberate: the top-level `query` field below is not covered by
 * any serializer (pino only applies those to the key they are registered under), and
 * the fields inside `err` are not visible from here.
 *
 * @param {Error} err - the error pg-promise is reporting.
 * @param {{query?: unknown}} [e] - pg-promise error event context.
 * @returns {{err: Error, query: string}}
 */
export function dbErrorLogPayload(err, e) {
  return { err, query: elidirSql(e?.query, { teto: TETO_PADRAO }) };
}

/** pg-promise `error` hook. Separated from the payload so both are testable. */
export function logQueryError(err, e) {
  logger.error(dbErrorLogPayload(err, e), 'DB Error');
}

const initOptions = {
  query: logQueryEvent,
  error: logQueryError,
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
