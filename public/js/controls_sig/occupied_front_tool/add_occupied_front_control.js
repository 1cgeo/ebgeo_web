// Path: js\controls_sig\occupied_front_tool\add_occupied_front_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddOccupiedFrontControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // ✅ SISTEMA DE 3 ESTADOS (baseado no Circle)
        // 1. deselected: Estado padrão, sem interação especial
        // 2. selected: Feature pode ser movida via MoveHandler
        // 3. editing: Edição baseada em handles, drag da feature desabilitado
        this.currentState = 'deselected';
        this.selectedFeature = null;

        // Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];

        // Edit mode variables
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds = new Set();

        // ✅ PERFORMANCE OPTIMIZATION: RAF & Debouncing (mesmo padrão do Circle)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // ✅ EDIT PERFORMANCE: Same pattern as preview
        this.editRafId = null;
        this.pendingEditUpdate = false;
        this.lastEditPosition = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1.0,
        source: 'occupied_front', // ✅ CRÍTICO: usado pelo sistema de seleção
        type: 'occupied_front'
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

    // ✅ OBRIGATÓRIO: Padrão visual consistente
    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_occupied_front_red.svg' :
            './images/icon_occupied_front_black.svg';

        $("#occupied-front-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="FRENTE OCUPADA" />`);
    }

    // ===== SISTEMA DE 3 ESTADOS (BASEADO NO CIRCLE) =====

    transitionToState = (newState, feature = null) => {
        this.exitCurrentState();
        this.currentState = newState;
        this.selectedFeature = feature;

        switch (newState) {
            case 'deselected':
                this.enterDeselectedState();
                break;
            case 'selected':
                this.enterSelectedState(feature);
                break;
            case 'editing':
                this.enterEditingState(feature);
                break;
        }
    }

    exitCurrentState = () => {
        switch (this.currentState) {
            case 'selected':
                this.exitSelectedState();
                break;
            case 'editing':
                this.exitEditingState();
                break;
        }
    }

    forceTransitionToDeselected = () => {
        this.exitCurrentState();
        this.currentState = 'deselected';
        this.selectedFeature = null;
        this.enterDeselectedState();
    }

    // State 1: DESELECTED
    enterDeselectedState = () => {
        this.selectedFeature = null;
        this.setCursorStyle('');
    }

    // State 2: SELECTED (uses MoveHandler for drag)
    enterSelectedState = (feature) => {
        this.selectedFeature = feature;
        this.setCursorStyle('move');
    }

    exitSelectedState = () => { }

    // State 3: EDITING (handle-based editing)
    enterEditingState = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setCursorStyle('crosshair');
    }

    exitEditingState = () => {
        this.clearEditHandles();
        this.clearEditPreview();
        this.removeEditEventListeners();
        this.resetEditVariables();
    }

    resetEditVariables = () => {
        // ✅ CORREÇÃO: Reset em ordem segura
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds.clear();

        // ✅ CORREÇÃO: Verificar se mapa ainda existe antes de manipular
        if (this.map && this.map.dragPan) {
            this.map.dragPan.enable();
        }
        if (this.map && this.map.getCanvas) {
            this.map.getCanvas().style.cursor = '';
        }

        this.clearPreview();
        this.clearEditPreview();
        this.cancelPendingUpdates();
    }

    // ===== INTEGRAÇÃO COM SELECTION MANAGER =====

    onFeatureSelected = (feature) => {
        const featureId = feature.properties.id;
        const isSameFeature = this.selectedFeature && this.selectedFeature.properties.id === featureId;

        if (isSameFeature && this.currentState === 'selected') {
            // Mesma feature selecionada novamente: SELECTED → EDITING
            this.transitionToState('editing', feature);
        } else {
            // Nova feature ou primeira seleção: → SELECTED
            this.transitionToState('selected', feature);
        }
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;

        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.transitionToState('deselected');
        }
    }

    onGlobalDeselect = () => {
        if (this.currentState !== 'deselected') {
            this.forceTransitionToDeselected();
        }
    }

    // ✅ Interface para integração com move_handler
    isEditingMode = () => {
        return this.currentState === 'editing';
    }

    hasEditHandle = (featureId) => {
        return this.editHandleIds.has(featureId);
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'occupied_front';
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.forceTransitionToDeselected();
    }

    // ===== SISTEMA DE DESENHO =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        // ✅ OBRIGATÓRIO: Validação de entrada
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para frente ocupada');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            // Primeiro ponto - iniciar preview
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            // Segundo ponto - finalizar feature
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    // ✅ OPTIMIZED: RAF-based preview (mesmo padrão do Circle)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth preview
    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        const p1 = this.lastPreviewCenter; // Origem
        const p2 = this.lastPreviewPosition; // Braço superior

        // Calcular P3 automaticamente com ângulo de 50°
        const distance = this.calculateDistance(p1, p2);
        const bearing = this.calculateBearing(p1, p2);
        const p3 = this.destination(p1, distance, bearing + 50);

        if (distance >= 10) {
            // Debounce geometry generation for complex occupied front
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.createOccupiedFrontGeometry([p1, p2, p3]);
                this.showPreview(previewGeometry);
            }, 12); // Slightly more debouncing for complex geometry
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('occupied-front-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                preview: true,
                color: AddOccupiedFrontControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddOccupiedFrontControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();

        // ✅ CORREÇÃO: Verificar se source existe antes de limpar
        if (this.map && this.map.getSource('occupied-front-preview')) {
            this.map.getSource('occupied-front-preview').setData({
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
        const coordinates = [p1, p2, p3]; // LineString com 3 pontos

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddOccupiedFrontControl.DEFAULT_PROPERTIES,
                id: featureId,
                baseCoordinates: coordinates // Armazenar pontos de controle
            },
            geometry: this.createOccupiedFrontGeometry(coordinates)
        };

        try {
            // ✅ OBRIGATÓRIO: Salvar no IndexedDB
            await addFeature('occupied_fronts', feature);

            // Atualizar source do mapa
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

    // ===== GEOMETRIA DA FRENTE OCUPADA (BASEADA NO PROTÓTIPO) =====

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
     * Cria a geometria para um único braço da "Frente Ocupada" (do protótipo).
     * @param {Array} startPoint - Ponto de origem (P1).
     * @param {Array} endPoint - Ponto final (P2 ou P3).
     * @param {number} turnDirection - Direção da curva: -1 para direita, 1 para esquerda.
     * @returns {Array<Array<number>>} - Um array de coordenadas de linha.
     */
    createRay = (startPoint, endPoint, turnDirection) => {
        const rayLines = [];
        const initialBearing = this.calculateBearing(startPoint, endPoint);
        const distance = this.calculateDistance(startPoint, endPoint);

        if (distance < 1) return [];

        // 1. Ponto de início da curva (60% do caminho)
        const p_turn1 = this.destination(startPoint, distance * 0.6, initialBearing);

        // 2. Ponto final da curva
        // A curva tem um ângulo de 225 graus e um comprimento de 10% do raio total
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

    // ===== SISTEMA DE EDIÇÃO CUSTOMIZADA =====

    createEditHandles = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 3) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // Handle P1 - origem (verde)
        const handleId1 = `occupied-front-handle-${feature.properties.id}-p1`;
        this.editHandleIds.add(handleId1);
        handles.push({
            type: 'Feature',
            id: handleId1,
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
        const handleId2 = `occupied-front-handle-${feature.properties.id}-p2`;
        this.editHandleIds.add(handleId2);
        handles.push({
            type: 'Feature',
            id: handleId2,
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
        const handleId3 = `occupied-front-handle-${feature.properties.id}-p3`;
        this.editHandleIds.add(handleId3);
        handles.push({
            type: 'Feature',
            id: handleId3,
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

        // Adicionar feature destacada para modo de edição
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'occupied_front_editing'
            }
        });

        // Atualizar source
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();

        // ✅ CORREÇÃO: Verificar se source existe antes de limpar
        if (this.map && this.map.getSource('occupied-front-edit-handles')) {
            this.map.getSource('occupied-front-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    // ===== ✅ NOVO: PREVIEW SYSTEM FOR EDITING MODE =====

    showEditPreview = (feature, handlePosition, handleId) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (!coords || coords.length < 3) return;

        // Atualizar coordenada sendo editada
        const updatedCoords = [...coords];
        if (handleId === 'p1') updatedCoords[0] = handlePosition;
        else if (handleId === 'p2') updatedCoords[1] = handlePosition;  
        else if (handleId === 'p3') updatedCoords[2] = handlePosition;

        // Criar handles nas posições atualizadas
        const handleTypes = ['center', 'primary', 'secondary'];
        const handleIds = ['p1', 'p2', 'p3'];
        
        updatedCoords.forEach((coord, index) => {
            const handleId = `occupied-front-handle-${feature.properties.id}-${handleIds[index]}`;
            this.editHandleIds.add(handleId);
            
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: handleTypes[index],
                    handleId: handleIds[index],
                    index,
                    featureId: feature.properties.id,
                    mode: 'occupied_front_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // Preview feature
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'occupied_front_editing'
            }
        });

        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditPreview = () => {
        if (this.map && this.map.getSource('occupied-front-edit-handles')) {
            this.map.getSource('occupied-front-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    // ===== SISTEMA DE EDIÇÃO: HANDLE INTERACTION =====

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

    // Detectar clique nos handles
    onEditMouseDown = (e) => {
        if (!this.isEditingMode()) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['occupied-front-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];

            // ✅ CORREÇÃO: Verificar se handle tem propriedades válidas
            if (handle && handle.properties && handle.properties.handleId) {
                this.isDraggingHandle = true;
                this.activeHandle = handle;
                this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
                this.map.dragPan.disable();
                this.map.getCanvas().style.cursor = 'grabbing';
                
                // ✅ NOVO: Criar preview feature
                this.previewFeature = JSON.parse(JSON.stringify(this.selectedFeature));
                e.preventDefault();
            }
        }
    }

    // ✅ OPTIMIZED: RAF-based edit updates (mesmo padrão do Circle)
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;

        this.lastEditPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingEditUpdate) {
            this.pendingEditUpdate = true;
            this.editRafId = requestAnimationFrame(this.performEditUpdate.bind(this));
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth edit updates
    performEditUpdate = () => {
        // ✅ CORREÇÃO: Verificar se tudo está válido antes de continuar
        if (!this.lastEditPosition || !this.selectedFeature || !this.activeHandle) {
            this.pendingEditUpdate = false;
            return;
        }

        // Light debouncing for geometry generation
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // ✅ CORREÇÃO: Verificar novamente antes do timeout
            if (this.activeHandle && this.activeHandle.properties && this.lastEditPosition) {
                this.updateGeometryFromHandle(this.activeHandle.properties.handleId, this.lastEditPosition);
            }
        }, 12);

        this.pendingEditUpdate = false;
    }

    // ✅ CORRIGIDO: Finalizar drag com atualizações completas
    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
            // ✅ NOVO: Apply preview changes to actual feature
            this.selectedFeature.properties.baseCoordinates = this.previewFeature.properties.baseCoordinates;
            this.selectedFeature.geometry = this.previewFeature.geometry;

            // Reset drag state first
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            const finalFeature = this.selectedFeature;
            this.previewFeature = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';

            // ✅ CRÍTICO: Atualizações completas (como no Circle)
            this.clearEditPreview();
            this.forceUpdateMainSource(finalFeature);
            this.createEditHandles(finalFeature);
            this.updateSelectionAfterEdit();      // ✅ NOVO: Atualiza bounding box
            this.updateUIAfterEdit();             // ✅ NOVO: Atualiza UI
            this.saveFeatureChanges(finalFeature);
        }
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        // ✅ CORREÇÃO: Verificações de segurança
        if (!this.previewFeature || !handleId || !newPosition) {
            console.warn('updateGeometryFromHandle: parâmetros inválidos');
            return;
        }

        const coords = this.normalizeBaseCoordinates(this.previewFeature.properties.baseCoordinates);

        if (!coords || coords.length < 3) {
            console.warn('updateGeometryFromHandle: coordenadas inválidas');
            return;
        }

        // Atualizar apenas o ponto sendo arrastado, manter os outros fixos
        if (handleId === 'p1') { // P1 - origem
            coords[0] = newPosition;
        } else if (handleId === 'p2') { // P2 - braço superior
            coords[1] = newPosition;
        } else if (handleId === 'p3') { // P3 - braço inferior
            coords[2] = newPosition;
        }

        // Recalcular geometria completa
        this.previewFeature.properties.baseCoordinates = coords;
        this.previewFeature.geometry = this.createOccupiedFrontGeometry(coords);

        // ✅ NOVO: Mostrar preview em tempo real
        this.showEditPreview(this.previewFeature, newPosition, handleId);
    }

    // ===== ✅ NOVOS MÉTODOS CRÍTICOS PARA BOUNDING BOX =====

    updateSelectionAfterEdit = () => {
        const featureId = this.selectedFeature.properties.id;
        const type = this.selectedFeature.properties.source; // 'occupied_front'
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

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        this.map.on('mouseenter', 'occupied-front-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'occupied-front-layer', this.handleMouseLeave);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'occupied-front-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'occupied-front-layer', this.handleMouseLeave);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.cancelPendingUpdates();
    }

    handleMouseEnter = () => {
        if (this.currentState === 'deselected') {
            this.map.getCanvas().style.cursor = 'pointer';
        }
    }

    handleMouseLeave = () => {
        if (this.currentState === 'deselected') {
            this.map.getCanvas().style.cursor = '';
        }
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
        // ✅ CORREÇÃO: Verificações de segurança
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
            } else {
                console.error(`Feature ${feature.properties.id} not found in occupied_fronts source for forced update`);
            }
        } catch (error) {
            console.error('Erro em forceUpdateMainSource:', error);
        }
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('occupied_fronts', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações da frente ocupada:', error);
        }
    }

    setCursorStyle = (style) => {
        if (this.map && this.map.getCanvas) {
            this.map.getCanvas().style.cursor = style;
        }
    }

    // ✅ PERFORMANCE: Cancel pending RAF/debouncing operations
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        if (this.editRafId) {
            cancelAnimationFrame(this.editRafId);
            this.editRafId = null;
        }
        this.pendingEditUpdate = false;
        this.lastEditPosition = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    // ===== MÉTODOS OBRIGATÓRIOS PARA O SISTEMA DE SELEÇÃO =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));

        for (const feature of features) {
            feature.properties.id = feature.properties.id;

            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Se alterar propriedades geométricas, recalcular geometria
                if (['baseCoordinates'].includes(property)) {
                    const newGeometry = this.createOccupiedFrontGeometry(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('occupied_fronts').setData(data);
    }

    // ✅ OBRIGATÓRIO: Método updateFeatures padronizado
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

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('occupied_fronts')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,  // Geometria atual (pós-drag)
                        properties: { ...selectedFeature.properties } // Propriedades do painel
                    };
                    await updateFeature('occupied_fronts', featureToSave);
                }
            }
        }
    }

    // ✅ NOVO: Método hasUnsavedChanges para otimização
    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.properties.id);
            if (!initialProperties) return false;

            return this.hasFeatureChanged(feature, initialProperties);
        });
    }

    // ✅ OBRIGATÓRIO: Método hasFeatureChanged para otimização
    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));

            // Regenerar geometria com propriedades originais
            f.geometry = this.createOccupiedFrontGeometry(f.properties.baseCoordinates);
        });

        // Usar o método updateFeatures que já existe e funciona corretamente
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (!features || features.length === 0) return;

        try {
            // ✅ CORREÇÃO: Remover do IndexedDB primeiro
            for (const feature of features) {
                const featureId = feature.properties.id;
                await removeFeature('occupied_fronts', featureId);
            }

            // ✅ CORREÇÃO: Atualizar source do mapa imediatamente
            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
            const idsToDelete = new Set(features.map(f => String(f.properties.id || f.properties.id)));
            data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
            this.map.getSource('occupied_fronts').setData(data);

        } catch (error) {
            console.error('Erro ao remover frentes ocupadas:', error);
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddOccupiedFrontControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('occupied_fronts')) {
            const currentData = this.map.getSource('occupied_fronts')._data;
            this.map.getSource('occupied_fronts').setData(currentData);
        }
    }
}

export default AddOccupiedFrontControl;