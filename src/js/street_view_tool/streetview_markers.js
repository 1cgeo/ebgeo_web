// Path: js/street_view_tool/streetview_markers.js

import config from '../config.js';

// Flag to prevent click propagation to line layer when marker is clicked
// Shared between streetview markers and 3D viewer markers via window object
window._markerClickConsumed = false;

// Streetview marker clustering configuration
const SV_CLUSTER_CONFIG = {
    maxZoom: 14,
    radius: 50
};

// Cluster size breakpoints based on point count
const SV_CLUSTER_SIZE_STEPS = {
    small: { maxCount: 10, radius: 18 },
    medium: { maxCount: 50, radius: 22 },
    large: { radius: 26 }
};

// Streetview primary color (orange - contrasts well with blue line)
const SV_MARKER_COLOR = '#ff6b00';

// Marker popup offset
const SV_MARKER_POPUP_OFFSET = 55;

/**
 * Manages streetview markers on the map.
 * Displays clustered markers with preview popups for specific panoramic photo locations.
 */
class StreetviewMarkers {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} streetViewControl - Reference to the parent street view control
     */
    constructor(map, streetViewControl) {
        this.map = map;
        this.streetViewControl = streetViewControl;

        // Layer IDs
        this.sourceId = 'streetview-markers-source';
        this.clustersLayer = 'streetview-markers-clusters';
        this.clusterCountLayer = 'streetview-markers-cluster-count';
        this.markersLayer = 'streetview-markers-pins';
        this.labelsLayer = 'streetview-markers-labels';

        // Popup state
        this.previewPopup = null;
        this.currentOpenMarkerId = null;

        // Bind methods
        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.handleClusterClick = this.handleClusterClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
    }

    /**
     * Check if the street view control is active
     * @returns {boolean}
     */
    get isActive() {
        return this.streetViewControl?.isActive ?? false;
    }

    /**
     * Load marker image (SVG pin) into the map
     * @returns {Promise<void>}
     */
    async loadMarkerImage() {
        const markerPinSvg = `<svg width="48" height="64" viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="24" cy="60" rx="12" ry="4" fill="#000000" opacity="0.3"/>
            <path d="M24,2 C13.5,2 5,10.5 5,21 C5,32 24,58 24,58 C24,58 43,32 43,21 C43,10.5 34.5,2 24,2 Z" fill="${SV_MARKER_COLOR}" stroke="#ffffff" stroke-width="2"/>
            <circle cx="24" cy="21" r="10" fill="#ffffff" opacity="0.9"/>
            <g transform="translate(24, 21)">
                <circle cx="0" cy="0" r="6" fill="none" stroke="${SV_MARKER_COLOR}" stroke-width="2"/>
                <circle cx="0" cy="0" r="2" fill="${SV_MARKER_COLOR}"/>
                <line x1="-8" y1="0" x2="-6" y2="0" stroke="${SV_MARKER_COLOR}" stroke-width="1.5"/>
                <line x1="6" y1="0" x2="8" y2="0" stroke="${SV_MARKER_COLOR}" stroke-width="1.5"/>
                <line x1="0" y1="-8" x2="0" y2="-6" stroke="${SV_MARKER_COLOR}" stroke-width="1.5"/>
                <line x1="0" y1="6" x2="0" y2="8" stroke="${SV_MARKER_COLOR}" stroke-width="1.5"/>
            </g>
        </svg>`;

        return new Promise((resolve, reject) => {
            const img = new Image(48, 64);
            img.onload = () => {
                try {
                    if (!this.map.hasImage('streetview-marker')) {
                        this.map.addImage('streetview-marker', img, { pixelRatio: 2 });
                    }
                    resolve();
                } catch (error) {
                    console.error('Error adding streetview marker image to map:', error);
                    reject(error);
                }
            };
            img.onerror = (error) => {
                console.error('Error loading streetview marker SVG:', error);
                reject(new Error('Failed to load streetview marker image'));
            };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markerPinSvg);
        });
    }

    /**
     * Load markers from API service and create map layers with clustering.
     * Fetches projects from the Street View 360 API service.
     */
    async loadMarkers() {
        let features;

        try {
            const { fetchProjects } = await import('./streetview-api.service.js');
            const projects = await fetchProjects();
            if (!projects || projects.length === 0) return;

            const serviceUrl = config.streetView360.serviceUrl;

            features = projects.map(p => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [p.center.lon, p.center.lat]
                },
                properties: {
                    markerId: p.id,
                    name: p.name,
                    dataCaptura: p.captureDate || null,
                    previewThumbnail: p.previewThumbnail
                        ? `${serviceUrl}${p.previewThumbnail}`
                        : null,
                    photoName: p.entryPhotoId
                }
            }));
        } catch (error) {
            console.error('Failed to load streetview markers from API:', error);
            return;
        }

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
                clusterMaxZoom: SV_CLUSTER_CONFIG.maxZoom,
                clusterRadius: SV_CLUSTER_CONFIG.radius
            });

            // Marker layers are added at the top of the stack (no beforeId)
            // so they always render above PMTiles line layers

            // Layer 1: Cluster circles
            this.map.addLayer({
                id: this.clustersLayer,
                type: 'circle',
                source: this.sourceId,
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': SV_MARKER_COLOR,
                    'circle-radius': [
                        'step',
                        ['get', 'point_count'],
                        SV_CLUSTER_SIZE_STEPS.small.radius,
                        SV_CLUSTER_SIZE_STEPS.small.maxCount,
                        SV_CLUSTER_SIZE_STEPS.medium.radius,
                        SV_CLUSTER_SIZE_STEPS.medium.maxCount,
                        SV_CLUSTER_SIZE_STEPS.large.radius
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
                    'icon-image': 'streetview-marker',
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
        } else {
            // Update existing source data
            this.map.getSource(this.sourceId).setData(geojson);
        }
    }

    /**
     * Show markers and enable event listeners
     */
    show() {
        if (!this.map.getLayer(this.markersLayer)) return;

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
    }

    /**
     * Hide markers and remove event listeners
     */
    hide() {
        if (!this.map.getLayer(this.markersLayer)) return;

        // Remove popup
        this.removePreviewPopup();

        // Cluster events
        this.map.off('click', this.clustersLayer, this.handleClusterClick);
        this.map.off('mouseenter', this.clustersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.clustersLayer, this.hideHoverCursor);

        // Individual marker events
        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);

        // Set visibility
        this.map.setLayoutProperty(this.clustersLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.clusterCountLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.labelsLayer, 'visibility', 'none');
    }

    /**
     * Handle click on cluster - zoom to expand
     * @param {Object} e - Map click event
     */
    async handleClusterClick(e) {
        if (!this.isActive) return;

        // Skip if click was already consumed by another marker handler
        if (window._markerClickConsumed) return;

        // Mark click as consumed to prevent line handler and other markers from processing
        window._markerClickConsumed = true;

        // Reset flag after current event loop to allow future clicks
        setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0);

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
            console.error('Error expanding streetview marker cluster:', error);
        }
    }

    /**
     * Handle click on individual marker - show preview popup
     * @param {Object} e - Map click event
     */
    handleMarkerClick(e) {
        if (!this.isActive) return;

        // Skip if click was already consumed by another marker handler
        if (window._markerClickConsumed) return;

        // Mark click as consumed to prevent line handler and other markers from processing
        window._markerClickConsumed = true;

        // Reset flag after current event loop to allow future clicks
        setTimeout(() => {
            window._markerClickConsumed = false;
        }, 0);

        e.originalEvent.stopPropagation();
        e.originalEvent.preventDefault();

        const feature = e.features[0];
        const markerId = feature.properties.markerId;

        // Toggle behavior: if clicking same marker, close popup
        if (this.currentOpenMarkerId === markerId && this.previewPopup) {
            this.removePreviewPopup();
            return;
        }

        const coordinates = feature.geometry.coordinates.slice();
        const name = feature.properties.name;
        const dataCaptura = feature.properties.dataCaptura;
        const previewThumbnail = feature.properties.previewThumbnail;
        const photoName = feature.properties.photoName;

        // Adjust coordinates for multiple world copies
        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        // Fly to marker to center it on the map
        this.map.flyTo({
            center: coordinates,
            duration: 500
        });

        this.createPreviewPopup(coordinates, markerId, name, dataCaptura, previewThumbnail, photoName);
    }

    /**
     * Create preview popup with thumbnail and open button
     * @param {number[]} coordinates - [lng, lat] position
     * @param {string} markerId - ID of the marker
     * @param {string} name - Display name
     * @param {string|null} dataCaptura - Capture date in DD/MM/YYYY format or null
     * @param {string|null} previewThumbnail - URL to preview thumbnail or null
     * @param {string} photoName - Photo name for loadImageByName
     */
    createPreviewPopup(coordinates, markerId, name, dataCaptura, previewThumbnail, photoName) {
        // Remove existing popup
        this.removePreviewPopup();

        this.currentOpenMarkerId = markerId;

        // Hide label for current marker
        this.updateLabelFilter(markerId);

        // Determine if we have thumbnail to show
        const hasMedia = !!previewThumbnail;

        // Build popup content
        const container = document.createElement('div');
        container.className = hasMedia ? 'streetview-preview-content' : 'streetview-preview-content no-thumbnail';

        // Prevent clicks inside popup from propagating to map
        container.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Thumbnail element (if available)
        if (previewThumbnail) {
            const img = document.createElement('img');
            img.src = previewThumbnail;
            img.className = 'streetview-preview-thumbnail';
            img.alt = name;
            img.onerror = () => {
                img.remove();
                container.classList.add('no-thumbnail');
            };
            container.appendChild(img);
        }

        // Info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'streetview-preview-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'streetview-preview-name';
        nameDiv.textContent = name;
        infoDiv.appendChild(nameDiv);

        // Capture date (only if available)
        if (dataCaptura) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'streetview-preview-date';
            dateDiv.textContent = `Captura: ${dataCaptura}`;
            infoDiv.appendChild(dateDiv);
        }

        const openButton = document.createElement('button');
        openButton.className = 'streetview-preview-button';
        openButton.textContent = 'Abrir foto 360°';
        openButton.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.openStreetView(photoName);
        };
        infoDiv.appendChild(openButton);

        container.appendChild(infoDiv);

        // Create MapLibre popup
        this.previewPopup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: true,
            anchor: 'bottom',
            offset: [0, -SV_MARKER_POPUP_OFFSET],
            className: 'streetview-preview-popup-container',
            maxWidth: 'none'
        })
            .setLngLat(coordinates)
            .setDOMContent(container)
            .addTo(this.map);

        // Listen for popup close event
        this.previewPopup.on('close', () => this.handlePopupClose());
    }

    /**
     * Open streetview 360° photo
     * @param {string} photoName - Photo name for loadImageByName
     */
    async openStreetView(photoName) {
        this.removePreviewPopup();
        // Use the new viewer API
        const { openViewer360WithPhoto } = await import('./street_view_viewer.js');
        await openViewer360WithPhoto(photoName, {
            miniMap: this.streetViewControl?.miniMap,
            controlInstance: this.streetViewControl
        });
    }

    /**
     * Handle popup close event - restore label visibility
     */
    handlePopupClose() {
        this.currentOpenMarkerId = null;
        this.resetLabelFilter();
        this.previewPopup = null;
    }

    /**
     * Remove preview popup and cleanup
     */
    removePreviewPopup() {
        if (this.previewPopup) {
            this.previewPopup.remove();
            this.previewPopup = null;
        }

        this.currentOpenMarkerId = null;
        this.resetLabelFilter();
    }

    /**
     * Update label filter to hide specific marker's label
     * @param {string} markerId - ID of marker to hide label for
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
     * Navigate to a specific marker and open its preview popup.
     * Used by external components like search.
     * @param {string} markerId - ID of the marker to navigate to
     * @returns {Promise<boolean>} True if navigation successful
     */
    async navigateToMarker(markerId) {
        let markerData = this._findMarkerInSource(markerId);

        // Markers may not be loaded yet (e.g. search before activating street view)
        if (!markerData) {
            await this.loadMarkers();
            markerData = this._findMarkerInSource(markerId);
        }

        // Fallback: build from API cache if source lookup still fails
        if (!markerData) {
            markerData = await this._resolveMarkerFromAPI(markerId);
        }

        if (!markerData) {
            console.warn(`Streetview marker not found: ${markerId}`);
            return false;
        }

        // Activate viewer if not active
        if (!this.isActive && this.streetViewControl?.toolManager) {
            this.streetViewControl.toolManager.toggleViewer(this.streetViewControl);
        }

        // Fly to location
        this.map.flyTo({
            center: markerData.coordinates,
            zoom: 14,
            essential: true
        });

        // Open popup after animation completes
        this.map.once('moveend', () => {
            this.createPreviewPopup(
                markerData.coordinates,
                markerData.markerId,
                markerData.name,
                markerData.dataCaptura,
                markerData.previewThumbnail,
                markerData.photoName
            );
        });

        return true;
    }

    /**
     * Looks up a marker in the GeoJSON source by ID.
     * @private
     * @param {string} markerId
     * @returns {Object|null} Marker data or null
     */
    _findMarkerInSource(markerId) {
        const source = this.map.getSource(this.sourceId);
        if (!source) return null;

        const features = source._data?.features || [];
        const feature = features.find(f => f.properties.markerId === markerId);
        if (!feature) return null;

        return {
            coordinates: feature.geometry.coordinates,
            ...feature.properties
        };
    }

    /**
     * Resolves marker data from the API projects cache.
     * Used as fallback when the GeoJSON source is unavailable.
     * @private
     * @param {string} markerId
     * @returns {Promise<Object|null>}
     */
    async _resolveMarkerFromAPI(markerId) {
        try {
            const { getCachedProjects } = await import('./streetview-api.service.js');
            const projects = getCachedProjects();
            if (!projects) return null;

            const project = projects.find(p => p.id === markerId);
            if (!project?.center) return null;

            const serviceUrl = config.streetView360.serviceUrl;

            return {
                coordinates: [project.center.lon, project.center.lat],
                markerId: project.id,
                name: project.name,
                dataCaptura: project.captureDate || null,
                previewThumbnail: project.previewThumbnail
                    ? `${serviceUrl}${project.previewThumbnail}`
                    : null,
                photoName: project.entryPhotoId
            };
        } catch {
            return null;
        }
    }
}

export default StreetviewMarkers;
