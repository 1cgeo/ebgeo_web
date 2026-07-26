// Path: js/street_view_tool/navigation/minimap-sync.js

/**
 * @fileoverview Synchronizes Street View 360 state with the MapLibre minimap.
 * Updates camera position icon on the minimap.
 * Navigation targets and cursor overlays have been removed to avoid
 * duplicating the vector tile point layer already visible on the minimap.
 */

/**
 * Manages synchronization between the 360 viewer and the minimap.
 */
export class StreetViewMinimapSync {
    /**
     * @param {maplibregl.Map} minimap - MapLibre map instance for the minimap
     */
    constructor(minimap) {
        this.minimap = minimap;
        this.initialized = false;

        // Current state
        this.cameraPosition = null;
    }

    /**
     * Initializes minimap sync (no extra layers needed).
     *
     * WAITING FOR A ONE-SHOT EVENT IS A RACE, and this one wedged the whole viewer.
     * The body was:
     *
     *     if (!this.minimap.loaded()) {
     *         await new Promise(resolve => this.minimap.on('load', resolve));
     *     }
     *
     * MapLibre fires `load` exactly once. If it fired between the `loaded()` test
     * and the listener being attached — or had already fired — nothing would ever
     * resolve that promise. And this await sits inside the viewer's opening chain
     * (openViewer360WithPhoto → initThreeJS → initNavigator → navigator.initialize
     * → here), so the panorama never even requested its metadata: black screen,
     * no error, no failed request, roughly half the time on a shared deep link,
     * and never on the ordinary click path where the minimap loaded long before.
     *
     * Two guards, because either alone still loses:
     *  - re-CHECK `loaded()` on an interval, so a `load` that fires (or fired) in
     *    the gap is picked up regardless of the listener;
     *  - a TIMEOUT that resolves rather than rejects. The minimap is an aid, not a
     *    prerequisite: a viewer with a stale minimap beats no viewer at all, and
     *    nothing downstream of here may be gated on it.
     *
     * @param {number} [timeoutMs=8000] - Stop waiting for the minimap after this
     */
    async initialize(timeoutMs = 8000) {
        if (this.initialized || !this.minimap) return;

        if (!this.minimap.loaded()) {
            await new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    clearInterval(poll);
                    clearTimeout(timer);
                    this.minimap.off('load', finish);
                    resolve();
                };

                this.minimap.on('load', finish);
                const poll = setInterval(() => {
                    if (this.minimap.loaded()) finish();
                }, 50);
                const timer = setTimeout(() => {
                    console.warn(
                        '[minimap-sync] minimap did not report loaded in',
                        timeoutMs, 'ms — continuing without it'
                    );
                    finish();
                }, timeoutMs);

                // The event may already have fired before this promise existed.
                if (this.minimap.loaded()) finish();
            });
        }

        this.initialized = true;
    }

    /**
     * Updates the camera position indicator on the minimap
     * @param {number} lon - Longitude
     * @param {number} lat - Latitude
     * @param {number} heading - Camera heading in degrees
     */
    setCameraPosition(lon, lat, heading) {
        this.cameraPosition = { lon, lat, heading };

        if (!this.minimap) return;

        // Update the 'selected' layer icon rotation
        if (this.minimap.getLayer('selected')) {
            this.minimap.setLayoutProperty('selected', 'icon-rotate', heading);
        }
    }

    /**
     * Clears all minimap overlays
     */
    clear() {
        this.cameraPosition = null;
    }

    /**
     * Disposes of the minimap sync
     */
    dispose() {
        this.initialized = false;
    }
}
