// Path: js/street_view_tool/add_street_view_control.js

/**
 * @fileoverview MapLibre control for Street View 360 functionality.
 * Manages the 2D map integration: photo markers, line layers, popup preview,
 * and activation/deactivation of the Street View feature.
 *
 * NOTE: Three.js viewer logic has been moved to street_view_viewer.js
 */

/* global PMTiles */

import config from '../config.js';
import { getEventBus, registerControl } from '@store';
import { EventTypes } from '@events/event_types.js';
import StreetviewMarkers from './streetview_markers.js';
import SavedPhotosMarkers from './saved_photos_markers.js';
import { STYLE_MINI_MAPA } from './street-view-mini-map-style.js';

// Property name used in PMTiles to identify photos
const PHOTO_PROPERTY = 'photo_uuid';

class AddStreetViewControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.queryMobile = window.matchMedia("(max-width: 650px)");
        this.isActive = false;
        this.isOpen = false;

        // Mini-map for street view navigation (lazy — created in setupMiniMapWithPMTiles)
        this.miniMap = null;

        this.photosSourceId = 'pmtiles-photos';

        // PMTiles nearby features cache
        this.nearbyFeaturesCache = new Map();
        this.cacheRadius = 1000;

        // Streetview markers manager (initialized in onAdd)
        this.streetviewMarkers = null;

        // Saved photos markers manager (photos with orientations/markers saved)
        this.savedPhotosMarkers = null;

        // Bind event handlers
        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._unsubBaseLayerChanged = null;

        // Layer definitions for PMTiles
        if (config.features.imagens_panoramicas) {
            this.streetViewPointsLayer = {
                'id': 'street-view',
                'type': 'circle',
                'source': 'streetViewPointsSource',
                'source-layer': config.streetView360.pointsSourceLayer,
                'visibility': 'none',
                'paint': {
                    'circle-radius': 0,
                    'circle-color': '#0d6efd',
                    'circle-stroke-width': 0,
                    'circle-stroke-color': '#0d6efd'
                }
            };

            this.streetViewLinesLayer = {
                'id': 'street-view-lines',
                'type': 'line',
                'source': config.streetView360.linesSourceLayer,
                'source-layer': config.streetView360.linesSourceLayer,
                'paint': {
                    'line-color': '#0d6efd',
                    'line-width': 3
                }
            };

            // Invisible wider layer for easier click/hover hit testing
            this.streetViewLinesHitLayer = {
                'id': 'street-view-lines-hit',
                'type': 'line',
                'source': config.streetView360.linesSourceLayer,
                'source-layer': config.streetView360.linesSourceLayer,
                'paint': {
                    'line-color': 'transparent',
                    'line-width': 10
                }
            };
        }
    }

    onAdd(map) {
        this.map = map;

        // Initialize streetview markers manager
        this.streetviewMarkers = new StreetviewMarkers(map, this);

        // Initialize saved photos markers manager
        this.savedPhotosMarkers = new SavedPhotosMarkers(map, this);

        // Register in control registry for search integration
        registerControl('streetView', this);

        // Register PMTiles protocol
        if (typeof PMTiles !== 'undefined' && !this.map._pmtilesRegistered) {
            const protocol = new PMTiles.Protocol();
            maplibregl.addProtocol("pmtiles", protocol.tile);
            this.map._pmtilesRegistered = true;
        }

        // UI is handled by BottomControlsControl - return empty container
        this.container = document.createElement('div');
        this.container.style.display = 'none';

        if (config.features.imagens_panoramicas) {
            this.setupMiniMapWithPMTiles();
        }

        // Listen for base layer changes to reload layers if active
        this._unsubBaseLayerChanged = getEventBus().on(EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);

        return this.container;
    }

    /**
     * Handles base layer change event.
     * Reloads photo layers if the viewer is active.
     * @private
     */
    async _handleBaseLayerChanged() {
        if (this.isActive) {
            // Layers were removed by setStyle, need to reload
            await this.reload();

            // Also reload streetview markers if they exist
            if (this.streetviewMarkers) {
                await this.streetviewMarkers.loadMarkers();
                this.streetviewMarkers.show();
            }

            // Reload saved photos markers
            if (this.savedPhotosMarkers) {
                await this.savedPhotosMarkers.loadMarkers();
                this.savedPhotosMarkers.show();
            }

            // Fix z-order after async layer recreation — line layers may have
            // been added before marker layers due to sourcedata event timing
            this._ensureLayerOrder();
        }
    }

    setupMiniMapWithPMTiles = async () => {
        // Lazy-create miniMap only when street view feature is actually enabled
        if (!this.miniMap) {
            this.miniMap = new maplibregl.Map({
                container: 'mini-map-street-view',
                style: STYLE_MINI_MAPA,
                attributionControl: false,
                zoom: 12.5,
                minZoom: 11,
                maxZoom: 17.9,
                validateStyle: false
            });
        }

        this.miniMap.on('load', async () => {
            try {
                // Register PMTiles protocol
                if (typeof PMTiles !== 'undefined') {
                    const protocol = new PMTiles.Protocol();
                    maplibregl.addProtocol("pmtiles", protocol.tile);
                }

                this.miniMap.addSource(this.streetViewPointsLayer['source'], config.streetView360.pointsSource);

                const pointImage = await this.miniMap.loadImage('./street_view/point.png');
                await this.miniMap.addImage('point', pointImage.data);

                const pointSelectedImage = await this.miniMap.loadImage('./street_view/point-selected-v2.png');
                this.miniMap.addImage('point-selected', pointSelectedImage.data);

                this.miniMap.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': this.streetViewPointsLayer['source'],
                    'source-layer': config.streetView360.pointsSourceLayer,
                    'layout': {
                        'icon-image': 'point',
                        'icon-allow-overlap': true,
                        'icon-ignore-placement': true
                    }
                });

                // Click on minimap point to navigate
                this.miniMap.on('click', 'points', async (e) => {
                    const properties = e.features[0].properties;
                    const { navigateToTarget } = await import('./street_view_viewer.js');
                    await navigateToTarget(properties[PHOTO_PROPERTY]);
                });

                this.miniMap.on('mouseenter', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = 'pointer';
                });

                this.miniMap.on('mouseleave', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = '';
                });

            } catch (error) {
                console.error('Error setting up minimap:', error);
            }
        });
    }

    loadData = async () => {
        try {
            if (!this.map.getSource(this.streetViewPointsLayer['source'])) {
                this.map.addSource(this.streetViewPointsLayer['source'], config.streetView360.pointsSource);
                const onPhotosSourceData = (e) => {
                    if (e.sourceId === this.streetViewPointsLayer['source'] && this.map.isSourceLoaded(this.streetViewPointsLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewPointsLayer['id'])) {
                            this.map.addLayer(this.streetViewPointsLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onPhotosSourceData);
                    }
                };
                this.map.on('sourcedata', onPhotosSourceData);
            } else {
                this.showLayers();
            }

            if (!this.map.getSource(this.streetViewLinesLayer['source'])) {
                this.map.addSource(this.streetViewLinesLayer['source'], config.streetView360.linesSource);

                const onLinesSourceData = (e) => {
                    if (e.sourceId === this.streetViewLinesLayer['source'] && this.map.isSourceLoaded(this.streetViewLinesLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewLinesLayer['id'])) {
                            this.map.addLayer(this.streetViewLinesLayer);
                        }
                        if (!this.map.getLayer(this.streetViewLinesHitLayer['id'])) {
                            this.map.addLayer(this.streetViewLinesHitLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onLinesSourceData);
                    }
                };
                this.map.on('sourcedata', onLinesSourceData);
            } else {
                this.showLayers();
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    reload = async () => {
        if (this.isActive) {
            await this.loadData();
            this.showPhotos();
        }
    }

    onRemove() {
        if (this._unsubBaseLayerChanged) {
            this._unsubBaseLayerChanged();
            this._unsubBaseLayerChanged = null;
        }

        // Cleanup streetview viewer if open
        if (this.isOpen) {
            this.closeStreetView();
        }

        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }

    async activate() {
        const isEnabled = config.features?.imagens_panoramicas ?? true;
        if (!isEnabled) {
            return false;
        }

        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.addEventListener('click', this.closeStreetView);
        this.isActive = true;
        await this.loadData();
        this.showPhotos();

        // Load and show streetview markers
        if (this.streetviewMarkers) {
            await this.streetviewMarkers.loadMarkers();
            this.streetviewMarkers.show();
        }

        // Load and show saved photos markers
        if (this.savedPhotosMarkers) {
            await this.savedPhotosMarkers.loadMarkers();
            this.savedPhotosMarkers.show();
        }
    }

    /**
     * Toggle Street View tool on/off.
     * Delegates to toolManager for consistent state management.
     */
    toggleStreetView() {
        this.toolManager.toggleViewer(this);
    }

    showPhotos = async () => {
        // Bind click/hover to the wider invisible hit layer for easier interaction
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        this.map.on('click', hitLayerId, this.loadPoint);
        this.map.on('mouseenter', hitLayerId, this.showHoverCursor);
        this.map.on('mouseleave', hitLayerId, this.hideHoverCursor);

        if (this.miniMap.getLayer('selected')) {
            this.miniMap.removeLayer('selected');
        }

        this.miniMap.addLayer({
            'id': 'selected',
            'type': 'symbol',
            'source': this.streetViewPointsLayer['source'],
            'source-layer': config.streetView360.pointsSourceLayer,
            "filter": ["==", PHOTO_PROPERTY, ""],
            'layout': {
                'icon-image': 'point-selected'
            }
        });
    }

    /**
     * Finds the nearest photo point to a given coordinate.
     * Uses querySourceFeatures (vector tile data) since the points layer
     * has circle-radius: 0 and queryRenderedFeatures would return nothing.
     * @param {Object} point - {lng, lat} coordinate
     * @returns {Promise<Object|null>} Nearest feature or null
     */
    getNearestPhoto = async (point) => {
        try {
            const cacheKey = `${Math.round(point.lng * 1000)}_${Math.round(point.lat * 1000)}`;

            if (this.nearbyFeaturesCache.has(cacheKey)) {
                return this.nearbyFeaturesCache.get(cacheKey);
            }

            // ~33m buffer — tight enough to avoid adjacent tracks
            const bufferDistance = 0.0003;
            const bbox = [
                point.lng - bufferDistance,
                point.lat - bufferDistance,
                point.lng + bufferDistance,
                point.lat + bufferDistance
            ];

            let features = this.map.querySourceFeatures(this.streetViewPointsLayer['source'], {
                bbox,
                sourceLayer: config.streetView360.pointsSourceLayer
            });

            // Widen search if nothing found nearby
            if (features.length === 0) {
                const widerBuffer = 0.001;
                const widerBbox = [
                    point.lng - widerBuffer,
                    point.lat - widerBuffer,
                    point.lng + widerBuffer,
                    point.lat + widerBuffer
                ];
                features = this.map.querySourceFeatures(this.streetViewPointsLayer['source'], {
                    bbox: widerBbox,
                    sourceLayer: config.streetView360.pointsSourceLayer
                });
            }

            if (features.length === 0) {
                return null;
            }

            const from = turf.point([point.lng, point.lat]);
            let minDistance = Infinity;
            let target = null;

            for (const feature of features) {
                const coords = feature.geometry.coordinates;
                const to = turf.point(coords);
                const distance = turf.distance(from, to);

                if (distance < minDistance) {
                    minDistance = distance;
                    target = feature;
                }
            }

            if (target) {
                this.nearbyFeaturesCache.set(cacheKey, target);
            }

            return target;

        } catch (error) {
            console.error('Error finding nearest photo:', error);
            return null;
        }
    }

    /**
     * Handles click on street view line to open the viewer.
     * Delegates to street_view_viewer.js for actual viewer management.
     */
    loadPoint = async (e) => {
        // Ignore if tool is not active
        if (!this.isActive) return;

        // Skip if click was already consumed by a marker handler
        if (window._markerClickConsumed) {
            return;
        }

        // Prevent event from propagating to other map handlers
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
        }

        try {
            const feature = await this.getNearestPhoto(e.lngLat);

            if (feature && feature.properties && feature.properties[PHOTO_PROPERTY]) {
                this.isOpen = true;

                // Import and open viewer dynamically
                const { openViewer360WithPhoto, isStreetView360Open } = await import('./street_view_viewer.js');

                // If already open, just navigate to new photo
                if (isStreetView360Open()) {
                    const { navigateToTarget } = await import('./street_view_viewer.js');
                    await navigateToTarget(feature.properties[PHOTO_PROPERTY]);
                } else {
                    await openViewer360WithPhoto(feature.properties[PHOTO_PROPERTY], {
                        miniMap: this.miniMap,
                        controlInstance: this
                    });
                }
            } else {
                console.warn('No photo found near clicked point');
            }

        } catch (error) {
            console.error('Error loading point:', error);
        }
    }

    showHoverCursor = () => {
        if (!this.isActive) return;
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = 'pointer';
        }
    }

    hideHoverCursor = () => {
        if (!this.isActive) return;
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }
    }

    deactivate = () => {
        this.isActive = false;

        // Safe cursor reset with null check
        if (this.map?.getCanvas()) {
            this.map.getCanvas().style.cursor = '';
        }

        // Safe hidePhotos call
        try {
            this.hidePhotos();
        } catch (error) {
            console.warn('Error hiding photos:', error);
        }

        // Hide streetview markers
        if (this.streetviewMarkers) {
            this.streetviewMarkers.hide();
        }

        // Hide saved photos markers
        if (this.savedPhotosMarkers) {
            this.savedPhotosMarkers.hide();
        }

        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.removeEventListener('click', this.closeStreetView);

        if (this.isOpen) {
            this.closeStreetView();
        }
    }

    closeStreetView = async () => {
        if (!this.isOpen) return;

        this.isOpen = false;

        // Delegate to viewer for cleanup
        try {
            const { closeViewer360 } = await import('./street_view_viewer.js');
            await closeViewer360();
        } catch (error) {
            console.warn('Error closing viewer:', error);
        }
    }

    hidePhotos = () => {
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        this.map.off('click', hitLayerId, this.loadPoint);
        this.map.off('mouseenter', hitLayerId, this.showHoverCursor);
        this.map.off('mouseleave', hitLayerId, this.hideHoverCursor);

        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'none');
        }
        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'none');
        }
        if (this.map.getLayer(hitLayerId)) {
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'none');
        }
    }

    /**
     * Finds the first streetview marker layer to use as beforeId for line layers.
     * Lines must render below markers, so they are inserted before the first marker layer.
     * @returns {string|undefined} Layer ID or undefined if no marker layers exist
     * @private
     */
    _getFirstMarkerLayerId() {
        // Check streetview project markers first, then saved photo markers
        const candidateIds = [
            this.streetviewMarkers?.clustersLayer,
            this.streetviewMarkers?.markersLayer,
            this.savedPhotosMarkers?.markersLayer
        ];
        for (const id of candidateIds) {
            if (id && this.map.getLayer(id)) return id;
        }
        return undefined;
    }

    /**
     * Ensures line layers are always below marker layers.
     * Moves line layers if they ended up above markers due to async loading race conditions
     * (e.g., after base layer change when all layers are recreated).
     * @private
     */
    _ensureLayerOrder() {
        const firstMarkerId = this._getFirstMarkerLayerId();
        if (!firstMarkerId) return;

        // Move line layers below the first marker layer
        const lineLayers = [
            this.streetViewLinesLayer?.['id'],
            this.streetViewLinesHitLayer?.['id'],
            this.streetViewPointsLayer?.['id']
        ];

        for (const layerId of lineLayers) {
            if (layerId && this.map.getLayer(layerId)) {
                this.map.moveLayer(layerId, firstMarkerId);
            }
        }
    }

    showLayers = () => {
        // Find first marker layer so lines are inserted below markers
        const beforeId = this._getFirstMarkerLayerId();

        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'visible');
        }

        // Add line layers before marker layers so markers render above them
        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        } else {
            this.map.addLayer(this.streetViewLinesLayer, beforeId);
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        }

        // Hit layer (invisible wider line for click/hover) — also before markers
        const hitLayerId = this.streetViewLinesHitLayer['id'];
        if (this.map.getLayer(hitLayerId)) {
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'visible');
        } else if (this.map.getSource(this.streetViewLinesHitLayer['source'])) {
            this.map.addLayer(this.streetViewLinesHitLayer, beforeId);
            this.map.setLayoutProperty(hitLayerId, 'visibility', 'visible');
        }

        // Ensure correct z-order after all layers are set visible
        this._ensureLayerOrder();
    }

    clearCache = () => {
        this.nearbyFeaturesCache.clear();
    }

    /**
     * Navigate to a specific streetview marker and open its preview popup.
     * Used by external components like search.
     * Delegates to the StreetviewMarkers module.
     * @param {string} markerId - ID of the marker to navigate to
     * @returns {Promise<boolean>} True if navigation successful
     */
    async navigateToStreetViewMarker(markerId) {
        if (this.streetviewMarkers) {
            return this.streetviewMarkers.navigateToMarker(markerId);
        }
        return false;
    }
}

export default AddStreetViewControl;
