class SelectionManager {
    constructor(map, drawControl, textControl, imageControl, losControl, visibilityControl) {
        this.map = map;
        this.uiControl = null;
        this.drawControl = drawControl;
        this.textControl = textControl;
        this.imageControl = imageControl;
        this.losControl = losControl;
        this.visibilityControl = visibilityControl;
        this.selectedDrawFeatures = new Map();
        this.selectedTextFeatures = new Map();
        this.selectedImageFeatures = new Map();
        this.selectedLOSFeatures = new Map();
        this.selectedVisibilityFeatures = new Map();

        this.setupEventListeners();
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    setvectorTileInfoControl(vectorTileInfoControl) {
        this.vectorTileInfoControl = vectorTileInfoControl;
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

            const clickedFeature = this.getClickedDrawFeature(e.point);

            if (!clickedFeature) {
                if (!e.originalEvent.shiftKey) {
                    this.uiManager.saveChangesAndClosePanel();
                    this.deselectAllFeatures();
                }
            } else {
                if (this.selectedDrawFeatures.has(clickedFeature.id)) {
                    this.drawControl.draw.changeMode('direct_select', { featureId: clickedFeature.id });
                } else {
                    if (!e.originalEvent.shiftKey) {
                        this.deselectAllFeatures();
                    }
                }
            }
            this.updateUI();
        }
    }

    getClickedDrawFeature(point) {
        const features = this.map.queryRenderedFeatures(point);
        return features.find(f => f.source === 'mapbox-gl-draw-cold' || f.source === 'mapbox-gl-draw-hot');
    }

    handleElementClick = (e) => {
        e.preventDefault();
        if (!e.originalEvent.shiftKey) {
            this.deselectAllFeatures();
        }

        const feature = e.features[0];
        const source = feature.properties.source;
        const featureId = feature.id;

        this.toggleFeatureSelection(source, featureId, feature);

        const drawFeatureIds = Array.from(this.selectedDrawFeatures.keys());
        this.drawControl.draw.changeMode('simple_select', { featureIds: drawFeatureIds });

        this.updateUI();
    }

    toggleFeatureSelection(source, featureId, feature) {
        let targetMap;
        switch (source) {
            case 'text':
                targetMap = this.selectedTextFeatures;
                break;
            case 'image':
                targetMap = this.selectedImageFeatures;
                break;
            case 'los':
                targetMap = this.selectedLOSFeatures;
                break;
            case 'visibility':
                targetMap = this.selectedVisibilityFeatures;
                break;
            case 'draw':
                targetMap = this.selectedDrawFeatures;
                break;
            default:
                console.error('Invalid source');
        }

        if (targetMap.has(featureId)) {
            targetMap.delete(featureId);
        } else {
            targetMap.set(featureId, feature);
        }
    }

    handleDrawSelectionChange = (e) => {
        const selectedFeatures = this.drawControl.draw.getSelected().features;
        this.selectedDrawFeatures = new Map(
            selectedFeatures.map(f => [f.id, f])
        );
        this.updateUI();
    }

    deselectAllFeatures = (forceDraw = false) => {
        this.selectedTextFeatures.clear();
        this.selectedImageFeatures.clear();
        this.selectedLOSFeatures.clear();
        this.selectedVisibilityFeatures.clear();

        if(forceDraw) {
            this.drawControl.draw.changeMode('simple_select', { featureIds: [] });
            this.selectedDrawFeatures.clear();
        }
    }

    getAllSelectedFeatures() {
        return [
            ...[...this.selectedDrawFeatures.values()],
            ...[...this.selectedTextFeatures.values()],
            ...[...this.selectedImageFeatures.values()],
            ...[...this.selectedLOSFeatures.values()],
            ...[...this.selectedVisibilityFeatures.values()]
        ];
    }

    updateUI = () => {
        this.uiManager.updateSelectionHighlight();
        this.uiManager.updatePanels();
    }

    getActiveTool = () => {
        if (this.textControl.isActive) return this.textControl;
        if (this.imageControl.isActive) return this.imageControl;
        if (this.losControl.isActive) return this.losControl;
        if (this.visibilityControl.isActive) return this.visibilityControl;
        if (this.vectorTileInfoControl.isActive) return this.vectorTileInfoControl;
        if (this.drawControl.isActive) return this.drawControl;
        return null;
    }

    deleteSelectedFeatures = () => {
        this.textControl.deleteFeatures([...this.selectedTextFeatures.values()]);
        this.imageControl.deleteFeatures([...this.selectedImageFeatures.values()]);
        this.losControl.deleteFeatures([...this.selectedLOSFeatures.values()]);
        this.visibilityControl.deleteFeatures([...this.selectedVisibilityFeatures.values()]);
        this.drawControl.deleteFeatures([...this.selectedDrawFeatures.values()]);

        this.deselectAllFeatures(true);
        this.updateUI();
    }

    updateSelectedFeatures(save = false) {
        this.textControl.updateFeatures([...this.selectedTextFeatures.values()], save);
        this.imageControl.updateFeatures([...this.selectedImageFeatures.values()], save);
        this.losControl.updateFeatures([...this.selectedLOSFeatures.values()], save);
        this.visibilityControl.updateFeatures([...this.selectedVisibilityFeatures.values()], save);
        this.drawControl.updateFeatures([...this.selectedDrawFeatures.values()], save);
    }
}

export default SelectionManager;