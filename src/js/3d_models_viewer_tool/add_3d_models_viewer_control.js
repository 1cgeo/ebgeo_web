// Path: js/3d_models_viewer_tool/add_3d_models_viewer_control.js

import config from '../config.js';
import { URLRouter } from '../url_router.js';
import { getEventBus, getAllMarkers, getAllMeasurements, getAllViewsheds } from '../store';
import { EventTypes } from '../events/event_types.js';

// Initialize click consumed flag if not already set
// This flag prevents click propagation between overlapping marker layers
if (typeof window._markerClickConsumed === 'undefined') {
    window._markerClickConsumed = false;
}

// Clustering configuration
const CLUSTER_CONFIG = {
    maxZoom: 14,
    radius: 50
};

// Cluster size breakpoints based on point count
const CLUSTER_SIZE_STEPS = {
    small: { maxCount: 10, radius: 18 },
    medium: { maxCount: 50, radius: 22 },
    large: { radius: 26 }
};

// Application primary color
const PRIMARY_COLOR = '#508D4E';

// Video popup dimensions (16:9 aspect ratio)
const _VIDEO_POPUP_WIDTH = 320;
const _VIDEO_POPUP_HEIGHT = 180;

// Marker pin vertical offset for popup positioning
const MARKER_POPUP_OFFSET = 55;

// Badge color for feature count
const BADGE_COLOR = '#e53935';

/**
 * Gets feature counts grouped by tilesetId.
 * @returns {Promise<Map<string, number>>} Map of tilesetId to feature count
 */
async function getFeatureCountsByTileset() {
    const counts = new Map();

    try {
        const [markers, measurements, viewsheds] = await Promise.all([
            getAllMarkers(),
            getAllMeasurements(),
            getAllViewsheds()
        ]);

        // Count markers
        for (const marker of (markers || [])) {
            const current = counts.get(marker.tilesetId) || 0;
            counts.set(marker.tilesetId, current + 1);
        }

        // Count measurements
        for (const measurement of (measurements || [])) {
            const current = counts.get(measurement.tilesetId) || 0;
            counts.set(measurement.tilesetId, current + 1);
        }

        // Count viewsheds
        for (const viewshed of (viewsheds || [])) {
            const current = counts.get(viewshed.tilesetId) || 0;
            counts.set(viewshed.tilesetId, current + 1);
        }
    } catch (error) {
        console.warn('Error getting feature counts:', error);
    }

    return counts;
}

/**
 * Control for viewing 3D models on the map.
 * Displays clustered markers with video preview popups.
 */
class Add3DModelsViewerControl {
    /**
     * @param {Object} toolManager - Reference to the tool manager
     */
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.markersVisible = false;
        this.map = null;
        this.container = null;

        // Layer IDs
        this.sourceId = '3d-models-source';
        this.clustersLayer = '3d-models-clusters';
        this.clusterCountLayer = '3d-models-cluster-count';
        this.markersLayer = '3d-models-markers';
        this.labelsLayer = '3d-models-labels';
        this.badgeCircleLayer = '3d-models-badge-circle';
        this.badgeTextLayer = '3d-models-badge-text';

        // Popup state
        this.previewPopup = null;
        this.activeVideoElement = null;
        this.currentOpenTilesetId = null;

        // Close button listener tracking
        this._closeListenerAttached = false;

