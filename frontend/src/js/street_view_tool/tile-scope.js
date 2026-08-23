// Path: js/street_view_tool/tile-scope.js

/**
 * @fileoverview The ATLAS SCOPE of a 360 read, carried on the URL — the ONE place that knows how
 * `?atlasId=` is written onto an address of the 360 service.
 *
 * WHAT THIS EXISTS FOR. The decision of 2026-08-18 ("o emprestimo por atlas alcanca o 360, e o
 * UUID do atlas nao e senha") made every read route honour `?atlasId=`: `validate` →
 * `liftOptionalAtlasId` → `requireAtlasScopeWhenPresent`, which composes a real
 * `requireAtlasPermission('read')`. The server half shipped; the client half shipped ONLY for the
 * MVT tiles. `/api/config` publishes `${sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf` with no `atlasId`,
 * and nothing on the client added one — so a 360 project LENT by an atlas was invisible on the 2D
 * layer, in every deploy. This module is the client half.
 *
 * WHY THE STAMP IS ONE FUNCTION AND NOT A `?atlasId=` PER CALL SITE. The half-shipped state above
 * was the worst possible one: the tiles carried the scope and the fourteen other reads did not, so
 * the map PROVED a borrowed panorama existed (a dot on the 2D layer) and every other surface
 * refused it — the click resolved `/photos/nearest` with no scope, got a 404, and opened nothing.
 * A rule spread over N call sites fails exactly like that, at the site nobody remembered. The
 * whole file name is historical: the module is named after tiles because they were the first
 * caller, and {@link stampAtlasOnUrl} is the general one both 360 clients (the map's
 * `streetview-api.service.js` and the studio's `calibration/api.js`) build every read address
 * with.
 *
 * WHY ON THE SOURCE URL AND NOT IN `transformRequest`, WHICH ALREADY EXISTS. Measured in the
 * vendored bundle (`public/vendors/maplibre-gl.js`), and the measurement decides it:
 *
 *   - `VectorTileSource.loadTile` builds the address from the SOURCE template
 *     (`e.tileID.canonical.url(this.tiles, ...)`) and only then hands it to
 *     `this.map._requestManager.transformRequest(t, "Tile")`. The transformed value is worker
 *     payload and nothing else.
 *   - `TileManager._addTile(e)` answers from `this._inViewTiles.getTileById(e.key)` and
 *     `this._outOfViewCache.getAndRemove(e)`. BOTH are keyed by `OverscaledTileID.key`, that is
 *     by z/x/y/wrap. The transformed URL is in no cache key anywhere.
 *
 * So a tile already loaded under atlas A is handed back under atlas B without a request, and
 * `transformRequest` is never consulted again. Stamping there would look right, produce the
 * correct URL on the first fetch of each tile, and still serve A's panoramas inside B. That is
 * exactly the cross-scope reuse the 2026-08-18 decision refused when it moved the `ETag` to a
 * hash of the BODY. The transformRequest path is therefore eliminated, not preferred-against.
 *
 * WHY `setTiles()` IS NOT THE INVALIDATION EITHER, and this one is a trap. For a RASTER source
 * `setSourceProperty` calls `load(!0)`, which fires `content` with `sourceDataChanged: true`, and
 * `TileManager.reload(true)` re-requests every tile as `"expired"` → `"LT"` → network. For a
 * VECTOR source `setSourceProperty` calls `load()` with NO argument: `sourceDataChanged` is
 * undefined, tiles are reloaded as `"reloading"`, and `loadTile` then takes the
 * `e.actor && "expired" !== e.state` branch and sends `"RT"`, whose worker handler
 * (`reloadTile`) re-parses `this.tileState.getLoaded(uid)` and never touches the network. A
 * `setTiles()` on the 360 source would change the template and re-serve the previous atlas's
 * bytes.
 *
 * The only invalidation that actually destroys the cache is removing the source, which tears down
 * the whole `TileManager` (in-view tiles, out-of-view cache and the worker's loaded state) — hence
 * {@link rebuildScopedSource}.
 *
 * THE UUID IS NOT A CREDENTIAL and nothing here treats it as one. This module only says which
 * atlas is in focus; `requireAtlasScopeWhenPresent` decides, and an unreachable atlas propagates
 * the gate's 404. There is deliberately no catch anywhere on this path that turns that 404 into
 * a success.
 *
 * A LEAF ON PURPOSE: the atlas id arrives as an argument, so this file imports nothing and the
 * two behaviours can be measured without a config, a session or a map.
 */

/**
 * The same vector-source spec with `atlasId` on every tile template, or the SPEC ITSELF when
 * there is nothing to stamp.
 *
 * NO ATLAS IN FOCUS RETURNS THE INPUT BY IDENTITY, and that is the negative control of the whole
 * feature: the anonymous caller and the logged-in caller with no atlas open must produce the URL
 * they produce today, character for character. A stamp of `atlasId=` with an empty value would
 * not merely be noise — `atlasScopeQuerySchema` validates the field as a GUID, so the empty
 * string dies as a 422 and the layer disappears for everyone.
 *
 * STRING CONCATENATION, NEVER `new URL()`, for the same reason `withAbsoluteTiles` gives: the URL
 * constructor percent-encodes the braces of `{z}/{x}/{y}` and MapLibre substitutes them by
 * literal text replacement, so `%7Bz%7D` would never be replaced.
 *
 * The stamp goes on whatever origin the template names, cross-origin included, and that is not
 * the `assets3d` rule inverted: there a cross-origin address means a THIRD PARTY, while here the
 * template comes from `/api/config` and names our own 360 service (`SV360_SERVICE_URL`), which is
 * the one process that reads the parameter.
 *
 * @param {Object} source - A MapLibre vector-source spec (`{ type, tiles: [...] }`).
 * @param {string|null} [atlasId] - The atlas in focus, or null/'' when there is none.
 * @returns {Object} The stamped spec, or `source` unchanged.
 */
