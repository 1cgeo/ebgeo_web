class SelectionManager {
    constructor(map, drawControl, textControl, imageControl, losControl, visibilityControl) {
        this.map = map;
        this.uiControl = null;
        this.drawControl = drawControl;
        this.textControl = textControl;
        this.imageControl = imageControl;
        this.losControl = losControl;
        this.visibilityControl = visibilityControl;
        this.selectedFeatures = new Set();
        this.selectedTextFeatures = new Set();
        this.selectedImageFeatures = new Set();
        this.selectedLOSFeatures = new Set();
        this.selectedVisibilityFeatures = new Set();

        this.setupEventListeners();
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    setupEventListeners = () => {
        this.map.on('click', this.handleMapClick);
        this.map.on('click', 'text-layer', this.handleElementClick);
        this.map.on('click', 'image-layer', this.handleElementClick);
        this.map.on('click', 'los-layer', this.handleElementClick);
        this.map.on('click', 'visibility-layer', this.handleElementClick);
        this.map.on('draw.selectionchange', this.handleDrawSelectionChange);
    }

    handleMapClick = (e) => {
        if (e.defaultPrevented) return;

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
        } else {
            if (!e.originalEvent.shiftKey) {
                if (this.uiManager) {
                    this.uiManager.saveChangesAndClosePanel();
                }
                this.deselectAllFeatures();
            }
        }
        this.updateUI();
    }

    handleElementClick = (e) => {
        e.preventDefault();

        if (!e.originalEvent.shiftKey) {
            this.deselectAllFeatures();
        }

        const feature = e.features[0];
        const layerId = feature.layer.id;
        const featureId  = feature.id;

        if (layerId === 'text-layer') {
            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            const feature = data.features.find(f => f.id == featureId);
            this.toggleTextSelection(feature);
        } else if (layerId === 'image-layer') {
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            const feature = data.features.find(f => f.id == featureId);
            this.toggleImageSelection(feature);
        } else if (layerId === 'los-layer') {
            const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
            const feature = data.features.find(f => f.id == featureId);
            this.toggleLOSSelection(feature);
        } else if (layerId === 'visibility-layer') {
            const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
            const feature = data.features.find(f => f.id == featureId);
            this.toggleVisibilitySelection(feature);
        }

        this.updateUI();
    }

    handleDrawSelectionChange = (e) => {
        this.selectedFeatures = new Set(this.drawControl.draw.getSelected().features);
        this.updateUI();
    }

    toggleTextSelection = (feature) => {
        if (this.selectedTextFeatures.has(feature)) {
            this.selectedTextFeatures.delete(feature);
        } else {
            this.selectedTextFeatures.add(feature);
        }
    }

    toggleImageSelection = (feature) => {
        if (this.selectedImageFeatures.has(feature)) {
            this.selectedImageFeatures.delete(feature);
        } else {
            this.selectedImageFeatures.add(feature);
        }
    }

    toggleLOSSelection = (feature) => {
        if (this.selectedLOSFeatures.has(feature)) {
            this.selectedLOSFeatures.delete(feature);
        } else {
            this.selectedLOSFeatures.add(feature);
        }
    }

    toggleVisibilitySelection = (feature) => {
        if (this.selectedVisibilityFeatures.has(feature)) {
            this.selectedVisibilityFeatures.delete(feature);
        } else {
            this.selectedVisibilityFeatures.add(feature);
        }
    }

    toggleDrawSelection = (feature) => {
        if (this.selectedFeatures.has(feature)) {
            this.selectedFeatures.delete(feature);
            this.drawControl.draw.changeMode('simple_select', { featureIds: Array.from(this.selectedFeatures).map(f => f.id) });
        } else {
            this.selectedFeatures.add(feature);
            this.drawControl.draw.changeMode('simple_select', { featureIds: Array.from(this.selectedFeatures).map(f => f.id) });
        }
    }

    deselectAllFeatures = (forceDraw = false) => {
        this.selectedTextFeatures.clear();
        this.selectedImageFeatures.clear();
        this.selectedLOSFeatures.clear();
        this.selectedVisibilityFeatures.clear();
        this.selectedFeatures.clear();

        if(forceDraw){
            this.drawControl.draw.changeMode('simple_select', { featureIds: [] });
        }
    }

    updateUI = () => {
        if (this.uiManager) {
            this.uiManager.updateSelectionHighlight();
            this.uiManager.updatePanels();
        }
    }

    getActiveTool = () => {
        if (this.textControl.isActive) return this.textControl;
        if (this.imageControl.isActive) return this.imageControl;
        if (this.losControl.isActive) return this.losControl;
        if (this.visibilityControl.isActive) return this.visibilityControl;
        if (this.drawControl.isActive) return this.drawControl;
        return null;
    }

    deleteSelectedFeatures = () => {
        this.textControl.deleteFeatures(this.selectedTextFeatures);
        this.imageControl.deleteFeatures(this.selectedImageFeatures);
        this.losControl.deleteFeatures(this.selectedLOSFeatures);
        this.visibilityControl.deleteFeatures(this.selectedVisibilityFeatures);
        this.drawControl.deleteFeatures(this.selectedFeatures);

        this.deselectAllFeatures();
        this.updateUI();
    }

    updateFeature(feature, sourceId) {
        if(sourceId === 'texts') {
            this.textControl.updateFeatures([feature], false);
        } else if(sourceId === 'images') {
            this.imageControl.updateFeatures([feature], false);
        } else if(sourceId === 'draw') {
            this.drawControl.updateFeatures([feature], false);
        } else if(sourceId === 'los') {
            this.losControl.updateFeatures([feature], false);
        } else if(sourceId === 'visibility') {
            this.visibilityControl.updateFeatures([feature], false);
        } else {
            console.error('Unknown source id');
        }
    }

    updateSelectedFeatures() {
        this.textControl.updateFeatures(this.selectedTextFeatures, true);
        this.imageControl.updateFeatures(this.selectedImageFeatures, true);
        this.losControl.updateFeatures(this.selectedLOSFeatures, true);
        this.visibilityControl.updateFeatures(this.selectedVisibilityFeatures, true);
        this.drawControl.updateFeatures(this.selectedFeatures, true);
    }
}

export default SelectionManager;