// Path: src/modules/sync/atlas-log-lock.js
//
// THE PER-ATLAS WRITE LOCK OF THE OPERATIONS LOG, in one place, because it has more than one
// writer.
//
// `operations.server_version` is `nextval('atlas_version_seq')`, assigned at INSERT time, while
// visibility is decided at COMMIT time. The incremental pull (`server_version > $cursor`) is a
// sound cursor only if, per atlas, version order equals commit order, and the lock below is what
// makes that true: every transaction that inserts into the log of an atlas takes it BEFORE its
// first write, so nextval and commit happen in the same order for that atlas.
//
// `pushOperations` always took it. The REST exceptions that record a structural MARKER in an
// EXISTING atlas (map duplicate and map merge) did not, and they also update the atlas row
// (`map_order`) BEFORE writing the marker. A push arriving in between drew the LOWER version,
// blocked on the atlas row inside `trg_update_atlas_version`, and committed AFTER the marker: a
// peer that pulled in that window stored the marker's version as its cursor and never received
// the push's operation, and the trigger then wrote the lower version over `current_version`,
// moving the atlas version backwards. Pinned by
// `tests/integration/marcador-rest-ordem-de-commit.repro.test.js`.
//
// Clone and import are not callers: they write into an atlas that does not exist until their own
// commit, so nothing else can be inserting into its log.
import { ServiceUnavailableError } from '../../utils/errors.js';

// Namespace for the per-atlas advisory lock. The two-argument form of pg_advisory_xact_lock keys
// locks by (namespace, key), so this constant keeps sync's lock space from colliding with any other
// advisory lock the app may take later. Value is ASCII 'SYNC' read as int32.
export const SYNC_PUSH_LOCK_NAMESPACE = 0x53594e43;

/**
 * Takes the per-atlas log lock for the rest of the transaction `t`. Call it FIRST, before any write:
 * taking it after a row lock on the atlas would invert the order the push takes them in, which is a
 * deadlock.
 *
 * `lock_timeout` is set BEFORE waiting: the pool connection is already held while we block, so an
 * unbounded wait turns contention on one atlas into pool exhaustion (with poolMax=10, ten concurrent
 * writers on the same atlas would hang the whole process, /auth/login and /health included).
 * Failing after 5 s becomes a retryable 503 instead of a global stall.
 *
 * @param {Object} t - pg-promise transaction context.
 * @param {string} atlasId - The atlas whose log the transaction writes.
 * @returns {Promise<void>}
 */
export async function lockAtlasLog(t, atlasId) {
  await t.none("SET LOCAL lock_timeout = '5s'");
  try {
    await t.one('SELECT pg_advisory_xact_lock($1, hashtext($2))', [SYNC_PUSH_LOCK_NAMESPACE, atlasId]);
  } catch (err) {
    // 55P03 = lock_not_available (the lock_timeout above fired).
    if (err && err.code === '55P03') {
      throw new ServiceUnavailableError(
        'Servidor ocupado processando outra sincronização deste atlas. Tente novamente.'
      );
    }
    throw err;
  }
}
