// Path: js/draw_tools/sector_tool/add_sector_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { getPointerPosition } from '../../utilities/pointer-utils';
import { addSectorAttributesToPanel } from './sector_attributes_panel.js';
import AddSectorGeometry from './add_sector_geometry.js';
import { BaseControl, HatchPatternGenerator } from '../../tool_manager';
import { getSnappingService } from '../../snapping/snapping.service.js';

/**
 * Sector drawing tool control.
 * Two-click creation: first click sets center, second defines radius and bearing.
 * Default aperture is 60 degrees.
 */
class AddSectorControl extends BaseControl {
    featureType = 'sector';
    constructor(toolManager) {
        super(toolManager);
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this.geometry = new AddSectorGeometry();
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
        source: 'sector',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        aperture: 60
    };
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
        sectionPanel.className = 'sector-attributes-section';
        try {
            addSectorAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating sector attribute panel:', error);
        }
    }

    getDragSources() {
        return ['setores'];
    }

    getEditHandleSources() {
        return ['sector-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(), this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating sector selection box:', error);
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
        return ['sector-fill-layer', 'sectors-layer'];
    }

    getSourceNames() {
        return ['setores'];
    }

    getEditHandleSource() {
        return 'sector-edit-handles';
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
                feature.properties.radius,
                feature.properties.bearing,
                feature.properties.aperture
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
        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: this.geometry.generate(
                newCenter,
                feature.properties.radius,
                feature.properties.bearing,
                feature.properties.aperture
            )
        };
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

    syncEditHandlesAfterDrag = (_movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive) return;
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for sector');
            return;
        }
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        this.drawPoints.push([snap.lng, snap.lat]);
        snapping?.hideIndicator(this.map);

        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    // Show snap indicator before the first click so the user knows snap is active
    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
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
            this.updateHandlePreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const center = this.lastPreviewCenter;
            const radius = this.geometry.calculateDistance(center, this.lastPreviewPosition);
            if (radius >= 10) {
                const bearing = this.geometry.calculateBearing(center, this.lastPreviewPosition);
                const aperture = AddSectorControl.DEFAULT_PROPERTIES.aperture;
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate(center, radius, bearing, aperture);
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }
        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('sector-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddSectorControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddSectorControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('sector-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const endPoint = this.drawPoints[1];
        const radius = this.geometry.calculateDistance(center, endPoint);
        const bearing = this.geometry.calculateBearing(center, endPoint);
        const aperture = AddSectorControl.DEFAULT_PROPERTIES.aperture;

        if (!this.geometry.validate(center, radius, aperture)) {
            showWarning('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('sector', this.map);
        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddSectorControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                center: center,
                radius: radius,
                bearing: bearing,
                aperture: aperture,
                id: featureId,
                nome: featureName
            },
            geometry: this.geometry.generate(center, radius, bearing, aperture)
        };

        try {
            await addFeature('setores', feature);
            const data = await this.map.getSource('setores').getData();
            data.features.push(feature);

            if (feature.properties.hatchEnabled) {
                this.updateHatchPatterns(data);
            }
            this.map.getSource('setores').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('sector', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating sector:', error);
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
        this.activeHandleId = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles) return;

        this.map.getSource('sector-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        this.map.getSource('sector-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('sector-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('sector-feedback').setData({
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
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['sector-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            this.isDraggingHandle = true;
            this.activeHandleId = handleFeatures[0].properties.handleId;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';

            this._activePointerId = e.pointerId;
            canvas.setPointerCapture(e.pointerId);

            canvas.addEventListener('pointermove', this._onEditPointerMove);
            canvas.addEventListener('pointerup', this._onEditPointerUp);
            canvas.addEventListener('pointercancel', this._onEditPointerUp);

            e.preventDefault();
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

    async _onEditPointerUp(_e) {
        const canvas = this.map.getCanvasContainer();

        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.lastPreviewPosition) {
            const result = this.geometry.updateFromHandle(this.activeHandleId, this.lastPreviewPosition, selectedFeature);
            if (result) {
                const center = this.geometry.normalizeCenter(selectedFeature.properties.center);
                const updatedFeature = {
                    ...selectedFeature,
                    properties: {
                        ...selectedFeature.properties,
                        radius: result.radius,
                        bearing: result.bearing,
                        aperture: result.aperture,
                        center: center
                    },
                    geometry: result.geometry
                };
                await this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                await this.saveFeatureChanges(updatedFeature);
            }
        }

        getSnappingService()?.hideIndicator(this.map);
        this.isDraggingHandle = false;
        this.activeHandleId = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateHandlePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleId) return;

        const preview = this.geometry.calculatePreview(this.activeHandleId, newPosition, selectedFeature);
        if (!preview) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.map.getSource('sector-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            const [radiusPoint, aperturePoint] = preview.handles;
            this.map.getSource('sector-edit-handles').setData({
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: radiusPoint },
                        properties: {
                            role: 'handle',
                            handleType: 'vertex',
                            handleId: 'radius',
                            user_isEditingHandle: true
                        }
                    },
                    {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: aperturePoint },
                        properties: {
                            role: 'handle',
                            handleType: 'eccentricity',
                            handleId: 'aperture',
                            user_isEditingHandle: true
                        }
                    }
                ]
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
            this.map.getCanvas().style.cursor = 'crosshair';
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.source === 'sector-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'setores' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('setores').getData();
        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                if (property === 'radius' || property === 'center' || property === 'bearing' || property === 'aperture') {
                    const center = this.geometry.normalizeCenter(sourceFeature.properties.center);
                    const newGeometry = this.geometry.generate(
                        center,
                        sourceFeature.properties.radius,
                        sourceFeature.properties.bearing,
                        sourceFeature.properties.aperture
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        if (property.startsWith('hatch') || (property === 'fillColor' && features.some(f => f.properties.hatchEnabled))) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('setores').setData(data);
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

    updateHatchPatterns = (data) => {
        if (!data || !data.features) return;
        const features = data.features.filter(f => f.properties.hatchEnabled);
        this.hatchGenerator.loadPatternsToMap(this.map, features);
    }

    updateHatchType = async (features, type) => {
        const data = await this.map.getSource('setores').getData();
        const isEnabled = type !== 'none';

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties.hatchType = type;
                sourceFeature.properties.hatchEnabled = isEnabled;
                feature.properties.hatchType = type;
                feature.properties.hatchEnabled = isEnabled;

                if (!isEnabled) {
                    delete sourceFeature.properties.hatchPatternId;
                    delete feature.properties.hatchPatternId;
                }
            }
        }

        if (isEnabled) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('setores').setData(data);

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
        const currentData = await this.map.getSource('setores').getData();
        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);
                if (currentFeature) {
                    await updateFeature('setores', currentFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const center = this.geometry.normalizeCenter(f.properties.center);
            f.geometry = this.geometry.generate(center, f.properties.radius, f.properties.bearing, f.properties.aperture);
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('setores', featureId);
                const data = await this.map.getSource('setores').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('setores').setData(data);
            } catch (error) {
                console.error(`Error removing sector ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddSectorControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.radius !== initialProperties.radius ||
            feature.properties.bearing !== initialProperties.bearing ||
            feature.properties.aperture !== initialProperties.aperture ||
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
            const data = await this.map.getSource('setores').getData();
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
                        await updateFeature('setores', featureToUpdate);
                    }
                }
            }
            this.map.getSource('setores').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('sector', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'sector') {
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
        if (this.uiManager && this.uiManager.isDragging) return;
        const data = await this.map.getSource('setores').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('setores').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('setores', feature);
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

export default AddSectorControl;
