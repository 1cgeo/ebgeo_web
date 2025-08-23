// Path: js\controls_sig\occupied_front_tool\add_occupied_front_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddOccupiedFrontControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // ✅ ESTADO SIMPLIFICADO (6 variáveis máximo)
        this.isActive = false;
        this.selectedFeature = null;           // Substitui currentState system
        this.drawPoints = [];
        this.isDraggingHandle = false;         // Estado de drag único
        this.activeHandleType = null;          // Track qual handle está sendo arrastado

        // ✅ RAF CONSOLIDADO - um sistema apenas
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;         // Cache do centro durante preview
        this.geometryDebounceTimer = null;     // Debounce para operações de geometria
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1.0,
        source: 'occupied_front',
        type: 'occupied_front',

        // ✅ NOVOS ATRIBUTOS
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl occupied-front-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "occupied-front-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_occupied_front_black.svg" alt="FRENTE OCUPADA" />';
        button.title = 'Adicionar Frente Ocupada (F)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            if (this.selectionManager.uiManager) {
                this.selectionManager.uiManager.removeControl(this.container);
            }
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddOccupiedFrontControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_occupied_front_red.svg' :
            './images/icon_occupied_front_black.svg';
        $("#occupied-front-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="FRENTE OCUPADA" />`);
    }

    // ===== SIMPLIFIED STATE MANAGEMENT =====

    selectFeature = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    // ✅ CLEANUP - cancelar operações pendentes
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.activeHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    // ===== HOVER SYSTEM FOR DYNAMIC CURSOR =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;

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
            f.source === 'occupied-front-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'occupied_fronts' &&
            f.properties.id === this.selectedFeature.properties.id
        );
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;
        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.selectedFeature) {
            this.deselectFeature();
        }
    }

    // Interface for move_handler integration
    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return this.selectedFeature && this.selectedFeature.properties.id === featureId;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        if (this.selectedFeature && !this.isDraggingHandle) {
            const updatedFeature = movedFeatures.find(f =>
                f.properties.id === this.selectedFeature.properties.id
            );
            if (updatedFeature) {
                this.selectedFeature = updatedFeature;
                this.createEditHandles(updatedFeature);
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para frente ocupada');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    // ✅ RAF-based preview (com cache do centro)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];  // Cache do centro
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    // ✅ CONSOLIDATED RAF - handles both preview and edit
    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Edit mode - updating occupied front via handle drag
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            this.updateOccupiedFrontPreview(this.lastPreviewPosition);
        }
        // Drawing mode - showing occupied front preview
        else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const p1 = this.lastPreviewCenter; // Origem
            const p2 = this.lastPreviewPosition; // Braço superior

            // Calcular P3 automaticamente com ângulo de 50°
            const distance = this.calculateDistance(p1, p2);
            const bearing = this.calculateBearing(p1, p2);
            const p3 = this.destination(p1, distance, bearing + 50);

            if (distance >= 10) {
                // ✅ Debounce para operações de geometria complexa
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.createOccupiedFrontGeometry([p1, p2, p3]);
                    this.showPreview(previewGeometry);
                }, 8); // 8ms para geometria mais complexa
            }
        }

        this.pendingPreviewUpdate = false;
    }

    // ✅ UPDATED - uses consolidated feedback source
    showPreview = (geometry) => {
        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                color: AddOccupiedFrontControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddOccupiedFrontControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    // ✅ UPDATED - clears consolidated feedback source
    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('occupied-front-feedback')) {
            this.map.getSource('occupied-front-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        const p1 = this.drawPoints[0]; // Origem
        const p2 = this.drawPoints[1]; // Braço superior

        // Calcular P3 automaticamente com ângulo de 50°
        const distance = this.calculateDistance(p1, p2);
        const bearing = this.calculateBearing(p1, p2);
        const p3 = this.destination(p1, distance, bearing + 50);

        if (distance < 10) {
            alert('Distância mínima: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('occupied_front', this.map);
        const coordinates = [p1, p2, p3]; // LineString com 3 pontos

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddOccupiedFrontControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates // Armazenar pontos de controle
            },
            geometry: this.createOccupiedFrontGeometry(coordinates)
        };

        try {
            await addFeature('occupied_fronts', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
            data.features.push(feature);
            this.map.getSource('occupied_fronts').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('occupied_front', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar frente ocupada:', error);
        }
    }

    // ===== GEOMETRIA DA FRENTE OCUPADA (MANTER LÓGICA ORIGINAL) =====

    /**
     * Cria a geometria MultiLineString da frente ocupada
     */
    createOccupiedFrontGeometry = (coords) => {
        if (!coords || coords.length < 3) return null;

        const p1 = coords[0]; // Origem
        const p2 = coords[1]; // Braço superior  
        const p3 = coords[2]; // Braço inferior

        const multiLine = {
            type: 'MultiLineString',
            coordinates: []
        };

        // Criar os dois braços independentemente usando createRay
        const upperArm = this.createRay(p1, p2, -1); // Braço superior (curva para direita)
        const lowerArm = this.createRay(p1, p3, 1);  // Braço inferior (curva para esquerda)

        multiLine.coordinates.push(...upperArm);
        multiLine.coordinates.push(...lowerArm);

        return multiLine;
    }

    /**
     * Cria a geometria para um único braço da "Frente Ocupada" (MANTER LÓGICA ORIGINAL).
     */
    createRay = (startPoint, endPoint, turnDirection) => {
        const rayLines = [];
        const initialBearing = this.calculateBearing(startPoint, endPoint);
        const distance = this.calculateDistance(startPoint, endPoint);

        if (distance < 1) return [];

        // 1. Ponto de início da curva (60% do caminho)
        const p_turn1 = this.destination(startPoint, distance * 0.6, initialBearing);

        // 2. Ponto final da curva
        const turnBearing = initialBearing + (225 * turnDirection);
        const turnLength = distance * 0.1;
        const p_turn2 = this.destination(p_turn1, turnLength, turnBearing);

        // 3. Monta os 3 segmentos de linha do braço
        rayLines.push([startPoint, p_turn1]);
        rayLines.push([p_turn1, p_turn2]);
        rayLines.push([p_turn2, endPoint]);

        // 4. Cabeça da seta - DUAS LINHAS COMPLETAS
        const headLength = distance * 0.1
        const finalBearing = this.calculateBearing(p_turn2, endPoint);
        const headPoint1 = this.destination(endPoint, headLength, finalBearing + 150);
        const headPoint2 = this.destination(endPoint, headLength, finalBearing - 150);

        // Duas linhas separadas para formar a seta completa
        rayLines.push([headPoint1, endPoint]);
        rayLines.push([headPoint2, endPoint]);

        return rayLines;
    }

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 3) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // Handle P1 - origem (verde)
        handles.push({
            type: 'Feature',
            id: `occupied-front-handle-${feature.properties.id}-p1`,
            geometry: { type: 'Point', coordinates: coords[0] },
            properties: {
                role: 'handle',
                handleType: 'center',
                handleId: 'p1',
                index: 0,
                featureId: feature.properties.id,
                mode: 'occupied_front_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle P2 - braço superior (vermelho)
        handles.push({
            type: 'Feature',
            id: `occupied-front-handle-${feature.properties.id}-p2`,
            geometry: { type: 'Point', coordinates: coords[1] },
            properties: {
                role: 'handle',
                handleType: 'primary',
                handleId: 'p2',
                index: 1,
                featureId: feature.properties.id,
                mode: 'occupied_front_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Handle P3 - braço inferior (azul)
        handles.push({
            type: 'Feature',
            id: `occupied-front-handle-${feature.properties.id}-p3`,
            geometry: { type: 'Point', coordinates: coords[2] },
            properties: {
                role: 'handle',
                handleType: 'secondary',
                handleId: 'p3',
                index: 2,
                featureId: feature.properties.id,
                mode: 'occupied_front_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // Show selection feedback using consolidated source
        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('occupied-front-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // ===== EDITING MODE: HANDLE INTERACTION =====

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

    // ✅ SIMPLIFIED - track do handle específico
    onEditMouseDown = (e) => {
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['occupied-front-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            if (handle && handle.properties && handle.properties.handleId) {
                this.isDraggingHandle = true;
                this.activeHandleType = handle.properties.handleId; // Track qual handle
                this.map.dragPan.disable();
                this.map.getCanvas().style.cursor = 'grabbing';
                e.preventDefault();
            }
        }
    }

    // ✅ SIMPLIFIED - uses consolidated RAF
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            // Apply changes to selected feature
            const coords = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);

            if (coords && coords.length >= 3 && this.lastPreviewPosition) {
                // Update specific handle position
                if (this.activeHandleType === 'p1') coords[0] = this.lastPreviewPosition;
                else if (this.activeHandleType === 'p2') coords[1] = this.lastPreviewPosition;
                else if (this.activeHandleType === 'p3') coords[2] = this.lastPreviewPosition;

                // Regenerate geometry
                this.selectedFeature.properties.baseCoordinates = coords;
                this.selectedFeature.geometry = this.createOccupiedFrontGeometry(coords);

                this.forceUpdateMainSource(this.selectedFeature);
                this.createEditHandles(this.selectedFeature);
                this.updateSelectionAfterEdit();
                this.updateUIAfterEdit();
                this.saveFeatureChanges(this.selectedFeature);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateOccupiedFrontPreview = (newPosition) => {
        if (!this.selectedFeature || !this.activeHandleType) return;

        const coords = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);
        if (!coords || coords.length < 3) return;

        // ✅ Debounce para operações de geometria complexa
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // Update specific handle position for preview
            const previewCoords = [...coords];
            if (this.activeHandleType === 'p1') previewCoords[0] = newPosition;
            else if (this.activeHandleType === 'p2') previewCoords[1] = newPosition;
            else if (this.activeHandleType === 'p3') previewCoords[2] = newPosition;

            const previewGeometry = this.createOccupiedFrontGeometry(previewCoords);

            // Show updated selection
            this.map.getSource('occupied-front-feedback').setData({
                type: 'Feature',
                geometry: previewGeometry,
                properties: {
                    ...this.selectedFeature.properties,
                    isSelected: true
                }
            });

            // Update handles
            const handles = previewCoords.map((coord, index) => ({
                type: 'Feature',
                id: `occupied-front-handle-${this.selectedFeature.properties.id}-p${index + 1}`,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: ['center', 'primary', 'secondary'][index],
                    handleId: `p${index + 1}`,
                    user_isEditingHandle: true
                }
            }));

            this.map.getSource('occupied-front-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }, 12); // 12ms para geometria complexa
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }

    // ===== UTILITY METHODS =====

    normalizeBaseCoordinates = (coords) => {
        if (typeof coords === 'string') {
            try {
                coords = JSON.parse(coords);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', coords, e);
                return [];
            }
        }

        if (!Array.isArray(coords)) {
            console.error('baseCoordinates inválido:', coords);
            return [];
        }

        return coords;
    }

    calculateDistance = (point1, point2) => {
        const R = 6371000; // Earth's radius in meters
        const lat1Rad = point1[1] * Math.PI / 180;
        const lat2Rad = point2[1] * Math.PI / 180;
        const deltaLatRad = (point2[1] - point1[1]) * Math.PI / 180;
        const deltaLngRad = (point2[0] - point1[0]) * Math.PI / 180;

        const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    calculateBearing = (point1, point2) => {
        const lat1 = point1[1] * Math.PI / 180;
        const lat2 = point2[1] * Math.PI / 180;
        const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    destination = (point, distance, bearing) => {
        const R = 6371000; // Earth's radius in meters
        const lat1 = point[1] * Math.PI / 180;
        const lng1 = point[0] * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(distance / R) +
            Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
        );

        const lng2 = lng1 + Math.atan2(
            Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
            Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
        );

        return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
    }

    forceUpdateMainSource = (feature) => {
        if (!feature || !this.map) {
            console.warn('forceUpdateMainSource: feature ou map inválido');
            return;
        }

        const source = this.map.getSource('occupied_fronts');
        if (!source) {
            console.warn('forceUpdateMainSource: source occupied_fronts não encontrado');
            return;
        }

        try {
            const data = JSON.parse(JSON.stringify(source._data));
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);

            if (sourceFeature) {
                sourceFeature.properties = { ...feature.properties };
                sourceFeature.geometry = { ...feature.geometry };
                source.setData(data);
            }
        } catch (error) {
            console.error('Erro em forceUpdateMainSource:', error);
        }
    }

    updateSelectionAfterEdit = () => {
        const featureId = this.selectedFeature.properties.id;
        const type = this.selectedFeature.properties.source;
        const key = `${type}:${featureId}`;

        this.selectionManager.selectedFeatures.set(key, {
            type,
            feature: this.selectedFeature
        });
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('occupied_fronts', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações da frente ocupada:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['baseCoordinates'].includes(property)) {
                    const newGeometry = this.createOccupiedFrontGeometry(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('occupied_fronts').setData(data);

        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('occupied_fronts')._data;
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('occupied_fronts', featureToSave);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.createOccupiedFrontGeometry(f.properties.baseCoordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (!features || features.length === 0) return;

        try {
            for (const feature of features) {
                const featureId = feature.properties.id;
                await removeFeature('occupied_fronts', featureId);
            }

            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
            const idsToDelete = new Set(features.map(f => String(f.properties.id)));
            data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
            this.map.getSource('occupied_fronts').setData(data);
        } catch (error) {
            console.error('Erro ao remover frentes ocupadas:', error);
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddOccupiedFrontControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            // ✅ NOVOS ATRIBUTOS
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        await updateFeature('occupied_fronts', data.features[featureIndex]);
                    }
                }
            }

            this.map.getSource('occupied_fronts').setData(data);
        }
    }
}

export default AddOccupiedFrontControl;