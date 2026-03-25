// Path: js/draw_tools/text_tool/add_text_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { getPointerPosition } from '../../utilities/pointer-utils';
import { addTextAttributesToPanel } from './text_attributes_panel.js';
import AddTextGeometry from './add_text_geometry.js';
import { BaseControl } from '../../tool_manager';
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    syncZoomCorrectedProperty,
} from '../../tool_manager/helpers/zoom-correction.helpers.js';

class AddTextControl extends BaseControl {
    featureType = 'text';
    constructor(toolManager) {
        super(toolManager);

        this.geometry = new AddTextGeometry();

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this.zoomCorrectionEnabled = true;
        this._name = 'AddTextControl';

        // Pointer event state for edit handles
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
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
        backgroundBorderColor: '#000000',
        backgroundBorderOpacity: 1.0,
        backgroundBorderWidth: 1,

        createdAtZoom: 0,
        calculatedSize: 16,
        zoomCorrectionEnabled: true,
        selectionBox: null,

        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.setupZoomListener();
    }

    onRemove = () => {
        this.map.off('zoom', this.handleZoomChange);
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'text-attributes-section';

        try {
            addTextAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating text attribute panel:', error);
        }
    }

    getDragSources() {
        return ['texts'];
    }

    getEditHandleSources() {
        return ['text-edit-handles'];
    }

    createSelectionBox(feature) {
        if (feature.properties.selectionBox) {
            return { geometry: feature.properties.selectionBox };
        }

        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth,
            effectiveZoom
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
        return 'text-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoordinates = feature.geometry.coordinates;
        const newCoordinates = [oldCoordinates[0] + offset.dx, oldCoordinates[1] + offset.dy];

        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth,
            effectiveZoom
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

        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth,
            effectiveZoom
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
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.deselectFeature();
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
        const selectedFeature = this.getSelectedFeature();
        return selectedFeature && selectedFeature.properties.id === featureId;
    }

    syncEditHandlesAfterDrag = async (movedFeatures) => {
        await this.updateSelectionBoxesForFeatures(movedFeatures);
        await this.updateTextBackgroundsSource();

        // Refresh rotation handle position after drag
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            const movedFeature = movedFeatures.find(f =>
                f.properties.source === 'text' &&
                f.properties.id === selectedFeature.properties.id
            );

            if (movedFeature) {
                this.updateSelectionManagerFeature(movedFeature);
                this.createEditHandles(movedFeature);
            }
        }
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
                    const effectiveZoom = currentSourceFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        currentSourceFeature.geometry.coordinates,
                        currentSourceFeature.properties.text,
                        currentSourceFeature.properties.size,
                        currentSourceFeature.properties.rotation,
                        currentSourceFeature.properties.createdAtZoom,
                        this.selectionManager.uiManager,
                        currentSourceFeature.properties.showBackground,
                        currentSourceFeature.properties.backgroundBorderWidth,
                        effectiveZoom
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

        // Skip edit handles and edit listeners when map is locked (read-only)
        if (this._mapLocked) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.map.dragPan.enable();
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
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
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
            id: geoJsonId,
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

