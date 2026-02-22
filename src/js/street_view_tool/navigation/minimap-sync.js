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
     * Initializes minimap sync (no extra layers needed)
     */
    async initialize() {
        if (this.initialized || !this.minimap) return;

        // Wait for map to be loaded
        if (!this.minimap.loaded()) {
            await new Promise(resolve => this.minimap.on('load', resolve));
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
     * No-op: cursor overlay removed to avoid duplicating vector tile points
     */
    setCursorPosition() {}

    /**
     * No-op: target overlay removed to avoid duplicating vector tile points
     */
    setTargets() {}

    /**
     * No-op: highlighting removed with target overlay
     */
    highlightTarget() {}

    /**
     * No-op: highlighting removed with target overlay
     */
    clearHighlight() {}

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
