// Path: js/vendor/shpjs.js

/**
 * @module vendor/shpjs
 * @description Single entry point of shpjs (6.2.0), with the one ES2023 method it needs made sure.
 *
 * WHY THIS POINT EXISTS FOR A PACKAGE WITH ONE CALLER. `shpjs` calls `Array.prototype.toReversed`
 * (Chrome and Edge 110, Firefox 115) in the second pass of `handleRings` (`shpjs/lib/parseShp.js`),
 * the pass a polygon with a hole takes when its rings come in the non-ESRI orientation, which is
 * how tools that start from GeoJSON often write them. `@vitejs/plugin-legacy` (`vite.config.js`)
 * serves the MODERN bundle, with no polyfill (`modernPolyfills: false`), to every browser that has
 * `import.meta.resolve`, so Chrome and Edge 105 to 109 get it and lack the method. The 109 is the
 * last Chrome of Windows 7 and 8.1. The import ended in "Erro ao processar Shapefile:
 * o.ring.toReversed is not a function", with nothing imported (measured on the production bundle
 * with that JS surface simulated; current Chromium and Firefox import it).
 *
 * THE METHOD IS DEFINED ONLY WHERE IT IS MISSING, with the native descriptor (not enumerable,
 * writable, configurable), so a browser that has it keeps its own. It lives HERE, and not in the
 * import control, so that any future caller of the package gets it too. The alternative of
 * `modernPolyfills` in the legacy plugin was set aside: it puts a polyfill chunk in front of every
 * page for every modern browser, to serve one line of one library.
 *
 * Other ES2023+ uses in the emitted bundle were checked on 2026-09-23 and are not reachable: the
 * Cesium `toSorted` runs only for an ARRAY of key modifiers, which this app never passes, and the
 * iterator helper in `@turf/jsts` sits in a `HashMap.entrySet` that `turf.buffer` never calls.
 *
 * Guard: `tests/unit/shapefile-sem-toreversed.repro.test.js`.
 */

/**
 * `Array.prototype.toReversed`: a reversed shallow copy, the receiver untouched. Like the native,
 * it reads through `Get`, so a hole becomes `undefined` in a dense result, and an array-like works.
 * @this {ArrayLike<*>}
 * @returns {Array<*>}
 */
function toReversed() {
    const source = Object(this);
    const length = Math.min(Math.max(Math.trunc(Number(source.length)) || 0, 0), Number.MAX_SAFE_INTEGER);
    const copy = new Array(length);
    for (let i = 0; i < length; i++) copy[i] = source[length - 1 - i];
    return copy;
}

if (typeof Array.prototype.toReversed !== 'function') {
    // eslint-disable-next-line no-extend-native -- the ES2023 method, only where the browser lacks it (see above)
    Object.defineProperty(Array.prototype, 'toReversed', {
        value: toReversed,
        writable: true,
        configurable: true,
        enumerable: false,
    });
}

export { default } from 'shpjs';
