// Path: js/3d_models_viewer_tool/add_3d_models_viewer_control.js

/**
 * @fileoverview Control for viewing 3D tilesets and first-person (Gaussian splatting)
 * scenes on the 2D map. Displays clustered markers with video preview popups and opens
 * either the Cesium 3D viewer or the lazy-loaded first-person viewer.
 * @dependencies config, store, event_types, first_person_3d_tool/scene-config.service
 */

import config from '@js/config.js';
import { getEventBus, getAllMarkers, getAllMeasurements, getAllViewsheds } from '@store/index.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, subscribe, addDomListener, trackTimer, cleanup } from '@utils/event-cleanup.js';
import { showLoading3DScreen, hideLoading3DScreen } from '@ui/loading-screen-3d.js';
import { MARKER_KIND, buildMarkerFeatures, resolveMarkerDescriptor } from './marker-features.js';
import { model3dFailures } from './model3d-failure.js';

// Global flag to prevent click propagation between overlapping marker layers
// (3D models, street view, saved photos)
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

// Application primary color (3D tileset pins and clusters)
const PRIMARY_COLOR = '#508D4E';

// First-person scene pin color
const FIRST_PERSON_COLOR = '#7B52D3';

// Marker pin vertical offset for popup positioning
const MARKER_POPUP_OFFSET = 55;

// Badge color for feature count
const BADGE_COLOR = '#e53935';

// Map image ids for each marker kind
const MARKER_IMAGE = {
    [MARKER_KIND.TILESET]: '3d-model-marker',
    [MARKER_KIND.FIRST_PERSON]: '3d-fp-marker'
};

// Inner glyph of the tileset pin: an isometric cube
const TILESET_GLYPH = `<path d="M0,-8 L-7,-4 L-7,4 L0,8 L7,4 L7,-4 Z" fill="${PRIMARY_COLOR}" stroke="${PRIMARY_COLOR}" stroke-width="1"/>
    <path d="M0,-8 L-7,-4 L0,0 Z" fill="#3d6e3b"/>
    <path d="M0,-8 L7,-4 L0,0 Z" fill="#6ba85e"/>`;

// Inner glyph of the first-person pin: a walking figure
const FIRST_PERSON_GLYPH = `<circle cx="-0.5" cy="-6" r="2.4" fill="${FIRST_PERSON_COLOR}"/>
    <g fill="none" stroke="${FIRST_PERSON_COLOR}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-0.5,-3.2 L1,0.6"/>
        <path d="M1,0.6 L4,6"/>
        <path d="M1,0.6 L-3.6,5.6"/>
        <path d="M0,-2.4 L-4,1.6"/>
        <path d="M0,-2.4 L3.8,-3.4"/>
    </g>`;

/**
 * Builds the marker pin SVG for a given color and inner glyph.
 * @param {string} color - Pin body color
 * @param {string} glyph - SVG markup drawn centered on the pin head (viewport -8..8)
 * @returns {string} SVG markup
 */
function buildMarkerPinSvg(color, glyph) {
    return `<svg width="48" height="64" viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="24" cy="60" rx="12" ry="4" fill="#000000" opacity="0.3"/>
        <path d="M24,2 C13.5,2 5,10.5 5,21 C5,32 24,58 24,58 C24,58 43,32 43,21 C43,10.5 34.5,2 24,2 Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="24" cy="21" r="10" fill="#ffffff" opacity="0.9"/>
        <g transform="translate(24, 21) scale(0.5)">
            ${glyph}
        </g>
    </svg>`;
}

