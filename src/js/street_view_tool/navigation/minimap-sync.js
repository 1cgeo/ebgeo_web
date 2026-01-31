// Path: js/street_view_tool/navigation/minimap-sync.js

/**
 * @fileoverview Synchronizes Street View 360 state with the MapLibre minimap.
 * Updates camera position, cursor, and target markers on the minimap.
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

        // Source and layer IDs
        this.cursorSourceId = 'streetview-cursor-source';
        this.cursorLayerId = 'streetview-cursor-layer';
        this.targetsSourceId = 'streetview-targets-source';
        this.targetsLayerId = 'streetview-targets-layer';

        // Current state
        this.cameraPosition = null;
        this.cursorPosition = null;
        this.targets = [];
        this.highlightedTargetId = null;
    }

    /**
     * Initializes minimap layers and sources
     */
    async initialize() {
        if (this.initialized || !this.minimap) return;

        try {
            // Wait for map to be loaded
            if (!this.minimap.loaded()) {
                await new Promise(resolve => this.minimap.on('load', resolve));
            }

            // Add cursor source and layer
            if (!this.minimap.getSource(this.cursorSourceId)) {
                this.minimap.addSource(this.cursorSourceId, {
                    type: 'geojson',
                    data: this.createEmptyFeatureCollection()
                });

                this.minimap.addLayer({
                    id: this.cursorLayerId,
                    type: 'circle',
                    source: this.cursorSourceId,
                    paint: {
                        'circle-radius': 6,
                        'circle-color': '#ffffff',
                        'circle-stroke-color': '#0d6efd',
                        'circle-stroke-width': 2,
                        'circle-opacity': 0.8
                    }
                });
            }

            // Add targets source and layer
            if (!this.minimap.getSource(this.targetsSourceId)) {
                this.minimap.addSource(this.targetsSourceId, {
                    type: 'geojson',
                    data: this.createEmptyFeatureCollection()
                });

                this.minimap.addLayer({
                    id: this.targetsLayerId,
                    type: 'circle',
                    source: this.targetsSourceId,
                    paint: {
                        'circle-radius': [
                            'case',
                            ['get', 'highlighted'],
                            8,
                            5
                        ],
                        'circle-color': [
                            'case',
                            ['get', 'highlighted'],
                            '#ffc107',
                            '#6c757d'
                        ],
                        'circle-stroke-color': '#ffffff',
                        'circle-stroke-width': 1,
                        'circle-opacity': 0.9
                    }
                });
            }

            this.initialized = true;
        } catch (error) {
            console.warn('Failed to initialize minimap sync:', error);
        }
    }

    /**
     * Creates an empty GeoJSON FeatureCollection
     * @returns {Object} Empty FeatureCollection
     */
    createEmptyFeatureCollection() {
        return {
            type: 'FeatureCollection',
            features: []
        };
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
     * Updates the cursor position on the minimap
     * @param {number} lon - Longitude
     * @param {number} lat - Latitude
     */
    setCursorPosition(lon, lat) {
        if (lon === null || lat === null) {
            this.cursorPosition = null;
            this.updateCursorSource();
            return;
        }

        this.cursorPosition = { lon, lat };
        this.updateCursorSource();
    }

    /**
     * Updates the cursor source data
     */
    updateCursorSource() {
        if (!this.minimap || !this.initialized) return;

        const source = this.minimap.getSource(this.cursorSourceId);
        if (!source) return;

        if (!this.cursorPosition) {
            source.setData(this.createEmptyFeatureCollection());
            return;
        }

        source.setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [this.cursorPosition.lon, this.cursorPosition.lat]
                },
                properties: {}
            }]
        });
    }

    /**
     * Sets the navigation targets to display on the minimap
     * @param {Array} targets - Array of target objects with lon/lat
     */
    setTargets(targets) {
        this.targets = targets || [];
        this.updateTargetsSource();
    }

    /**
     * Updates the targets source data
     */
    updateTargetsSource() {
        if (!this.minimap || !this.initialized) return;

        const source = this.minimap.getSource(this.targetsSourceId);
        if (!source) return;

        const features = this.targets.map(target => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [target.lon, target.lat]
            },
            properties: {
                id: target.id,
                highlighted: target.id === this.highlightedTargetId
            }
        }));

        source.setData({
            type: 'FeatureCollection',
            features
        });
    }

    /**
     * Highlights a specific target on the minimap
     * @param {string} targetId - Target ID to highlight
     */
    highlightTarget(targetId) {
        this.highlightedTargetId = targetId;
        this.updateTargetsSource();
    }

    /**
     * Clears the target highlight
     */
    clearHighlight() {
        this.highlightedTargetId = null;
        this.updateTargetsSource();
    }

    /**
     * Clears all minimap overlays
     */
    clear() {
        this.cursorPosition = null;
        this.targets = [];
        this.highlightedTargetId = null;

        this.updateCursorSource();
        this.updateTargetsSource();
    }

    /**
     * Disposes of the minimap sync
     */
    dispose() {
        if (!this.minimap || !this.initialized) return;

        try {
            // Remove layers
            if (this.minimap.getLayer(this.cursorLayerId)) {
                this.minimap.removeLayer(this.cursorLayerId);
            }
            if (this.minimap.getLayer(this.targetsLayerId)) {
                this.minimap.removeLayer(this.targetsLayerId);
            }

            // Remove sources
            if (this.minimap.getSource(this.cursorSourceId)) {
                this.minimap.removeSource(this.cursorSourceId);
            }
            if (this.minimap.getSource(this.targetsSourceId)) {
                this.minimap.removeSource(this.targetsSourceId);
            }
        } catch (error) {
            console.warn('Error disposing minimap sync:', error);
        }

        this.initialized = false;
    }
}
