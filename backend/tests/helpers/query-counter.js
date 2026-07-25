// Path: tests/helpers/query-counter.js
// Counts the SQL statements issued INSIDE a pg-promise transaction, so a test can assert that
// a whole-entity operation (clone / duplicate / import) costs a CONSTANT number of round-trips
// instead of one per row. Only statements executed through the transaction context `t` are
// counted — anything on the plain pool (auth, permission middleware) is ignored.
//
// The hook replaces `db.tx` (a property of the exported Database object, looked up at call
// time by database/index.js's `tx()` wrapper) with a version that hands the callback a counting
// Proxy over the transaction context.

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
