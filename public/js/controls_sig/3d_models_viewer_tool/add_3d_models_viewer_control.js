// js/controls_sig/3d_models_viewer_tool/add_3d_models_viewer_control.js

import config from '../../config.js';

class Add3DModelsViewerControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.markersVisible = false;
        this.markersLayer = '3d-models-markers';
        this.map = null;
        this.container = null;
        
        // Bind methods
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
        this.changeButtonColor();
        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
    }

    async activate() {
        // Toggle behavior
        if (this.isActive) {
            this.toolManager.deactivateCurrentTool();
            return;
        }

        // Fechar street view se estiver aberto
        if (window.streetViewControl?.isOpen) {
            window.streetViewControl.closeStreetView();
        }

        this.isActive = true;
        this.changeButtonColor();
        
        $('#close-3d-viewer-button').on('click', this.closeViewer);
        
        await this.loadMarkers();
        this.showMarkers();
    }

    deactivate() {
        this.isActive = false;
        this.changeButtonColor();
        this.hideMarkers();
        $('#close-3d-viewer-button').off('click', this.closeViewer);
        
        // Se o viewer estiver aberto, fechar
        if ($('#map-3d-container').is(':visible')) {
            this.closeViewer();
        }
    }

    changeButtonColor() {
        const iconSrc = this.isActive 
            ? './images/icon_3d_red.svg' 
            : './images/icon_3d_black.svg';
        $("#models3d-viewer-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" />`);
    }

    async loadMarkers() {
        // Criar GeoJSON a partir de config.tilesets
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

        // Adicionar source se não existir
        if (!this.map.getSource(this.markersLayer)) {
            this.map.addSource(this.markersLayer, {
                type: 'geojson',
                data: geojson
            });

            // Adicionar layer de círculos
            this.map.addLayer({
                id: this.markersLayer,
                type: 'circle',
                source: this.markersLayer,
                paint: {
                    'circle-radius': 10,
                    'circle-color': '#508d4e',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff'
                },
                layout: {
                    'visibility': 'none'
                }
            });

            // Adicionar layer de labels
            this.map.addLayer({
                id: this.markersLayer + '-labels',
                type: 'symbol',
                source: this.markersLayer,
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 12,
                    'text-offset': [0, 1.5],
                    'text-anchor': 'top',
                    'visibility': 'none'
                },
                paint: {
                    'text-color': '#508d4e',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            });
        } else {
            // Atualizar dados se já existir
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
            // Esconder mapa 2D e mostrar 3D
            this.setFullMap(false);
            $('#close-3d-viewer-button').show();

            // Importar dinamicamente map_3d (subir 2 níveis: ../.. desde controls_sig/3d_models_viewer_tool/)
            const map3dModule = await import('../../map_3d.js');
            await map3dModule.openViewerWithTileset(tilesetId);

        } catch (error) {
            console.error('Erro ao abrir viewer 3D:', error);
            this.setFullMap(true);
            $('#close-3d-viewer-button').hide();
        }
    }

    async closeViewer() {
        try {
            // Importar dinamicamente map_3d (subir 2 níveis: ../.. desde controls_sig/3d_models_viewer_tool/)
            const map3dModule = await import('../../map_3d.js');
            map3dModule.closeViewer();

            this.setFullMap(true);
            $('#close-3d-viewer-button').hide();
        } catch (error) {
            console.error('Erro ao fechar viewer 3D:', error);
        }
    }

    setFullMap(full) {
        $('#top-bar').css({ display: full ? 'flex' : 'none' });
        $('#map-sig').css({ display: full ? 'block' : 'none' });
        $('#map-3d-container').css({ display: full ? 'none' : 'block' });
    }

    showHoverCursor() {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    hideHoverCursor() {
        this.map.getCanvas().style.cursor = '';
    }
}

export default Add3DModelsViewerControl;