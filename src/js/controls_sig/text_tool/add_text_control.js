// Path: js/controls_sig/text_tool/add_text_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addTextAttributesToPanel } from './text_attributes_panel.js';
import AddTextGeometry from './add_text_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddTextControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.geometry = new AddTextGeometry();

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this._name = 'AddTextControl';
    }

    static DEFAULT_PROPERTIES = {
        text: 'Texto',
        size: 16,
        color: '#000000',
        backgroundColor: '#ffffff',
        textHaloWidth: 2,
        rotation: 0,
        justify: 'center',
        source: 'text',

        showBackground: false,
        backgroundFillColor: '#315730',
        backgroundFillOpacity: 0.8,
        backgroundBorderColor: '#000000ff',
        backgroundBorderOpacity: 1.0,
        backgroundBorderWidth: 1,

        createdAtZoom: 0,
        calculatedSize: 16,
        selectionBox: null,

        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected text feature from SelectionManager
     * @returns {Object|null} Selected text feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('text');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected text features from SelectionManager
     * @returns {Array} Array of selected text features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('text')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl text-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "text-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_text_black.svg" alt="TEXT" />';
        button.title = 'Adicionar texto (T)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.setupZoomListener();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;

            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddTextControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'text-attributes-section';

        try {
            addTextAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating text attribute panel:', error);
        }
    }

    getDragSources() {
        return ['texts'];
    }

    getEditHandleSources() {
        return [];
    }

    createSelectionBox(feature) {
        if (feature.properties.selectionBox) {
            return { geometry: feature.properties.selectionBox };
        }

        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth
        );

        return { geometry: selectionBox };
    }

    getSelectionBoxStrategy() {
        return 'preCalculated';
    }

    getSelectionBoxPadding() {
        return 5;
    }

    getLayerIds() {
        return ['texts-layer'];
    }

    getSourceNames() {
        return ['texts'];
    }

    getEditHandleSource() {
        return null;
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoordinates = feature.geometry.coordinates;
        const newCoordinates = [oldCoordinates[0] + offset.dx, oldCoordinates[1] + offset.dy];

        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth
        );

        return {
            ...feature,
            geometry: this.geometry.generate(newCoordinates),
            properties: {
                ...feature.properties,
                selectionBox: newSelectionBox
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
        return [
            coords[0] - referencePoint.lng,
            coords[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCoordinates = [newCoords.lng, newCoords.lat];

        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth
        );

        const updatedFeature = {
            ...feature,
            geometry: this.geometry.generate(newCoordinates),
            properties: {
                ...feature.properties,
                selectionBox: newSelectionBox
            }
        };

        return updatedFeature;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_text_red.svg' :
            './images/icon_text_black.svg';
        const btn = document.getElementById('text-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="TEXT" />`;
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        const featureId = feature.properties.id;
        if (selectedFeature && selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        this.updateSelectionBoxesForFeatures(movedFeatures);
        this.updateTextBackgroundsSource();
    }

    /**
     * Update selection boxes for specific features (used after drag or attribute changes)
     * Always uses fresh data from map source to ensure accuracy
     * @param {Array} features - Features to update selection boxes for
     */
    updateSelectionBoxesForFeatures = async (features) => {
        if (!features || features.length === 0) return;

        const data = await this.map.getSource('texts').getData();
        let hasChanges = false;

        features.forEach(inputFeature => {
            if (inputFeature.properties.source === 'text') {
                const currentSourceFeature = data.features.find(f =>
                    f.properties.id === inputFeature.properties.id
                );

                if (currentSourceFeature) {
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        currentSourceFeature.geometry.coordinates,
                        currentSourceFeature.properties.text,
                        currentSourceFeature.properties.size,
                        currentSourceFeature.properties.rotation,
                        currentSourceFeature.properties.createdAtZoom,
                        this.selectionManager.uiManager,
                        currentSourceFeature.properties.showBackground,
                        currentSourceFeature.properties.backgroundBorderWidth
                    );

                    currentSourceFeature.properties.selectionBox = newSelectionBox;
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) {
            this.map.getSource('texts').setData(data);

            const freshFeatures = features.map(inputFeature => {
                const sourceFeature = data.features.find(f => f.properties.id === inputFeature.properties.id);
                return sourceFeature || inputFeature;
            });

            this.updateSelectionManagerFeatures(freshFeatures);

            requestAnimationFrame(() => {
                if (this.selectionManager.uiManager.updateSelectionHighlight) {
                    this.selectionManager.uiManager.updateSelectionHighlight();
                }
            });
        }
    }

    selectFeature = (feature) => {
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    // ===== TEXT CREATION SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for text');
            return;
        }

        await this.createTextFeature(e.lngLat);
        this.toolManager.deactivateCurrentTool();
    }

    createTextFeature = async (lngLat) => {
        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('text', this.map);

        const currentZoom = this.map.getZoom();
        const coordinates = [lngLat.lng, lngLat.lat];

        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            coordinates,
            AddTextControl.DEFAULT_PROPERTIES.text,
            AddTextControl.DEFAULT_PROPERTIES.size,
            AddTextControl.DEFAULT_PROPERTIES.rotation,
            currentZoom,
            this.selectionManager.uiManager,
            AddTextControl.DEFAULT_PROPERTIES.showBackground,
            AddTextControl.DEFAULT_PROPERTIES.backgroundBorderWidth
        );

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddTextControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                createdAtZoom: currentZoom,
                calculatedSize: AddTextControl.DEFAULT_PROPERTIES.size,
                selectionBox: selectionBox
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('texts', feature);

            const data = await this.map.getSource('texts').getData();
            data.features.push(feature);
            this.map.getSource('texts').setData(data);

            this.selectionManager.toggleFeatureSelection('text', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating text feature:', error);
        }
    }

    // ===== ZOOM-INVARIANT SYSTEM =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllTextSizes);
        }
    }

    applyZoomCorrections = (features) => {
        const currentZoom = this.map.getZoom();
        return features.map(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 255);
            return feature;
        });
    }

    updateAllTextSizes = async () => {
        if (!this.map.getSource('texts')) {
            this.pendingZoomUpdate = false;
            return;
        }

        const currentZoom = this.map.getZoom();
        const data = await this.map.getSource('texts').getData();
        let hasChanges = false;

        data.features.forEach(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedSize = Math.min(feature.properties.size * scaleFactor, 255);

            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            this.map.getSource('texts').setData(data);
        }

        this.pendingZoomUpdate = false;
    }

    // ===== HOVER SYSTEM =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const features = this.map.queryRenderedFeatures(e.point);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        this.map.getCanvas().style.cursor = hasFeature ? 'move' : '';
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'texts' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== BACKGROUND SYNCHRONIZATION SYSTEM =====

    /**
     * Synchronize text-backgrounds source with current texts data
     * This method handles the critical synchronization between the main 'texts' source
     * and the separate 'text-backgrounds' source used for background rendering
     */
    updateTextBackgroundsSource = async () => {
        if (!this.map.getSource('text-backgrounds')) {
            console.warn('text-backgrounds source not found - skipping background sync');
            return;
        }

        try {
            const currentTextsData = await this.map.getSource('texts').getData();
            const currentTexts = currentTextsData.features;

            const backgroundFeatures = currentTexts
                .filter(feature => feature.properties.showBackground && feature.properties.selectionBox)
                .map(feature => ({
                    type: 'Feature',
                    properties: {
                        ...feature.properties,
                        id: feature.properties.id + '_bg'
                    },
                    geometry: feature.properties.selectionBox
                }));

            this.map.getSource('text-backgrounds').setData({
                type: 'FeatureCollection',
                features: backgroundFeatures
            });

        } catch (error) {
            console.error('Error updating text backgrounds source:', error);
        }
    }

    /**
     * Check if a property affects background rendering and requires background sync
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects background rendering
     */
    isBackgroundAffectingProperty = (property) => {
        const backgroundAffectingProperties = [
            'text', 'size', 'rotation',
            'showBackground',
            'backgroundBorderWidth',
            'backgroundFillColor', 'backgroundFillOpacity',
            'backgroundBorderColor', 'backgroundBorderOpacity',
            'visivel',
            'createdAtZoom'
        ];
        return backgroundAffectingProperties.includes(property);
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('texts').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'createdAtZoom') {
                    const roundedValue = Math.round(value * 10) / 10;
                    sourceFeature.properties[property] = roundedValue;
                    feature.properties[property] = roundedValue;

                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - roundedValue;
                    const scaleFactor = Math.pow(2, zoomDifference);

                    const newCalculatedSize = Math.min(sourceFeature.properties.size * scaleFactor, 255);
                    sourceFeature.properties.calculatedSize = newCalculatedSize;
                    feature.properties.calculatedSize = newCalculatedSize;
                } else {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - sourceFeature.properties.createdAtZoom;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    sourceFeature.properties.calculatedSize = Math.min(sourceFeature.properties.size * scaleFactor, 255);
                    feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
                }

                const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth'];
                if (visualProperties.includes(property) || property === 'createdAtZoom') {
                    const currentCoordinates = sourceFeature.geometry.coordinates;
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        currentCoordinates,
                        sourceFeature.properties.text,
                        sourceFeature.properties.size,
                        sourceFeature.properties.rotation,
                        sourceFeature.properties.createdAtZoom,
                        this.selectionManager.uiManager,
                        sourceFeature.properties.showBackground,
                        sourceFeature.properties.backgroundBorderWidth
                    );

                    sourceFeature.properties.selectionBox = newSelectionBox;
                    feature.properties.selectionBox = newSelectionBox;
                }
            }
        }

        await this.forceUpdateMainSource(data);

        if (this.isBackgroundAffectingProperty(property)) {
            await this.updateTextBackgroundsSource();
        }

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);

        const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth'];
        if (visualProperties.includes(property) || property === 'createdAtZoom') {
            requestAnimationFrame(() => {
                if (this.selectionManager.uiManager.updateSelectionHighlight) {
                    this.selectionManager.uiManager.updateSelectionHighlight();
                }
            });
        }
    }

    /**
     * Force update main source with drag protection
     * @param {Object} data - Feature collection data
     */
    forceUpdateMainSource = async (data) => {
        if (this.selectionManager.uiManager && this.selectionManager.uiManager.isDragging) {
            return;
        }

        this.map.getSource('texts').setData(data);
    }

    /**
     * Check if source updates should be blocked (during drag)
     * @returns {boolean} True if updates should be blocked
     */
    isSourceUpdateBlocked = () => {
        return this.selectionManager.uiManager && this.selectionManager.uiManager.isDragging;
    }

    ensureFeatureConsistency = (feature, currentZoom = null, forceRecalculateSelectionBox = false) => {
        const zoom = currentZoom || this.map.getZoom();

        const zoomDifference = zoom - feature.properties.createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 255);

        if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
            feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.text,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom,
                this.selectionManager.uiManager,
                feature.properties.showBackground,
                feature.properties.backgroundBorderWidth
            );
        }

        return feature;
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('texts').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('texts', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            f.geometry = this.geometry.generate(f.geometry.coordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('texts', featureId);

                const data = await this.map.getSource('texts').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('texts').setData(data);
            } catch (error) {
                console.error(`Error removing text ${feature.properties.id}:`, error);
            }
        }

        await this.updateTextBackgroundsSource();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddTextControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.text !== initialProperties.text ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.color !== initialProperties.color ||
            feature.properties.backgroundColor !== initialProperties.backgroundColor ||
            feature.properties.textHaloWidth !== initialProperties.textHaloWidth ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.justify !== initialProperties.justify ||
            feature.properties.createdAtZoom !== initialProperties.createdAtZoom ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.showBackground !== initialProperties.showBackground ||
            feature.properties.backgroundFillColor !== initialProperties.backgroundFillColor ||
            feature.properties.backgroundFillOpacity !== initialProperties.backgroundFillOpacity ||
            feature.properties.backgroundBorderColor !== initialProperties.backgroundBorderColor ||
            feature.properties.backgroundBorderOpacity !== initialProperties.backgroundBorderOpacity ||
            feature.properties.backgroundBorderWidth !== initialProperties.backgroundBorderWidth ||
            JSON.stringify(feature.geometry.coordinates) !== JSON.stringify(initialProperties.coordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('texts').getData();
            const currentZoom = this.map.getZoom();
            let backgroundNeedsUpdate = false;

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    this.ensureFeatureConsistency(data.features[featureIndex], currentZoom, !onlyUpdateProperties);

                    if (data.features[featureIndex].properties.showBackground) {
                        backgroundNeedsUpdate = true;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('texts', featureToUpdate);
                    }
                }
            }

            await this.forceUpdateMainSource(data);

            if (backgroundNeedsUpdate) {
                await this.updateTextBackgroundsSource();
            }

            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update in SelectionManager
     */
    updateSelectionManagerFeature(feature) {
        const key = `text:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'text', feature });
    }

    /**
     * Update SelectionManager with multiple features
     * @param {Array} features - Features to update in SelectionManager
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'text') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.removeHoverListeners();

        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
    }
}

export default AddTextControl;
