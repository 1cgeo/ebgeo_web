// Path: src/database/index.js
import pgPromise from 'pg-promise';
import config from '../config.js';
import logger from '../utils/logger.js';
import { elidirSql, TETO_PADRAO } from '../utils/elidir-sql.js';
import {
  MARCADOR_QUERY_LENTA, duracaoDeQuery, deveAcusarQueryLenta,
} from '../utils/query-lenta.js';

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

/** Ceiling of the slow-query line. Wider than the debug one: this line is rare and is read. */
const TETO_DA_LINHA_LENTA = 300;

/**
 * Builds the payload of the slow-query line.
 *
 * THE VALUES NEVER TRAVEL, and this is the same door `queryLogPayload` above closes:
 * `pgFormatting` is at pg-promise's default (`false`), so by the time any event fires the
 * placeholders are gone and the text carries the literal credential. `elidirSql` keeps the
 * SHAPE and drops the values, which is exactly the half that answers "which statement is
 * slow". `e.ctx.params` and `e.ctx.values` are NOT read here, at all: the arity is not the
 * question, and reading them would reintroduce by hand the leak the elision closes.
 *
 * `rows` COMES FROM THE RESULT AND NOT FROM `data.length`, because they are not the same
 * question on every path: `result.rowCount` is what the server reported, while `data` is
 * the array pg-promise is about to hand to the caller, which a `.one()`/`.none()` shape
 * check can still reject afterwards. The number worth having beside a duration is what the
 * database actually produced.
 *
 * Exported for the same reason `queryLogPayload` is: the invariant is asserted against the
 * object the code BUILDS, not against a logger sitting at level 'silent' under
 * NODE_ENV=test, which would mask everything and pass green.
 *
 * @param {{ctx?: {query?: unknown}, result?: {duration?: number, rowCount?: number}}} e
 * @returns {{query: string, duration: number|null, rows: number|null}}
 */
export function queryLentaPayload(e) {
  const rows = e?.result?.rowCount;
  return {
    query: elidirSql(e?.ctx?.query, { teto: TETO_DA_LINHA_LENTA }),
    duration: duracaoDeQuery(e?.result),
    rows: Number.isFinite(rows) ? rows : null,
  };
}

/**
 * pg-promise `receive` hook: one `warn` line per query slower than `SLOW_QUERY_MS`.
 *
 * IT MUST NEVER THROW, and that is not defensive style: `Events.receive`
 * (`node_modules/pg-promise/lib/events.js`) catches whatever this handler throws and
 * REJECTS THE QUERY with it. So a bug in the logging of a slow query would turn a slow
 * query into a FAILED query, i.e. the instrument breaking the thing it measures, in the
 * hottest path of the application. The `try` wraps the decision as well as the log for
 * that reason, and the `catch` is deliberately silent: the only thing left to do with an
 * error here is to log it, which is the operation that just failed.
 *
 * THE THRESHOLD IS READ AT CALL TIME, from `config`, and not captured in a module-level
 * constant. It costs a property access per query and buys the property that matters for
 * a test: the hook and the configuration cannot be observed disagreeing.
 *
 * @param {Object} e - `{data, result, ctx}`, as `Events.receive` builds it.
 */
export function receberResultado(e) {
  try {
    const duracaoMs = duracaoDeQuery(e?.result);
    if (!deveAcusarQueryLenta({ duracaoMs, limiteMs: config.db.slowQueryMs })) return;
    logger.warn(queryLentaPayload(e), MARCADOR_QUERY_LENTA);
  } catch {
    // Sem re-log: o que falhou aqui foi justamente a escrita de log, e uma segunda
    // tentativa dentro do `catch` correria o mesmo risco no mesmo caminho quente.
  }
}

const initOptions = {
  query: logQueryEvent,
  error: logQueryError,
  receive: receberResultado,
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
