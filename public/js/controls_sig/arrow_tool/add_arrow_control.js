// Path: js\controls_sig\arrow_tool\add_arrow_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddArrowControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

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

        // ✅ PERFORMANCE OPTIMIZATION: RAF & Debouncing (same pattern as circle)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;

        // ✅ EDIT PERFORMANCE: Same pattern as circle
        this.editRafId = null;
        this.pendingEditUpdate = false;
        this.lastEditHandleId = null;
        this.lastEditPosition = null;
    }

    static DEFAULT_PROPERTIES = {
        width: 500,
        fillColor: '#3f4fb5',
        lineColor: '#3f4fb5',
        lineWidth: 3,
        fillOpacity: 0.8,
        lineOpacity: 1.0,
        headLengthRatio: 1.5,
        showArrowHead: true,  // ✅ NOVA PROPRIEDADE
        airmobile: false,
        airmobilePosition: 0.7,
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

    // ===== SISTEMA DE 3 ESTADOS =====

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

    exitSelectedState = () => { }

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

        // ✅ CLEANUP: Cancel pending operations
        this.cancelPendingUpdates();
    }

    // ✅ PERFORMANCE: Cancel pending RAF/debouncing operations
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;

        // ✅ EDIT RAF cleanup (same as circle)
        if (this.editRafId) {
            cancelAnimationFrame(this.editRafId);
            this.editRafId = null;
        }
        this.pendingEditUpdate = false;
        this.lastEditHandleId = null;
        this.lastEditPosition = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
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

    // ✅ OPTIMIZED: RAF-based preview
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];
            this.lastPreviewPoints = [...this.drawPoints, this.lastPreviewPosition];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth preview
    performPreviewUpdate = () => {
        if (!this.lastPreviewPoints || this.lastPreviewPoints.length < 2) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Light debouncing for heavy turf.js operations (same as circle)
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const previewGeometry = this.generateArrowGeometry({
                baseCoordinates: this.lastPreviewPoints,
                width: AddArrowControl.DEFAULT_PROPERTIES.width,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,  // ✅ NOVA PROPRIEDADE
                airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile,
                airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition
            });

            if (previewGeometry) {
                this.showPreview(previewGeometry);
            }
        }, 8); // Same 8ms as circle for consistency

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('arrow-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                preview: true,
                fillColor: AddArrowControl.DEFAULT_PROPERTIES.fillColor,
                lineColor: AddArrowControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddArrowControl.DEFAULT_PROPERTIES.lineWidth,
                fillOpacity: 0.5,
                lineOpacity: 0.8
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
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
                // ✅ GARANTIR que todas as propriedades visuais existam
                fillColor: AddArrowControl.DEFAULT_PROPERTIES.fillColor,
                lineColor: AddArrowControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddArrowControl.DEFAULT_PROPERTIES.lineWidth,
                fillOpacity: AddArrowControl.DEFAULT_PROPERTIES.fillOpacity,
                lineOpacity: AddArrowControl.DEFAULT_PROPERTIES.lineOpacity,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,  // ✅ NOVA PROPRIEDADE
                airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile,
                airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition
            },
            geometry: this.generateArrowGeometry({
                baseCoordinates: this.drawPoints,
                width: AddArrowControl.DEFAULT_PROPERTIES.width,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,  // ✅ NOVA PROPRIEDADE
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

            this.selectionManager.toggleFeatureSelection('arrow', feature.id, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar seta:', error);
        }
    }

    showValidationError = (message) => {
        alert(message);
        this.drawPoints = [];
        this.clearPreview();
    }

    // ===== GERAÇÃO DA GEOMETRIA DA SETA =====

    generateArrowGeometry = (properties) => {
        const coords = this.normalizeBaseCoordinates(properties.baseCoordinates);
        const width = properties.width || 1000;
        const headLengthRatio = properties.headLengthRatio || 1.5;
        const showArrowHead = properties.showArrowHead !== false;  // ✅ DEFAULT TRUE
        const airmobile = properties.airmobile || false;
        const airmobilePosition = properties.airmobilePosition || 0.7;

        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para seta:', coords);
            return null;
        }

        const absHalfBodyWidth = Math.abs(width / 2);

        try {
            const mainLine = turf.lineString(coords);

            // ===== MODO AEROMÓVEL/AEROTERRESTRE =====
            if (airmobile) {
                return this.generateAirmobileArrowGeometry(mainLine, width, headLengthRatio, airmobilePosition, showArrowHead);
            }

            // ===== MODO NORMAL =====
            return this.generateNormalArrowGeometry(mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead);

        } catch (error) {
            console.warn('Erro ao gerar geometria da seta:', error);
            return {
                type: 'LineString',
                coordinates: coords
            };
        }
    }

    generateNormalArrowGeometry = (mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead) => {
        const coords = mainLine.geometry.coordinates;

        // 1. Criar corpo da seta (linhas paralelas)
        const leftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
        const rightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

        const p_last = coords[coords.length - 1];
        const p_second_last = coords[coords.length - 2];
        const bearing = turf.bearing(p_second_last, p_last);

        // ✅ MODIFICAÇÃO: Se não mostrar cabeça, retornar apenas o corpo retangular
        if (!showArrowHead) {
            const arrowPolygonCoords = [];
            
            // Lado esquerdo do corpo (do início ao fim)
            arrowPolygonCoords.push(...leftLine.geometry.coordinates);
            
            // Lado direito do corpo (do fim ao início - reverso)
            const rightLineReversed = [...rightLine.geometry.coordinates].reverse();
            arrowPolygonCoords.push(...rightLineReversed);
            
            // Fechar o polígono
            arrowPolygonCoords.push(arrowPolygonCoords[0]);

            return {
                type: 'Polygon',
                coordinates: [arrowPolygonCoords]
            };
        }

        // 2. Definir proporções da cabeça baseado na largura absoluta
        const absHeadBaseWidth = Math.abs(width * 2.5);
        const headLength = absHeadBaseWidth * headLengthRatio;

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

        // 6. CRIAR POLÍGONO NORMAL (com cabeça)
        const arrowPolygonCoords = [];

        // Lado esquerdo do corpo (do início ao fim)
        arrowPolygonCoords.push(...leftLine.geometry.coordinates);

        // bodyEndLeft → headCornerRight
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
    }

    generateAirmobileArrowGeometry = (mainLine, width, headLengthRatio, airmobilePosition, showArrowHead) => {
        const coords = mainLine.geometry.coordinates;
        const absHalfBodyWidth = Math.abs(width / 2);
        const mainLineLength = turf.length(mainLine, { units: 'meters' });

        try {
            // 1. Create full offset lines first for stability
            const fullLeftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
            const fullRightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

            // 2. Find the exact point on the main line for the crossover
            const pointOnMainLine = turf.along(mainLine, mainLineLength * airmobilePosition, { units: 'meters' });

            // 3. Find the corresponding points on the offset lines
            const crossoverLeftPoint = turf.nearestPointOnLine(fullLeftLine, pointOnMainLine, { units: 'meters' });
            const crossoverRightPoint = turf.nearestPointOnLine(fullRightLine, pointOnMainLine, { units: 'meters' });

            // 4. Slice the two full offset lines at their respective crossover points
            const left1 = turf.lineSlice(turf.point(fullLeftLine.geometry.coordinates[0]), crossoverLeftPoint, fullLeftLine);
            const left2 = turf.lineSlice(crossoverLeftPoint, turf.point(fullLeftLine.geometry.coordinates[fullLeftLine.geometry.coordinates.length - 1]), fullLeftLine);
            const right1 = turf.lineSlice(turf.point(fullRightLine.geometry.coordinates[0]), crossoverRightPoint, fullRightLine);
            const right2 = turf.lineSlice(crossoverRightPoint, turf.point(fullRightLine.geometry.coordinates[fullRightLine.geometry.coordinates.length - 1]), fullRightLine);

            const finalBodyLine1 = turf.lineString([...left1.geometry.coordinates, ...right2.geometry.coordinates.slice(1)]);
            const finalBodyLine2 = turf.lineString([...right1.geometry.coordinates, ...left2.geometry.coordinates.slice(1)]);

            const intersection = turf.lineIntersect(finalBodyLine1, finalBodyLine2);

            let handleCoord;
            if (intersection.features.length > 0) {
                handleCoord = intersection.features[0].geometry.coordinates;
            } else {
                handleCoord = pointOnMainLine.geometry.coordinates;
            }

            // ✅ MODIFICAÇÃO: Se não mostrar cabeça, retornar apenas o corpo cruzado
            if (!showArrowHead) {
                // PRIMEIRO POLÍGONO: Do início até o crossover
                const polygon1Coords = [];
                polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));
                polygon1Coords.push(handleCoord);
                const right1Reversed = [...right1.geometry.coordinates].reverse();
                polygon1Coords.push(...right1Reversed.slice(1));
                polygon1Coords.push(polygon1Coords[0]);

                // SEGUNDO POLÍGONO: Do crossover até o fim (SEM cabeça triangular)
                const polygon2Coords = [];
                polygon2Coords.push(...[...left2.geometry.coordinates].slice(1));
                const right2Reversed = [...right2.geometry.coordinates].reverse();
                polygon2Coords.push(...right2Reversed.slice(0, -1));
                polygon2Coords.push(handleCoord);
                polygon2Coords.push(polygon2Coords[0]);

                return {
                    type: 'MultiPolygon',
                    coordinates: [
                        [polygon1Coords],
                        [polygon2Coords]
                    ]
                };
            }

            // 5. Calcular geometria da cabeça da seta (quando showArrowHead = true)
            const p_last = coords[coords.length - 1];
            const p_second_last = coords[coords.length - 2];
            const bearing = turf.bearing(p_second_last, p_last);
            const absHeadBaseWidth = Math.abs(width * 2.5);
            const headLength = absHeadBaseWidth * headLengthRatio;

            const perpendicularBearingLeft = bearing - 90;
            const perpendicularBearingRight = bearing + 90;
            const headCornerLeft = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingLeft, { units: 'meters' });
            const headCornerRight = turf.destination(p_last, absHeadBaseWidth / 2, perpendicularBearingRight, { units: 'meters' });
            const headTip = turf.destination(p_last, headLength, bearing, { units: 'meters' });

            // 6. ✅ SOLUÇÃO: Criar MultiPolygon com duas partes separadas para evitar auto-interseção

            // PRIMEIRO POLÍGONO: Do início até o crossover
            const polygon1Coords = [];

            // Seguir left1 (linha esquerda do início até crossover)
            polygon1Coords.push(...[...left1.geometry.coordinates].slice(0, -1));

            // Ir para o ponto de crossover na linha direita
            polygon1Coords.push(handleCoord);

            // Voltar pela right1 reversa (linha direita do crossover até início)
            const right1Reversed = [...right1.geometry.coordinates].reverse();
            polygon1Coords.push(...right1Reversed.slice(1)); // slice(1) para evitar duplicar o ponto de crossover

            // Fechar o primeiro polígono
            polygon1Coords.push(polygon1Coords[0]);

            // SEGUNDO POLÍGONO: Do crossover até o fim (incluindo a cabeça)
            const polygon2Coords = [];

            // Seguir left2 (linha esquerda do crossover até fim)
            polygon2Coords.push(...[...left2.geometry.coordinates].slice(1));

            // Conectar com a cabeça da seta
            polygon2Coords.push(headCornerRight.geometry.coordinates);
            polygon2Coords.push(headTip.geometry.coordinates);
            polygon2Coords.push(headCornerLeft.geometry.coordinates);

            // Voltar pela right2 reversa (linha direita do fim até crossover)
            const right2Reversed = [...right2.geometry.coordinates].reverse();
            polygon2Coords.push(...right2Reversed.slice(0, -1)); // slice(1) para evitar duplicar o último ponto

            // Ir para o ponto de crossover na linha esquerda
            polygon2Coords.push(handleCoord);

            // Fechar o segundo polígono
            polygon2Coords.push(polygon2Coords[0]);

            // 7. Retornar MultiPolygon
            return {
                type: 'MultiPolygon',
                coordinates: [
                    [polygon1Coords],  // Primeiro polígono
                    [polygon2Coords]   // Segundo polígono
                ]
            };

        } catch (error) {
            console.warn('Erro na geometria aeromóvel, usando normal:', error);
            // Fallback para geometria normal
            return this.generateNormalArrowGeometry(mainLine, width, headLengthRatio, absHalfBodyWidth, showArrowHead);
        }
    }

    // ===== SISTEMA DE EDIÇÃO COM HANDLES =====

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

        // 4. Handle de comprimento da cabeça (verde) - ✅ APENAS SE showArrowHead = true
        const showArrowHead = feature.properties.showArrowHead !== false;
        if (showArrowHead) {
            const headLengthRatio = feature.properties.headLengthRatio || 1.5;
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
        }

        // 5. Handle de posição do X aeromóvel (roxo) - REPLICANDO EXATAMENTE O EXEMPLO
        const airmobile = feature.properties.airmobile || false;

        if (airmobile) {
            const airmobilePosition = feature.properties.airmobilePosition || 0.5;

            if (coords.length >= 2) {
                const absHalfBodyWidth = Math.abs((feature.properties.width || 1000) / 2);
                const mainLine = turf.lineString(coords);
                const mainLineLength = turf.length(mainLine, { units: 'meters' });

                // ✅ REPLICANDO EXATAMENTE O CÁLCULO DO EXEMPLO
                const fullLeftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
                const fullRightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });
                const pointOnMainLine = turf.along(mainLine, mainLineLength * airmobilePosition, { units: 'meters' });

                // ✅ USAR nearestPointOnLine pois pointOnLine não existe na nossa versão
                const crossoverLeftPoint = turf.nearestPointOnLine(fullLeftLine, pointOnMainLine);
                const crossoverRightPoint = turf.nearestPointOnLine(fullRightLine, pointOnMainLine);

                const left1 = turf.lineSlice(turf.point(fullLeftLine.geometry.coordinates[0]), crossoverLeftPoint, fullLeftLine);
                const left2 = turf.lineSlice(crossoverLeftPoint, turf.point(fullLeftLine.geometry.coordinates[fullLeftLine.geometry.coordinates.length - 1]), fullLeftLine);
                const right1 = turf.lineSlice(turf.point(fullRightLine.geometry.coordinates[0]), crossoverRightPoint, fullRightLine);
                const right2 = turf.lineSlice(crossoverRightPoint, turf.point(fullRightLine.geometry.coordinates[fullRightLine.geometry.coordinates.length - 1]), fullRightLine);

                const finalBodyLine1 = turf.lineString([...left1.geometry.coordinates, ...right2.geometry.coordinates.slice(1)]);
                const finalBodyLine2 = turf.lineString([...right1.geometry.coordinates, ...left2.geometry.coordinates.slice(1)]);

                const intersection = turf.lineIntersect(finalBodyLine1, finalBodyLine2);

                let handleCoord;
                if (intersection.features.length > 0) {
                    handleCoord = intersection.features[0].geometry.coordinates;
                } else {
                    handleCoord = pointOnMainLine.geometry.coordinates;
                }

                const airmobileHandleId = `arrow-handle-${feature.id}-airmobile`;
                this.editHandleIds.add(airmobileHandleId);

                // ✅ USAR EXATAMENTE A MESMA ESTRUTURA DO EXEMPLO
                const handleFeature = {
                    type: 'Feature',
                    id: airmobileHandleId,
                    geometry: { type: 'Point', coordinates: handleCoord },
                    properties: {
                        role: 'handle',
                        handleType: 'airmobile',  // ✅ Manter para compatibilidade com layers
                        handleId: 'airmobile',
                        featureId: feature.id,
                        mode: 'arrow_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                };

                handles.push(handleFeature);
            }
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

            this.previewFeature = JSON.parse(JSON.stringify(this.selectedFeature));

            e.preventDefault();
        }
    }

    // ✅ OPTIMIZED: RAF-based edit updates (same pattern as circle)
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) {
            return;
        }

        this.lastEditPosition = [e.lngLat.lng, e.lngLat.lat];
        this.lastEditHandleId = this.activeHandle.properties.handleId;

        if (!this.pendingEditUpdate) {
            this.pendingEditUpdate = true;
            this.editRafId = requestAnimationFrame(this.performEditUpdate.bind(this));
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth edit updates
    performEditUpdate = () => {
        if (!this.lastEditPosition || !this.lastEditHandleId || !this.previewFeature) {
            this.pendingEditUpdate = false;
            return;
        }

        // Light debouncing for heavy turf.js operations (same as circle)
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.updateGeometryFromHandle(this.lastEditHandleId, this.lastEditPosition);
        }, 8); // Same 8ms as circle for consistency

        this.pendingEditUpdate = false;
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
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
            // Handle de largura (sem mudanças)
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const line = turf.lineString([secondLastPoint, lastPoint]);

            let newWidth = turf.pointToLineDistance(turf.point(newPosition), line, { units: 'meters' });

            // Determinar sinal baseado no lado da linha
            const x1 = secondLastPoint[0], y1 = secondLastPoint[1];
            const x2 = lastPoint[0], y2 = lastPoint[1];
            const x = newPosition[0], y = newPosition[1];
            if ((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1) > 0) newWidth = -newWidth;

            this.previewFeature.properties.width = newWidth;
        } else if (handleId === 'headLength') {
            // Handle de comprimento da cabeça (sem mudanças)
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const bearing = turf.bearing(secondLastPoint, lastPoint);

            const line = turf.lineString([lastPoint, newPosition]);
            const distance = turf.length(line, { units: 'meters' });

            const tipBearing = turf.bearing(lastPoint, newPosition);
            const angleDiff = Math.abs(bearing - tipBearing);
            const isForward = angleDiff < 90 || angleDiff > 270;

            if (isForward && distance > 100) {
                const width = this.previewFeature.properties.width || 500;
                const headBaseWidth = Math.abs(width * 2.5);
                const newHeadLengthRatio = Math.max(0.5, distance / headBaseWidth);

                this.previewFeature.properties.headLengthRatio = newHeadLengthRatio;
            }
        } else if (handleId === 'airmobile') {
            // ✅ IMPLEMENTAR EXATAMENTE COMO NO HTML DE REFERÊNCIA
            const line = turf.lineString(coords);
            const lineLength = turf.length(line, { units: 'meters' });

            // ✅ Tentar usar turf.pointOnLine primeiro (como no HTML)
            let snappedPoint;
            let newDistance;

            snappedPoint = turf.nearestPointOnLine(line, turf.point(newPosition), { units: 'meters' });
            newDistance = snappedPoint.properties.location;

            let newPositionNormalized = newDistance / lineLength;
            newPositionNormalized = Math.max(0.01, Math.min(0.99, newPositionNormalized));

            this.previewFeature.properties.airmobilePosition = newPositionNormalized;
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
        // ✅ CLEANUP: Cancel all pending operations
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

    // ===== MÉTODOS OBRIGATÓRIOS PARA O SISTEMA DE SELEÇÃO =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));

        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;

            const sourceFeature = data.features.find(f => f.id == feature.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // ✅ GARANTIR que propriedades essenciais nunca sejam null
                sourceFeature.properties.fillColor = sourceFeature.properties.fillColor || AddArrowControl.DEFAULT_PROPERTIES.fillColor;
                sourceFeature.properties.lineColor = sourceFeature.properties.lineColor || AddArrowControl.DEFAULT_PROPERTIES.lineColor;
                sourceFeature.properties.lineOpacity = sourceFeature.properties.lineOpacity || AddArrowControl.DEFAULT_PROPERTIES.lineOpacity;
                sourceFeature.properties.fillOpacity = sourceFeature.properties.fillOpacity || AddArrowControl.DEFAULT_PROPERTIES.fillOpacity;
                sourceFeature.properties.lineWidth = sourceFeature.properties.lineWidth || AddArrowControl.DEFAULT_PROPERTIES.lineWidth;

                // ✅ Se alterar propriedades geométricas, recalcular geometria
                if (property === 'width' || property === 'headLengthRatio' || property === 'showArrowHead' || property === 'airmobile' || property === 'airmobilePosition') {
                    const newGeometry = this.generateArrowGeometry(sourceFeature.properties);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('arrows').setData(data);

        // Atualizar handles se em modo editing
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
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        const currentHeadRatio = feature.properties.headLengthRatio || 1.5;
        const initialHeadRatio = initialProperties.headLengthRatio || 1.5;

        const currentShowHead = feature.properties.showArrowHead !== false;  // ✅ NOVA COMPARAÇÃO
        const initialShowHead = initialProperties.showArrowHead !== false;

        const currentAirmobile = feature.properties.airmobile || false;
        const initialAirmobile = initialProperties.airmobile || false;

        const currentAirmobilePosition = feature.properties.airmobilePosition || 0.7;
        const initialAirmobilePosition = initialProperties.airmobilePosition || 0.7;

        return (
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.fillOpacity !== initialProperties.fillOpacity ||
            feature.properties.width !== initialProperties.width ||
            currentHeadRatio !== initialHeadRatio ||
            currentShowHead !== initialShowHead ||  // ✅ NOVA VERIFICAÇÃO
            currentAirmobile !== initialAirmobile ||
            currentAirmobilePosition !== initialAirmobilePosition ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.id);
            if (!initialProperties) return false;

            return this.hasFeatureChanged(feature, initialProperties);
        });
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));

            // Regenerar geometria com propriedades originais
            f.geometry = this.generateArrowGeometry(f.properties);
        });

        // Usar o método updateFeatures que já existe e funciona corretamente
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.id || feature.properties.id;
                await removeFeature('arrows', featureId);
            } catch (error) {
                console.error(`Error removing arrow ${featureId}:`, error);
            }
        }

        // Remove from map source (visual)
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

    // ===== UTILITY METHODS =====

    // Helper para garantir que baseCoordinates é sempre um array
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