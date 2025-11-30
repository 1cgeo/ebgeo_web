// Path: js\controls_sig\los_tool\add_los_control.js
import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateLOSFeatures, getActiveLayerIdSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addLOSAttributesToPanel } from './los_attributes_panel.js';
import AddLOSGeometry from './add_los_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddLOSControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.startPoint = null;
        this.endPoint = null;

        // Geometry handler
        this.geometry = new AddLOSGeometry();

        // Performance optimization - RAF system with async support
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // Drag recalculation timeout for debouncing
        this.dragRecalculateTimeout = null;

        // Store reference in toolManager for terrain integration
        this.toolManager.losControl = this;
    }

    static DEFAULT_PROPERTIES = {
        opacity: 1,
        width: 5,
        profile: true,
        measure: false,
        source: 'los',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected LOS feature from SelectionManager
     * @returns {Object|null} Selected LOS feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('los');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected LOS features from SelectionManager
     * @returns {Array} Array of selected LOS features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('los')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl los-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "los-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_los_black.svg" alt="LOS" />';
        button.title = 'Adicionar linha de visada (O)';
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
            console.error('Error removing AddLOSControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'los-attributes-section';

        try {
            addLOSAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating LOS attribute panel:', error);
        }
    }

    getDragSources() {
        return ['los'];
    }

    getEditHandleSources() {
        return []; // LOS doesn't have edit handles
    }

    createSelectionBox(feature) {
        try {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            if (coordinates && coordinates.length === 2) {
                const bbox = this.geometry.getBoundingBox(coordinates);
                const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
                return turf.bboxPolygon(expandedBbox);
            }
            return turf.bbox(feature);
        } catch (error) {
            console.warn('Error creating LOS selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8;
    }

    getLayerIds() {
        return ['los-visible-layer', 'los-obstructed-layer'];
    }

    getSourceNames() {
        return ['los']; // Only return main source for selection detection
    }

    getEditHandleSource() {
        return null; // LOS doesn't have edit handles
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    async prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!oldCoords) return feature;

        const newCoords = oldCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        try {
            // Recalculate LOS with new position (async)
            const result = await this.geometry.recalculateFromCoordinates(newCoords, this.map);

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    profileData: JSON.stringify(result.profileData)
                },
                geometry: result.geometry
            };
        } catch (error) {
            console.error('Error preparing LOS for paste:', error);
            return feature;
        }
    }

    calculateMoveOffset(feature, referencePoint) {
        const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!coordinates || coordinates.length === 0) {
            return [0, 0];
        }

        // Use first point as reference
        const firstPoint = coordinates[0];
        return [
            firstPoint[0] - referencePoint.lng,
            firstPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const oldCoords = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
        if (!oldCoords) return feature;

        const newLOSCoords = oldCoords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        // Return simple translated geometry (sync)
        return {
            ...feature,
            geometry: {
                type: 'LineString',
                coordinates: newLOSCoords
            }
            // Keep original profileData temporarily
        };
    }

    async recalculateLOSAfterMove(movedFeatures) {
        for (const feature of movedFeatures) {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            const result = await this.geometry.recalculateFromCoordinates(coordinates, this.map);

            // Update main source with correct LOS geometry + profile
            this.updateMainSourceAfterRecalculation(feature, result);

            // Update processed sources
            this.updateProcessedSourcesAfterRecalculation(feature, result);
        }
    }

    canMove(feature) {
        return !feature.properties?.bloqueado && this.geometry.isTerrainAvailable(this.map);
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        if (!this.geometry.isTerrainAvailable(this.map)) {
            return false; // Block activation
        }
        this.isActive = true;
        this.startPoint = null;
        this.endPoint = null;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.startPoint = null;
        this.endPoint = null;
        this.map.getCanvas().style.cursor = '';
        this.clearPreview();
        this.updateButtonAppearance();
    }

    updateButtonAppearance = () => {
        const terrainEnabled = this.geometry.isTerrainAvailable(this.map);

        if (!terrainEnabled) {
            // Disabled state
            this.container.classList.add('disabled');
            this.container.querySelector('button').disabled = true;
            $("#los-tool").html('<img class="icon-sig-tool" src="./images/icon_los_disabled.svg" alt="LOS DISABLED" />');
        } else {
            // Normal state
            this.container.classList.remove('disabled');
            this.container.querySelector('button').disabled = false;

            const iconSrc = this.isActive ?
                './images/icon_los_red.svg' :
                './images/icon_los_black.svg';
            $("#los-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="LOS" />`);
        }
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        // LOS features always have profile data - will be shown by UIManager
    }

    onFeatureDeselected = (feature) => {
        // No special cleanup needed
    }

    onGlobalDeselect = () => {
        // No special cleanup needed
    }

    isEditingMode = () => {
        return false; // LOS doesn't have edit handles
    }

    hasEditHandle = (featureId) => {
        return false; // LOS doesn't have edit handles
    }

    /**
     * NOVA IMPLEMENTAÇÃO: Recálculo síncrono após drag
     * Garante que o painel de perfil seja atualizado após o recálculo completo
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        // Verificar se há features LOS que precisam de recálculo
        const losFeatures = movedFeatures.filter(f => f.properties.source === 'los');
        
        if (losFeatures.length === 0) return;

        // Debounce para múltiplos drags rápidos
        clearTimeout(this.dragRecalculateTimeout);
        this.dragRecalculateTimeout = setTimeout(async () => {
            this.showRecalculatingState();
            
            try {
                const updatedFeatures = await this.recalculateMovedLOSFeatures(losFeatures);
                
                // Update
                this.updateSelectionManagerFeatures(updatedFeatures);
                
                // Forçar atualização do UI/painel com dados frescos
                this.selectionManager.updateUI();
                
            } catch (error) {
                console.error('Error recalculating LOS after drag:', error);
            } finally {
                this.hideRecalculatingState();
            }
        }, 50); // 50ms debounce para responsividade
    }

    /**
     * Mostrar estado de recálculo
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
     * Esconder estado de recálculo
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
     * MODIFICADO: Recalcular LOS features após movimento e retornar features atualizados
     * @param {Array} movedFeatures - Array of moved LOS features
     * @returns {Array} Array of updated features
     */
    async recalculateMovedLOSFeatures(movedFeatures) {
        const updatedFeatures = [];
        
        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'los') {
                try {
                    const coordinates = this.geometry.extractCoordinatesFromGeometry(movedFeature.geometry);
                    if (coordinates) {
                        // Recalcular LOS com nova posição
                        const result = await this.geometry.recalculateFromCoordinates(coordinates, this.map);

                        // Update
                        movedFeature.geometry = result.geometry;
                        movedFeature.properties.profileData = JSON.stringify(result.profileData);

                        // Save
                        await updateFeature('los', movedFeature);

                        // Update
                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }

                        // Update
                        await this.updateProcessedFeaturesAfterMove(movedFeature);
                        
                        updatedFeatures.push(movedFeature);
                    }
                } catch (error) {
                    console.error('Error recalculating LOS after movement:', error);
                }
            }
        }
        
        return updatedFeatures;
    }

    /**
     * Update processed features after main feature movement
     * @param {Object} mainFeature - Updated main LOS feature
     */
    async updateProcessedFeaturesAfterMove(mainFeature) {
        const processedData = await this.map.getSource('processed-los').getData();

        // Remove old processed features
        processedData.features = processedData.features.filter(f =>
            f.properties.id !== mainFeature.properties.id + '-visible' &&
            f.properties.id !== mainFeature.properties.id + '-obstructed'
        );

        // Add new processed features
        const newProcessedFeatures = this.geometry.generateProcessedFeatures(mainFeature);
        for (const processedFeature of newProcessedFeatures) {
            await updateFeature('processed_los', processedFeature);
            processedData.features.push(processedFeature);
        }

        // Update map source
        this.map.getSource('processed-los').setData(processedData);
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive || !this.geometry.isTerrainAvailable(this.map)) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.lastPreviewCenter = this.startPoint;
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            this.endPoint = [lng, lat];
            this.map.off('mousemove', this.handleMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    // RAF-based preview system following standard pattern
    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Standard 8ms debounce - no terrain calculations in preview
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const previewGeometry = this.geometry.generate([this.lastPreviewCenter, this.lastPreviewPosition]);
            this.showPreview(previewGeometry);
        }, 8);

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('los-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('los-feedback')) {
            this.map.getSource('los-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.startPoint || !this.endPoint) return;

        try {
            const coordinates = [this.startPoint, this.endPoint];
            const featureId = IDUtils.generateUniqueId();
            const featureName = await IDUtils.generateFeatureName('los', this.map);

            const properties = {
                ...AddLOSControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                layerId: getActiveLayerIdSync(),
            };

            // Create complete LOS feature with geometry and profile
            const losFeature = await this.geometry.createLOSFeature(coordinates, properties, this.map);

            // Save to IndexedDB
            await addFeature('los', losFeature);
            this.updateFeatureMeasurement(losFeature);

            // Update main source
            const data = await this.map.getSource('los').getData();
            data.features.push(losFeature);
            this.map.getSource('los').setData(data);

            // Create and save processed features
            const processedFeatures = this.geometry.generateProcessedFeatures(losFeature);
            const processedData = await this.map.getSource('processed-los').getData();

            for (const processedFeature of processedFeatures) {
                await addFeature('processed_los', processedFeature);
                processedData.features.push(processedFeature);
            }

            this.map.getSource('processed-los').setData(processedData);

            // Select new feature
            this.selectionManager.toggleFeatureSelection('los', losFeature.properties.id, losFeature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Error creating LOS feature:', error);
        } finally {
            this.startPoint = null;
            this.endPoint = null;
        }
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Update measurement if measure property changed
                if (property === 'measure') {
                    this.updateFeatureMeasurement(feature);
                }

                // Update processed features with exact ID matching
                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id === feature.properties.id + '-visible' ||
                    f.properties.id === feature.properties.id + '-obstructed'
                );
                processedFeatures.forEach(processedFeature => {
                    if (property !== 'color') { // Don't override specific colors
                        processedFeature.properties[property] = value;
                    }
                });
            }
        }

        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);

        // Update SelectionManager with fresh features
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: {
                            ...currentFeature.properties,
                            ...selectedFeature.properties
                        }
                    };

                    // Get processed features
                    const processedFeatures = processedData.features.filter(pf =>
                        pf.properties.id === selectedFeature.properties.id + '-visible' ||
                        pf.properties.id === selectedFeature.properties.id + '-obstructed'
                    );

                    // Update processed features properties
                    const updatedProcessedFeatures = processedFeatures.map(pf => ({
                        ...pf,
                        properties: {
                            ...pf.properties,
                            ...selectedFeature.properties,
                            id: pf.properties.id,              // Keep specific ID
                            color: pf.properties.color         // Keep specific color
                        }
                    }));

                    // Use batch operation if available
                    try {
                        if (typeof batchUpdateLOSFeatures === 'function') {
                            await batchUpdateLOSFeatures(featureToSave, updatedProcessedFeatures);
                        } else {
                            // Fallback: individual updates
                            await updateFeature('los', featureToSave);
                            for (const processedFeature of updatedProcessedFeatures) {
                                await updateFeature('processed_los', processedFeature);
                            }
                        }
                    } catch (error) {
                        console.error('Error saving LOS features:', error);
                        // Fallback on error
                        await updateFeature('los', featureToSave);
                        for (const processedFeature of updatedProcessedFeatures) {
                            await updateFeature('processed_los', processedFeature);
                        }
                    }
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

                // Remove measurement
                this.removeFeatureMeasurement(featureId);

                // Remove from store (removes both main and processed features)
                await removeFeature('los', featureId);

            } catch (error) {
                console.error(`Error removing LOS feature ${feature.properties.id}:`, error);
            }
        }

        // Reload sources from store (safer approach)
        const currentMapFeatures = await getCurrentMapFeatures();

        this.map.getSource('los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.los
        });

        this.map.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_los
        });
    }

    setDefaultProperties = (properties) => {
        const {
            id,
            nome,
            profileData,
            ...styleProperties
        } = properties;

        Object.assign(AddLOSControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.profile !== initialProperties.profile ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length === 0) return;

        const data = await this.map.getSource('los').getData();
        const processedData = await this.map.getSource('processed-los').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);

                    // Update processed features
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id === feature.properties.id + '-visible' ||
                        f.properties.id === feature.properties.id + '-obstructed'
                    );
                    processedFeatures.forEach(processedFeature => {
                        Object.keys(feature.properties).forEach(key => {
                            if (key !== 'color') {
                                processedFeature.properties[key] = feature.properties[key];
                            }
                        });
                    });
                } else {
                    data.features[featureIndex] = feature;
                }

                if (save) {
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id === feature.properties.id + '-visible' ||
                        f.properties.id === feature.properties.id + '-obstructed'
                    );

                    if (typeof batchUpdateLOSFeatures === 'function') {
                        await batchUpdateLOSFeatures(data.features[featureIndex], processedFeatures);
                    } else {
                        await updateFeature('los', data.features[featureIndex]);
                        for (const pf of processedFeatures) {
                            await updateFeature('processed_los', pf);
                        }
                    }

                    this.updateFeatureMeasurement(data.features[featureIndex]);
                }
            }
        }

        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);
        this.updateSelectionManagerFeatures(features);
    }

    // ===== MEASUREMENT SYSTEM =====

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);

        if (feature.properties.measure) {
            const coordinates = this.geometry.extractCoordinatesFromGeometry(feature.geometry);
            if (coordinates) {
                const distance = this.geometry.calculateLOSDistance(coordinates);
                const formattedDistance = this.geometry.formatDistance(distance);
                const midpoint = this.geometry.getMidpoint(coordinates);

                this.displayMeasurement(midpoint, formattedDistance, feature.properties.id);
            }
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

    // ===== TERRAIN INTEGRATION =====

    setupBaseEventListeners = () => {
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange(); // Initial check
    }

    _onTerrainChange = () => {
        this.updateButtonAppearance();

        // If tool is active but terrain is disabled, deactivate
        if (this.isActive && !this.geometry.isTerrainAvailable(this.map)) {
            this.toolManager.setActiveTool(null);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        const key = `los:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'los', feature });
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'los') {
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

        if (this.dragRecalculateTimeout) {
            clearTimeout(this.dragRecalculateTimeout);
            this.dragRecalculateTimeout = null;
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.cancelPendingUpdates();
    }
}

export default AddLOSControl;