// Path: js/terrain/terrain-basemap.model.js

/**
 * @fileoverview Pure decision for the base map the terrain prefers (node-testable;
 * imports nothing, touches no DOM and no map).
 *
 * WHY THE MECHANISM EXISTS. Measured on 2026-09-04 and summarised in
 * `docs/wiki/desempenho-do-mapa-2d.md`, which links the full report: with terrain
 * on, a RASTER base costs between half and a third of a VECTOR base's frame (1 RTT
 * stack against 2 or 11) and holds 60 fps at rest on the four times slower CPU
 * (19 ms against 34 ms). The raster base pays for that with labels baked into the
 * image and coverage limited to the clip that was generated: outside it the map goes
 * WHITE. So the switch is opt-in, off by default, and gated by an optional coverage
 * box.
 *
 * WHY IT IS A PURE FUNCTION. The rule has eight inputs and three of them are memory
 * that only the running control holds (what base was there before, whether the user
 * has moved since, whether we already switched). Deciding inside the control means
 * every one of those cases needs a map, a style and a running app to exercise; here
 * they are arguments. The control keeps only the executing half.
 *
 * THE TWO PROPERTIES THE RULE PROTECTS:
 *   - the user's own choice, which an automatic switch must never undo behind them;
 *   - the screen, which must not go white because the preferred base does not cover
 *     the current view.
 *
 * WHY `available` IS LOAD-BEARING IN THIS PACKAGE, more than in the local-only line:
 * the switch runs through `applySharedBasemap`, which passes the id through
 * `config.getValidBasemapFallback` BEFORE switching. An id nobody offers therefore
 * does not resolve to "do nothing" down there — it resolves to the FIRST enabled
 * base, silently moving the user's map. The gate has to be here.
 */

/** @enum {string} What the caller should do with the base map. */
export const TERRAIN_BASEMAP_ACTION = {
    /** Leave the base map alone. */
    NONE: 'none',
    /** Move to the preferred base (terrain going on). */
    SWITCH: 'switch',
    /** Move back to the remembered base (terrain going off). */
    RESTORE: 'restore',
};

/**
 * Reads a centre as `{lng, lat}` from either shape the app produces:
 * MapLibre's `LngLat` object and the `[lng, lat]` pair the config writes.
 *
 * The longitude is UNWRAPPED before use: `map.getCenter().lng` does not return to
 * [-180, 180) after the globe is spun, so a map two turns east of home reports
 * lng + 720 and would fall outside its own coverage box.
 *
 * The unwrap runs ONLY on a longitude that needs it. Measured on 2026-09-05: the
 * round trip `((lng + 180) % 360 + 360) % 360 - 180` applied to -58.1, a value
 * already in range, returns -58.099999999999994, and the west edge of a box
 * declared at exactly -58.1 fell outside itself. A coverage box is authored by
 * hand with the same numbers as its edges, so the edge is the likely case, not
 * the rare one.
 *
 * @param {{lng: number, lat: number}|Array<number>|null|undefined} center
 * @returns {{lng: number, lat: number}|null} Null when the centre is unusable
 */
function readCenter(center) {
    if (!center) return null;
    const rawLng = Array.isArray(center) ? center[0] : center.lng;
    const lat = Array.isArray(center) ? center[1] : center.lat;
    if (!Number.isFinite(rawLng) || !Number.isFinite(lat)) return null;
    const lng = rawLng >= -180 && rawLng <= 180
        ? rawLng
        : ((((rawLng + 180) % 360) + 360) % 360) - 180;
    return { lng, lat };
}

/**
 * Is the view centre inside the coverage declared for a base map?
 *
 * NO BOX MEANS GLOBAL: a base with nothing declared is assumed to cover the map,
 * which is what every base in this deployment's catalog does today. Everything else
 * fails CLOSED and answers false, because the cost of a wrong "true" is a white
 * screen while the cost of a wrong "false" is the frame budget the app already lives
 * with.
 *
 * THE ANTIMERIDIAN IS NOT HANDLED, deliberately. Nothing in `frontend/src/` treats it
 * (zero occurrences), so a treatment invented here would be the only one in the house
 * and would have no second reader. A box with `west > east` is rejected whole, which
 * turns the mechanism off for it; the acervo in play covers southern Brazil.
 *
 * @param {Array<number>|null|undefined} bounds - [west, south, east, north] in degrees
 * @param {{lng: number, lat: number}|Array<number>|null|undefined} center
 * @returns {boolean} True when the switch is allowed by coverage
 */
export function isCenterInsideBounds(bounds, center) {
    if (bounds === null || bounds === undefined) return true;
    if (!Array.isArray(bounds) || bounds.length !== 4) return false;
    if (!bounds.every((value) => Number.isFinite(value))) return false;

    const [west, south, east, north] = bounds;
    if (west < -180 || east > 180 || west > east) return false;
    if (south < -90 || north > 90 || south > north) return false;

    const point = readCenter(center);
    if (!point) return false;

    return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

/**
 * Decides what to do with the base map when the terrain is toggled.
 *
 * `remember` is ALWAYS the value the caller should store, never a delta: the caller
 * assigns it and stops thinking. That is what makes the second "turn on" harmless
 * (it returns the base already remembered instead of overwriting it with the base
 * the mechanism itself installed, which is how the first draft lost the user's
 * original base for good).
 *
 * @param {Object} [params]
 * @param {boolean} [params.terrainOn] - The state the terrain is moving INTO
 * @param {string|null} [params.preferred] - Configured base id, null when the mechanism is off
 * @param {string|null} [params.current] - Base id on the map right now
 * @param {string|null} [params.remembered] - Base id stored by a previous switch
 * @param {boolean} [params.userSwitchedSince] - The user changed base while the terrain was on
 * @param {Array<number>|null} [params.bounds] - Coverage of the preferred base, [W,S,E,N]
 * @param {{lng: number, lat: number}|Array<number>|null} [params.center] - View centre
 * @param {Array<string>|null} [params.available] - Base ids that are enabled AND resolve to a style
 * @returns {{action: string, to: string|null, remember: string|null}}
 */
export function decideTerrainBasemap({
    terrainOn = false,
    preferred = null,
    current = null,
    remembered = null,
    userSwitchedSince = false,
    bounds = null,
    center = null,
    available = null,
} = {}) {
    const list = Array.isArray(available) ? available : [];
    const nothing = { action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: null };

    if (!terrainOn) {
        // Turning off closes the window: the memory dies here whatever happens, so
        // the next cycle starts from what is actually on the screen.
        if (!remembered || userSwitchedSince) return nothing;
        if (remembered === current) return nothing;
        if (list.length > 0 && !list.includes(remembered)) return nothing;
        return { action: TERRAIN_BASEMAP_ACTION.RESTORE, to: remembered, remember: null };
    }

    const keep = { action: TERRAIN_BASEMAP_ACTION.NONE, to: null, remember: remembered || null };

    if (!preferred) return nothing;
    // Already switched. Answering `keep` and not `nothing` is the whole point:
    // the base to come back to is the one remembered the FIRST time.
    if (remembered) return keep;
    if (!list.includes(preferred)) return keep;
    if (!current || current === preferred) return keep;
    if (!isCenterInsideBounds(bounds, center)) return keep;

    return { action: TERRAIN_BASEMAP_ACTION.SWITCH, to: preferred, remember: current };
}
