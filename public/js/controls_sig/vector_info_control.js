// Path: js\controls_sig\vector_info_control.js
import config from '../config.js';

class VectorTileInfoControl {
    constructor(toolManager, uiManager) {
        this.toolManager = toolManager;
        this.uiManager = uiManager;
        this.isActive = false;
        this.map = null;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl vector-info-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "vector-tile-info-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_info_black.svg" alt="INFO" />';
        button.title = 'Informação da carta (N)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        const isEnabled = config.features?.vector_info ?? true;
        if (!isEnabled) {
            this.container.classList.add('disabled');
            button.disabled = true;
        }

        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        const isEnabled = config.features?.vector_info ?? true;
        
        if (!isEnabled) {
            // Use setTimeout para garantir que DOM está pronto
            setTimeout(() => {
                $("#vector-tile-info-tool").html('<img class="icon-sig-tool" src="./images/icon_info_gray.svg" alt="INFO" />');
            }, 10);
            return;
        }
        
        $("#vector-tile-info-tool").html(`<img class="icon-sig-tool" src="./images/icon_info_black.svg" alt="INFO" />`);
        if (!this.isActive) return
        $("#vector-tile-info-tool").html('<img class="icon-sig-tool" src="./images/icon_info_red.svg" alt="INFO" />');
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        const isEnabled = config.features?.vector_info ?? true;
        if (!isEnabled) {
            return false;
        }

        this.isActive = true;
        this.map.getCanvas().style.cursor = 'help';
        this.changeButtonColor()
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor()
        this.uiManager.saveChangesAndClosePanel();
    }

    handleMapClick(e) {
        if (this.isActive) {
            const features = this.map.queryRenderedFeatures(e.point);
            const vectorTileFeatures = features.filter(f => f.sourceLayer && !f.properties.source);
            if (vectorTileFeatures.length > 0) {
                const preferenceOrder = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

                vectorTileFeatures.sort((a, b) => {
                    const aPriority = a.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(a.geometry.type);
                    const bPriority = b.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(b.geometry.type);

                    return aPriority - bPriority;
                });

                this.uiManager.showVectorTileInfoPanel(vectorTileFeatures[0]);
            } else {
                this.uiManager.saveChangesAndClosePanel();
            }
        }
    }
}

export default VectorTileInfoControl;