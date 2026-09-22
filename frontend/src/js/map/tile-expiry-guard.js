// Path: js/map/tile-expiry-guard.js

/**
 * @fileoverview THE 404 THAT MAPLIBRE ASKS FOR AGAIN, AT NETWORK SPEED, FOR AS LONG AS THE PAGE
 * IS OPEN, and the guard that stops it.
 *
 * WHAT WAS MEASURED (test stack, 2026-09-21, nginx log): 309,325 answers 404 in eight minutes for
 * `GET .../api/v1/sv360/tiles/{z}/{x}/{y}.pbf?atlasId=<one atlas>`, peak near 530 per second, from
 * two stations at once, and only 26 DISTINCT tiles, each asked up to ~56,000 times. They were the
 * tiles each map had on screen: `12/2047..2048/2047..2048` is the hidden 360 mini-map parked at
 * 0°,0° (it is built with a zoom and no centre), `5/12/18` and `5/12/19` the trajectory layer over
 * Brazil; the z17 ones fit a mini-map that had been moved to a photo (it opens at zoom 17).
 *
 * NOTHING IN THIS APPLICATION ASKED FOR THEM AGAIN. Read on 2026-09-22: no `setTiles`, `setUrl`,
 * `refreshTiles` or `reload` touches a 360 source; the only demolition of one
 * (`rebuildScopedSource`, `street_view_tool/tile-scope.js`) runs on an atlas change compared by
 * value; and nothing re-adds the mini-map's source. The loop is MapLibre's own (6.9.1, the version
 * in the lockfile), and it needs three facts that each sit in the installed bundle:
 *
 *   1. The 360 MVT route answers `Cache-Control: max-age=60` (`MVT_MAX_AGE`, in
 *      `backend/src/modules/streetview360/sv360.controller.js`). Every tile therefore carries an
 *      `expirationTime`, and `TileManager._setTileReloadTimer` refreshes it a minute later, as
 *      `'expired'`, over the NETWORK.
 *   2. A VECTOR tile answered 404 is not an error. `VectorTileSource.loadTile` catches it
 *      (`if (err && err.status !== 404) throw err`) and calls `_afterTileLoadWorkerResponse(tile,
 *      null)`, which loads the tile EMPTY and never reaches `setExpiryData`, since that call is
 *      guarded by `data &&`. The tile keeps the `expirationTime` of the last good answer, now in
 *      the past, with `expiredRequestCount` still 0.
 *   3. `_tileLoaded` re-arms the timer from `Tile.getExpiryTimeout()`, which in that state returns
 *      `expirationTime - now`: a NEGATIVE number. `if (expiryTimeout)` takes it as true,
 *      `setTimeout(reload, negative)` fires at once, the reload asks the network, gets 404, and the
 *      cycle closes. One request per round trip, per tile on screen, hidden maps included.
 *
 * So a tile that was served once and then REFUSED is asked for forever, and the atlas scope is
 * exactly what produces that transition: the tile carries `?atlasId=` and the server answers 404
 * the moment the caller loses read on that atlas (`requireAtlasScopeWhenPresent`), which is what a
 * revoked share, a deleted atlas or an unpublished public link does to every station in the room
 * at once. The server is right to refuse; the refresh that follows the refusal is the defect.
 * MapLibre's own answer to "the server keeps serving an expired resource" is an exponential
 * backoff inside `setExpiryData`, and the 404 path never gets there.
 *
 * THE GUARD is two wraps on the prototype of MapLibre's `Tile`, which the package does not export.
 * It is read off the first tile a `sourcedata` event carries (the event's `tile` field is part of
 * the documented `MapSourceDataEvent`) and patched once per page. One patch covers every map,
 * because every map is built from the same module (`map/maplibre.js`).
 *
 *   - `loadVectorData` records on the tile whether the load brought data. `null` is fact 2.
 *   - `getExpiryTimeout` refuses to re-arm a timer that has ALREADY RUN OUT when the load that
 *     just finished brought no data. Otherwise it lets a run-out tile through ONCE per
 *     `expirationTime`, which is the legitimate case (a tile that outlived its freshness while out
 *     of view) and also bounds any other shape of the same loop to a single extra request.
 *     Anything positive (a fresh expiry, MapLibre's own backoff) passes through untouched.
 *
 * WHAT IT DOES NOT CHANGE: the healthy refresh every 60 s; the backoff MapLibre applies to a server
 * that keeps answering an expired resource; raster tiles, whose 404 throws and leaves the tile
 * `errored`, with no timer at all. A tile refused this way stays EMPTY until something the person
 * does asks for it again: turning the layer on, switching atlas, or the retry of the failure
 * notice. Nothing here retries on its own, and that is the point.
 *
 * WHAT IT CANNOT SEE: the first tile of the page. It loads before the prototype is known, so it
 * carries no record of its load; its NEXT load does. The whole premise is pinned against the
 * installed bundle by `frontend/tests/integration/tiles-360-sem-laco-em-404.repro.test.js`, which
 * drives MapLibre's own `getExpiryTimeout` and `_setTileReloadTimer`, extracted from that bundle,
 * and which fails when an upgrade moves any of the three facts.
 *
 * A LEAF ON PURPOSE (zero imports): the page's map and the 360 mini-map both install it, and the
 * test loads it in node with no MapLibre, no config and no DOM.
 */

