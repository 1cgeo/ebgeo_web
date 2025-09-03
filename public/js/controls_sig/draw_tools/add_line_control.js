// Path: js\controls_sig\draw_tools\add_line_control.js

import { addFeature, updateFeature, removeFeature } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addLineAttributesToPanel } from './line_attributes_panel.js';
import { getTerrainElevation } from '../terrain_control.js';
import AddLineGeometry from './add_line_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddLineControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;      // Store complete handle object
        this.activeHandleType = null;  // Handle type string

        // Geometry handler
        this.geometry = new AddLineGeometry();

        // Performance optimization - RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.geometryDebounceTimer = null;
        
        // Profile calculation state
        this.isCalculatingProfile = false;
        
        // NOVO: Drag recalculation timeout para debouncing (seguindo padrão LOS)
        this.dragRecalculateTimeout = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#fbb03b',
        size: 7,
        opacity: 0.7,
        outlinecolor: '#fbb03b',
        lineStyle: 'solid',
        measure: false,
        profile: false,
        profileData: null,
        source: 'line',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected line feature from SelectionManager
     * @returns {Object|null} Selected line feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('line');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected line features from SelectionManager
     * @returns {Array} Array of selected line features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('line')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl line-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "line-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_line_black.svg" alt="LINE" />';
        button.title = 'Adicionar linha (L)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddLineControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'line-attributes-section';

        try {
            addLineAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating line attribute panel:', error);
        }
    }

    getDragSources() {
        return ['lines'];
    }

    getEditHandleSources() {
        return ['line-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating line selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8; // Slightly larger padding for lines
    }

    getLayerIds() {
        return ['line-layer'];
    }

    getSourceNames() {
        return ['lines'];
    }

    getEditHandleSource() {
        return 'line-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, offset.dx, offset.dy);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(
            this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates)
        );
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, dx, dy);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
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
        this.updateButtonAppearance();
        this.setupRightClickListener();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.removeRightClickListener();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_line_red.svg' :
            './images/icon_line_black.svg';
        $("#line-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="LINE" />`);
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

    /**
     * IMPLEMENTAÇÃO SEGUINDO PADRÃO LOS: Recálculo assíncrono após drag
     * Garante que o painel de perfil seja atualizado após o recálculo completo
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        // Verificar se há features Line que precisam de recálculo
        const lineFeatures = movedFeatures.filter(f => f.properties.source === 'line');
        
        if (lineFeatures.length === 0) {
            // Se é selecionado e não é drag, recrear handles normalmente
            const selectedFeature = this.getSelectedFeature();
            if (selectedFeature && !this.isDraggingHandle) {
                this.createEditHandles(selectedFeature);
            }
            return;
        }

        // Debounce para múltiplos drags rápidos (seguindo padrão LOS)
        clearTimeout(this.dragRecalculateTimeout);
        this.dragRecalculateTimeout = setTimeout(async () => {
            this.showRecalculatingState();
            
            try {
                const updatedFeatures = await this.recalculateMovedLineFeatures(lineFeatures);
                
                // Atualizar SelectionManager com features recalculados (seguindo padrão LOS)
                this.updateSelectionManagerFeatures(updatedFeatures);
                
                // Forçar atualização do UI/painel com dados frescos (seguindo padrão LOS)
                this.selectionManager.updateUI();
                
                // Recrear handles se necessário
                const selectedFeature = this.getSelectedFeature();
                if (selectedFeature && !this.isDraggingHandle) {
                    this.createEditHandles(selectedFeature);
                }
                
            } catch (error) {
                console.error('Error recalculating Line profile after drag:', error);
            } finally {
                this.hideRecalculatingState();
            }
        }, 50); // 50ms debounce para responsividade (igual ao LOS)
    }

    /**
     * NOVO: Mostrar estado de recálculo (seguindo padrão LOS)
     */
    showRecalculatingState() {
        this.map.getCanvas().style.cursor = 'wait';
        
        // Temporariamente desabilitar interações durante recálculo
        this.map.off('click', this.handleMapClick);
        
        // Opcional: mostrar indicador visual
        if (this.container) {
            this.container.classList.add('recalculating');
        }
    }

    /**
     * NOVO: Esconder estado de recálculo (seguindo padrão LOS)
     */
    hideRecalculatingState() {
        this.map.getCanvas().style.cursor = this.isActive ? 'crosshair' : '';
        
        // Re-habilitar interações
        if (this.isActive) {
            this.map.on('click', this.handleMapClick);
        }
        
        if (this.container) {
            this.container.classList.remove('recalculating');
        }
    }

    /**
     * NOVO: Recalcular Line features após movimento e retornar features atualizados (seguindo padrão LOS)
     * @param {Array} movedFeatures - Array of moved Line features
     * @returns {Array} Array of updated features
     */
    async recalculateMovedLineFeatures(movedFeatures) {
        const updatedFeatures = [];
        
        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'line') {
                try {
                    const coordinates = this.geometry.normalizeBaseCoordinates(movedFeature.properties.baseCoordinates);
                    if (coordinates && coordinates.length >= 2) {
                        
                        // CRÍTICO: Recalcular perfil se habilitado (seguindo padrão LOS)
                        if (movedFeature.properties.profile) {
                            console.log('Recalculating line profile after drag...');
                            const newProfileData = await this.calculateProfile(coordinates);
                            movedFeature.properties.profileData = JSON.stringify(newProfileData);
                        }

                        // Salvar no IndexedDB (seguindo padrão LOS)
                        await updateFeature('lines', movedFeature);

                        // Atualizar measurement se habilitado (seguindo padrão LOS)
                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }
                        
                        updatedFeatures.push(movedFeature);
                        console.log('Line profile recalculation complete after drag');
                    }
                } catch (error) {
                    console.error('Error recalculating Line profile after movement:', error);
                    // Continuar com próxima feature mesmo se uma falhar
                    updatedFeatures.push(movedFeature);
                }
            }
        }
        
        return updatedFeatures;
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for line');
            return;
        }

        const newPoint = [e.lngLat.lng, e.lngLat.lat];

        // Check if point is too close to last point
        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.drawPoints.push(newPoint);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length >= 2) {
            // Update preview to show current line
            this.updateDrawingPreview();
        }
    }

    setupRightClickListener = () => {
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
    }

    removeRightClickListener = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
    }

    handleRightClick = (e) => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const coordinates = this.map.unproject([e.offsetX, e.offsetY]);
        const finalPoint = [coordinates.lng, coordinates.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        // Finish line if we have at least 2 points
        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

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
            this.updateLinePreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length >= 1) {
            this.updateDrawingPreview();
        }

        this.pendingPreviewUpdate = false;
    }

    updateDrawingPreview = () => {
        if (this.drawPoints.length === 0) return;

        let previewCoords = [...this.drawPoints];
        if (this.lastPreviewPosition) {
            previewCoords.push(this.lastPreviewPosition);
        }

        if (previewCoords.length >= 2) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.geometry.generate(previewCoords);
                this.showPreview(previewGeometry);
            }, 8);
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                color: AddLineControl.DEFAULT_PROPERTIES.color,
                size: AddLineControl.DEFAULT_PROPERTIES.size,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('line-feedback')) {
            this.map.getSource('line-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.geometry.validate(this.drawPoints)) {
            alert('Linha deve ter pelo menos 2 pontos válidos');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('line', this.map);
        const coordinates = [...this.drawPoints];

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddLineControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates,
                profileData: JSON.stringify(await this.calculateProfile(coordinates))
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('lines', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
            data.features.push(feature);
            this.map.getSource('lines').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('line', featureId, feature);
            this.selectionManager.updateUI();

            this.updateFeatureMeasurement(feature);
        } catch (error) {
            console.error('Error creating line:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;         // Reset handle object
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

        // Show selection feedback
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('line-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    setupEditEventListeners = () => {
        this.map.on('mousedown', this.onEditMouseDown);
        this.map.on('mousemove', this.onEditMouseMove);
        this.map.on('mouseup', this.onEditMouseUp);
    }

    removeEditEventListeners = () => {
        this.map.off('mousedown', this.onEditMouseDown);
        this.map.off('mousemove', this.onEditMouseMove);
        this.map.off('mouseup', this.onEditMouseUp);
    }

    onEditMouseDown = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['line-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;                           // Store complete handle object
            this.activeHandleType = handle.properties.handleId;   // Store handleId (like "vertex-0", "midpoint-1")
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    // ===== EDIT COMPLETION COM RECÁLCULO ASYNC (SEGUINDO PADRÃO LOS) =====
    onEditMouseUp = async () => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType) {
            try {
                // Apply geometry changes directly
                this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);
                
                // Get updated coordinates from feature
                const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);
                const result = this.geometry.updateFromHandle(this.activeHandleType, this.lastPreviewPosition, selectedFeature);

                if (result) {
                    // Create updated feature with new coordinates
                    let updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            baseCoordinates: result.baseCoordinates
                        },
                        geometry: result.geometry
                    };

                    // CRÍTICO: Calculate profile ANTES do UI update se profile habilitado
                    if (updatedFeature.properties.profile && !this.isCalculatingProfile) {
                        try {
                            this.isCalculatingProfile = true;
                            console.log('Recalculating profile after vertex edit...');
                            
                            const newProfileData = await this.calculateProfile(result.baseCoordinates);
                            updatedFeature.properties.profileData = JSON.stringify(newProfileData);
                            
                            console.log('Profile recalculation complete');
                        } catch (error) {
                            console.error('Error recalculating profile:', error);
                            // Continue with update even if profile calculation fails
                        } finally {
                            this.isCalculatingProfile = false;
                        }
                    }

                    // Update everything with complete feature data (including fresh profile)
                    this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);
                    
                    // UI update now has correct profile data
                    this.updateUIAfterEdit();
                    
                    // Save changes (no profile recalculation needed here)
                    this.saveFeatureChanges(updatedFeature);
                    this.updateFeatureMeasurement(updatedFeature);
                }
            } catch (error) {
                console.error('Error during edit completion:', error);
            }
        }

        // Reset drag state
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateLinePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType || !this.isDraggingHandle) {
            return;
        }

        // Update geometry in feature directly (like Arrow Tool)
        this.updateGeometryFromHandle(this.activeHandleType, newPosition);

        // Calculate preview
        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);
        const preview = this.geometry.calculatePreview(this.activeHandleType, newPosition, selectedFeature);

        if (preview) {
            // Show updated selection
            this.map.getSource('line-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            // Update handles
            this.map.getSource('line-edit-handles').setData({
                type: 'FeatureCollection',
                features: preview.handles
            });
        }
    }

    // Handle conversion logic (like Arrow Tool)
    updateGeometryFromHandle = (handleId, newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        let coords = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);
        if (!coords || coords.length < 2) return;

        coords = [...coords]; // Create copy

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            if (handleId.startsWith('vertex-')) {
                // Move existing vertex
                const index = parseInt(handleId.split('-')[1]);
                if (index >= 0 && index < coords.length) {
                    coords[index] = newPosition;
                    selectedFeature.properties.baseCoordinates = coords;
                }
            } else if (handleId.startsWith('midpoint-')) {
                // Add new vertex
                const insertIndex = parseInt(handleId.split('-')[1]) + 1;
                coords.splice(insertIndex, 0, newPosition);
                selectedFeature.properties.baseCoordinates = coords;

                // CRITICAL: Convert handle from midpoint → vertex
                if (this.activeHandle && this.activeHandle.properties) {
                    this.activeHandle.properties.handleType = 'vertex';
                    this.activeHandle.properties.handleId = `vertex-${insertIndex}`;
                    this.activeHandleType = `vertex-${insertIndex}`;  // Synchronize
                }
            }

            // Update geometry
            selectedFeature.geometry = this.geometry.generate(coords);
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
            f.source === 'line-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'lines' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== PROFILE CALCULATION =====

    async calculateProfile(coordinates) {
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;

        let profileData = [];

        for (let i = 0; i <= steps; i++) {
            const point = turf.along(line, i * stepLength, { units: 'meters' });
            const elevation = await getTerrainElevation(this.map, point.geometry.coordinates);
            profileData.push({
                distance: i * stepLength,
                elevation: elevation
            });
        }

        return profileData;
    }

    // ===== MEASUREMENT SYSTEM =====

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);

        if (feature.properties.measure) {
            const line = turf.lineString(feature.geometry.coordinates);
            const lengthInMeters = turf.length(line, { units: 'meters' });
            const lengthFormatted = lengthInMeters >= 1000
                ? `${(lengthInMeters / 1000).toFixed(2)} km`
                : `${lengthInMeters.toFixed(2)} m`;
            const midpoint = turf.along(line, lengthInMeters / 2, { units: 'meters' });
            this.displayMeasurement(midpoint.geometry.coordinates, lengthFormatted, feature.properties.id);
        }
    }

    removeFeatureMeasurement = (featureId) => {
        const measurementLabel = document.querySelector(`.measurement-label[data-feature-id="${featureId}"]`);
        if (measurementLabel) {
            measurementLabel.remove();
        }
    }

    displayMeasurement = (coordinates, measurement, featureId) => {
        const markerElement = this.createMeasurementLabel(measurement, featureId);
        new maplibregl.Marker({ element: markerElement })
            .setLngLat(coordinates)
            .addTo(this.map);
    }

    createMeasurementLabel = (measurement, featureId) => {
        const label = document.createElement('div');
        label.className = 'measurement-label';
        label.innerText = measurement;
        label.dataset.featureId = featureId;

        label.style.cssText = `
            background-color: rgba(255, 255, 255, 0.9);
            border: 2px solid #508D4E;
            border-radius: 6px;
            padding: 6px 10px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: bold;
            color: #333;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            white-space: nowrap;
            pointer-events: none;
            user-select: none;
            transform: translate(-50%, -50%);
            z-index: 1000;
        `;

        return label;
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // If changing geometry properties, recalculate geometry
                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                // CRÍTICO: Recalcular perfil quando property profile é habilitada (seguindo padrão anterior)
                if (property === 'profile' && value === true) {
                    try {
                        console.log('Recalculating profile after property change...');
                        const coordinates = this.geometry.normalizeBaseCoordinates(sourceFeature.properties.baseCoordinates);
                        const newProfileData = await this.calculateProfile(coordinates);
                        sourceFeature.properties.profileData = JSON.stringify(newProfileData);
                        feature.properties.profileData = JSON.stringify(newProfileData);
                        console.log('Profile recalculation complete for property change');
                    } catch (error) {
                        console.error('Error recalculating profile for property change:', error);
                    }
                }
            }
        }

        this.map.getSource('lines').setData(data);

        // Update measurement if property changed
        if (property === 'measure') {
            features.forEach(f => {
                if (value) {
                    this.updateFeatureMeasurement(f);
                } else {
                    this.removeFeatureMeasurement(f.properties.id);
                }
            });
        }

        // CRÍTICO: Update profile panel explicitamente após mudanças na property profile
        if (property === 'profile' && this.selectionManager) {
            // Force profile panel update com dados frescos (seguindo padrão anterior)
            setTimeout(() => {
                this.selectionManager.updateProfile();
            }, 100); // Small delay para garantir que dados foram atualizados
        }

        // Update SelectionManager with fresh features
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('lines')._data;
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('lines', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const coordinates = this.geometry.normalizeBaseCoordinates(f.properties.baseCoordinates);
            f.geometry = this.geometry.generate(coordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;

                // Remove measurement label
                this.removeFeatureMeasurement(featureId);

                await removeFeature('lines', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('lines').setData(data);
            } catch (error) {
                console.error(`Error removing line ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLineControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.outlinecolor !== initialProperties.outlinecolor ||
            feature.properties.lineStyle !== initialProperties.lineStyle ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.profile !== initialProperties.profile ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
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
                        await updateFeature('lines', featureToUpdate);
                    }
                }
            }

            this.map.getSource('lines').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        const key = `line:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'line', feature });
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'line') {
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
        
        // CRITICAL FIX: Only reset activeHandle if NOT currently dragging
        if (!this.isDraggingHandle) {
            this.activeHandle = null;
            this.activeHandleType = null;
        }

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        // NOVO: Cancel drag recalculation timeout (seguindo padrão LOS)
        if (this.dragRecalculateTimeout) {
            clearTimeout(this.dragRecalculateTimeout);
            this.dragRecalculateTimeout = null;
        }
    }

    forceUpdateMainSource = (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = JSON.parse(JSON.stringify(this.map.getSource('lines')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                baseCoordinates: feature.properties.baseCoordinates
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('lines').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    // SIMPLIFICADO: saveFeatureChanges sem recálculo de perfil (seguindo padrão LOS)
    saveFeatureChanges = async (feature) => {
        try {
            // Profile data já deve estar calculado neste ponto
            await updateFeature('lines', feature);
            console.log('Feature changes saved successfully');
        } catch (error) {
            console.error('Error saving line changes:', error);
        }
    }

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddLineControl;