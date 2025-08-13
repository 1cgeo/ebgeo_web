// Path: js\controls_sig\tool_manager\selection_manager.js
class SelectionManager {
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.drawControl = null;
        this.textControl = null;
        this.imageControl = null;
        this.losControl = null;
        this.visibilityControl = null;
        this.circleControl = null;
        this.ellipseControl = null;
        this.arrowControl = null;
        this.boundaryControl = null;
        this.selectedDrawFeatures = new Map();
        this.selectedTextFeatures = new Map();
        this.selectedImageFeatures = new Map();
        this.selectedLOSFeatures = new Map();
        this.selectedVisibilityFeatures = new Map();
        this.selectedCircleFeatures = new Map();
        this.selectedEllipseFeatures = new Map();
        this.selectedArrowFeatures = new Map();
        this.selectedBoundaryFeatures = new Map();

        this.setupEventListeners();
    }

    setDrawControl(drawControl) {
        this.drawControl = drawControl;
    }

    setTextControl(textControl) {
        this.textControl = textControl;
    }

    setImageControl(imageControl) {
        this.imageControl = imageControl;
    }

    setLosControl(losControl) {
        this.losControl = losControl;
    }

    setVisibilityControl(visibilityControl) {
        this.visibilityControl = visibilityControl;
    }

    setCircleControl(circleControl) {
        this.circleControl = circleControl;
    }

    setEllipseControl(ellipseControl) {
        this.ellipseControl = ellipseControl;
    }

    setArrowControl(arrowControl) {
        this.arrowControl = arrowControl;
    }

    setBoundaryControl(boundaryControl) {
        this.boundaryControl = boundaryControl;
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
        this.map.on('click', 'circle-fill-layer', this.handleElementClick);
        this.map.on('click', 'circle-layer', this.handleElementClick);
        this.map.on('click', 'ellipse-layer', this.handleElementClick);
        this.map.on('click', 'ellipse-fill-layer', this.handleElementClick);
        this.map.on('click', 'arrow-layer', this.handleElementClick);
        this.map.on('click', 'arrow-fill-layer', this.handleElementClick);
        this.map.on('click', 'boundary-line-layer', this.handleElementClick);
        this.map.on('click', 'boundary-symbol-layer', this.handleElementClick);
        this.map.on('click', 'boundary-text-layer', this.handleElementClick);
        this.map.on('draw.selectionchange', this.handleDrawSelectionChange);
    }

    handleMapClick = (e) => {
        if (e.defaultPrevented) return;

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
        } else {
            // Check for maplibredraw features
            const clickedDrawFeature = this.getClickedDrawFeature(e.point);
            
            // Check for custom tool features (circle, ellipse, etc.)
            const clickedCustomFeature = this.getClickedCustomFeature(e.point);

            // Check if we clicked on an edit handle
            if (this.isClickOnEditHandle(e.point)) {
                return; // Don't deselect if clicking on edit handles
            }

            // Handle maplibredraw features
            if (clickedDrawFeature) {
                if (this.selectedDrawFeatures.has(clickedDrawFeature.properties.id) && clickedDrawFeature.geometry.type !== 'Point') {
                    this.drawControl.draw.changeMode('direct_select', { featureId: clickedDrawFeature.properties.id });
                } else {
                    if (!e.originalEvent.shiftKey) {
                        this.deselectAllFeatures();
                    }
                }
                this.updateUI();
                return;
            }

            // Handle custom tool features (circle, ellipse, etc.)
            if (clickedCustomFeature) {
                const isAlreadySelected = this.isCustomFeatureSelected(clickedCustomFeature);
                
                if (isAlreadySelected) {
                    // Feature is already selected - transition to editing mode
                    this.transitionToEditingMode(clickedCustomFeature);
                } else {
                    // New feature selection
                    if (!e.originalEvent.shiftKey) {
                        this.deselectAllFeatures();
                    }
                    // The actual selection will be handled by handleElementClick
                }
                this.updateUI();
                return;
            }

            // No feature clicked - deselect all if not holding shift
            if (!e.originalEvent.shiftKey) {
                this.uiManager.saveChangesAndClosePanel();
                this.deselectAllFeatures();
            }
            this.updateUI();
        }
    }

    // Get clicked custom tool feature (circle, ellipse, etc.)
    getClickedCustomFeature = (point) => {
        const features = this.map.queryRenderedFeatures(point);
        
        // Look for circle features
        const circleFeature = features.find(f => 
            (f.source === 'circles' || f.layer?.id === 'circle-layer' || f.layer?.id === 'circle-fill-layer') &&
            f.properties.source === 'circle'
        );
        if (circleFeature) return { ...circleFeature, toolType: 'circle' };

        // Look for ellipse features
        const ellipseFeature = features.find(f => 
            (f.source === 'ellipses' || f.layer?.id === 'ellipse-layer') &&
            f.properties.source === 'ellipse'
        );
        if (ellipseFeature) return { ...ellipseFeature, toolType: 'ellipse' };

        // Look for other custom tool features
        const textFeature = features.find(f => 
            (f.source === 'texts' || f.layer?.id === 'text-layer') &&
            f.properties.source === 'text'
        );
        if (textFeature) return { ...textFeature, toolType: 'text' };

        const imageFeature = features.find(f => 
            (f.source === 'images' || f.layer?.id === 'image-layer') &&
            f.properties.source === 'image'
        );
        if (imageFeature) return { ...imageFeature, toolType: 'image' };

        const losFeature = features.find(f => 
            (f.source === 'los' || f.layer?.id === 'los-layer') &&
            f.properties.source === 'los'
        );
        if (losFeature) return { ...losFeature, toolType: 'los' };

        const visibilityFeature = features.find(f => 
            (f.source === 'visibility' || f.layer?.id === 'visibility-layer') &&
            f.properties.source === 'visibility'
        );
        if (visibilityFeature) return { ...visibilityFeature, toolType: 'visibility' };

        const arrowFeature = features.find(f => 
            (f.source === 'arrows' || f.layer?.id === 'arrow-layer') &&
            f.properties.source === 'arrow'
        );
        if (arrowFeature) return { ...arrowFeature, toolType: 'arrow' };

        const boundaryFeature = features.find(f => 
            (f.source === 'boundarys' || 
             f.layer?.id === 'boundary-line-layer' || 
             f.layer?.id === 'boundary-symbol-layer' ||
             f.layer?.id === 'boundary-text-layer') &&
            f.properties.source === 'boundary'
        );
        if (boundaryFeature) return { ...boundaryFeature, toolType: 'boundary' };

        return null;
    }

    // Check if a custom feature is already selected
    isCustomFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        
        switch (feature.toolType || feature.properties.source) {
            case 'circle':
                return this.selectedCircleFeatures.has(featureId);
            case 'ellipse':
                return this.selectedEllipseFeatures.has(featureId);
            case 'arrow':
                return this.selectedArrowFeatures.has(featureId);
            case 'boundary':
                return this.selectedBoundaryFeatures.has(featureId);
            case 'text':
                return this.selectedTextFeatures.has(featureId);
            case 'image':
                return this.selectedImageFeatures.has(featureId);
            case 'los':
                return this.selectedLOSFeatures.has(featureId);
            case 'visibility':
                return this.selectedVisibilityFeatures.has(featureId);
            default:
                return false;
        }
    }

    // Transition feature to editing mode (analogous to maplibredraw's direct_select)
    transitionToEditingMode = (feature) => {
        const source = feature.toolType || feature.properties.source;
        const featureId = feature.id || feature.properties.id;
                
        switch (source) {
            case 'circle':
                if (this.selectedCircleFeatures.has(featureId)) {
                    const selectedFeature = this.selectedCircleFeatures.get(featureId);
                    // Trigger transition to editing mode in circle control
                    this.circleControl.onFeatureSelected?.(selectedFeature);
                }
                break;
            case 'ellipse':
                if (this.selectedEllipseFeatures.has(featureId)) {
                    const selectedFeature = this.selectedEllipseFeatures.get(featureId);
                    // Trigger transition to editing mode in ellipse control
                    this.ellipseControl.onFeatureSelected?.(selectedFeature);
                }
                break;
            case 'arrow':
                if (this.selectedArrowFeatures.has(featureId)) {
                    const selectedFeature = this.selectedArrowFeatures.get(featureId);
                    // Trigger transition to editing mode in arrow control
                    this.arrowControl.onFeatureSelected?.(selectedFeature);
                }
                break;
            case 'boundary':
                if (this.selectedBoundaryFeatures.has(featureId)) {
                    const selectedFeature = this.selectedBoundaryFeatures.get(featureId);
                    // Trigger transition to editing mode in boundary control
                    this.boundaryControl.onFeatureSelected?.(selectedFeature);
                }
                break;
        }
    }

    // Check if click is on an edit handle (for any tool in editing mode)
    isClickOnEditHandle = (point) => {
        const features = this.map.queryRenderedFeatures(point);
        
        // Check for maplibredraw edit handles
        const hasMaplibreDrawEditHandles = features.some(feature =>
            feature.properties.mode === 'direct_select' || 
            feature.properties.meta === 'midpoint' || 
            feature.properties.meta === 'vertex'
        );
        if (hasMaplibreDrawEditHandles) return true;

        // Check for circle edit handles
        if (this.circleControl.isEditingMode && this.circleControl.isEditingMode()) {
            const handleFeatures = features.filter(f => 
                f.source === 'circle-edit-handles' && 
                (f.properties.meta === 'vertex' || f.properties.user_isEditingHandle)
            );
            if (handleFeatures.length > 0) return true;
        }

        // Check for ellipse edit handles (similar pattern)
        if (this.ellipseControl.isEditingMode && this.ellipseControl.isEditingMode()) {
            const handleFeatures = features.filter(f => 
                f.source === 'ellipse-edit-handles' && 
                (f.properties.meta === 'vertex' || f.properties.user_isEditingHandle)
            );
            if (handleFeatures.length > 0) return true;
        }

        if (this.arrowControl.isEditingMode && this.arrowControl.isEditingMode()) {
            const handleFeatures = features.filter(f => 
                f.source === 'arrow-edit-handles' && 
                (f.properties.meta === 'vertex' || f.properties.user_isEditingHandle)
            );
            if (handleFeatures.length > 0) return true;
        }

        if (this.boundaryControl.isEditingMode && this.boundaryControl.isEditingMode()) {
            const handleFeatures = features.filter(f => 
                f.source === 'boundary-edit-handles' && 
                (f.properties.meta === 'vertex' || f.properties.user_isEditingHandle)
            );
            if (handleFeatures.length > 0) return true;
        }

        return false;
    }

    getClickedDrawFeature(point) {
        const features = this.map.queryRenderedFeatures(point);
        return features.find(f => f.source === 'mapbox-gl-draw-cold' || f.source === 'mapbox-gl-draw-hot');
    }

    handleElementClick = (e) => {
        e.preventDefault();
        
        const feature = e.features[0];
        const source = feature.properties.source;
        const featureId = feature.id || feature.properties.id;

        // Check if feature is already selected
        const isFeatureSelected = this.isFeatureSelected(source, featureId);

        if (isFeatureSelected && e.originalEvent.shiftKey) {
            // Only deselect if holding shift and feature is already selected
            this.toggleFeatureSelection(source, featureId, feature, true); // force toggle
        } else if (!isFeatureSelected) {
            // Select new feature
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            this.toggleFeatureSelection(source, featureId, feature, false); // don't force toggle
        }
        // If feature is selected and not holding shift, don't deselect (will transition to editing in handleMapClick)

        const drawFeatureIds = Array.from(this.selectedDrawFeatures.keys());
        this.drawControl.draw.changeMode('simple_select', { featureIds: drawFeatureIds });

        this.updateUI();
    }

    isFeatureSelected = (source, featureId) => {
        switch (source) {
            case 'text':
                return this.selectedTextFeatures.has(featureId);
            case 'image':
                return this.selectedImageFeatures.has(featureId);
            case 'los':
                return this.selectedLOSFeatures.has(featureId);
            case 'visibility':
                return this.selectedVisibilityFeatures.has(featureId);
            case 'draw':
                return this.selectedDrawFeatures.has(featureId);
            case 'circle':
                return this.selectedCircleFeatures.has(featureId);
            case 'ellipse':
                return this.selectedEllipseFeatures.has(featureId);
            case 'arrow':
                return this.selectedArrowFeatures.has(featureId);
            case 'boundary':
                return this.selectedBoundaryFeatures.has(featureId);
            default:
                return false;
        }
    }

    toggleFeatureSelection(source, featureId, feature, forceToggle = false) {
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
            case 'circle':
                targetMap = this.selectedCircleFeatures;
                break;
            case 'ellipse':
                targetMap = this.selectedEllipseFeatures;
                break;
            case 'arrow':
                targetMap = this.selectedArrowFeatures;
                break;
            case 'boundary':
                targetMap = this.selectedBoundaryFeatures;
            default:
                console.error('Invalid source:', source);
                return;
        }

        if (targetMap.has(featureId) && forceToggle) {
            // Only deselect if explicitly forced (shift+click)
            targetMap.delete(featureId);
            if (source === 'circle' && this.circleControl) {
                this.circleControl.onFeatureDeselected?.(feature);
            }
            if (source === 'ellipse' && this.ellipseControl) {
                this.ellipseControl.onFeatureDeselected?.(feature);
            }
            if (source === 'arrow' && this.arrowControl) {
                this.arrowControl.onFeatureDeselected?.(feature);
            }
            if (source === 'boundary' && this.boundaryControl) {
                this.boundaryControl.onFeatureDeselected?.(feature);
            }
        } else if (!targetMap.has(featureId)) {
            // Select feature
            targetMap.set(featureId, feature);
            if (source === 'circle' && this.circleControl) {
                this.circleControl.onFeatureSelected?.(feature);
            }
            if (source === 'ellipse' && this.ellipseControl) {
                this.ellipseControl.onFeatureSelected?.(feature);
            }
            if (source === 'arrow' && this.arrowControl) {
                this.arrowControl.onFeatureSelected?.(feature);
            }
            if (source === 'boundary' && this.boundaryControl) {
                this.boundaryControl.onFeatureSelected?.(feature);
            }
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
        this.selectedDrawFeatures.clear();
        this.selectedCircleFeatures.clear();
        this.selectedEllipseFeatures.clear();
        this.selectedArrowFeatures.clear();
        this.selectedBoundaryFeatures.clear();

        if (forceDraw && !this.drawControl.isActive) {
            this.drawControl.draw.changeMode('simple_select', { featureIds: [] });
        }

        this.updateUI();
        this.notifyControlsOfGlobalDeselect();
    }

    notifyControlsOfGlobalDeselect = () => {
        // Notify circle control about global deselect
        if (this.circleControl && this.circleControl.onGlobalDeselect) {
            this.circleControl.onGlobalDeselect();
        }

        // Notify ellipse control about global deselect
        if (this.ellipseControl && this.ellipseControl.onGlobalDeselect) {
            this.ellipseControl.onGlobalDeselect();
        }

        if (this.arrowControl && this.arrowControl.onGlobalDeselect) {
            this.arrowControl.onGlobalDeselect();
        }
        if (this.boundaryControl && this.boundaryControl.onGlobalDeselect) {
            this.boundaryControl.onGlobalDeselect();
        }
    }

    getAllSelectedFeatures() {
        return [
            ...this.selectedDrawFeatures.values(),
            ...this.selectedTextFeatures.values(),
            ...this.selectedImageFeatures.values(),
            ...this.selectedLOSFeatures.values(),
            ...this.selectedVisibilityFeatures.values(),
            ...this.selectedCircleFeatures.values(),
            ...this.selectedEllipseFeatures.values(),
            ...this.selectedArrowFeatures.values(),
            ...this.selectedBoundaryFeatures.values(),
        ];
    }

    updateUI = () => {
        this.uiManager.updateSelectionHighlight();
        this.uiManager.updatePanels();
    }

    updateProfile = () => {
        this.uiManager.updateProfile();
    }

    getActiveTool = () => {
        if (this.textControl.isActive) return this.textControl;
        if (this.imageControl.isActive) return this.imageControl;
        if (this.losControl.isActive) return this.losControl;
        if (this.visibilityControl.isActive) return this.visibilityControl;
        if (this.vectorTileInfoControl.isActive) return this.vectorTileInfoControl;
        if (this.drawControl.isActive) return this.drawControl;
        if (this.circleControl.isActive) return this.circleControl;
        if (this.ellipseControl.isActive) return this.ellipseControl;
        if (this.arrowControl.isActive) return this.arrowControl;
        if (this.boundaryControl.isActive) return this.boundaryControl;
        return null;
    }

    deleteSelectedFeatures = () => {
        this.textControl.deleteFeatures([...this.selectedTextFeatures.values()]);
        this.imageControl.deleteFeatures([...this.selectedImageFeatures.values()]);
        this.losControl.deleteFeatures([...this.selectedLOSFeatures.values()]);
        this.visibilityControl.deleteFeatures([...this.selectedVisibilityFeatures.values()]);
        this.drawControl.deleteFeatures([...this.selectedDrawFeatures.values()]);
        this.circleControl.deleteFeatures([...this.selectedCircleFeatures.values()]);
        this.ellipseControl.deleteFeatures([...this.selectedEllipseFeatures.values()]);
        this.arrowControl.deleteFeatures([...this.selectedArrowFeatures.values()]);
        this.boundaryControl.deleteFeatures([...this.selectedBoundaryFeatures.values()]);

        this.deselectAllFeatures(true);
    }

    updateSelectedFeatures() {
        this.textControl.updateFeatures([...this.selectedTextFeatures.values()], true);
        this.imageControl.updateFeatures([...this.selectedImageFeatures.values()], true);
        this.drawControl.updateFeatures([...this.selectedDrawFeatures.values()], true);
        this.losControl.updateFeatures([...this.selectedLOSFeatures.values()], true);
        this.visibilityControl.updateFeatures([...this.selectedVisibilityFeatures.values()], true);
        this.circleControl.updateFeatures([...this.selectedCircleFeatures.values()], true);
        this.ellipseControl.updateFeatures([...this.selectedEllipseFeatures.values()], true);
        this.arrowControl.updateFeatures([...this.selectedArrowFeatures.values()], true);
        this.boundaryControl.updateFeatures([...this.selectedBoundaryFeatures.values()], true);
    }
}

export default SelectionManager;