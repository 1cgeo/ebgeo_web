// Path: js/layers/image-regen-registry.js

/**
 * @fileoverview Registry mapping a feature `source` to the function that rebuilds
 * its LOCAL-ONLY raster from the feature's synced properties.
 *
 * Military symbols, coordination measures and magnetic declinations render a PNG
 * that is generated on the client (milsymbol / canvas) and stored only in the local
 * image cache — it is NEVER uploaded to the backend, because it is deterministically
 * reconstructible from the feature's properties (SIDC, declination, etc.).
 *
 * That makes the load path 404 whenever the local blob is absent: opening or
 * reconnecting to a remote atlas (snapshot), or switching to a map whose symbols
 * were never regenerated, leaves the blob missing locally — and `getImage()` then
 * tries to fetch it from the server, which has no such blob, yielding the error
 * icon. The incremental remote-op path already regenerates these (see
 * BaseControl#_subscribeRemoteImageRegen), but the snapshot / map-load path did not.
 *
 * Each owning control publishes its regenerator here (same fn it wires for remote
 * ops); `setImages()` (layer_setup.js) consults it to rebuild a missing blob from
 * props BEFORE falling back to a backend fetch. This is a tiny leaf module (no
 * imports) so both tool_manager and layers can use it without an import cycle.
 */

/** @type {Map<string, (feature: Object) => (void|Promise<void>)>} */
const _regenerators = new Map();

/**
 * Registers (or replaces) the raster regenerator for a feature source.
 * @param {string} source - The feature `properties.source` (e.g. 'military_symbol')
 * @param {(feature: Object) => (void|Promise<void>)} fn - Rebuilds + installs the image from props
 */
export function registerImageRegenerator(source, fn) {
    if (source && typeof fn === 'function') _regenerators.set(source, fn);
}

/**
 * @param {string} source
 * @returns {((feature: Object) => (void|Promise<void>))|null} The regenerator, or null if none.
 */
export function getImageRegenerator(source) {
    return _regenerators.get(source) || null;
}
