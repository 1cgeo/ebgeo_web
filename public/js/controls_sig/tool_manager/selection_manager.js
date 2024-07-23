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

        this.drawControl.draw.changeMode('simple_select', { featureIds: Array.from(this.selectedFeatures).map(f => f.id) });

        this.updateUI();
    }

    handleDrawSelectionChange = (e) => {
        const selectedFeatures = this.drawControl.draw.getSelected().features;
        this.selectedFeatures = new Set(selectedFeatures);
        this.updateUI();
    }

    toggleSelection(feature, selectedSet) {
        if (selectedSet.has(feature)) {
            selectedSet.delete(feature);
        } else {
            selectedSet.add(feature);
        }
    }

    toggleTextSelection(feature) {
        this.toggleSelection(feature, this.selectedTextFeatures);
    }

    toggleImageSelection(feature) {
        this.toggleSelection(feature, this.selectedImageFeatures);
    }

    toggleLOSSelection(feature) {
        this.toggleSelection(feature, this.selectedLOSFeatures);
    }

    toggleVisibilitySelection(feature) {
        this.toggleSelection(feature, this.selectedVisibilityFeatures);
    }

    deselectAllFeatures = (forceDraw = false) => {
        this.selectedTextFeatures.clear();
        this.selectedImageFeatures.clear();
        this.selectedLOSFeatures.clear();
        this.selectedVisibilityFeatures.clear();

        if(forceDraw) {
            this.drawControl.draw.changeMode('simple_select', { featureIds: [] });
            this.selectedFeatures.clear();
        }
    }

    getAllSelectedFeatures() {
        return [
            ...Array.from(this.selectedTextFeatures).map(feature => ({ ...feature, source: 'text' })),
            ...Array.from(this.selectedImageFeatures).map(feature => ({ ...feature, source: 'image' })),
            ...Array.from(this.selectedLOSFeatures).map(feature => ({ ...feature, source: 'los' })),
            ...Array.from(this.selectedVisibilityFeatures).map(feature => ({ ...feature, source: 'visibility' })),
            ...Array.from(this.selectedFeatures).map(feature => ({ ...feature, source: 'draw' }))
        ];
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

    updateSelectedFeatures(save = false) {
        this.textControl.updateFeatures(this.selectedTextFeatures, save);
        this.imageControl.updateFeatures(this.selectedImageFeatures, save);
        this.losControl.updateFeatures(this.selectedLOSFeatures, save);
        this.visibilityControl.updateFeatures(this.selectedVisibilityFeatures, save);
        this.drawControl.updateFeatures(this.selectedFeatures, save);
    }
}

export default SelectionManager;