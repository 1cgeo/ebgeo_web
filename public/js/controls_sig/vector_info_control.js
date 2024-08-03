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

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'help';
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
    }

    handleMapClick(e) {
        if (this.isActive) {
            const features = this.map.queryRenderedFeatures(e.point);
            if (features.length > 0) {
                this.uiManager.showVectorTileInfoPanel(features[0]);
            } else {
                this.uiManager.saveChangesAndClosePanel();
            }
            this.toolManager.deactivateCurrentTool();
        }
    }
}

export default VectorTileInfoControl;