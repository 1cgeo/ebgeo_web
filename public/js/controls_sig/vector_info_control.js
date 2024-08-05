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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "vector-tile-info-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_info_black.svg" alt="INFO" />';
        button.title = 'Informação da carta';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $("#vector-tile-info-tool").html(`<img class="icon-sig-tool" src="./images/icon_info_${color}.svg" alt="INFO" />`);
        if (!this.isActive) return
        $("#vector-tile-info-tool").html('<img class="icon-sig-tool" src="./images/icon_info_red.svg" alt="INFO" />');
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
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
            if (features.length > 0) {
                const preferenceOrder = ['Point', 'LineString', 'Polygon'];
    
                features.sort((a, b) => {
                    return preferenceOrder.indexOf(a.geometry.type) - preferenceOrder.indexOf(b.geometry.type);
                });
    
                this.uiManager.showVectorTileInfoPanel(features[0]);
            } else {
                this.uiManager.saveChangesAndClosePanel();
            }
        }
    }
}

export default VectorTileInfoControl;