// Path: js/controls_sig/brush_tool/add_brush_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addBrushAttributesToPanel } from './brush_attributes_panel.js';
import AddBrushGeometry from './add_brush_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

/**
 * Brush Tool Control
 * Manages freehand drawing for brush/pencil features with zoom-adaptive scaling
 */
class AddBrushControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.isDrawing = false;
        this.points = [];
        this.lastPixelPoint = null;

        this.geometry = new AddBrushGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this._name = 'AddBrushControl';
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        lineWidth: 10,
        createdAtZoom: 0,
        calculatedLineWidth: 10,
        source: 'brush',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Get currently selected brush feature from SelectionManager
     * @returns {Object|null} Selected brush feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('brush');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected brush features from SelectionManager
     * @returns {Array} Array of selected brush features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('brush')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl brush-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "brush-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_brush_black.svg" alt="BRUSH" />';
        button.title = 'Ferramenta Pincel (B)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();
        this.setupZoomListener();

        return this.container;
    }

    onRemove = () => {
        try {
            this.selectionManager.uiManager.removeControl(this.container);
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddBrushControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'brush-attributes-section';

        try {
            addBrushAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating brush attribute panel:', error);
        }
    }

    getDragSources() {
        return ['brushes'];
    }

    getEditHandleSources() {
        return [];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating brush selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 5;
    }

    getLayerIds() {
        return ['brush-layer'];
    }

    getSourceNames() {
        return ['brushes'];
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
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            offset.dx,
            offset.dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(feature.geometry.coordinates);
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            dx,
            dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.isDrawing = false;
        this.points = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
        this.setupDrawingEventListeners();
    }

    deactivate = () => {
        this.isActive = false;
        this.finishDrawing();
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.removeDrawingEventListeners();
        this.clearPreview();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_brush_red.svg' :
            './images/icon_brush_black.svg';
        const btn = document.getElementById('brush-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="BRUSH" />`;
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
    }

    onFeatureDeselected = (feature) => {
    }

    onGlobalDeselect = () => {
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
    }

    setupDrawingEventListeners = () => {
        this.map.on('mousedown', this.onMouseDown);
        this.map.on('mousemove', this.onMouseMove);
        this.map.on('mouseup', this.onMouseUp);
        this.map.getCanvas().addEventListener('mouseleave', this.onMouseLeave);
    }

    removeDrawingEventListeners = () => {
        this.map.off('mousedown', this.onMouseDown);
        this.map.off('mousemove', this.onMouseMove);
        this.map.off('mouseup', this.onMouseUp);
        this.map.getCanvas().removeEventListener('mouseleave', this.onMouseLeave);
    }

    onMouseDown = (e) => {
        if (!this.isActive) return;

        this.isDrawing = true;
        this.points = [[e.lngLat.lng, e.lngLat.lat]];
        this.lastPixelPoint = e.point;
        this.map.dragPan.disable();
        this.map.getCanvas().style.cursor = 'crosshair';

        e.preventDefault();
    }

    onMouseMove = (e) => {
        if (!this.isActive || !this.isDrawing) return;

        if (!this.geometry.isPixelDistanceSufficient(this.lastPixelPoint, e.point)) {
            return;
        }

        this.points.push([e.lngLat.lng, e.lngLat.lat]);
        this.lastPixelPoint = e.point;

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.updatePreview);
        }
    }

    onMouseUp = (e) => {
        if (!this.isActive || !this.isDrawing) return;

        this.finishDrawing();
    }

    onMouseLeave = () => {
        if (this.isDrawing) {
            this.finishDrawing();
        }
    }

    finishDrawing = async () => {
        if (!this.isDrawing) return;

        this.isDrawing = false;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = 'crosshair';

        if (this.points.length >= 2) {
            await this.createFeature();
        }

        this.points = [];
        this.lastPixelPoint = null;
        this.clearPreview();
    }

    updatePreview = () => {
        if (this.points.length > 1) {
            this.map.getSource('brush-feedback').setData({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [...this.points]
                },
                properties: {
                    isPreview: true,
                    lineColor: AddBrushControl.DEFAULT_PROPERTIES.lineColor,
                    lineWidth: AddBrushControl.DEFAULT_PROPERTIES.lineWidth
                }
            });
        }
        this.pendingPreviewUpdate = false;
    }

    clearPreview = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;

        if (this.map && this.map.getSource('brush-feedback')) {
            this.map.getSource('brush-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.geometry.validate(this.points)) {
            console.warn('Line must have at least 2 valid points');
            return;
        }

        const currentZoom = this.map.getZoom();
        const calculatedLineWidth = AddBrushControl.DEFAULT_PROPERTIES.lineWidth;

        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('brush', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddBrushControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                createdAtZoom: currentZoom,
                calculatedLineWidth: calculatedLineWidth
            },
            geometry: this.geometry.generate(this.points)
        };

        try {
            await addFeature('brushes', feature);

            const data = await this.map.getSource('brushes').getData();
            data.features.push(feature);
            this.map.getSource('brushes').setData(data);

            this.points = [];
            this.toolManager.deactivateCurrentTool();
            this.selectionManager.toggleFeatureSelection('brush', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar pincel:', error);
        }
    }

    // ===== ZOOM HANDLING =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.performZoomUpdate);
        }
    }

    performZoomUpdate = async () => {
        if(this.map.getSource('brushes')){
            const data = await this.map.getSource('brushes').getData();
            if (data && data.features) {
                const updatedFeatures = data.features.map(feature =>
                    this.applyZoomCorrections([feature])[0]
                );

                this.map.getSource('brushes').setData({
                    type: 'FeatureCollection',
                    features: updatedFeatures
                });
            }
            this.pendingZoomUpdate = false;
        }
    }

    applyZoomCorrections = (features) => {
        const currentZoom = this.map.getZoom();
        return features.map(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedWidth = feature.properties.lineWidth * scaleFactor;

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    calculatedLineWidth: newCalculatedWidth
                }
            };
        });
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('brushes').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'lineWidth') {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - sourceFeature.properties.createdAtZoom;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    const newCalculatedWidth = value * scaleFactor;

                    sourceFeature.properties.calculatedLineWidth = newCalculatedWidth;
                    feature.properties.calculatedLineWidth = newCalculatedWidth;
                }

                if (property === 'createdAtZoom') {
                    const roundedValue = Math.round(value * 10) / 10;
                    sourceFeature.properties[property] = roundedValue;
                    feature.properties[property] = roundedValue;

                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - roundedValue;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    const newCalculatedWidth = sourceFeature.properties.lineWidth * scaleFactor;

                    sourceFeature.properties.calculatedLineWidth = newCalculatedWidth;
                    feature.properties.calculatedLineWidth = newCalculatedWidth;
                }
            }
        }

        this.map.getSource('brushes').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const correctedFeatures = this.applyZoomCorrections(features);

        const currentData = await this.map.getSource('brushes').getData();
        let hasChanges = false;

        for (const selectedFeature of correctedFeatures) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('brushes', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('brushes', featureId);
                const data = await this.map.getSource('brushes').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('brushes').setData(data);
            } catch (error) {
                console.error(`Error removing brush ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddBrushControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.createdAtZoom !== initialProperties.createdAtZoom
        );
    }

    updateFeatures = async (featuresBeforeZoomFix, save = false, onlyUpdateProperties = false) => {
        const features = this.applyZoomCorrections(featuresBeforeZoomFix);

        if (features.length > 0) {
            const data = await this.map.getSource('brushes').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('brushes', featureToUpdate);
                    }
                }
            }

            this.map.getSource('brushes').setData(data);

            this.updateSelectionManagerFeatures(features);
        }
    }

    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update
     */
    updateSelectionManagerFeature(feature) {
        const key = `brush:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'brush', feature });
    }

    /**
     * Update SelectionManager with multiple features
     * @param {Array} features - Features to update
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'brush') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.removeDrawingEventListeners();
        this.clearPreview();
        this.map.off('zoom', this.handleZoomChange);
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
    }
}

export default AddBrushControl;
