// Path: src/js/controls_sig/3d_models_viewer_tool/add_3d_models_viewer_control.js

import config from '../../config.js';

class Add3DModelsViewerControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.markersVisible = false;
        this.markersLayer = '3d-models-markers';
        this.map = null;
        this.container = null;

        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.closeViewer = this.closeViewer.bind(this);
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group models3d-view-control controls-column-left';

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

    onRemove() {
        this.container.parentNode.removeChild(this.container);
    }

    async activate() {
        if (this.isActive) {
            this.toolManager.deactivateCurrentTool();
            return;
        }

        if (window.streetViewControl?.isOpen) {
            window.streetViewControl.closeStreetView();
        }

        this.isActive = true;
        this.changeButtonColor();

        const closeBtn = document.getElementById('close-3d-viewer-button');
        if (closeBtn) closeBtn.addEventListener('click', this.closeViewer);

        await this.loadMarkers();
        this.showMarkers();
    }

    deactivate() {
        this.isActive = false;
        this.changeButtonColor();
        this.hideMarkers();
        const closeBtn = document.getElementById('close-3d-viewer-button');
        if (closeBtn) closeBtn.removeEventListener('click', this.closeViewer);

        const map3dContainer = document.getElementById('map-3d-container');
        if (map3dContainer && map3dContainer.style.display !== 'none') {
            this.closeViewer();
        }
    }

    changeButtonColor() {
        const iconSrc = this.isActive
            ? './images/icon_3d_red.svg'
            : './images/icon_3d_black.svg';
        const btn = document.getElementById('models3d-viewer-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" />`;
    }

    async loadMarkers() {
        const features = config.tilesets.map(tileset => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [tileset.locate.lon, tileset.locate.lat]
            },
            properties: {
                tilesetId: tileset.id,
                name: tileset.name
            }
        }));

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        if (!this.map.getSource(this.markersLayer)) {
            this.map.addSource(this.markersLayer, {
                type: 'geojson',
                data: geojson
            });

            const markerPinSvg = `<svg width="48" height="64" viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="24" cy="60" rx="12" ry="4" fill="#000000" opacity="0.3"/>
                <path d="M24,2 C13.5,2 5,10.5 5,21 C5,32 24,58 24,58 C24,58 43,32 43,21 C43,10.5 34.5,2 24,2 Z" fill="#508d4e" stroke="#ffffff" stroke-width="2"/>
                <circle cx="24" cy="21" r="10" fill="#ffffff" opacity="0.9"/>
                <g transform="translate(24, 21) scale(0.5)">
                    <path d="M0,-8 L-7,-4 L-7,4 L0,8 L7,4 L7,-4 Z" fill="#508d4e" stroke="#508d4e" stroke-width="1"/>
                    <path d="M0,-8 L-7,-4 L0,0 Z" fill="#3d6e3b"/>
                    <path d="M0,-8 L7,-4 L0,0 Z" fill="#6ba85e"/>
                </g>
            </svg>`;

            await new Promise((resolve, reject) => {
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

            this.map.addLayer({
                id: this.markersLayer,
                type: 'symbol',
                source: this.markersLayer,
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

            this.map.addLayer({
                id: this.markersLayer + '-labels',
                type: 'symbol',
                source: this.markersLayer,
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
            this.map.getSource(this.markersLayer).setData(geojson);
        }
    }

    showMarkers() {
        if (!this.map.getLayer(this.markersLayer)) return;

        this.map.on('click', this.markersLayer, this.handleMarkerClick);
        this.map.on('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.on('mouseleave', this.markersLayer, this.hideHoverCursor);

        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'visible');
        this.map.setLayoutProperty(this.markersLayer + '-labels', 'visibility', 'visible');
        this.markersVisible = true;
    }

    hideMarkers() {
        if (!this.map.getLayer(this.markersLayer)) return;

        this.map.off('click', this.markersLayer, this.handleMarkerClick);
        this.map.off('mouseenter', this.markersLayer, this.showHoverCursor);
        this.map.off('mouseleave', this.markersLayer, this.hideHoverCursor);

        this.map.setLayoutProperty(this.markersLayer, 'visibility', 'none');
        this.map.setLayoutProperty(this.markersLayer + '-labels', 'visibility', 'none');
        this.markersVisible = false;
    }

    async handleMarkerClick(e) {
        const tilesetId = e.features[0].properties.tilesetId;
        await this.openViewer(tilesetId);
    }

    async openViewer(tilesetId) {
        try {
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

    setFullMap(full) {
        const topBar = document.getElementById('top-bar');
        const mapSig = document.getElementById('map-sig');
        const map3dContainer = document.getElementById('map-3d-container');

        if (topBar) topBar.style.display = full ? 'flex' : 'none';
        if (mapSig) mapSig.style.display = full ? 'block' : 'none';
        if (map3dContainer) map3dContainer.style.display = full ? 'none' : 'block';
    }

    showHoverCursor() {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    hideHoverCursor() {
        this.map.getCanvas().style.cursor = '';
    }
}

export default Add3DModelsViewerControl;
