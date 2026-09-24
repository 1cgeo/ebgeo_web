// Path: js/baselayers/style-ready.js

/**
 * @fileoverview Waiting for MapLibre's style, with a timeout that counts only VISIBLE time.
 *
 * MapLibre applies a new style on the NEXT ANIMATION FRAME (`Style.loadJSON` waits on
 * `requestAnimationFrame`), even a style embedded in the bundle, and a browser gives a hidden tab
 * no animation frames. A page that boots or reloads in a background tab has its style parked
 * until the tab is shown. A plain 10 s timer expired in the meantime, and the boot went on over a
 * style that had not loaded: `addSource` and `setProjection` threw "Style is not done loading."
 * and the map came back without the application's layers until the next map switch (owner's
 * report, 2026-09-24; repro in `tests/e2e-ui/boot-em-aba-oculta.spec.js`).
 *
 * Two rules come out of that:
 * - the clock runs only while the document is visible, because a hidden tab is not a failure.
 *   Each visible stretch gets the whole timeout again;
 * - "done loading" is MapLibre's own flag, `style._loaded`, the one `Style._checkLoaded` throws on.
 *   The public `isStyleLoaded()` also waits for every tile and image, so on a slow tile server it
 *   would hold the boot for nothing that `addSource` needs.
 *
 * Zero imports on purpose: node tests drive it with a fake map and a fake document. The MapLibre
 * contract it leans on is read from the installed library in `tests/unit/style-ready.test.js`.
 */

/**
 * Whether MapLibre considers the map's style loaded, which is what `addSource`, `addLayer` and
 * `setProjection` require.
 * @param {Object} map - MapLibre map
 * @returns {boolean}
 */
export function styleDoneLoading(map) {
    return map?.style?._loaded === true;
}

/**
 * Waits for a map event, giving up after `timeoutMs` of VISIBLE time.
 * @param {Object} map - MapLibre map (`on`/`off`)
 * @param {string} eventName
 * @param {{ timeoutMs: number, doc?: Document }} options
 * @returns {Promise<boolean>} true when the event fired, false on timeout
 */
export function waitForMapEvent(map, eventName, { timeoutMs, doc = globalThis.document }) {
    return new Promise((resolve) => {
        let timer = null;
        const onEvent = () => finish(true);
        const arm = () => {
            clearTimeout(timer);
            timer = doc?.visibilityState === 'hidden' ? null : setTimeout(() => finish(false), timeoutMs);
        };
        function finish(fired) {
            clearTimeout(timer);
            map.off(eventName, onEvent);
            doc?.removeEventListener?.('visibilitychange', arm);
            resolve(fired);
        }
        map.on(eventName, onEvent);
        doc?.addEventListener?.('visibilitychange', arm);
        arm();
    });
}

/**
 * Resolves once the style is done loading (at once when it already is).
 * @param {Object} map - MapLibre map
 * @param {{ timeoutMs: number, doc?: Document }} options
 * @returns {Promise<boolean>} false when `timeoutMs` of visible time passed without it
 */
export async function waitForStyleDone(map, options) {
    if (styleDoneLoading(map)) return true;
    return (await waitForMapEvent(map, 'style.load', options)) || styleDoneLoading(map);
}
