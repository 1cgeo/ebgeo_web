// js/controls_sig/arrow_tool/add_arrow_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddArrowControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // ✅ SISTEMA DE 3 ESTADOS (BASEADO NO CIRCLE)
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
    }

    static DEFAULT_PROPERTIES = {
        width: 500,
        color: '#3f4fb5',          // Retrocompatibilidade
        fillColor: '#3f4fb5',
        lineColor: '#3f4fb5',
        lineWidth: 3,
        fillOpacity: 0.8,
        headLengthRatio: 1.5,
        airmobile: false,          // ✅ NOVA: Aeromóvel/Aeroterrestre
        airmobilePosition: 0.7,    // ✅ NOVA: Posição do X na linha (0-1)
        source: 'arrow',
        geometryType: 'arrow',
        baseCoordinates: []
    };

    // ===== MAPBOX CONTROL INTERFACE =====
    
    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl arrow-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "arrow-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_arrow_black.svg" alt="ARROW" />';
        button.title = 'Adicionar Seta (A)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ? 
            './images/icon_arrow_red.svg' : 
            './images/icon_arrow_black.svg';
            
        $(`#arrow-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="ARROW" />`);
    }

    // ===== SISTEMA DE 3 ESTADOS (TEMPLATE DO CIRCLE) =====

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
    }

    // State 2: SELECTED (uses MoveHandler for drag)
    enterSelectedState = (feature) => {
        this.selectedFeature = feature;
    }

    exitSelectedState = () => {}

    // State 3: EDITING (handle-based editing)
    enterEditingState = (feature) => {
        this.selectedFeature = feature;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }

    exitEditingState = () => {
        this.clearEditHandles();
        this.clearEditPreview();
        this.removeEditEventListeners();
        this.resetEditVariables();
    }

    resetEditVariables = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds.clear();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
        this.clearEditPreview();
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        const isSameFeature = this.selectedFeature && this.selectedFeature.id === featureId;
        
        if (isSameFeature && this.currentState === 'selected') {
            // Same feature selected again: SELECTED → EDITING
            this.transitionToState('editing', feature);
        } else {
            // New feature or first selection: → SELECTED
            this.transitionToState('selected', feature);
        }
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        
        if (this.selectedFeature && this.selectedFeature.id === featureId) {
            this.transitionToState('deselected');
        }
    }

    onGlobalDeselect = () => {
        if (this.currentState !== 'deselected') {
            this.forceTransitionToDeselected();
        }
    }

    // Interface for move_handler integration
    isEditingMode = () => {
        return this.currentState === 'editing';
    }
    
    hasEditHandle = (featureId) => {
        return this.editHandleIds.has(featureId);
    }

    // ===== SISTEMA DE DESENHO MULTI-CLIQUE =====

    handleMapClick = (e) => {
        if (!this.isActive) return;
        
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para seta');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
        
        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }
    }

    handleDoubleClick = (e) => {
        if (!this.isActive) return;
        
        if (this.drawPoints.length > 0) {
            this.drawPoints.pop();
        }
        
        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        } else {
            this.stopDrawing();
        }
        e.preventDefault();
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            const previewPoints = [...this.drawPoints, [e.lngLat.lng, e.lngLat.lat]];
            
            if (previewPoints.length >= 2) {
                const previewGeometry = this.generateArrowGeometry({
                    baseCoordinates: previewPoints,
                    width: AddArrowControl.DEFAULT_PROPERTIES.width,
                    headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio, // ✅ INCLUIR NO PREVIEW
                    airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile, // ✅ INCLUIR NO PREVIEW
                    airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition // ✅ INCLUIR NO PREVIEW
                });
                
                if (previewGeometry) {
                    this.showPreview(previewGeometry);
                }
            }
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('arrow-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: { 
                preview: true,
                color: AddArrowControl.DEFAULT_PROPERTIES.color,
                fillColor: AddArrowControl.DEFAULT_PROPERTIES.fillColor,
                lineWidth: AddArrowControl.DEFAULT_PROPERTIES.lineWidth,
                fillOpacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.getSource('arrow-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    stopDrawing = () => {
        this.drawPoints = [];
        this.clearPreview();
        this.toolManager.deactivateCurrentTool();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) {
            this.showValidationError('Seta deve ter pelo menos 2 pontos');
            return;
        }

        const featureId = Date.now().toString();
        const feature = {
            type: 'Feature',
            id: featureId,
            properties: {
                ...AddArrowControl.DEFAULT_PROPERTIES,
                baseCoordinates: [...this.drawPoints],
                id: featureId,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio, // ✅ GARANTIR VALOR PADRÃO
                airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile, // ✅ GARANTIR VALOR PADRÃO
                airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition // ✅ GARANTIR VALOR PADRÃO
            },
            geometry: this.generateArrowGeometry({
                baseCoordinates: this.drawPoints,
                width: AddArrowControl.DEFAULT_PROPERTIES.width,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile,
                airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition
            })
        };

        try {
            await addFeature('arrows', feature);
            
            const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
            data.features.push(feature);
            this.map.getSource('arrows').setData(data);
            
            this.drawPoints = [];
            this.toolManager.setActiveTool(null);

            if (this.selectionManager) {
                this.selectionManager.toggleFeatureSelection('arrow', feature.id, feature);
                this.selectionManager.updateUI();
            }
        } catch (error) {
            console.error('Erro ao criar seta:', error);
        }
    }

    showValidationError = (message) => {
        alert(message);
        this.drawPoints = [];
        this.clearPreview();
    }

    // ===== GERAÇÃO DA GEOMETRIA DA SETA (CORRIGIDA PARA FILL) =====

    generateArrowGeometry = (properties) => {
        const coords = this.normalizeBaseCoordinates(properties.baseCoordinates);
        const width = properties.width || 1000;
        // ✅ RETROCOMPATIBILIDADE: se não existir, usar valor padrão
        const headLengthRatio = properties.headLengthRatio !== undefined ? 
            properties.headLengthRatio : 1.5;
        
        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para seta:', coords);
            return null;
        }

        const absHalfBodyWidth = Math.abs(width / 2);
        
        try {
            const mainLine = turf.lineString(coords);
            
            // 1. Criar corpo da seta (linhas paralelas)
            const leftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
            const rightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

            const p_last = coords[coords.length - 1];
            const p_second_last = coords[coords.length - 2];
            const bearing = turf.bearing(p_second_last, p_last);

            // 2. Definir proporções da cabeça baseado na largura absoluta
            const absHeadBaseWidth = Math.abs(width * 2.5);
            const headLength = absHeadBaseWidth * headLengthRatio; // ✅ USANDO NOVA PROPORÇÃO

            // 3. Calcular pontos dos cantos da cabeça (sempre geográficos left/right)
            const perpendicularBearingLeft = bearing - 90;
            const perpendicularBearingRight = bearing + 90;
            const headCornerLeft = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingLeft, { units: 'meters' });
            const headCornerRight = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingRight, { units: 'meters' });
            
            // 4. Calcular a ponta da seta
            const headTip = turf.destination(p_last, headLength, bearing, { units: 'meters' });
            
            // 5. Obter os pontos finais do corpo
            const bodyEndLeft = leftLine.geometry.coordinates[leftLine.geometry.coordinates.length - 1];
            const bodyEndRight = rightLine.geometry.coordinates[rightLine.geometry.coordinates.length - 1];
            
            // 6. CRIAR POLÍGONO SEGUINDO EXATAMENTE O PADRÃO TACTICAL_TOOLS
            const arrowPolygonCoords = [];
            
            // Lado esquerdo do corpo (do início ao fim)
            arrowPolygonCoords.push(...leftLine.geometry.coordinates);
            
            // bodyEndLeft → headCornerRight (como tactical_tools)
            arrowPolygonCoords.push(headCornerRight.geometry.coordinates);
            
            // headCornerRight → headTip
            arrowPolygonCoords.push(headTip.geometry.coordinates);
            
            // headTip → headCornerLeft
            arrowPolygonCoords.push(headCornerLeft.geometry.coordinates);
            
            // headCornerLeft → bodyEndRight (conecta com fim da linha direita)
            // Agora seguimos a linha direita do fim ao início (reverso)
            const rightLineReversed = [...rightLine.geometry.coordinates].reverse();
            arrowPolygonCoords.push(...rightLineReversed);
            
            // Fechar o polígono
            arrowPolygonCoords.push(arrowPolygonCoords[0]);

            return {
                type: 'Polygon',
                coordinates: [arrowPolygonCoords]
            };
            
        } catch (error) {
            console.warn('Erro ao gerar geometria da seta:', error);
            return {
                type: 'LineString',
                coordinates: coords
            };
        }
    }

    // ===== SISTEMA DE EDIÇÃO COM HANDLE DE LARGURA =====

    createEditHandles = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // 1. Handles nos vértices da linha base (vermelho)
        coords.forEach((coord, index) => {
            const handleId = `arrow-handle-${feature.id}-vertex-${index}`;
            this.editHandleIds.add(handleId);
            
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    index: index,
                    featureId: feature.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // 2. Handles de ponto médio para adicionar vértices (laranja)
        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[i + 1]));
            const handleId = `arrow-handle-${feature.id}-midpoint-${i}`;
            this.editHandleIds.add(handleId);
            
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: i + 1,
                    featureId: feature.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // 3. Handle de largura (azul)
        const width = feature.properties.width;
        const lastPoint = coords[coords.length - 1];
        const secondLastPoint = coords[coords.length - 2];
        const bearing = turf.bearing(secondLastPoint, lastPoint);
        const sign = Math.sign(width || 1);
        const perpendicularBearing = bearing - (90 * sign);
        const headBaseWidth = Math.abs(width * 2.5);
        const widthHandlePoint = turf.destination(lastPoint, headBaseWidth / 2, perpendicularBearing, { units: 'meters' });
        
        const widthHandleId = `arrow-handle-${feature.id}-width`;
        this.editHandleIds.add(widthHandleId);
        
        handles.push({
            type: 'Feature',
            id: widthHandleId,
            geometry: { type: 'Point', coordinates: widthHandlePoint.geometry.coordinates },
            properties: {
                role: 'handle',
                handleType: 'width',
                handleId: 'width',
                featureId: feature.id,
                mode: 'arrow_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // 4. Handle de comprimento da cabeça (verde)
        const headLengthRatio = feature.properties.headLengthRatio !== undefined ? 
            feature.properties.headLengthRatio : 1.5; // ✅ RETROCOMPATIBILIDADE
        const headLength = headBaseWidth * headLengthRatio;
        const headTipPoint = turf.destination(lastPoint, headLength, bearing, { units: 'meters' });
        
        const headLengthHandleId = `arrow-handle-${feature.id}-headlength`;
        this.editHandleIds.add(headLengthHandleId);
        
        handles.push({
            type: 'Feature',
            id: headLengthHandleId,
            geometry: { type: 'Point', coordinates: headTipPoint.geometry.coordinates },
            properties: {
                role: 'handle',
                handleType: 'headLength',
                handleId: 'headLength',
                featureId: feature.id,
                mode: 'arrow_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // 5. ✅ NOVO: Handle de posição do X aeromóvel (roxo) - só aparece se airmobile estiver ativo
        const airmobile = feature.properties.airmobile || false;
        if (airmobile) {
            const airmobilePosition = feature.properties.airmobilePosition !== undefined ? 
                feature.properties.airmobilePosition : 0.7;
            
            const mainLine = turf.lineString(coords);
            const lineLength = turf.length(mainLine, { units: 'meters' });
            const xPoint = turf.along(mainLine, lineLength * airmobilePosition, { units: 'meters' });
            
            const airmobileHandleId = `arrow-handle-${feature.id}-airmobile`;
            this.editHandleIds.add(airmobileHandleId);
            
            handles.push({
                type: 'Feature',
                id: airmobileHandleId,
                geometry: { type: 'Point', coordinates: xPoint.geometry.coordinates },
                properties: {
                    role: 'handle',
                    handleType: 'airmobile',
                    handleId: 'airmobile',
                    featureId: feature.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // 6. Feature destacada para modo editing
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'arrow_editing'
            }
        });

        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();
        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    clearEditPreview = () => {
        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    // ===== EVENT LISTENERS PARA EDIÇÃO =====

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
        if (this.currentState !== 'editing') return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['arrow-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            
            // Criar preview para drag
            this.previewFeature = JSON.parse(JSON.stringify(this.selectedFeature));
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;

        const currentPosition = [e.lngLat.lng, e.lngLat.lat];
        const handleId = this.activeHandle.properties.handleId;

        this.updateGeometryFromHandle(handleId, currentPosition);
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
            // ✅ SEGUINDO PADRÃO DO CIRCLE CONTROL
            // Apply preview changes to actual feature
            this.selectedFeature.properties = { ...this.previewFeature.properties };
            this.selectedFeature.geometry = { ...this.previewFeature.geometry };
            
            // Reset drag state first
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            const finalFeature = this.selectedFeature;
            this.previewFeature = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';
            
            this.clearEditPreview();
            this.forceUpdateMainSource(finalFeature);
            this.createEditHandles(finalFeature);
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(finalFeature);
        }
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        if (!this.previewFeature) return;
        
        let coords = this.normalizeBaseCoordinates(this.previewFeature.properties.baseCoordinates);

        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para atualizar geometria:', coords);
            return;
        }

        coords = [...coords]; // Criar cópia

        if (handleId.startsWith('vertex-')) {
            // Mover vértice existente
            const index = parseInt(handleId.split('-')[1]);
            coords[index] = newPosition;
            this.previewFeature.properties.baseCoordinates = coords;
        } else if (handleId.startsWith('midpoint-')) {
            // Adicionar novo vértice
            const insertIndex = parseInt(handleId.split('-')[1]) + 1;
            coords.splice(insertIndex, 0, newPosition);
            this.previewFeature.properties.baseCoordinates = coords;
            // Converter para vertex handle
            this.activeHandle.properties.handleType = 'vertex';
            this.activeHandle.properties.handleId = `vertex-${insertIndex}`;
        } else if (handleId === 'width') {
            // Handle de largura
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const line = turf.lineString([secondLastPoint, lastPoint]);

            let newWidth = turf.pointToLineDistance(turf.point(newPosition), line, {units: 'meters'});
            
            // Determinar sinal baseado no lado da linha
            const x1 = secondLastPoint[0], y1 = secondLastPoint[1];
            const x2 = lastPoint[0], y2 = lastPoint[1];
            const x = newPosition[0], y = newPosition[1];
            if ((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1) > 0) newWidth = -newWidth;

            // Aplicar nova largura
            this.previewFeature.properties.width = newWidth;
        } else if (handleId === 'headLength') {
            // Handle de comprimento da cabeça
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const bearing = turf.bearing(secondLastPoint, lastPoint);
            
            // Calcular distância do último ponto até a nova posição na direção do bearing
            const line = turf.lineString([lastPoint, newPosition]);
            const distance = turf.length(line, { units: 'meters' });
            
            // Verificar se está na mesma direção (produto escalar)
            const tipBearing = turf.bearing(lastPoint, newPosition);
            const angleDiff = Math.abs(bearing - tipBearing);
            const isForward = angleDiff < 90 || angleDiff > 270;
            
            if (isForward && distance > 100) { // Mínimo de 100m para a cabeça
                const width = this.previewFeature.properties.width || 500;
                const headBaseWidth = Math.abs(width * 2.5);
                const newHeadLengthRatio = Math.max(0.5, distance / headBaseWidth); // Mínimo 0.5x
                
                this.previewFeature.properties.headLengthRatio = newHeadLengthRatio;
            }
        } else if (handleId === 'airmobile') {
            // ✅ NOVO: Handle de posição do X aeromóvel
            const mainLine = turf.lineString(coords);
            const lineLength = turf.length(mainLine, { units: 'meters' });
            
            // Encontrar o ponto mais próximo na linha
            const nearestPointOnLine = turf.nearestPointOnLine(mainLine, turf.point(newPosition));
            const distanceFromStart = turf.length(turf.lineSliceAlong(mainLine, 0, nearestPointOnLine.properties.location, { units: 'meters' }), { units: 'meters' });
            
            // Calcular nova posição como percentual (0-1)
            let newAirmobilePosition = distanceFromStart / lineLength;
            
            // Limitar entre 0.1 e 0.9 (não pode ficar muito perto das extremidades)
            newAirmobilePosition = Math.max(0.1, Math.min(0.9, newAirmobilePosition));
            
            this.previewFeature.properties.airmobilePosition = newAirmobilePosition;
        }
        
        // Recalcular geometria da seta
        this.previewFeature.geometry = this.generateArrowGeometry(this.previewFeature.properties);
        
        // Mostrar preview
        this.showEditPreview(this.previewFeature);
    }

    showEditPreview = (feature) => {
        this.createEditHandles(feature);
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('arrows').setData(data);
        } else {
            console.error(`Feature ${feature.id} not found in arrows source for forced update`);
        }
    }

    // ✅ NOVOS MÉTODOS BASEADOS NO CIRCLE CONTROL
    updateSelectionAfterEdit = () => {
        this.selectionManager.selectedArrowFeatures.set(this.selectedFeature.id, this.selectedFeature);
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('arrows', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações da seta:', error);
        }
    }

    // ===== MÉTODOS OBRIGATÓRIOS PARA O SISTEMA DE SELEÇÃO =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
        
        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;
            
            const sourceFeature = data.features.find(f => f.id == feature.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                
                // ✅ Se alterar propriedades geométricas, recalcular geometria
                if (property === 'width' || property === 'headLengthRatio') { // ✅ INCLUÍDO headLengthRatio
                    const newGeometry = this.generateArrowGeometry(sourceFeature.properties);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }
        
        this.map.getSource('arrows').setData(data);
        
        // SEGUINDO PADRÃO DO CIRCLE - Atualizar handles se em modo editing
        if (this.currentState === 'editing' && this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
            
            for (const feature of features) {
                feature.id = feature.id || feature.properties.id;
                
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
                    
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? 
                            data.features[featureIndex] : feature;
                        await updateFeature('arrows', featureToUpdate);
                    }
                }
            }
            
            this.map.getSource('arrows').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('arrows', f);
            }
        }
        console.log('Arrow features saved:', features.length);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        
        // ✅ Normalizar valores para comparação (tratar undefined)
        const currentHeadRatio = feature.properties.headLengthRatio !== undefined ? 
            feature.properties.headLengthRatio : 1.5;
        const initialHeadRatio = initialProperties.headLengthRatio !== undefined ? 
            initialProperties.headLengthRatio : 1.5;
        
        const currentAirmobile = feature.properties.airmobile || false;
        const initialAirmobile = initialProperties.airmobile || false;
        
        const currentAirmobilePosition = feature.properties.airmobilePosition !== undefined ? 
            feature.properties.airmobilePosition : 0.7;
        const initialAirmobilePosition = initialProperties.airmobilePosition !== undefined ? 
            initialProperties.airmobilePosition : 0.7;
        
        return (
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.fillOpacity !== initialProperties.fillOpacity ||
            feature.properties.width !== initialProperties.width ||
            currentHeadRatio !== initialHeadRatio ||
            currentAirmobile !== initialAirmobile || // ✅ NOVA PROPRIEDADE
            currentAirmobilePosition !== initialAirmobilePosition || // ✅ NOVA PROPRIEDADE
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    // ✅ NOVOS MÉTODOS DE VALIDAÇÃO BASEADOS NO CIRCLE CONTROL
    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.id);
            if (!initialProperties) return false;
            
            return this.hasFeatureChanged(feature, initialProperties);
        });
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                feature.geometry = this.generateArrowGeometry(feature.properties);
                await updateFeature('arrows', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        // ✅ SEGUINDO PADRÃO DO CIRCLE CONTROL
        for (const feature of features) {
            try {
                const featureId = feature.id || feature.properties.id;
                await removeFeature('arrows', featureId);
            } catch (error) {
                console.error(`Error removing arrow ${featureId}:`, error);
            }
        }
        
        // ✅ Remove from map source (visual) - CRÍTICO PARA ATUALIZAR
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
        const idsToDelete = new Set(features.map(f => String(f.id || f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.id)));
        this.map.getSource('arrows').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddArrowControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('arrows')) {
            const currentData = this.map.getSource('arrows')._data;
            this.map.getSource('arrows').setData(currentData);
        }
    }

    // ✅ NOVOS MÉTODOS DE VALIDAÇÃO BASEADOS NO CIRCLE CONTROL
    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.id);
            if (!initialProperties) return false;
            
            return this.hasFeatureChanged(feature, initialProperties);
        });
    }

    // ===== EVENT LISTENER MANAGEMENT =====
    
    setupBaseEventListeners = () => {
        this.map.on('mouseenter', 'arrow-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'arrow-layer', this.handleMouseLeave);
        this.map.on('mouseenter', 'arrow-fill-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'arrow-fill-layer', this.handleMouseLeave);
        this.map.on('dblclick', this.handleDoubleClick);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'arrow-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'arrow-layer', this.handleMouseLeave);
        this.map.off('mouseenter', 'arrow-fill-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'arrow-fill-layer', this.handleMouseLeave);
        this.map.off('dblclick', this.handleDoubleClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
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

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'arrow';
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

    // ===== UTILITY METHODS =====
    
    // ✅ Helper para garantir que baseCoordinates é sempre um array
    normalizeBaseCoordinates = (baseCoordinates) => {
        if (typeof baseCoordinates === 'string') {
            try {
                return JSON.parse(baseCoordinates);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', e);
                return [];
            }
        }
        
        if (!Array.isArray(baseCoordinates)) {
            console.warn('baseCoordinates não é um array:', baseCoordinates);
            return [];
        }
        
        return baseCoordinates;
    }
    
    setCursorStyle = (style) => {
        this.map.getCanvas().style.cursor = style;
    }

    onRemove = () => {
        try {
            if (this.selectionManager && this.selectionManager.uiManager) {
                this.selectionManager.uiManager.removeControl(this.container);
            }
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddArrowControl:', error);
            throw error;
        }
    }

    setSelectionManager = (selectionManager) => {
        this.selectionManager = selectionManager;
    }
}

export default AddArrowControl;