export function stampAtlasOnTiles(source, atlasId) {
    if (typeof atlasId !== 'string' || atlasId === '') return source;
    if (!Array.isArray(source?.tiles) || source.tiles.length === 0) return source;
    return {
        ...source,
        tiles: source.tiles.map((t) => (typeof t === 'string' ? stampAtlasOnUrl(t, atlasId) : t)),
    };
}

/**
 * The same URL with `atlasId` in the query, preserving an existing query and an existing hash.
 *
 * NO ATLAS IN FOCUS RETURNS THE INPUT UNCHANGED, and that guard belongs HERE rather than in each
 * caller for the same reason the whole module exists: "no atlas" is the NORMAL state (the
 * anonymous visitor, the local map, the calibration studio), so the branch that must never
 * regress is the one that runs most. A stamp of `atlasId=` with an empty or `undefined` value
 * would not be harmless noise — `atlasScopeQuerySchema` validates the field as a GUID, so
 * `atlasId=` dies as a 422 and `atlasId=undefined` with it, taking the read down for everyone
 * including the caller who never had an atlas.
 *
 * Idempotent: an address that already carries an `atlasId` comes back untouched, so a second
 * pass cannot produce two of them (the second would win in Express and Joi would still accept it,
 * which is precisely the kind of silent disagreement that is cheaper to make impossible).
 *
 * STRING CONCATENATION, NEVER `new URL()`: this is the same function the tile templates go
 * through, and the URL constructor percent-encodes the braces of `{z}/{x}/{y}`, which MapLibre
 * substitutes by literal text replacement.
 * @param {string} url - Any address of the 360 service, relative or absolute.
 * @param {string|null} [atlasId] - The atlas in focus, or null/'' when there is none.
 * @returns {string} The stamped URL, or `url` unchanged.
 */
export function stampAtlasOnUrl(url, atlasId) {
    if (typeof atlasId !== 'string' || atlasId === '') return url;
    if (typeof url !== 'string' || url === '' || /[?&]atlasId=/.test(url)) return url;
    const [semHash, ...resto] = url.split('#');
    const hash = resto.length > 0 ? `#${resto.join('#')}` : '';
    const separador = semHash.includes('?') ? '&' : '?';
    return `${semHash}${separador}atlasId=${encodeURIComponent(atlasId)}${hash}`;
}

/**
 * Destroys a tile source and builds it again from a new spec, putting every layer that used it
 * back where it was.
 *
 * THIS IS THE INVALIDATION, and the reason it is a demolition instead of a `setTiles()` is
 * measured in the fileoverview: for a vector source `setTiles()` re-parses the bytes already in
 * the worker and never re-fetches. `removeSource` is what drops the `TileManager` with its
 * in-view tiles and its out-of-view cache, so the next render has nothing to reuse and every
 * tile is fetched again under the new atlas.
 *
 * THE LAYERS COME BACK IN THE SAME PLACE, not on top of the stack. Each one is captured from
 * `map.getStyle()` — which serializes the LIVE spec, so a filter set at runtime (the minimap's
 * `selected` highlight) survives — together with the id of the first following layer that does
 * NOT belong to this source. Re-adding each layer before that id reproduces the previous
 * stacking exactly, including the case of a layer that was last (no `beforeId`, appended).
 *
 * Returns false, and touches nothing, when the source is not on this map: the 360 sources are
 * created lazily (the trajectory on activation, the points when the minimap loads), so "the
 * atlas changed before the layer existed" is a normal state and not an error.
 *
 * @param {Object} map - A MapLibre map (or anything with the same five methods).
 * @param {string} sourceId
 * @param {Object} sourceSpec - The replacement spec, already stamped.
 * @returns {boolean} true when the source was rebuilt.
 */
export function rebuildScopedSource(map, sourceId, sourceSpec) {
    if (!map || !sourceId || !sourceSpec) return false;
    if (typeof map.getSource !== 'function' || !map.getSource(sourceId)) return false;

    let camadas;
    try {
        camadas = map.getStyle()?.layers ?? [];
    } catch {
        // The style is not ready to be serialized. Doing half of this would leave the map
        // without the layer; doing none of it leaves the previous atlas's tiles up, which the
        // caller reports by keeping its scope stamp unchanged and trying again.
        return false;
    }

    const alvo = [];
    for (let i = 0; i < camadas.length; i++) {
        if (camadas[i]?.source !== sourceId) continue;
        let beforeId;
        for (let j = i + 1; j < camadas.length; j++) {
            if (camadas[j]?.source !== sourceId) {
                beforeId = camadas[j].id;
                break;
            }
        }
        alvo.push({ spec: camadas[i], beforeId });
    }

    for (const { spec } of alvo) map.removeLayer(spec.id);
    map.removeSource(sourceId);
    map.addSource(sourceId, sourceSpec);
    for (const { spec, beforeId } of alvo) map.addLayer(spec, beforeId);
    return true;
}