            await this.selectionManager.toggleFeatureSelection('text', featureId, feature);
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
        return applyZoomCorrectionsUtil(features, this.map.getZoom(), {
            sourceProperty: 'size',
            calculatedProperty: 'calculatedSize',
            maxValue: 255,
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
        let hasSelectionBoxChanges = false;

        data.features.forEach(feature => {
            let newCalculatedSize;

            if (feature.properties.zoomCorrectionEnabled === false) {
                newCalculatedSize = feature.properties.size;

                // Recalculate selection box for features with zoom correction disabled
                const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                    feature.geometry.coordinates,
                    feature.properties.text,
                    feature.properties.size,
                    feature.properties.rotation,
                    feature.properties.createdAtZoom,
                    this.selectionManager.uiManager,
                    feature.properties.showBackground,
                    feature.properties.backgroundBorderWidth,
                    currentZoom
                );
                feature.properties.selectionBox = newSelectionBox;
                hasSelectionBoxChanges = true;
            } else {
                const zoomDifference = currentZoom - feature.properties.createdAtZoom;
                const scaleFactor = Math.pow(2, zoomDifference);
                newCalculatedSize = Math.min(feature.properties.size * scaleFactor, 255);
            }

            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges || hasSelectionBoxChanges) {
            this.map.getSource('texts').setData(data);

            // Update text backgrounds if any selection boxes changed
            if (hasSelectionBoxChanges) {
                await this.updateTextBackgroundsSource();

                // Update SelectionManager with fresh features that have updated selectionBox
                const selectedFeatures = this.getSelectedFeatures();
                if (selectedFeatures.length > 0) {
                    selectedFeatures.forEach(selectedFeature => {
                        const freshFeature = data.features.find(f => f.properties.id === selectedFeature.properties.id);
                        if (freshFeature) {
                            this.selectionManager.updateSelectedFeature('text', freshFeature.properties.id, freshFeature);
                            // Invalidate cache for this feature
                            if (this.selectionManager.uiManager.invalidateCache) {
                                this.selectionManager.uiManager.invalidateCache(freshFeature.properties.id);
                            }
                        }
                    });
                    // Update selection highlight
                    if (this.selectionManager.uiManager.updateSelectionHighlight) {
                        this.selectionManager.uiManager.updateSelectionHighlight();
                    }
                }
            }

            // Refresh rotation handle position on zoom (handle uses screen-space offset)
            if (!this.isDraggingHandle) {
                const selectedFeature = this.getSelectedFeature();
                if (selectedFeature) {
                    this.createEditHandles(selectedFeature);
                }
            }
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
        const hasHandle = this.hasHandleAtPoint(features);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        if (hasHandle) {
            this.map.getCanvas().style.cursor = 'grab';
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.source === 'text-edit-handles' &&
            f.properties.user_isEditingHandle
        );
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
            'createdAtZoom',
            'zoomCorrectionEnabled'
        ];
        return backgroundAffectingProperties.includes(property);
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('texts').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                syncZoomCorrectedProperty(
                    sourceFeature, feature, property, value, this.map.getZoom(),
                    { sourceProperty: 'size', calculatedProperty: 'calculatedSize', maxValue: 255 }
                );

                const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth', 'zoomCorrectionEnabled'];
                if (visualProperties.includes(property) || property === 'createdAtZoom') {
                    const currentCoordinates = sourceFeature.geometry.coordinates;
                    const effectiveZoom = sourceFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        currentCoordinates,
                        sourceFeature.properties.text,
                        sourceFeature.properties.size,
                        sourceFeature.properties.rotation,
                        sourceFeature.properties.createdAtZoom,
                        this.selectionManager.uiManager,
                        sourceFeature.properties.showBackground,
                        sourceFeature.properties.backgroundBorderWidth,
                        effectiveZoom
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
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);

        const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth', 'zoomCorrectionEnabled'];
        if (visualProperties.includes(property) || property === 'createdAtZoom') {
            requestAnimationFrame(() => {
                if (this.selectionManager.uiManager.updateSelectionHighlight) {
                    this.selectionManager.uiManager.updateSelectionHighlight();
                }
            });
        }

        // Refresh rotation handle when properties change (not during handle drag)
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
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

        if (feature.properties.zoomCorrectionEnabled === false) {
            feature.properties.calculatedSize = feature.properties.size;
        } else {
            const zoomDifference = zoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 255);
        }

        if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
            const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? zoom : null;
            feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.text,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom,
                this.selectionManager.uiManager,
                feature.properties.showBackground,
                feature.properties.backgroundBorderWidth,
                effectiveZoom
            );
        }

        return feature;
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('texts').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('texts', currentFeature);
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
            feature.properties.backgroundBorderWidth !== initialProperties.backgroundBorderWidth
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('texts').getData();
            const currentZoom = this.map.getZoom();
            let backgroundNeedsUpdate = false;

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
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
    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update in SelectionManager
     */
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('text', feature.properties.id, feature);
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

    // ===== EDIT HANDLES SYSTEM =====

    /**
     * Create rotation handle for the selected text feature
     * @param {Object} feature - Text feature
     */
    createEditHandles = (feature) => {
        const mapZoom = this.map.getZoom();
        const handles = this.geometry.createHandles(feature, mapZoom);
        if (!handles || handles.length === 0) return;

        this.map.getSource('text-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    /**
     * Clear all text edit handles from the map
     */
    clearEditHandles = () => {
        if (this.map.getSource('text-edit-handles')) {
            this.map.getSource('text-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    /**
     * Register pointerdown listener on the canvas for handle interaction
     */
    setupEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.addEventListener('pointerdown', this._onEditPointerDown);
    }

    /**
     * Remove all edit pointer listeners and release pointer capture
     */
    removeEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('pointerdown', this._onEditPointerDown);
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        // Release any captured pointer
        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }
    }

    /**
     * Handle pointer down on canvas — start handle drag if hit
     * @param {PointerEvent} e
     */
    _onEditPointerDown(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['text-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';

            // Capture pointer for reliable tracking
            this._activePointerId = e.pointerId;
            canvas.setPointerCapture(e.pointerId);

            // Add move/up listeners only when dragging starts
            canvas.addEventListener('pointermove', this._onEditPointerMove);
            canvas.addEventListener('pointerup', this._onEditPointerUp);
            canvas.addEventListener('pointercancel', this._onEditPointerUp);

            e.preventDefault();
        }
    }

    /**
     * Handle pointer move during handle drag — update rotation in real time
     * @param {PointerEvent} e
     */
    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);
        const newPosition = [lngLat.lng, lngLat.lat];

        const result = this.geometry.updateFromHandle(this.activeHandleType, newPosition, selectedFeature);
        if (result === null) return;

        // Update rotation on all selected features in real time
        const selectedFeatures = this.getSelectedFeatures();
        this.updateFeaturesProperty(selectedFeatures, 'rotation', result.rotation);

        // Refresh handle position during drag (updateFeaturesProperty skips this when isDraggingHandle)
        const freshFeature = this.getSelectedFeature();
        if (freshFeature) {
            this.createEditHandles(freshFeature);
        }
    }

    /**
     * Handle pointer up — finalize rotation drag
     * @param {PointerEvent} _e
     */
    async _onEditPointerUp(_e) {
        const canvas = this.map.getCanvasContainer();

        // Remove move/up listeners
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        // Release pointer capture
        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            // Recreate handles at final position
            this.createEditHandles(selectedFeature);

            // Rebuild attribute panel to sync slider with final rotation value
            this.updateUIAfterEdit();

            // Persist changes
            await this.saveFeatureChanges(selectedFeature);
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    /**
     * Refresh UI (selection highlight + attribute panel) after handle edit
     */
    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    /**
     * Persist a feature's current state to the store
     * @param {Object} feature - Feature to persist
     */
    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('texts', feature);
        } catch (error) {
            console.error('Error saving text changes:', error);
        }
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.removeEditEventListeners();
        this.removeHoverListeners();

        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
    }
}

export default AddTextControl;
