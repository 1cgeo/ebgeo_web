// Path: tests/helpers/query-counter.js
// Counts the SQL statements issued INSIDE a pg-promise transaction, so a test can assert that
// a whole-entity operation (clone / duplicate / import) costs a CONSTANT number of round-trips
// instead of one per row. Only statements executed through the transaction context `t` are
// counted — anything on the plain pool (auth, permission middleware) is ignored.
//
// The hook replaces `db.tx` (a property of the exported Database object, looked up at call
// time by database/index.js's `tx()` wrapper) with a version that hands the callback a counting
// Proxy over the transaction context.
//
// `installPoolQueryCounter` is the sibling for work that runs OUTSIDE a transaction — the
// read path of GET /api/config is eight independent `query()` calls on the plain pool, so the
// transaction counter above cannot see a single one of them.

import { db } from '../../src/database/index.js';

// Methods of a pg-promise task/transaction context that issue a statement.
const QUERY_METHODS = new Set([
  'none', 'one', 'oneOrNone', 'many', 'manyOrNone', 'any', 'query', 'result',
  'multi', 'multiResult', 'each', 'map', 'func', 'proc',
]);

function countingContext(t, state) {
  return new Proxy(t, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!QUERY_METHODS.has(prop)) return value.bind(target);
      return (...args) => {
        state.count += 1;
        state.statements.push(String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 70));
        return value.apply(target, args);
      };
    },
  });
}

/**
 * Installs the counter. ALWAYS call `restore()` (in `after`) — the patch is global.
 * @returns {{ state: {count: number, statements: string[]}, reset: Function, restore: Function }}
 */
export function installTxQueryCounter() {
  const hadOwn = Object.prototype.hasOwnProperty.call(db, 'tx');
  const original = db.tx;
  const state = { count: 0, statements: [] };

  db.tx = function patchedTx(...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return original.apply(this, args);
    const wrapped = (t) => cb(countingContext(t, state));
    return original.apply(this, [...args.slice(0, -1), wrapped]);
  };

  return {
    state,
    reset() {
      state.count = 0;
      state.statements.length = 0;
    },
    restore() {
      if (hadOwn) db.tx = original;
      else delete db.tx;
    },
  };
}

/**
 * Installs a counter over the POOL, i.e. the statements issued OUTSIDE any transaction. It
 * patches `db.query` and ONLY `db.query`, because every other Database method (`any`, `one`,
 * `oneOrNone`, `none`, `result`, …) delegates to it: wrapping the whole family counts each
 * statement twice, which is exactly what the first run of this helper reported (16 for a
 * request that issues 8). One statement in, one tick out.
 *
 * Everything the request touches is counted, middleware included — that is deliberate, because
 * the number a DoS argument needs is "queries per HTTP request", not "queries the service meant
 * to issue". ALWAYS call `restore()` (in `after`) — the patch is global.
 *
 * @returns {{ state: {count: number, statements: string[]}, reset: Function, restore: Function }}
 */
export function installPoolQueryCounter() {
  const hadOwn = Object.prototype.hasOwnProperty.call(db, 'query');
  const original = db.query;
  const state = { count: 0, statements: [] };

  db.query = function countedQuery(...args) {
    state.count += 1;
    state.statements.push(String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 70));
    return original.apply(this, args);
  };

  return {
    state,
    reset() {
      state.count = 0;
      state.statements.length = 0;
    },
    restore() {
      if (hadOwn) db.query = original;
      else delete db.query;
    },
  };
}
