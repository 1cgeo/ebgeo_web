// Path: js/street_view_tool/saved_photos_markers.js

/**
 * @fileoverview Manages markers for 360 photos with saved data (orientations or markers).
 * These markers appear on the main map when the 360 viewer is active and allow
 * direct access to specific photos without needing to click on the line layer.
 */

import { getAllOrientations, getAllMarkers360 } from '../store/streetview360.operations.js';
import { getEventBus } from '../store/services.js';
import { EventTypes } from '../events/event_types.js';
import config from '../config.js';

// Primary color for saved photo markers (blue to differentiate from orange streetview markers)
const SAVED_PHOTO_MARKER_COLOR = '#3b82f6';

// Separator layer ID - markers are added before this layer to ensure correct z-order
const STREETVIEW_MARKERS_SEPARATOR = 'streetview-markers-separator';

/**
 * Manages markers for 360 photos with saved data on the main map.
 * Displays clustered markers that allow direct access to specific photos.
 */
class SavedPhotosMarkers {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} streetViewControl - Reference to the parent street view control
     */
    constructor(map, streetViewControl) {
        this.map = map;
        this.streetViewControl = streetViewControl;

        // Layer IDs
        this.sourceId = 'saved-photos-markers-source';
        this.markersLayer = 'saved-photos-markers-pins';
        this.badgeLayer = 'saved-photos-markers-badge';
        this.badgeTextLayer = 'saved-photos-markers-badge-text';

        // Cached photo data
        this.photoDataMap = new Map(); // photoName -> { lon, lat, markerCount, hasOrientation }

        // Metadata cache
        this.metadataCache = new Map();

        // Bind methods
        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.handleDataChanged = this.handleDataChanged.bind(this);

        // Listen for data changes
        const eventBus = getEventBus();
        eventBus.on(EventTypes.MARKERS_360_CHANGED, this.handleDataChanged);
        eventBus.on(EventTypes.ORIENTATION_360_SAVED, this.handleDataChanged);
        eventBus.on(EventTypes.ORIENTATION_360_CLEARED, this.handleDataChanged);
    }

    /**
     * Check if the street view control is active
     * @returns {boolean}
     */
    get isActive() {
        return this.streetViewControl?.isActive ?? false;
    }

    /**
     * Handle data changes to update markers
     */
    async handleDataChanged() {
        if (this.isActive) {
            await this.loadMarkers();
        }
    }

    /**
     * Load marker image (SVG pin with camera icon) into the map
     * @returns {Promise<void>}
     */
    async loadMarkerImage() {
        // Main marker SVG - blue pin with camera icon
        const markerPinSvg = `<svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="20" cy="49" rx="10" ry="3" fill="#000000" opacity="0.3"/>
            <path d="M20,2 C11,2 4,9 4,18 C4,27.5 20,47 20,47 C20,47 36,27.5 36,18 C36,9 29,2 20,2 Z" fill="${SAVED_PHOTO_MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/>
            <circle cx="20" cy="17" r="9" fill="#ffffff" opacity="0.95"/>
            <g transform="translate(20, 17)">
                <!-- Camera icon -->
                <rect x="-6" y="-4" width="12" height="8" rx="1" fill="${SAVED_PHOTO_MARKER_COLOR}"/>
                <circle cx="0" cy="0" r="3" fill="#ffffff"/>
                <circle cx="0" cy="0" r="1.5" fill="${SAVED_PHOTO_MARKER_COLOR}"/>
                <rect x="-2" y="-6" width="4" height="2" rx="0.5" fill="${SAVED_PHOTO_MARKER_COLOR}"/>
            </g>
        </svg>`;

        return new Promise((resolve, reject) => {
            const img = new Image(40, 52);
            img.onload = () => {
                try {
                    if (!this.map.hasImage('saved-photo-marker')) {
                        this.map.addImage('saved-photo-marker', img, { pixelRatio: 2 });
                    }
                    resolve();
                } catch (error) {
                    console.error('Error adding saved photo marker image to map:', error);
                    reject(error);
                }
            };
            img.onerror = (error) => {
                console.error('Error loading saved photo marker SVG:', error);
                reject(new Error('Failed to load saved photo marker image'));
            };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markerPinSvg);
        });
    }

    /**
     * Fetches metadata for a photo
     * @param {string} photoName - Photo name
     * @returns {Promise<Object|null>} Metadata or null
     */
    async fetchMetadata(photoName) {
        if (this.metadataCache.has(photoName)) {
            return this.metadataCache.get(photoName);
        }

        try {
            const MOCK_MODE = config.features?.street_view_mock ?? false;
            const METADATA_LOCATION = MOCK_MODE ? './360/METADATA' : './street_view/METADATA';

            const response = await fetch(`${METADATA_LOCATION}/${photoName}.json`);
            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            this.metadataCache.set(photoName, data);
            return data;
        } catch (error) {
            console.warn(`Failed to fetch metadata for ${photoName}:`, error);
            return null;
        }
    }

    /**
     * Load saved photos data and create map layers
     */
    async loadMarkers() {
        // Get all saved orientations and markers
        const [orientations, markers] = await Promise.all([
            getAllOrientations(),
            getAllMarkers360()
        ]);

        // Build photo data map
        this.photoDataMap.clear();

        // Process orientations
        for (const photoName of Object.keys(orientations)) {
            if (!this.photoDataMap.has(photoName)) {
                this.photoDataMap.set(photoName, {
                    photoName,
                    markerCount: 0,
                    hasOrientation: true
                });
            } else {
                this.photoDataMap.get(photoName).hasOrientation = true;
            }
        }

        // Process markers (count by photo)
        for (const marker of markers) {
            const photoName = marker.photoName;
            if (!this.photoDataMap.has(photoName)) {
                this.photoDataMap.set(photoName, {
                    photoName,
                    markerCount: 1,
                    hasOrientation: false
                });
            } else {
                this.photoDataMap.get(photoName).markerCount++;
            }
        }

        // If no saved data, remove layers and return
        if (this.photoDataMap.size === 0) {
            this.removeLayers();
            return;
        }

        // Fetch positions from metadata for each photo
        const features = [];
        for (const [photoName, data] of this.photoDataMap) {
            const metadata = await this.fetchMetadata(photoName);
            if (metadata?.camera) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [metadata.camera.lon, metadata.camera.lat]
                    },
                    properties: {
                        photoName,
                        markerCount: data.markerCount,
                        hasOrientation: data.hasOrientation,
                        totalCount: data.markerCount + (data.hasOrientation ? 1 : 0),
                        hasBadge: data.markerCount > 0
                    }
                });
            }
        }

        if (features.length === 0) {
            this.removeLayers();
            return;
        }

        const geojson = {
            type: 'FeatureCollection',
            features
        };

        if (!this.map.getSource(this.sourceId)) {
            // Add source
            this.map.addSource(this.sourceId, {
                type: 'geojson',
                data: geojson
            });

            // Get separator layer for z-ordering
            const beforeId = this.map.getLayer(STREETVIEW_MARKERS_SEPARATOR)
                ? STREETVIEW_MARKERS_SEPARATOR
                : undefined;

            // Load marker icon
            await this.loadMarkerImage();

            // Layer 1: Marker pins
            this.map.addLayer({
                id: this.markersLayer,
                type: 'symbol',
                source: this.sourceId,
                layout: {
                    'icon-image': 'saved-photo-marker',
                    'icon-size': 1.4,
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'visibility': 'none'
                },
                paint: {
                    'icon-opacity': 1.0
                }
            }, beforeId);

            // Layer 2: Badge background (only for markers with count > 0)
            this.map.addLayer({
                id: this.badgeLayer,
                type: 'circle',
                source: this.sourceId,
                filter: ['>', ['get', 'markerCount'], 0],
                layout: {
                    'visibility': 'none'
                },
                paint: {
                    'circle-radius': 9,
                    'circle-color': '#ef4444', // Red badge
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-translate': [12, -42] // Position at top-right of marker
                }
            }, beforeId);

            // Layer 3: Badge text (marker count)
            this.map.addLayer({
                id: this.badgeTextLayer,
                type: 'symbol',
                source: this.sourceId,
                filter: ['>', ['get', 'markerCount'], 0],
                layout: {
                    'text-field': ['to-string', ['get', 'markerCount']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 11,
                    'text-offset': [1.09, -3.82], // Match badge position: [12/11, -42/11] ems
                    'text-anchor': 'center',
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff'
                }
            }, beforeId);

        } else {
            // Update existing source data
            this.map.getSource(this.sourceId).setData(geojson);
        }
    }

    /**
     * Remove all layers and source
     */
    removeLayers() {
        if (this.map.getLayer(this.badgeTextLayer)) {
            this.map.removeLayer(this.badgeTextLayer);
        }
        if (this.map.getLayer(this.badgeLayer)) {
            this.map.removeLayer(this.badgeLayer);
        }
        if (this.map.getLayer(this.markersLayer)) {
            this.map.removeLayer(this.markersLayer);
        }
        if (this.map.getSource(this.sourceId)) {
            this.map.removeSource(this.sourceId);
        }
    }

    /**
     * Show markers and enable event listeners
     */
    show() {
        if (!this.map.getLayer(this.markersLayer)) return;

        // Add event listeners
        this.map.on('click', this.markersLayer, this.handleMarkerClick);
        this.map.on('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Set visibility
        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.badgeLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.badgeTextLayer, 'visibility', 'visible');
    }

    /**
     * Hide markers and remove event listeners
     */
    hide() {
        if (!this.map.getLayer(this.markersLayer)) return;

        // Remove event listeners
        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Set visibility
        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.badgeLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.badgeTextLayer, 'visibility', 'none');
    }

    /**
     * Handle click on marker - open photo directly
     * @param {Object} e - Map click event
     */
    async handleMarkerClick(e) {
        if (!this.isActive) return;

        // Skip if click was already consumed
        if (window._markerClickConsumed) return;

        // Mark click as consumed
        window._markerClickConsumed = true;
        setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0);

        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        const feature = e.features[0];
        const photoName = feature.properties.photoName;

        // Open the photo directly (no preview popup)
        await this.openPhoto(photoName);
    }

    /**
     * Open a photo in the 360 viewer
     * @param {string} photoName - Photo name to open
     */
    async openPhoto(photoName) {
        const { openViewer360WithPhoto, isStreetView360Open, navigateToTarget } = await import('./street_view_viewer.js');

        if (isStreetView360Open()) {
            await navigateToTarget(photoName);
        } else {
            await openViewer360WithPhoto(photoName, {
                miniMap: this.streetViewControl?.miniMap,
                controlInstance: this.streetViewControl
            });
        }
    }

    /**
     * Show pointer cursor on hover
     */
    showHoverCursor() {
        if (!this.isActive) return;
        this.map.getCanvas().style.cursor = 'pointer';
    }

    /**
     * Hide pointer cursor on mouse leave
     */
    hideHoverCursor() {
        if (!this.isActive) return;
        this.map.getCanvas().style.cursor = '';
    }

    /**
     * Dispose of the markers manager
     */
    dispose() {
        const eventBus = getEventBus();
        eventBus.off(EventTypes.MARKERS_360_CHANGED, this.handleDataChanged);
        eventBus.off(EventTypes.ORIENTATION_360_SAVED, this.handleDataChanged);
        eventBus.off(EventTypes.ORIENTATION_360_CLEARED, this.handleDataChanged);

        this.hide();
        this.removeLayers();
        this.photoDataMap.clear();
        this.metadataCache.clear();
    }
}

export default SavedPhotosMarkers;
