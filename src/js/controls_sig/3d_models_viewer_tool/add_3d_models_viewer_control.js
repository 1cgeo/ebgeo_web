// Path: js/controls_sig/3d_models_viewer_tool/add_3d_models_viewer_control.js

import config from '../../config.js';

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
const VIDEO_POPUP_WIDTH = 320;
const VIDEO_POPUP_HEIGHT = 180;

// Marker pin vertical offset for popup positioning
const MARKER_POPUP_OFFSET = 60;

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

        // Popup state
        this.previewPopup = null;
        this.activeVideoElement = null;
        this.currentOpenTilesetId = null;

        // Bind methods
        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.handleClusterClick = this.handleClusterClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.closeViewer = this.closeViewer.bind(this);
        this.handlePopupClose = this.handlePopupClose.bind(this);
    }

    /**
     * Called when control is added to the map
     * @param {Object} map - MapLibre map instance
     * @returns {HTMLElement} Control container element
     */
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group models3d-view-control controls-bottom-left';

        const button = document.createElement('button');
        button.setAttribute("id", "models3d-viewer-tool");
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.title = 'Visualizar modelos 3D';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_3d_black.svg" />';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        const isMap3dEnabled = config.features?.map_3d ?? true;
        const hasTilesets = config.hasTilesets();

        if (!isMap3dEnabled || !hasTilesets) {
            this.container.classList.add('disabled');
            button.disabled = true;
        }

        this.changeButtonColor();
        return this.container;
    }

    /**
     * Called when control is removed from the map
     */
    onRemove() {
        this.container.parentNode.removeChild(this.container);
    }

    /**
     * Activate the 3D models viewer tool
     */
    async activate() {
        if (this.isActive) {
            this.toolManager.deactivateCurrentTool();
            return;
        }

        // Close Street View if open and deactivate its listeners
        if (window.streetViewControl?.isOpen) {
            window.streetViewControl.closeStreetView();
        }
        if (window.streetViewControl?.isActive) {
            window.streetViewControl.deactivate?.();
        }

        this.isActive = true;
        this.changeButtonColor();

        const closeBtn = document.getElementById('close-3d-viewer-button');
        if (closeBtn) closeBtn.addEventListener('click', this.closeViewer);

        await this.loadMarkers();
        this.showMarkers();
    }

    /**
     * Deactivate the 3D models viewer tool
     */
    deactivate() {
        this.isActive = false;
        this.changeButtonColor();
        this.removePreviewPopup();
        this.hideMarkers();

        const closeBtn = document.getElementById('close-3d-viewer-button');
        if (closeBtn) closeBtn.removeEventListener('click', this.closeViewer);

        const map3dContainer = document.getElementById('map-3d-container');
        if (map3dContainer && map3dContainer.style.display !== 'none') {
            this.closeViewer();
        }
    }

    /**
     * Update button icon based on active state
     */
    changeButtonColor() {
        const iconSrc = this.isActive
            ? './images/icon_3d_red.svg'
            : './images/icon_3d_black.svg';
        const btn = document.getElementById('models3d-viewer-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" />`;
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
                previewThumbnail: tileset.previewThumbnail || null
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
        } else {
            this.map.getSource(this.sourceId).setData(geojson);
        }
    }

    /**
     * Show markers and enable event listeners
     */
    showMarkers() {
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

        this.markersVisible = true;
    }

    /**
     * Hide markers and remove event listeners
     */
    hideMarkers() {
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

        this.markersVisible = false;
    }

    /**
     * Handle click on cluster - zoom to expand
     * @param {Object} e - Map click event
     */
    async handleClusterClick(e) {
        // Ignore if tool is not active
        if (!this.isActive) return;

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
            if (closeBtn) closeBtn.style.display = 'flex';

            const map3dModule = await import('../../map_3d.js');
            await map3dModule.openViewerWithTileset(tilesetId);

        } catch (error) {
            console.error('Error opening 3D viewer:', error);
            this.setFullMap(true);
            const closeBtn = document.getElementById('close-3d-viewer-button');
            if (closeBtn) closeBtn.style.display = 'none';
        }
    }

    /**
     * Close the 3D viewer and return to map
     */
    async closeViewer() {
        try {
            const map3dModule = await import('../../map_3d.js');
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
        const topBar = document.getElementById('top-bar');
        const mapSig = document.getElementById('map-sig');
        const map3dContainer = document.getElementById('map-3d-container');

        if (topBar) topBar.style.display = full ? 'flex' : 'none';
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
}

export default Add3DModelsViewerControl;