/** Marks a prototype as already wrapped. `Symbol.for` so two copies of this module agree. */
const GUARDED = Symbol.for('ebgeo.tileExpiryGuard.guarded');

/** On a tile: whether its LAST load brought no data, which is MapLibre's path for a 404. */
export const LOADED_WITHOUT_DATA = Symbol.for('ebgeo.tileExpiryGuard.loadedWithoutData');

/** On a tile: the run-out `expirationTime` it has already been allowed one refresh for. */
const RUN_OUT_REFRESH_SPENT = Symbol.for('ebgeo.tileExpiryGuard.runOutRefreshSpent');

/**
 * Whether a timeout MapLibre computed has already run out: a number that is not positive.
 * `undefined` is "no expiry at all" and is not ours to touch.
 * @param {*} timeout - What `Tile.getExpiryTimeout` returned.
 * @returns {boolean}
 */
export function isRunOutTimeout(timeout) {
    return typeof timeout === 'number' && !(timeout > 0);
}

/**
 * @param {Object} target
 * @param {string|symbol} key
 * @param {*} value
 */
function define(target, key, value) {
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
}

/**
 * Wraps `loadVectorData` and `getExpiryTimeout` on MapLibre's `Tile` prototype, once.
 *
 * Refuses, and touches nothing, when the prototype lacks either method: an upgrade that renamed
 * them would otherwise have this file patch `Object.prototype` from a tile-shaped object, or wrap
 * half of the pair. The repro test is what turns that refusal into a red suite.
 * @param {Object} proto - `Object.getPrototypeOf(tile)`.
 * @returns {boolean} true when the prototype is guarded (now or already).
 */
export function guardTilePrototype(proto) {
    if (!proto || (typeof proto !== 'object' && typeof proto !== 'function')) return false;
    if (proto[GUARDED] === true) return true;
    const originalLoad = proto.loadVectorData;
    const originalTimeout = proto.getExpiryTimeout;
    if (typeof originalLoad !== 'function' || typeof originalTimeout !== 'function') return false;

    function loadVectorData(data, ...rest) {
        this[LOADED_WITHOUT_DATA] = data == null;
        return originalLoad.call(this, data, ...rest);
    }

    function getExpiryTimeout() {
        const timeout = originalTimeout.call(this);
        if (!isRunOutTimeout(timeout)) return timeout;
        // The load that just finished was refused: re-arming now is the loop.
        if (this[LOADED_WITHOUT_DATA] === true) return undefined;
        // A tile that simply outlived its freshness gets MapLibre's immediate refresh, once. A
        // second run-out timeout for the same expiry means the refresh did not renew it.
        if (this[RUN_OUT_REFRESH_SPENT] === this.expirationTime) return undefined;
        this[RUN_OUT_REFRESH_SPENT] = this.expirationTime;
        return timeout;
    }

    define(proto, 'loadVectorData', loadVectorData);
    define(proto, 'getExpiryTimeout', getExpiryTimeout);
    define(proto, GUARDED, true);
    return true;
}

/**
 * Guards the page from a live map, and optionally reports every vector tile load of it.
 *
 * WITHOUT `onTileLoad` the listener leaves after the first tile: the prototype is shared, so there
 * is nothing left for it to do. WITH it, the listener stays and reports `{sourceId, withoutData}`
 * for each load it can read, which is how a caller tells a tile the server REFUSED (`true`) from
 * one it answered, even with zero features (`false`). It is on MapLibre's hot `sourcedata` path,
 * so everything before the callback is a property read.
 * @param {Object} map - A MapLibre map (anything with `on`/`off`).
 * @param {{onTileLoad?: (load: {sourceId: string, withoutData: boolean}) => void}} [options]
 * @returns {() => void} Stops listening. The prototype stays guarded: it belongs to every map.
 */
export function installTileExpiryGuard(map, { onTileLoad } = {}) {
    if (!map || typeof map.on !== 'function' || typeof map.off !== 'function') return () => {};
    const report = typeof onTileLoad === 'function' ? onTileLoad : null;
    let listening = true;
    let tried = false;

    function stop() {
        if (!listening) return;
        listening = false;
        map.off('sourcedata', onSourceData);
    }

    function onSourceData(event) {
        const tile = event?.tile;
        if (!tile || typeof tile !== 'object') return;
        if (!tried) {
            tried = true;
            if (!guardTilePrototype(Object.getPrototypeOf(tile))) {
                console.warn('[tile-expiry-guard] MapLibre tile shape changed: the guard against re-requesting refused tiles is OFF');
            }
        }
        if (!report) {
            stop();
            return;
        }
        const withoutData = tile[LOADED_WITHOUT_DATA];
        if (typeof withoutData !== 'boolean' || typeof event.sourceId !== 'string') return;
        report({ sourceId: event.sourceId, withoutData });
    }

    map.on('sourcedata', onSourceData);
    return stop;
}
