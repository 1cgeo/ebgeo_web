// Path: js/draw_tools/ellipse_tool/add_ellipse_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { getPointerPosition } from '../../utilities/pointer-utils';
import { addEllipseAttributesToPanel } from './ellipse_attributes_panel.js';
import AddEllipseGeometry from './add_ellipse_geometry.js';
import { BaseControl, HatchPatternGenerator } from '../../tool_manager';
import { getSnappingService } from '../../snapping/snapping.service.js';

class AddEllipseControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.geometry = new AddEllipseGeometry();
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
        this.hatchGenerator = new HatchPatternGenerator();

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        lineStyle: 'solid',
        opacity: 0.5,
        source: 'ellipse',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected ellipse feature from SelectionManager
     * @returns {Object|null} Selected ellipse feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('ellipse');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected ellipse features from SelectionManager
     * @returns {Array} Array of selected ellipse features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('ellipse')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
    }

    onRemove = () => {
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
        sectionPanel.className = 'ellipse-attributes-section';

        try {
            addEllipseAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating ellipse attribute panel:', error);
        }
    }

    getDragSources() {
        return ['ellipses'];
    }

    getEditHandleSources() {
        return ['ellipse-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating ellipse selection box:', error);
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
        return ['ellipse-fill-layer', 'ellipse-layer'];
    }

    getSourceNames() {
        return ['ellipses'];
    }

    getEditHandleSource() {
        return 'ellipse-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCenter = this.geometry.normalizeCenter(feature.properties.center);
        const newCenter = [oldCenter[0] + offset.dx, oldCenter[1] + offset.dy];

        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.geometry.generate(
                newCenter,
                feature.properties.majorRadius,
                feature.properties.minorRadius,
                feature.properties.bearing
            )
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const center = this.geometry.normalizeCenter(feature.properties.center);
        return [
            center[0] - referencePoint.lng,
            center[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCenter = [newCoords.lng, newCoords.lat];

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.geometry.generate(
                newCenter,
                feature.properties.majorRadius,
                feature.properties.minorRadius,
                feature.properties.bearing
            )
        };

        return updatedFeature;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.setupRightClickListener();
        this.map.on('mousemove', this._onPreClickMouseMove);
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this._onPreClickMouseMove);
        getSnappingService()?.hideIndicator(this.map);
        this.clearPreview();
        this.deselectFeature();
        this.removeRightClickListener();
    }

    // ===== RIGHT-CLICK FINISH SUPPORT =====

    setupRightClickListener = () => {
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
    }

    removeRightClickListener = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
    }

    handleRightClick = async (e) => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const screenPoint = { x: e.offsetX, y: e.offsetY };
        const coordinates = this.map.unproject([screenPoint.x, screenPoint.y]);
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, screenPoint, coordinates) ?? coordinates;
        const finalPoint = [snap.lng, snap.lat];

        this.drawPoints.push(finalPoint);

        if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
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

    syncEditHandlesAfterDrag = (movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            const movedFeature = movedFeatures.find(f =>
                f.properties.source === 'ellipse' &&
                f.properties.id === selectedFeature.properties.id
            );

            if (movedFeature) {
                this.updateSelectionManagerFeature(movedFeature);
                this.createEditHandles(movedFeature);
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for ellipse');
            return;
        }

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        this.drawPoints.push([snap.lng, snap.lat]);

        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];

            const snapping = getSnappingService();
            const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
            this.lastPreviewPosition = [snap.lng, snap.lat];

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            this.updateEllipsePreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const center = this.lastPreviewCenter;
            const { majorRadius, bearing } = this.geometry.calculateInitialDimensions(center, this.lastPreviewPosition);

            if (majorRadius >= 0.01) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate(
                        center,
                        majorRadius,
                        majorRadius * 0.6,
                        bearing
                    );
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('ellipse-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddEllipseControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddEllipseControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('ellipse-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const endPoint = this.drawPoints[1];

        const { majorRadius, bearing, minorRadius } = this.geometry.calculateInitialDimensions(center, endPoint);

        if (!this.geometry.validate(center, majorRadius, minorRadius, bearing)) {
            showWarning('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('ellipse', this.map);

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddEllipseControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                center: center,
                majorRadius: majorRadius,
                minorRadius: minorRadius,
                bearing: bearing,
                id: featureId,
                nome: featureName
            },
            geometry: this.geometry.generate(center, majorRadius, minorRadius, bearing)
        };

        try {
            await addFeature('ellipses', feature);

            const data = await this.map.getSource('ellipses').getData();
            data.features.push(feature);

            if (feature.properties.hatchEnabled) {
                this.updateHatchPatterns(data);
            }
            this.map.getSource('ellipses').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('ellipse', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating ellipse:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

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
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        this.map.getSource('ellipse-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('ellipse-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('ellipse-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    setupEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.addEventListener('pointerdown', this._onEditPointerDown);
    }

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

    _onEditPointerDown(e) {
        if (!e.isPrimary) return; // Only handle primary pointer

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['ellipse-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId;
            this.map.dragPan.disable();

            const cursor = this.getCursorForHandleType(this.activeHandleType);
            this.map.getCanvas().style.cursor = cursor;

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
     * Get appropriate cursor for handle type
     * @param {string} handleType - Type of handle
     * @returns {string} CSS cursor value
     */
    getCursorForHandleType(handleType) {
        switch (handleType) {
            case 'horizontal-resize':
                return 'ew-resize';
            case 'vertical-resize':
                return 'ns-resize';
            case 'rotation':
                return 'grabbing';
            default:
                return 'grabbing';
        }
    }

    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        const snapping = getSnappingService();
        const excludeId = selectedFeature.properties?.id;
        const snap = snapping?.resolve(this.map, point, lngLat, excludeId) ?? lngLat;

        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    _onEditPointerUp(_e) {
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
            const result = this.geometry.updateFromHandle(this.activeHandleType, this.lastPreviewPosition, selectedFeature);

            if (result && result.majorRadius > 0.01 && result.minorRadius > 0.01) {
                const updatedFeature = {
                    ...selectedFeature,
                    properties: {
                        ...selectedFeature.properties,
                        majorRadius: result.majorRadius,
                        minorRadius: result.minorRadius,
                        bearing: result.bearing
                    },
                    geometry: result.geometry
                };

                this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                this.saveFeatureChanges(updatedFeature);
            }
        }

        getSnappingService()?.hideIndicator(this.map);
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateEllipsePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const preview = this.geometry.calculatePreview(this.activeHandleType, newPosition, selectedFeature);
            if (!preview) return;

            this.map.getSource('ellipse-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            const handles = [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: preview.handlePositions.horizontal },
                    properties: {
                        role: 'handle',
                        handleType: 'vertex',
                        handleId: 'horizontal-resize',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: preview.handlePositions.vertical },
                    properties: {
                        role: 'handle',
                        handleType: 'vertex',
                        handleId: 'vertical-resize',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: preview.handlePositions.rotation },
                    properties: {
                        role: 'handle',
                        handleType: 'eccentricity',
                        handleId: 'rotation',
                        user_isEditingHandle: true
                    }
                }
            ];

            this.map.getSource('ellipse-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }, 8);
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
            const handleFeature = features.find(f =>
                f.source === 'ellipse-edit-handles' &&
                f.properties.user_isEditingHandle
            );

            if (handleFeature) {
                const cursor = this.getCursorForHandleType(handleFeature.properties.handleId);
                this.map.getCanvas().style.cursor = cursor;
            }
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.source === 'ellipse-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'ellipses' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('ellipses').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['majorRadius', 'minorRadius', 'bearing', 'center'].includes(property)) {
                    const center = this.geometry.normalizeCenter(sourceFeature.properties.center);
                    const newGeometry = this.geometry.generate(
                        center,
                        sourceFeature.properties.majorRadius,
                        sourceFeature.properties.minorRadius,
                        sourceFeature.properties.bearing
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        // Regenerate hatch patterns if hatch property changes or if fillColor changes (hatch uses fill color)
        if (property.startsWith('hatch') || (property === 'fillColor' && features.some(f => f.properties.hatchEnabled))) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('ellipses').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('ellipses').getData();
        let _hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('ellipses', currentFeature);
                    _hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            const center = this.geometry.normalizeCenter(initialProps.center);
            f.geometry = this.geometry.generate(center, initialProps.majorRadius, initialProps.minorRadius, initialProps.bearing);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('ellipses', featureId);
                const data = await this.map.getSource('ellipses').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('ellipses').setData(data);
            } catch (error) {
                console.error(`Error removing ellipse ${feature.properties.id}:`, error);
            }
        }
    }

    updateHatchPatterns = (data) => {
        if (!data || !data.features) {
            return;
        }
        const features = data.features.filter(f => f.properties.hatchEnabled);
        this.hatchGenerator.loadPatternsToMap(this.map, features);
    }

    /**
     * Update hatch type and enabled status together
     * This ensures proper pattern generation when enabling/disabling hatch
     */
    updateHatchType = async (features, type) => {
        const data = await this.map.getSource('ellipses').getData();
        const isEnabled = type !== 'none';

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                // Update both properties together
                sourceFeature.properties.hatchType = type;
                sourceFeature.properties.hatchEnabled = isEnabled;
                feature.properties.hatchType = type;
                feature.properties.hatchEnabled = isEnabled;

                // Clear hatchPatternId when disabling
                if (!isEnabled) {
                    delete sourceFeature.properties.hatchPatternId;
                    delete feature.properties.hatchPatternId;
                }
            }
        }

        // Generate patterns after both properties are set
        if (isEnabled) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('ellipses').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddEllipseControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.majorRadius !== initialProperties.majorRadius ||
            feature.properties.minorRadius !== initialProperties.minorRadius ||
            feature.properties.bearing !== initialProperties.bearing ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.hatchEnabled !== initialProperties.hatchEnabled ||
            feature.properties.hatchType !== initialProperties.hatchType ||
            feature.properties.hatchColor !== initialProperties.hatchColor ||
            feature.properties.hatchSpacing !== initialProperties.hatchSpacing ||
            feature.properties.hatchLineWidth !== initialProperties.hatchLineWidth ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('ellipses').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('ellipses', featureToUpdate);
                    }
                }
            }

            this.map.getSource('ellipses').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     * @param {Object} feature - Feature to update in SelectionManager
     */
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('ellipse', feature.properties.id, feature);
    }

    /**
     * Update SelectionManager with multiple features
     * @param {Array} features - Features to update in SelectionManager
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'ellipse') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('ellipses').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                center: feature.properties.center
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('ellipses').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('ellipses', feature);
        } catch (error) {
            console.error('Error saving changes:', error);
        }
    }

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddEllipseControl;