        // Bind methods
        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.handleClusterClick = this.handleClusterClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.closeViewer = this.closeViewer.bind(this);
        this.handlePopupClose = this.handlePopupClose.bind(this);
        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._handleFeaturesChanged = this._handleFeaturesChanged.bind(this);
    }

    /**
     * Called when control is added to the map
     * @param {Object} map - MapLibre map instance
     * @returns {HTMLElement} Control container element
     */
    onAdd(map) {
        this.map = map;
        // UI is now handled by BottomControlsControl - return empty container
        this.container = document.createElement('div');
        this.container.style.display = 'none';

        // Listen for base layer changes to reload layers if active
        getEventBus().on(EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);

        // Listen for 3D feature changes to update badges
        getEventBus().on(EventTypes.MARKERS_3D_CHANGED, this._handleFeaturesChanged);
        getEventBus().on(EventTypes.MEASUREMENTS_3D_CHANGED, this._handleFeaturesChanged);
        getEventBus().on(EventTypes.VIEWSHEDS_3D_CHANGED, this._handleFeaturesChanged);

        return this.container;
    }

    /**
     * Handles 3D feature changes to update badge counts.
     * @private
     */
    async _handleFeaturesChanged() {
        if (this.markersVisible && this.map.getSource(this.sourceId)) {
            await this._updateBadgeCounts();
        }
    }

    /**
     * Updates badge counts by refreshing the source data.
     * @private
     */
    async _updateBadgeCounts() {
        const featureCounts = await getFeatureCountsByTileset();

        const features = config.tilesets.map(tileset => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [tileset.locate.lon, tileset.locate.lat]
            },
            properties: {
                tilesetId: tileset.id,
                name: tileset.name,
                dataCaptura: tileset.data_captura || null,
                previewVideo: tileset.previewVideo || null,
                previewThumbnail: tileset.previewThumbnail || null,
                featureCount: featureCounts.get(tileset.id) || 0
            }
        }));

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData(geojson);
        }
    }

    /**
     * Handles base layer change event.
     * Reloads marker layers if the viewer is active.
     * @private
     */
    async _handleBaseLayerChanged() {
        if (this.isActive && this.markersVisible) {
            // Layers were removed by setStyle, need to reload
            // Reset markersVisible flag since layers no longer exist
            this.markersVisible = false;

            try {
                await this.loadMarkers();
                this.showMarkers();
            } catch (error) {
                console.error('Error reloading 3D model markers after base layer change:', error);
            }
        }
    }

    /**
     * Called when control is removed from the map
     */
    onRemove() {
        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }

    /**
     * Activate the 3D models viewer tool
     */
    async activate() {
        this.isActive = true;

        // Ensure close button listener is registered
        this._ensureCloseButtonListener();

        await this.loadMarkers();
        this.showMarkers();
    }

    /**
     * Deactivate the 3D models viewer tool
     */
    deactivate() {
        this.isActive = false;
        this.removePreviewPopup();
        this.hideMarkers();

        const map3dContainer = document.getElementById('map-3d-container');
        if (map3dContainer && map3dContainer.style.display !== 'none') {
            this.closeViewer();
        }
    }

    /**
     * Load marker image (SVG pin) into the map
     * @returns {Promise<void>}
     */
    async loadMarkerImage() {
        const markerPinSvg = `<svg width="48" height="64" viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="24" cy="60" rx="12" ry="4" fill="#000000" opacity="0.3"/>
            <path d="M24,2 C13.5,2 5,10.5 5,21 C5,32 24,58 24,58 C24,58 43,32 43,21 C43,10.5 34.5,2 24,2 Z" fill="${PRIMARY_COLOR}" stroke="#ffffff" stroke-width="2"/>
            <circle cx="24" cy="21" r="10" fill="#ffffff" opacity="0.9"/>
            <g transform="translate(24, 21) scale(0.5)">
                <path d="M0,-8 L-7,-4 L-7,4 L0,8 L7,4 L7,-4 Z" fill="${PRIMARY_COLOR}" stroke="${PRIMARY_COLOR}" stroke-width="1"/>
                <path d="M0,-8 L-7,-4 L0,0 Z" fill="#3d6e3b"/>
                <path d="M0,-8 L7,-4 L0,0 Z" fill="#6ba85e"/>
            </g>
        </svg>`;

        return new Promise((resolve, reject) => {
            const img = new Image(48, 64);
            img.onload = () => {
                try {
                    if (!this.map.hasImage('3d-model-marker')) {
                        this.map.addImage('3d-model-marker', img, { pixelRatio: 2 });
                    }
                    resolve();
                } catch (error) {
                    console.error('Error adding image to map:', error);
                    reject(error);
                }
            };
            img.onerror = (error) => {
                console.error('Error loading SVG:', error);
                reject(new Error('Failed to load marker image'));
            };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markerPinSvg);
        });
    }

    /**
     * Load markers from config and create map layers with clustering
     */
    async loadMarkers() {
        // Get feature counts for badges
        const featureCounts = await getFeatureCountsByTileset();

        const features = config.tilesets.map(tileset => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [tileset.locate.lon, tileset.locate.lat]
            },
            properties: {
                tilesetId: tileset.id,
                name: tileset.name,
                dataCaptura: tileset.data_captura || null,
                previewVideo: tileset.previewVideo || null,
                previewThumbnail: tileset.previewThumbnail || null,
                featureCount: featureCounts.get(tileset.id) || 0
            }
        }));

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        if (!this.map.getSource(this.sourceId)) {
            // Add clustered GeoJSON source
            this.map.addSource(this.sourceId, {
                type: 'geojson',
                data: geojson,
                cluster: true,
                clusterMaxZoom: CLUSTER_CONFIG.maxZoom,
                clusterRadius: CLUSTER_CONFIG.radius
            });

            // Layer 1: Cluster circles
            this.map.addLayer({
                id: this.clustersLayer,
                type: 'circle',
                source: this.sourceId,
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': PRIMARY_COLOR,
                    'circle-radius': [
                        'step',
                        ['get', 'point_count'],
                        CLUSTER_SIZE_STEPS.small.radius,
                        CLUSTER_SIZE_STEPS.small.maxCount,
                        CLUSTER_SIZE_STEPS.medium.radius,
                        CLUSTER_SIZE_STEPS.medium.maxCount,
                        CLUSTER_SIZE_STEPS.large.radius
                    ],
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff'
                },
                layout: {
                    'visibility': 'none'
                }
            });

            // Layer 2: Cluster count labels
            this.map.addLayer({
                id: this.clusterCountLayer,
                type: 'symbol',
                source: this.sourceId,
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': ['get', 'point_count_abbreviated'],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 14,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff'
                }
            });

            // Load marker icon
            await this.loadMarkerImage();

            // Layer 3: Individual markers (unclustered points)
            this.map.addLayer({
                id: this.markersLayer,
                type: 'symbol',
                source: this.sourceId,
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'icon-image': '3d-model-marker',
                    'icon-size': 1.7,
                    'icon-anchor': 'bottom',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'visibility': 'none'
                },
                paint: {
                    'icon-opacity': 1.0
                }
            });

            // Layer 4: Marker labels
            this.map.addLayer({
                id: this.labelsLayer,
                type: 'symbol',
                source: this.sourceId,
                filter: ['!', ['has', 'point_count']],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 16,
                    'text-offset': [0, 0.3],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-letter-spacing': 0.05,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#000000',
                    'text-halo-width': 2,
                    'text-halo-blur': 1
                }
            });

            // Layer 5: Badge circle (only show when featureCount > 0)
            this.map.addLayer({
                id: this.badgeCircleLayer,
                type: 'circle',
                source: this.sourceId,
                filter: ['all',
                    ['!', ['has', 'point_count']],
                    ['>', ['get', 'featureCount'], 0]
                ],
                paint: {
                    'circle-color': BADGE_COLOR,
                    'circle-radius': 10,
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-translate': [14, -42]
                },
                layout: {
                    'visibility': 'none'
                }
            });

            // Layer 6: Badge text (feature count number)
            this.map.addLayer({
                id: this.badgeTextLayer,
                type: 'symbol',
                source: this.sourceId,
                filter: ['all',
                    ['!', ['has', 'point_count']],
                    ['>', ['get', 'featureCount'], 0]
                ],
                layout: {
                    'text-field': ['to-string', ['get', 'featureCount']],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 11,
                    'text-anchor': 'center',
                    'text-offset': [1.27, -3.82],
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#ffffff'
                }
            });
        } else {
            this.map.getSource(this.sourceId).setData(geojson);
        }
    }

    /**
     * Show markers and enable event listeners
     */
    showMarkers() {
        if (!this.map.getLayer(this.markersLayer)) {
            console.warn('3D Models Viewer: markers layer not found, cannot show markers');
            return;
        }

        // First remove any existing listeners to prevent duplicates
        // (these calls are safe even if listeners don't exist)
        this.map.off('click', this.clustersLayer, this.handleClusterClick);
        this.map.off('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.clustersLayer, this.hideHoverCursor);
        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Cluster events
        this.map.on('click', this.clustersLayer, this.handleClusterClick);
        this.map.on('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.clustersLayer, this.hideHoverCursor);

        // Individual marker events
        this.map.on('click', this.markersLayer, this.handleMarkerClick);
        this.map.on('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Set visibility
        this.map.setLayoutProperty(this.clustersLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.clusterCountLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.labelsLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.badgeCircleLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.badgeTextLayer, 'visibility', 'visible');

        this.markersVisible = true;
    }

    /**
     * Hide markers and remove event listeners
     */
    hideMarkers() {
        // Remove popup first
        this.removePreviewPopup();

        // Always remove event listeners (safe even if they don't exist)
        this.map.off('click', this.clustersLayer, this.handleClusterClick);
        this.map.off('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.clustersLayer, this.hideHoverCursor);
        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Only set visibility if layers exist
        if (this.map.getLayer(this.markersLayer)) {
            this.map.setLayoutProperty(this.clustersLayer, 'visibility', 'none');
            this.map.setLayoutProperty(this.clusterCountLayer, 'visibility', 'none');
            this.map.setLayoutProperty(this.markersLayer, 'visibility', 'none');
            this.map.setLayoutProperty(this.labelsLayer, 'visibility', 'none');
            this.map.setLayoutProperty(this.badgeCircleLayer, 'visibility', 'none');
            this.map.setLayoutProperty(this.badgeTextLayer, 'visibility', 'none');
        }

        this.markersVisible = false;
    }

    /**
     * Handle click on cluster - zoom to expand
     * @param {Object} e - Map click event
     */
    async handleClusterClick(e) {
        // Ignore if tool is not active
        if (!this.isActive) return;

        // Skip if click was already consumed by another marker handler
        if (window._markerClickConsumed) return;

        // Mark click as consumed to prevent other marker handlers from processing
        window._markerClickConsumed = true;

        // Reset flag after current event loop to allow future clicks
        setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0);

        // Prevent event from propagating to other map handlers
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        const features = this.map.queryRenderedFeatures(e.point, {
            layers: [this.clustersLayer]
        });

        if (!features.length) return;

        const clusterId = features[0].properties.cluster_id;
        const source = this.map.getSource(this.sourceId);

        try {
            const zoom = await source.getClusterExpansionZoom(clusterId);
            this.map.easeTo({
                center: features[0].geometry.coordinates,
                zoom: zoom
            });
        } catch (error) {
            console.error('Error expanding cluster:', error);
        }
    }

    /**
     * Handle click on individual marker - show preview popup
     * @param {Object} e - Map click event
     */
    handleMarkerClick(e) {
        // Ignore if tool is not active
        if (!this.isActive) return;

        // Skip if click was already consumed by another marker handler
        if (window._markerClickConsumed) return;

        // Mark click as consumed to prevent other marker handlers from processing
        window._markerClickConsumed = true;

        // Reset flag after current event loop to allow future clicks
        setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0);

        // Prevent event from propagating to other map handlers
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        const feature = e.features[0];
        const tilesetId = feature.properties.tilesetId;

        // Toggle behavior: if clicking same marker, close popup
        if (this.currentOpenTilesetId === tilesetId && this.previewPopup) {
            this.removePreviewPopup();
            return;
        }

        const coordinates = feature.geometry.coordinates.slice();

        // Fly to marker to center it on the map
        this.map.flyTo({
            center: coordinates,
            duration: 500
        });
        const name = feature.properties.name;
        const dataCaptura = feature.properties.dataCaptura;
        const previewVideo = feature.properties.previewVideo;
        const previewThumbnail = feature.properties.previewThumbnail;

        // Adjust coordinates for multiple world copies
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        this.createPreviewPopup(coordinates, tilesetId, name, dataCaptura, previewVideo, previewThumbnail);
    }

    /**
     * Create preview popup with video/thumbnail and open button
     * @param {number[]} coordinates - [lng, lat] position
     * @param {string} tilesetId - ID of the tileset
     * @param {string} name - Display name of the model
     * @param {string|null} dataCaptura - Capture date in DD/MM/YYYY format or null
     * @param {string|null} previewVideo - URL to preview video or null
     * @param {string|null} previewThumbnail - URL to preview thumbnail or null
     */
    createPreviewPopup(coordinates, tilesetId, name, dataCaptura, previewVideo, previewThumbnail) {
        // Remove existing popup
        this.removePreviewPopup();

        this.currentOpenTilesetId = tilesetId;

        // Hide label for current marker
        this.updateLabelFilter(tilesetId);

        // Determine if we have any media to show
        const hasMedia = previewVideo || previewThumbnail;

        // Build popup content
        const container = document.createElement('div');
        container.className = hasMedia ? 'model-preview-content' : 'model-preview-content no-video';

        // Prevent clicks inside popup from propagating to map
        container.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Media element (video with thumbnail fallback, or just thumbnail)
        if (previewVideo) {
            const video = document.createElement('video');
            video.src = previewVideo;
            video.className = 'model-preview-video';
            video.autoplay = true;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'metadata';

            // Fallback to thumbnail on video error
            video.onerror = () => {
                if (previewThumbnail) {
                    const img = document.createElement('img');
                    img.src = previewThumbnail;
                    img.className = 'model-preview-thumbnail';
                    img.alt = name;
                    video.replaceWith(img);
                } else {
                    video.remove();
                    container.classList.add('no-video');
                }
            };

            container.appendChild(video);
            this.activeVideoElement = video;
        } else if (previewThumbnail) {
            const img = document.createElement('img');
            img.src = previewThumbnail;
            img.className = 'model-preview-thumbnail';
            img.alt = name;
            container.appendChild(img);
        }

        // Info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'model-preview-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'model-preview-name';
        nameDiv.textContent = name;
        infoDiv.appendChild(nameDiv);

        // Capture date (only if available)
        if (dataCaptura) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'model-preview-date';
            dateDiv.textContent = `Captura: ${dataCaptura}`;
            infoDiv.appendChild(dateDiv);
        }

        const openButton = document.createElement('button');
        openButton.className = 'model-preview-button';
        openButton.textContent = 'Visualizar em 3D';
        openButton.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.openViewer(tilesetId);
        };
        infoDiv.appendChild(openButton);

        container.appendChild(infoDiv);

        // Create MapLibre popup
        this.previewPopup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            anchor: 'bottom',
            offset: [0, -MARKER_POPUP_OFFSET],
            className: 'model-preview-popup-container',
            maxWidth: 'none'
        })
            .setLngLat(coordinates)
            .setDOMContent(container)
            .addTo(this.map);

        // Listen for popup close event
        this.previewPopup.on('close', this.handlePopupClose);
    }

    /**
     * Handle popup close event - restore label visibility
     */
    handlePopupClose() {
        this.currentOpenTilesetId = null;
        this.resetLabelFilter();

        if (this.activeVideoElement) {
            this.activeVideoElement.pause();
            this.activeVideoElement.src = '';
            this.activeVideoElement = null;
        }

        this.previewPopup = null;
    }

    /**
     * Remove preview popup and cleanup
     */
    removePreviewPopup() {
        if (this.activeVideoElement) {
            this.activeVideoElement.pause();
            this.activeVideoElement.src = '';
            this.activeVideoElement = null;
        }

        if (this.previewPopup) {
            this.previewPopup.off('close', this.handlePopupClose);
            this.previewPopup.remove();
            this.previewPopup = null;
        }

        this.currentOpenTilesetId = null;
        this.resetLabelFilter();
    }

    /**
     * Update label filter to hide specific marker's label
     * @param {string} tilesetId - ID of tileset to hide label for
     */
    updateLabelFilter(tilesetId) {
        if (!this.map.getLayer(this.labelsLayer)) return;

        this.map.setFilter(this.labelsLayer, [
            'all',
            ['!', ['has', 'point_count']],
            ['!=', ['get', 'tilesetId'], tilesetId]
        ]);
    }

    /**
     * Reset label filter to show all labels
     */
    resetLabelFilter() {
        if (!this.map.getLayer(this.labelsLayer)) return;

        this.map.setFilter(this.labelsLayer, [
            '!', ['has', 'point_count']
        ]);
    }

    /**
     * Open the 3D viewer for a specific tileset
     * @param {string} tilesetId - ID of the tileset to view
     */
    async openViewer(tilesetId) {
        try {
            this.removePreviewPopup();
            this.setFullMap(false);

            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) {
                closeBtn.style.display = 'flex';
                // Ensure close button listener is registered (needed for deep link opening)
                this._ensureCloseButtonListener();
            }

            const map3dModule = await import('./map_3d.js');
            await map3dModule.openViewerWithTileset(tilesetId);

            // Update URL for deep linking / sharing
            URLRouter.setModel(tilesetId);

        } catch (error) {
            console.error('Error opening 3D viewer:', error);
            this.setFullMap(true);
            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) closeBtn.style.display = 'none';
        }
    }

    /**
     * Ensures close button has event listener attached.
     * Prevents duplicate listeners by tracking registration state.
     * @private
     */
    _ensureCloseButtonListener() {
        const closeBtn = document.getElementById('close-3d-viewer-button');
        if (!closeBtn || this._closeListenerAttached) return;

        closeBtn.addEventListener('click', this._handleCloseButtonClick.bind(this));
        this._closeListenerAttached = true;
    }

    /**
     * Handle close button click with preventDefault to avoid hash in URL.
     * @param {Event} e - Click event
     * @private
     */
    _handleCloseButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this.closeViewer();
    }

    /**
     * Close the 3D viewer and return to map
     */
    async closeViewer() {
        try {
            const map3dModule = await import('./map_3d.js');
            map3dModule.closeViewer();

            this.setFullMap(true);
            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) closeBtn.style.display = 'none';

            // Clear URL param when closing viewer
            URLRouter.clearModel();

        } catch (error) {
            console.error('Error closing 3D viewer:', error);
        }
    }

    /**
     * Toggle between full map and split view
     * @param {boolean} full - True for full map, false for split view
     */
    setFullMap(full) {
        const mapSig = document.getElementById('map-sig');
        const map3dContainer = document.getElementById('map-3d-container');

        if (mapSig) mapSig.style.display = full ? 'block' : 'none';
        if (map3dContainer) map3dContainer.style.display = full ? 'none' : 'block';
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
     * Navigate to a specific 3D model and open its preview popup.
     * Used by external components like search.
     * @param {string} tilesetId - ID of the tileset to navigate to
     * @returns {Promise<boolean>} True if navigation successful
     */
    async navigateToModel(tilesetId) {
        const tileset = config.tilesets.find(t => t.id === tilesetId);
        if (!tileset) {
            console.warn(`Tileset not found: ${tilesetId}`);
            return false;
        }

        // Activate viewer if not active
        if (!this.isActive) {
            this.toolManager.toggleViewer(this);
        }

        const coordinates = [tileset.locate.lon, tileset.locate.lat];

        // Fly to location
        this.map.flyTo({
            center: coordinates,
            zoom: 14,
            essential: true
        });

        // Open popup after animation completes
        this.map.once('moveend', () => {
            this.createPreviewPopup(
                coordinates,
                tileset.id,
                tileset.name,
                tileset.data_captura || null,
                tileset.previewVideo || null,
                tileset.previewThumbnail || null
            );
        });

        return true;
    }
}

export default Add3DModelsViewerControl;
