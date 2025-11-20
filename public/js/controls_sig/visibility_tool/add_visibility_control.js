// Path: js\controls_sig\visibility_tool\add_visibility_control.js
import { addFeature, removeFeature, getCurrentMapFeatures, batchUpdateVisibilityFeatures } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addVisibilityAttributesToPanel } from './visibility_attributes_panel.js';
import AddVisibilityGeometry from './add_visibility_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddVisibilityControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.startPoint = null;

        // Geometry handler
        this.geometry = new AddVisibilityGeometry();

        // Performance optimization - RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // Async operation queue to prevent race conditions (following LOS pattern)
        this.recalculateQueue = Promise.resolve();

        // Debounce system for observer height changes
        this.observerHeightDebounceTimer = null;
        this.OBSERVER_HEIGHT_DEBOUNCE_DELAY = 1000; // 1 second

        // Progress modal components
        this.progressModal = null;
        this.progressBar = null;
        this.progressText = null;

        // Store reference in toolManager for terrain integration
        this.toolManager.visibilityControl = this;
    }

    static DEFAULT_PROPERTIES = {
        opacity: 0.5,
        source: 'visibility',
        observerHeight: 2,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    /**
     * Get currently selected visibility feature from SelectionManager
     * @returns {Object|null} Selected visibility feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('visibility');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected visibility features from SelectionManager
     * @returns {Array} Array of selected visibility features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('visibility')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl visibility-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "visibility-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_visibility_black.svg" alt="VISIBILITY" />';
        button.title = 'Adicionar análise de visibilidade (V)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();
        this.createProgressModal();

        return this.container;
    }

    onRemove = () => {
        try {
            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            
            if (this.progressModal && this.progressModal.parentNode) {
                this.progressModal.parentNode.removeChild(this.progressModal);
            }
            
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddVisibilityControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'visibility-attributes-section';

        try {
            addVisibilityAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating visibility attribute panel:', error);
        }
    }

    getDragSources() {
        return ['visibility'];
    }

    getEditHandleSources() {
        return []; // Visibility doesn't have edit handles
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating visibility selection box:', error);
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
        return ['visibility-visible-layer', 'visibility-obstructed-layer'];
    }

    getSourceNames() {
        return ['visibility'];
    }

    getEditHandleSource() {
        return null; // Visibility doesn't have edit handles
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    async prepareForPaste(feature, offset) {
        const oldCenter = this.geometry.normalizeCenter(feature.properties.center);
        if (!oldCenter) return feature;

        const newCenter = [oldCenter[0] + offset.dx, oldCenter[1] + offset.dy];

        try {
            // Recalculate visibility with new position (async)
            const result = await this.geometry.recalculateFromCoordinates(newCenter, feature, this.map);

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    center: newCenter,
                    cellData: result.cellData
                },
                geometry: result.geometry
            };
        } catch (error) {
            console.error('Error preparing visibility for paste:', error);
            return feature;
        }
    }

    calculateMoveOffset(feature, referencePoint) {
        const center = this.geometry.normalizeCenter(feature.properties.center);
        if (!center) {
            return [0, 0];
        }

        return [
            center[0] - referencePoint.lng,
            center[1] - referencePoint.lat
        ];
    }

    /**
     * Update feature for immediate move (following LOS pattern exactly)
     * Returns translated feature with updated geometry for immediate visual feedback
     * @param {Object} feature - Original feature
     * @param {number} dx - Longitude delta
     * @param {number} dy - Latitude delta 
     * @param {Object} newCoords - New coordinates object
     * @returns {Object} Updated feature with translated geometry
     */
    updateFeatureForMove(feature, dx, dy, newCoords) {
        // Update center position
        const newCenter = [newCoords.lng, newCoords.lat];

        // Translate geometry immediately using new method (following LOS pattern)
        const translatedGeometry = this.geometry.translateGeometry(feature.geometry, dx, dy);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: translatedGeometry
            // Keep original cellData temporarily - will be recalculated in syncEditHandlesAfterDrag
        };
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
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.startPoint = null;
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
            $("#visibility-tool").html('<img class="icon-sig-tool" src="./images/icon_visibility_disabled.svg" alt="VISIBILITY DISABLED" />');
        } else {
            // Normal state
            this.container.classList.remove('disabled');
            this.container.querySelector('button').disabled = false;

            const iconSrc = this.isActive ?
                './images/icon_visibility_red.svg' :
                './images/icon_visibility_black.svg';
            $("#visibility-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="VISIBILITY" />`);
        }
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        // Visibility features don't need special selection handling
    }

    onFeatureDeselected = (feature) => {
        // No special cleanup needed
    }

    onGlobalDeselect = () => {
        // No special cleanup needed
    }

    isEditingMode = () => {
        return false; // Visibility doesn't have edit handles
    }

    hasEditHandle = (featureId) => {
        return false; // Visibility doesn't have edit handles
    }

    /**
     * Sync edit handles after drag (following LOS pattern exactly)
     * Uses queued async operations to prevent race conditions
     * @param {Array} movedFeatures - Array of moved features
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        // Queue async recalculation operations to prevent race conditions (LOS pattern)
        this.recalculateQueue = this.recalculateQueue.then(async () => {
            await this.recalculateMovedVisibilityFeatures(movedFeatures);
        });
    }

    /**
     * Recalculate visibility features after movement (following LOS pattern)
     * @param {Array} movedFeatures - Array of moved features
     */
    async recalculateMovedVisibilityFeatures(movedFeatures) {
        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'visibility') {
                try {
                    const featureId = movedFeature.properties.id;

                    // Show progress modal for long operations
                    this.showProgressModal();
                    this.updateProgress(5, 'Detectando nova posição...');
                    await this.geometry.delay(100);

                    // CRITICAL FIX: Use center from properties (updated in updateFeatureForMove)
                    // instead of extracting from geometry (following LOS pattern)
                    const newCenter = this.geometry.normalizeCenter(movedFeature.properties.center);

                    if (newCenter) {
                        this.updateProgress(10, 'Preparando recálculo...');
                        await this.geometry.delay(100);

                        // Recalculate using geometry class with progress
                        const result = await this.geometry.recalculateFromCoordinates(
                            newCenter, 
                            movedFeature, 
                            this.map,
                            (progress, text) => this.updateProgress(progress, text)
                        );

                        this.updateProgress(80, 'Atualizando geometria...');
                        await this.geometry.delay(100);

                        // Update main feature
                        movedFeature.geometry = result.geometry;
                        movedFeature.properties.center = result.center;
                        movedFeature.properties.cellData = result.cellData;

                        this.updateProgress(85, 'Preparando features processadas...');
                        await this.geometry.delay(100);

                        // Generate new processed features
                        const newProcessedFeatures = this.geometry.generateProcessedFeatures(movedFeature);

                        this.updateProgress(90, 'Salvando no banco de dados...');
                        await this.geometry.delay(100);

                        // Save using batch operation (always use batchUpdate)
                        await batchUpdateVisibilityFeatures(movedFeature, newProcessedFeatures);

                        this.updateProgress(95, 'Atualizando fontes do mapa...');
                        await this.geometry.delay(100);

                        // Update processed features on map
                        await this.updateProcessedFeaturesAfterMove(movedFeature, newProcessedFeatures);

                        this.updateProgress(100, 'Recálculo concluído!');
                        await this.geometry.delay(300);
                    }

                } catch (error) {
                    console.error('Error during visibility recalculation:', error);
                } finally {
                    this.hideProgressModal();
                }
            }
        }
    }

    /**
     * Update processed features after main feature movement (following LOS pattern)
     * @param {Object} mainFeature - Updated main visibility feature
     * @param {Array} newProcessedFeatures - New processed features array
     */
    async updateProcessedFeaturesAfterMove(mainFeature, newProcessedFeatures = null) {
        const processedData = await this.map.getSource('processed-visibility').getData();

        // Remove old processed features (exact pattern from LOS)
        processedData.features = processedData.features.filter(f =>
            !f.properties.id.startsWith(mainFeature.properties.id + '-')
        );

        // Generate new processed features if not provided
        const processedFeatures = newProcessedFeatures || this.geometry.generateProcessedFeatures(mainFeature);

        // Add new processed features to data
        processedFeatures.forEach(processedFeature => {
            processedData.features.push(processedFeature);
        });

        // Update map source
        this.map.getSource('processed-visibility').setData(processedData);

        // Note: Features are already saved via batchUpdateVisibilityFeatures in the calling method
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
            const endPoint = [lng, lat];
            this.map.off('mousemove', this.handleMouseMove);
            await this.createFeature(this.startPoint, endPoint);
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
            const previewCoordinates = this.geometry.calculateSectorCoordinates(this.lastPreviewCenter, this.lastPreviewPosition);
            this.showPreview(previewCoordinates);
        }, 8);

        this.pendingPreviewUpdate = false;
    }

    showPreview = (coordinates) => {
        this.map.getSource('visibility-feedback').setData({
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                },
                properties: {
                    isPreview: true
                }
            }]
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('visibility-feedback')) {
            this.map.getSource('visibility-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async (startPoint, endPoint) => {
        try {
            // Show progress modal at start
            this.showProgressModal();
            
            const featureId = IDUtils.generateUniqueId();
            const featureName = await IDUtils.generateFeatureName('visibility', this.map);

            const properties = {
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName
            };

            // Create complete visibility feature with geometry using geometry class
            const visibilityFeature = await this.geometry.createVisibilityFeature(
                startPoint, 
                endPoint, 
                properties, 
                this.map,
                (progress, text) => this.updateProgress(progress, text)
            );

            this.updateProgress(80, 'Preparando features processadas...');
            await this.geometry.delay(100);

            // Create processed features
            const processedFeatures = this.geometry.generateProcessedFeatures(visibilityFeature);

            this.updateProgress(85, 'Salvando no banco de dados...');
            await this.geometry.delay(100);

            // Save main feature and processed features using batch operation
            await addFeature('visibility', visibilityFeature);
            await batchUpdateVisibilityFeatures(visibilityFeature, processedFeatures);

            this.updateProgress(90, 'Atualizando mapa...');
            await this.geometry.delay(50);

            // Update main source
            const data = await this.map.getSource('visibility').getData();
            data.features.push(visibilityFeature);
            this.map.getSource('visibility').setData(data);

            this.updateProgress(95, 'Atualizando células processadas...');
            await this.geometry.delay(100);

            // Update processed source
            const processedData = await this.map.getSource('processed-visibility').getData();
            processedFeatures.forEach(processedFeature => {
                processedData.features.push(processedFeature);
            });
            this.map.getSource('processed-visibility').setData(processedData);

            this.updateProgress(100, 'Concluído!');
            await this.geometry.delay(300);

            // Select new feature
            this.selectionManager.toggleFeatureSelection('visibility', visibilityFeature.properties.id, visibilityFeature);
            this.selectionManager.updateUI();

            this.hideProgressModal();

        } catch (error) {
            console.error('Error creating visibility feature:', error);
            this.hideProgressModal();
        } finally {
            this.startPoint = null;
        }
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        // Check if observer height is changing (requires debounced recalculation)
        if (property === 'observerHeight') {
            // Cancel previous debounced recalculation
            if (this.observerHeightDebounceTimer) {
                clearTimeout(this.observerHeightDebounceTimer);
            }
            
            // Update property immediately for UI responsiveness
            this.updatePropertyImmediately(features, property, value);
            
            // Schedule debounced recalculation
            this.observerHeightDebounceTimer = setTimeout(() => {
                this.recalculateForObserverHeight(features, value);
            }, this.OBSERVER_HEIGHT_DEBOUNCE_DELAY);
            
            return;
        }
        
        // For other properties, update immediately without recalculation
        this.updatePropertyImmediately(features, property, value);
    }

    /**
     * Update property immediately without recalculation (for UI responsiveness)
     */
    updatePropertyImmediately = async (features, property, value) => {
        const data = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Update processed features properties (but not geometry)
                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id.startsWith(feature.properties.id + '-')
                );
                processedFeatures.forEach(processedFeature => {
                    if (property !== 'color') { // Don't override specific colors
                        processedFeature.properties[property] = value;
                    }
                });
            }
        }

        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);

        // Update SelectionManager with fresh features
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }

    /**
     * Perform debounced recalculation for observer height changes
     */
    recalculateForObserverHeight = async (features, newObserverHeight) => {
        try {
            // Show progress modal
            this.showProgressModal();
            this.updateProgress(5, 'Detectando mudança de altura...');
            await this.geometry.delay(100);

            const data = await this.map.getSource('visibility').getData();
            const processedData = await this.map.getSource('processed-visibility').getData();

            for (const feature of features) {
                const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
                if (sourceFeature) {
                    try {
                        this.updateProgress(15, `Recalculando visibilidade (altura: ${newObserverHeight}m)...`);
                        await this.geometry.delay(100);

                        // Recalculate viewshed with new observer height
                        const result = await this.geometry.recalculateFromCoordinates(
                            sourceFeature.properties.center,
                            sourceFeature,
                            this.map,
                            (progress, text) => this.updateProgress(progress, text)
                        );

                        this.updateProgress(75, 'Atualizando geometria...');
                        await this.geometry.delay(100);

                        // Update main feature
                        sourceFeature.geometry = result.geometry;
                        sourceFeature.properties.cellData = result.cellData;
                        feature.geometry = result.geometry;
                        feature.properties.cellData = result.cellData;

                        this.updateProgress(80, 'Preparando células processadas...');
                        await this.geometry.delay(100);

                        // Generate new processed features
                        const newProcessedFeatures = this.geometry.generateProcessedFeatures(sourceFeature);

                        this.updateProgress(85, 'Salvando no banco de dados...');
                        await this.geometry.delay(100);

                        // Save using batch operation (always use batchUpdate)
                        await batchUpdateVisibilityFeatures(sourceFeature, newProcessedFeatures);

                        this.updateProgress(90, 'Atualizando células processadas...');
                        await this.geometry.delay(100);

                        // Remove old processed features from data
                        processedData.features = processedData.features.filter(f =>
                            !f.properties.id.startsWith(feature.properties.id + '-')
                        );

                        // Add new processed features to data
                        newProcessedFeatures.forEach(processedFeature => {
                            processedData.features.push(processedFeature);
                        });

                    } catch (error) {
                        console.error('Error recalculating visibility for observer height:', error);
                    }
                }
            }

            this.updateProgress(95, 'Atualizando mapa...');
            await this.geometry.delay(100);

            this.map.getSource('visibility').setData(data);
            this.map.getSource('processed-visibility').setData(processedData);

            // Update SelectionManager with fresh features
            const freshFeatures = features.map(feature => {
                const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
                return sourceFeature || feature;
            });

            this.updateSelectionManagerFeatures(freshFeatures);

            this.updateProgress(100, 'Recálculo concluído!');
            await this.geometry.delay(300);

        } catch (error) {
            console.error('Error in debounced observer height recalculation:', error);
        } finally {
            this.hideProgressModal();
            this.observerHeightDebounceTimer = null;
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

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
                        pf.properties.id.startsWith(selectedFeature.properties.id + '-')
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

                    // Always use batch operation
                    try {
                        await batchUpdateVisibilityFeatures(featureToSave, updatedProcessedFeatures);
                    } catch (error) {
                        console.error('Error saving visibility features with batch operation:', error);
                        throw error; // Re-throw to maintain error handling
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
                await removeFeature('visibility', featureId);
            } catch (error) {
                console.error(`Error removing visibility feature ${feature.properties.id}:`, error);
            }
        }

        // Reload sources from store (safer approach - following LOS pattern)
        const currentMapFeatures = await getCurrentMapFeatures();

        this.map.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.visibility
        });

        this.map.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_visibility
        });
    }

    setDefaultProperties = (properties) => {
        const {
            id,
            nome,
            cellData,
            center,
            radius,
            angle,
            ...styleProperties
        } = properties;

        Object.assign(AddVisibilityControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.observerHeight !== initialProperties.observerHeight ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length === 0) return;

        const data = await this.map.getSource('visibility').getData();
        const processedData = await this.map.getSource('processed-visibility').getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[featureIndex].properties, feature.properties);

                    // Update processed features
                    const processedFeatures = processedData.features.filter(f =>
                        f.properties.id.startsWith(feature.properties.id + '-')
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
                        f.properties.id.startsWith(feature.properties.id + '-')
                    );

                    // Always use batch operation
                    await batchUpdateVisibilityFeatures(data.features[featureIndex], processedFeatures);
                }
            }
        }

        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
        this.updateSelectionManagerFeatures(features);
    }

    // ===== PROGRESS MODAL SYSTEM =====

    createProgressModal = () => {
        this.progressModal = document.createElement('div');
        this.progressModal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            min-width: 300px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Calculando Visibilidade';
        title.style.cssText = `
            margin: 0 0 20px 0;
            color: #333;
            font-size: 18px;
            font-weight: 500;
        `;

        this.progressText = document.createElement('p');
        this.progressText.textContent = 'Analisando terreno...';
        this.progressText.style.cssText = `
            margin: 0 0 20px 0;
            color: #666;
            font-size: 14px;
        `;

        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 100%;
            height: 8px;
            background-color: #f0f0f0;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 10px;
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background-color: #508D4E;
            border-radius: 4px;
            transition: width 0.3s ease;
        `;

        const progressPercentage = document.createElement('div');
        progressPercentage.id = 'progress-percentage';
        progressPercentage.textContent = '0%';
        progressPercentage.style.cssText = `
            font-size: 12px;
            color: #666;
            font-weight: 500;
        `;

        progressContainer.appendChild(this.progressBar);
        modalContent.appendChild(title);
        modalContent.appendChild(this.progressText);
        modalContent.appendChild(progressContainer);
        modalContent.appendChild(progressPercentage);
        this.progressModal.appendChild(modalContent);
        document.body.appendChild(this.progressModal);
    }

    showProgressModal = () => {
        this.progressModal.style.display = 'flex';
        this.updateProgress(0, 'Iniciando análise...');
    }

    updateProgress = (percentage, text = null) => {
        this.progressBar.style.width = `${percentage}%`;
        const percentageElement = document.getElementById('progress-percentage');
        if (percentageElement) {
            percentageElement.textContent = `${Math.round(percentage)}%`;
        }

        if (text) {
            this.progressText.textContent = text;
        }
    }

    hideProgressModal = () => {
        this.progressModal.style.display = 'none';
        this.updateProgress(0, 'Analisando terreno...');
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

    // ===== SELECTION MANAGER INTEGRATION (following LOS pattern) =====

    updateSelectionManagerFeature(feature) {
        const key = `visibility:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'visibility', feature });
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'visibility') {
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

        // Cancel observer height debounce timer
        if (this.observerHeightDebounceTimer) {
            clearTimeout(this.observerHeightDebounceTimer);
            this.observerHeightDebounceTimer = null;
        }
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.cancelPendingUpdates();
    }
}

export default AddVisibilityControl;