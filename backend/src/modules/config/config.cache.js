// Path: src/modules/config/config.cache.js
// In-process memoization of the GET /api/config payload, INVALIDATED ON WRITE.
//
// Why this exists: `getAppConfig()` fans out to eight independent SELECTs (five over the
// four catalog tables — basemaps is read twice, once for the metadata and once for the
// MapLibre styles — plus ranks, organizations and the admin override document). The route is anonymous, has no auth to slow anyone down, and is the ONE
// endpoint whose failure stops the product: the frontend boot is fail-fast on it, with no
// static fallback, and it retries three times before giving up — so a burst amplifies
// itself against a pool of ten connections (bugs-backend.md #64).
//
// Why invalidation on write rather than a TTL: the controller sends `Cache-Control:
// no-cache` on purpose, so an admin edit shows up on the next boot. A TTL would trade that
// property for a delay measured in seconds and nobody could say which. Bursting the entry at
// the point of the write keeps the property EXACTLY: the request that follows a write
// rebuilds. The TTL below is only a backstop for a write path nobody wired up here (a manual
// UPDATE against the database, a future module) — the mechanism is `invalidateAppConfigCache`,
// which every catalog / ranks / organizations / config-override write calls.
//
// The entry holds the in-flight PROMISE, not the resolved value, so N concurrent misses cost
// one build and not N. That is the DoS case itself: an empty cache under a burst is exactly
// when 8×N queries would land.
//
// This module deliberately imports NOTHING from config.service.js. The writers that must
// invalidate (catalog / ranks / organizations) are themselves imported BY config.service.js,
// so the dependency has to point one way only.
//
// IT DOES OWN A SECOND FAN-OUT SINCE F11, and hanging it here rather than at the nine call
// sites is the whole point. `/assets3d` keeps two in-memory structures derived from the SAME
// catalog rows this payload is derived from — which paths belong to a PRIVATE resource, and
// who may have them — and they are what let that route decide a regime without a query. Two
// invalidations reachable only by remembering both is how one of them goes stale; every
// writer already remembers this one. Two consequences, accepted deliberately: the
// organizations and ranks writers invalidate the asset structures for nothing (inert — they
// rebuild), and the asset structures are cleared even when `isAppConfigCacheEnabled()` is
// false, because a security index switched off under test is an index whose "denied" tests
// would pass by vacuity.
import config from '../../config.js';
import { invalidarRegimeDeAssets3d } from '../nomes/assets3d-regime.js';
import { invalidarAcessoDeAssets3d } from '../nomes/assets3d-acesso.js';
import { invalidarIndiceDeModelos3d } from '../models3d/models3d.index.js';

/** @type {{ promise: Promise<Object>, expiresAt: number }|null} */
let entry = null;

/**
 * Whether the memo is active for this process.
 *
 * Off under NODE_ENV=test unless `CONFIG_CACHE_FORCE=1`, and read LIVE (not frozen at import)
 * — the same shape as the rate limiters' `skip`. The reason is the same too: the suite writes
 * to the catalog tables DIRECTLY (`UPDATE tilesets SET active = false`, config-infra-gaps.test.js)
 * and then reads /config back, which is a write path no service-level invalidation can see. A
 * cache silently on would make a dozen honest tests read stale rows and fail for the wrong
 * reason. The dedicated coverage (config-cache.test.js) sets the flag; so does the E2E harness,
 * where the app really does boot against the real server.
 * @returns {boolean}
 */
export function isAppConfigCacheEnabled() {
  if (config.configCache.ttlMs <= 0) return false;
  return !config.isTest || process.env.CONFIG_CACHE_FORCE === '1';
}

/**
 * Drops the memoized payload. Idempotent, synchronous, safe to call when the cache is off.
 * Call it AFTER a successful write to any table `getAppConfig()` reads.
 */
export function invalidateAppConfigCache() {
  entry = null;
  invalidarRegimeDeAssets3d();
  invalidarAcessoDeAssets3d();
  // Third structure derived from the same catalog rows: which file serves which model.
  // It hangs here for the reason the paragraph above gives — an invalidation reachable
  // only by remembering it is the one that goes stale.
  invalidarIndiceDeModelos3d();
}

/**
 * Read-through memo around the payload builder.
 * @param {() => Promise<Object>} build - Assembles the full payload (the expensive path).
 * @returns {Promise<Object>} The payload — SHARED between callers, so treat it as read-only
 *   (the top level is frozen; a caller that needs to mutate must copy).
 */
export function readThroughAppConfigCache(build) {
  if (!isAppConfigCacheEnabled()) return build();

  const now = Date.now();
  if (entry && entry.expiresAt > now) return entry.promise;

  const promise = build().then((payload) => {
    // Shallow freeze only: the payload is handed to every caller, and adding or replacing a
    // top-level key would leak across requests. Nested statics (config.static.js objects) are
    // deliberately left alone — freezing those would reach outside this module.
    Object.freeze(payload);
    return payload;
  });

  const fresh = { promise, expiresAt: now + config.configCache.ttlMs };
  entry = fresh;

  // A failed build must not be remembered: the next request has to try again, or one blip
  // while the database was unreachable would serve a rejected promise for the whole TTL —
  // and this is the endpoint whose failure blocks boot.
  promise.catch(() => {
    if (entry === fresh) entry = null;
  });

  return promise;
}