// Pin images loaded into the map style, one per marker kind
const MARKER_PIN_SPECS = [
    { imageId: MARKER_IMAGE[MARKER_KIND.TILESET], svg: buildMarkerPinSvg(PRIMARY_COLOR, TILESET_GLYPH) },
    { imageId: MARKER_IMAGE[MARKER_KIND.FIRST_PERSON], svg: buildMarkerPinSvg(FIRST_PERSON_COLOR, FIRST_PERSON_GLYPH) }
];

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

        for (const item of [...(markers || []), ...(measurements || []), ...(viewsheds || [])]) {
            counts.set(item.tilesetId, (counts.get(item.tilesetId) || 0) + 1);
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

        // Popup state (markerId is a tilesetId or a first-person sceneId)
        this.previewPopup = null;
        this.activeVideoElement = null;
        this.currentOpenMarkerId = null;

        // Close button listener tracking
        this._closeListenerAttached = false;

        // True while the first-person viewer is on screen. Mirrored from the
        // viewer's own events rather than set here: the viewer also opens from
        // the catalog, from the search and from a deep link, none of which pass
        // through this control.
        this._firstPersonOpen = false;

        // Bind methods
        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.handleClusterClick = this.handleClusterClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.closeViewer = this.closeViewer.bind(this);
        this.closeFirstPersonScene = this.closeFirstPersonScene.bind(this);
        this.handlePopupClose = this.handlePopupClose.bind(this);
        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._handleFeaturesChanged = this._handleFeaturesChanged.bind(this);
        this._handleDataCleared = this._handleDataCleared.bind(this);
        this._handleFirstPersonOpened = this._handleFirstPersonOpened.bind(this);
        this._handleFirstPersonClosed = this._handleFirstPersonClosed.bind(this);

        setupCleanup(this);
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

        // THE 3D VIEWER SPEAKS THROUGH THE MAP'S PANEL, and this is where it learns which map.
        // The engine that discovers a model did not load (`map_3d.js`) is lazy and holds a Cesium
        // viewer, never a MapLibre map, so the seam has to be attached from here: see
        // `model3d-failure.js`.
        model3dFailures.attach(map);

        // Listen for base layer changes to reload layers if active
        subscribe(this, getEventBus(), EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);

        // Listen for 3D feature changes to update badges
        subscribe(this, getEventBus(), EventTypes.MARKERS_3D_CHANGED, this._handleFeaturesChanged);
        subscribe(this, getEventBus(), EventTypes.MEASUREMENTS_3D_CHANGED, this._handleFeaturesChanged);
        subscribe(this, getEventBus(), EventTypes.VIEWSHEDS_3D_CHANGED, this._handleFeaturesChanged);

        // On logout / full data wipe, recompute badges to 0 even when markers are
        // hidden (otherwise the count badge stays stale after the store is cleared).
        subscribe(this, getEventBus(), EventTypes.ALL_DATA_CLEARED, this._handleDataCleared);

        // Track the first-person viewer, which also opens from the catalog, the
        // search and deep links: this control is only one of its four doors.
        subscribe(this, getEventBus(), EventTypes.FIRST_PERSON_OPENED, this._handleFirstPersonOpened);
        subscribe(this, getEventBus(), EventTypes.FIRST_PERSON_CLOSED, this._handleFirstPersonClosed);

        return this.container;
    }

    /**
     * The first-person viewer went on screen.
     * @private
     */
    _handleFirstPersonOpened() {
        this._firstPersonOpen = true;
    }

    /**
     * The first-person viewer left the screen.
     * @private
     */
    _handleFirstPersonClosed() {
        this._firstPersonOpen = false;
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
     * Rebuilds the badge source after a full data wipe (logout) so stale counts
     * reset to 0. Unlike _handleFeaturesChanged this does not gate on markersVisible
     * — only on the source existing — so the badge clears even when markers are off.
     * @private
     */
    async _handleDataCleared() {
        if (this.map?.getSource(this.sourceId)) {
            await this._updateBadgeCounts();
        }
    }

    /**
     * Updates badge counts by refreshing the source data.
     * @private
     */
    async _updateBadgeCounts() {
        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData(await this._buildGeoJSON());
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
        cleanup(this);

        // Paired with the attach in onAdd: a surface left registered keeps the shared notice
        // calling into a control that is gone.
        model3dFailures.detach();

        // The cluster/marker handlers are raw map.on() registrations, outside the
        // event-cleanup bookkeeping: pair them here or they outlive the control.
        if (this.map) {
            this._removeMapListeners();
        }

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

        if (this._firstPersonOpen) {
            this.closeFirstPersonScene();
        }
    }

    /**
     * Loads a single SVG pin into the map style.
     * @param {string} imageId - Map image id
     * @param {string} svg - SVG markup
     * @returns {Promise<void>}
     * @private
     */
    _loadPinImage(imageId, svg) {
        return new Promise((resolve, reject) => {
            const img = new Image(48, 64);
            img.onload = () => {
                try {
                    if (!this.map.hasImage(imageId)) {
                        this.map.addImage(imageId, img, { pixelRatio: 2 });
                    }
                    resolve();
                } catch (error) {
                    console.error('Error adding image to map:', error);
                    reject(error);
                }
            };
            img.onerror = (error) => {
                console.error('Error loading SVG:', error);
                reject(new Error(`Failed to load marker image: ${imageId}`));
            };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    }

    /**
     * Load marker images (SVG pins) into the map: 3D tileset and first-person scene.
     * @returns {Promise<void>}
     */
    async loadMarkerImage() {
        await Promise.all(
            MARKER_PIN_SPECS.map(spec => this._loadPinImage(spec.imageId, spec.svg))
        );
    }

    /**
     * Builds the GeoJSON FeatureCollection of the marker layer: one pin per positioned catalog
     * row, routed to its viewer by the shape partition (`marker-features.js`).
     * @returns {Promise<Object>} GeoJSON FeatureCollection
     * @private
     */
    async _buildGeoJSON() {
        const featureCounts = await getFeatureCountsByTileset();

        return {
            type: 'FeatureCollection',
            features: buildMarkerFeatures(config.tilesets, featureCounts)
        };
    }

    /**
     * Load markers from config and create map layers with clustering
     */
    async loadMarkers() {
        const geojson = await this._buildGeoJSON();

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
                    'icon-image': [
                        'match',
                        ['get', 'kind'],
                        MARKER_KIND.FIRST_PERSON, MARKER_IMAGE[MARKER_KIND.FIRST_PERSON],
                        MARKER_IMAGE[MARKER_KIND.TILESET]
                    ],
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
                    ['==', ['get', 'kind'], MARKER_KIND.TILESET],
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
                    ['==', ['get', 'kind'], MARKER_KIND.TILESET],
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
     * Gets all layer IDs managed by this control.
     * @returns {string[]} Array of layer IDs
     * @private
     */
    _getAllLayerIds() {
        return [
            this.clustersLayer, this.clusterCountLayer, this.markersLayer,
            this.labelsLayer, this.badgeCircleLayer, this.badgeTextLayer
        ];
    }

    /**
     * Removes all map event listeners for cluster and marker interaction.
     * Safe to call even if listeners are not registered.
     * @private
     */
    _removeMapListeners() {
        this.map.off('click', this.clustersLayer, this.handleClusterClick);
        this.map.off('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.clustersLayer, this.hideHoverCursor);
        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);
    }

    /**
     * Show markers and enable event listeners
     */
    showMarkers() {
        if (!this.map.getLayer(this.markersLayer)) {
            console.warn('3D Models Viewer: markers layer not found, cannot show markers');
            return;
        }

        // Remove existing listeners to prevent duplicates, then re-attach
        this._removeMapListeners();

        this.map.on('click', this.clustersLayer, this.handleClusterClick);
        this.map.on('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.clustersLayer, this.hideHoverCursor);
        this.map.on('click', this.markersLayer, this.handleMarkerClick);
        this.map.on('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.markersLayer, this.hideHoverCursor);

        for (const layerId of this._getAllLayerIds()) {
            this.map.setLayoutProperty(layerId, 'visibility', 'visible');
        }

        this.markersVisible = true;
    }

    /**
     * Hide markers and remove event listeners
     */
    hideMarkers() {
        this.removePreviewPopup();
        this._removeMapListeners();

        if (this.map.getLayer(this.markersLayer)) {
            for (const layerId of this._getAllLayerIds()) {
                this.map.setLayoutProperty(layerId, 'visibility', 'none');
            }
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
        trackTimer(this, setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0), 'timeout');

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
        trackTimer(this, setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0), 'timeout');

        // Prevent event from propagating to other map handlers
        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        const feature = e.features[0];
        const properties = feature.properties;
        const markerId = properties.markerId;

        // Toggle behavior: if clicking same marker, close popup
        if (this.currentOpenMarkerId === markerId && this.previewPopup) {
            this.removePreviewPopup();
            return;
        }

        const coordinates = feature.geometry.coordinates.slice();

        // Fly to marker to center it on the map
        this.map.flyTo({
            center: coordinates,
            duration: 500
        });

        // Adjust coordinates for multiple world copies
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        this.createPreviewPopup(coordinates, {
            kind: properties.kind,
            markerId,
            name: properties.name,
            dataCaptura: properties.dataCaptura,
            previewVideo: properties.previewVideo,
            previewThumbnail: properties.previewThumbnail
        });
    }

    /**
     * Create preview popup with video/thumbnail and open button
     * @param {number[]} coordinates - [lng, lat] position
     * @param {Object} markerInfo - Marker descriptor
     * @param {string} markerInfo.kind - 'tileset' or 'firstPerson'
     * @param {string} markerInfo.markerId - Tileset id or first-person scene id
     * @param {string} markerInfo.name - Display name
     * @param {string|null} [markerInfo.dataCaptura] - Capture date in DD/MM/YYYY format
     * @param {string|null} [markerInfo.previewVideo] - URL to preview video
     * @param {string|null} [markerInfo.previewThumbnail] - URL to preview thumbnail
     */
    createPreviewPopup(coordinates, markerInfo) {
        const { kind, markerId, name, dataCaptura, previewVideo, previewThumbnail } = markerInfo;
        const isFirstPerson = kind === MARKER_KIND.FIRST_PERSON;

        // Remove existing popup
        this.removePreviewPopup();

        this.currentOpenMarkerId = markerId;

        // Hide label for current marker
        this.updateLabelFilter(markerId);

        // Determine if we have any media to show
        const hasMedia = previewVideo || previewThumbnail;

        // Build popup content
        const container = document.createElement('div');
        container.className = hasMedia ? 'model-preview-content' : 'model-preview-content no-video';

        // Prevent clicks inside popup from propagating to map
        container.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Collapse the popup to its text-only layout. The terminal state when no
        // preview media survives, whatever the reason.
        const dropMedia = (element) => {
            element.remove();
            container.classList.add('no-video');
        };

        /**
         * Build the thumbnail image, degrading to the text-only layout if it fails
         * to load.
         *
         * The onerror is not defensive padding: a first-person scene DERIVES its
         * preview paths from the scene folder (preview/thumbnail.jpg), so the
         * address always exists even when the operator never recorded a preview.
         * Worse, a missing file under the Vite dev server does not 404: the SPA
         * fallback answers 200 with index.html, so the request "succeeds" and the
         * decode is what fails. Without this the popup shows a broken-image icon.
         */
        const buildThumbnail = () => {
            const img = document.createElement('img');
            img.className = 'model-preview-thumbnail';
            img.alt = name;
            img.onerror = () => dropMedia(img);
            img.src = previewThumbnail;
            return img;
        };

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
                    video.replaceWith(buildThumbnail());
                } else {
                    dropMedia(video);
                }
            };

            container.appendChild(video);
            this.activeVideoElement = video;
        } else if (previewThumbnail) {
            container.appendChild(buildThumbnail());
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
        openButton.textContent = isFirstPerson ? 'Entrar na cena' : 'Visualizar em 3D';
        openButton.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (isFirstPerson) {
                this.openFirstPersonScene(markerId);
            } else {
                this.openViewer(markerId);
            }
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
        this.currentOpenMarkerId = null;
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

        this.currentOpenMarkerId = null;
        this.resetLabelFilter();
    }

    /**
     * Update label filter to hide specific marker's label
     * @param {string} markerId - Tileset id or first-person scene id to hide the label for
     */
    updateLabelFilter(markerId) {
        if (!this.map.getLayer(this.labelsLayer)) return;

        this.map.setFilter(this.labelsLayer, [
            'all',
            ['!', ['has', 'point_count']],
            ['!=', ['get', 'markerId'], markerId]
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
     * Open the 3D viewer for a specific tileset.
     * @param {string} tilesetId - ID of the tileset to view
     */
    async openViewer(tilesetId) {
        try {
            this.removePreviewPopup();
            this.setFullMap(false);

            // Show loading overlay while Cesium initializes (first open only)
            showLoading3DScreen();

            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) {
                closeBtn.style.display = 'flex';
                // Ensure close button listener is registered (needed for deep link opening)
                this._ensureCloseButtonListener();
            }

            const map3dModule = await import('./map_3d.js');
            await map3dModule.openViewerWithTileset(tilesetId);

        } catch (error) {
            console.error('Error opening 3D viewer:', error);
            hideLoading3DScreen();
            this.setFullMap(true);
            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) closeBtn.style.display = 'none';
        }
    }

    /**
     * Open the first-person (Gaussian splatting) viewer for a scene.
     * The viewer module is loaded lazily on purpose: a static import would pull
     * the whole splatting runtime into the main bundle.
     * @param {string} sceneId - ID of the first-person scene to enter
     */
    async openFirstPersonScene(sceneId) {
        try {
            this.removePreviewPopup();

            const { openFirstPersonViewer } = await import('@js/first_person_3d_tool/first_person_viewer.js');
            await openFirstPersonViewer(sceneId);

        } catch (error) {
            console.error('Error opening first-person viewer:', error);
        }
    }

    /**
     * Close the first-person viewer and return to the map.
     *
     * Unlike the Cesium path, this control does NOT touch the viewer's DOM: the
     * first-person viewer owns its own container, its close button and hiding
     * the 2D map, all through CSS classes. Writing `style.display` here would
     * beat `.fp3d-container--open` (an inline style outranks any class) and the
     * scene would never come back after the first close.
     */
    async closeFirstPersonScene() {
        try {
            const { closeFirstPersonViewer } = await import('@js/first_person_3d_tool/first_person_viewer.js');
            await closeFirstPersonViewer();
        } catch (error) {
            console.error('Error closing first-person viewer:', error);
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

        addDomListener(this, closeBtn, 'click', this._handleCloseButtonClick.bind(this));
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
     * Resolves a marker id into the popup descriptor, over the SAME partition that produced the
     * pins, so the id of a walk-through scene never comes back as a Cesium model.
     *
     * `locate` is optional on either half: without it the row still exists in the catalog and in
     * the search, but it has no pin on the 2D map, so there is nowhere to fly to and no popup to
     * anchor, and the lookup answers null.
     *
     * @param {string} markerId - Tileset id or first-person scene id
     * @returns {Object|null} Descriptor with coordinates and popup fields, or null
     * @private
     */
    _resolveMarkerInfo(markerId) {
        return resolveMarkerDescriptor(config.tilesets, markerId);
    }

    /**
     * Navigate to a specific 3D model or first-person scene and open its preview popup.
     * Used by external components like search.
     * @param {string} markerId - Tileset id or first-person scene id to navigate to
     * @returns {Promise<boolean>} True if navigation successful
     */
    async navigateToModel(markerId) {
        const markerInfo = this._resolveMarkerInfo(markerId);
        if (!markerInfo) {
            console.warn(`3D model or first-person scene not found: ${markerId}`);
            return false;
        }

        // Activate viewer if not active
        if (!this.isActive) {
            this.toolManager.toggleViewer(this);
        }

        const { coordinates, ...popupInfo } = markerInfo;

        // Fly to location
        this.map.flyTo({
            center: coordinates,
            zoom: 14,
            essential: true
        });

        // Open popup after animation completes
        this.map.once('moveend', () => {
            this.createPreviewPopup(coordinates, popupInfo);
        });

        return true;
    }
}

export default Add3DModelsViewerControl;
