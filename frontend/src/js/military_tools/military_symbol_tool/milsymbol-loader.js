// Path: js/military_tools/military_symbol_tool/milsymbol-loader.js

/**
 * @fileoverview On-demand loader for the milsymbol global (`window.ms`).
 *
 * WHY THIS EXISTS. `milsymbol.min.js` is 855 kB and used to be an eager
 * `<script>` in `index.html`, 14,6% of the map page's eager JavaScript. Measured
 * with a Proxy on `window.ms` in a real browser: it is never read during boot,
 * not even on F5 with military symbols already on the map. The first read is the
 * first symbol drawn.
 *
 * THE RACE THIS CLOSES, and why the loader alone is not enough. `window.ms` is
 * not only read by a user gesture: `layers/layer_setup.js` regenerates symbol
 * PNGs when a remote atlas snapshot arrives, with nobody touching anything. If
 * the script were simply removed from `index.html`, that path would find `ms`
 * undefined. So the await belongs at the top of `generateSymbol`, the single
 * chokepoint every caller passes through — not at each call site, which is the
 * version that forgets one.
 *
 * WHY NOT `map_3d.js`'s loadScript. That one resolves as soon as a `<script>`
 * with the same src exists in the DOM, which is true from the moment it is
 * appended and long before it has executed. Two concurrent callers therefore get
 * a resolved promise while `window.ms` is still undefined. Here the promise is
 * memoized instead: everyone awaits the SAME load, and a failure clears the memo
 * so a later attempt can retry rather than inheriting a rejected promise forever.
 *
 * @module military_tools/military_symbol_tool/milsymbol-loader
 */

const MILSYMBOL_SRC = '/vendors/milsymbol.min.js';

/** In-flight (or settled) load. Memoized so concurrent callers share one fetch. */
let carregando = null;

/**
 * Ensures `window.ms` is available, loading the vendor bundle on first use.
 *
 * Safe to call on every symbol generation: after the first resolve it is a
 * property read.
 *
 * @returns {Promise<Object>} the milsymbol global
 * @throws {Error} when the bundle cannot be loaded, or loads without defining `ms`
 */
export function ensureMilsymbol() {
    if (typeof globalThis.ms !== 'undefined') return Promise.resolve(globalThis.ms);
    if (carregando) return carregando;

    carregando = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MILSYMBOL_SRC;
        script.async = true;
        script.onload = () => {
            // `onload` says the file ran, not that it defined what we need: a
            // wrong path served as HTML by the dev server also fires onload.
            if (typeof globalThis.ms === 'undefined') {
                reject(new Error(`${MILSYMBOL_SRC} carregou sem definir "ms"`));
                return;
            }
            resolve(globalThis.ms);
        };
        script.onerror = () => reject(new Error(`Falha ao carregar ${MILSYMBOL_SRC}`));
        document.head.appendChild(script);
    }).catch((err) => {
        // Drop the memo so a later draw can try again instead of inheriting a
        // permanently rejected promise (a transient network blip would otherwise
        // disable military symbols for the whole session).
        carregando = null;
        throw err;
    });

    return carregando;
}

/**
 * Test seam: forgets the memoized load.
 * @returns {void}
 */
export function resetMilsymbolLoader() {
    carregando = null;
}
