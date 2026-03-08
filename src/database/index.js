// Path: src/database/index.js
import pgPromise from 'pg-promise';
import config from '../config.js';
import logger from '../utils/logger.js';

const initOptions = {
  query(e) {
    logger.debug({ query: e.query.substring(0, 80), params: e.params }, 'DB Query');
  },
  error(err, e) {
    logger.error({ err, query: e.query }, 'DB Error');
  },
};

const pgp = pgPromise(initOptions);
const db = pgp(config.db.connectionString);

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
