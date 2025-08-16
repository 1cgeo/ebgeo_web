// js/controls_sig/boundary_tool/add_boundary_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddBoundaryControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // 3-STATE SYSTEM (seguindo padrão arrow/circle)
        // 1. deselected: Default state, no special interaction
        // 2. selected: Feature can be dragged via MoveHandler
        // 3. editing: Handle-based editing, feature drag disabled
        this.currentState = 'deselected';
        this.selectedFeature = null;
        
        // Edit mode variables
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds = new Set();

        // Drawing state (specific to boundary)
        this.clickTimer = null;
        this.lastClickCoords = null;

        // PERFORMANCE OPTIMIZATION: RAF & Debouncing (como arrow)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;
        
        // EDIT PERFORMANCE: Same pattern as arrow
        this.editRafId = null;
        this.pendingEditUpdate = false;
        this.lastEditPosition = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1,
        source: 'boundary',
        type: 'boundary',
        symbol_position_ratio: 0.5,
        symbol_size: 1,
        text_size: 35,
        echelon: 'XXX',
        text_top: '',
        text_bottom: ''
    };

    // ===== MAPBOX CONTROL INTERFACE =====
    
    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl boundary-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "boundary-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_boundary_black.svg" alt="BOUNDARY" />';
        button.title = 'Adicionar Linha de Divisão (B)';
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
            console.error('Error removing AddBoundaryControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'boundary';
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
        
        this.map.on('click', this.handleMapClick);
        this.map.on('dblclick', this.handleDoubleClick);
        this.map.on('mousemove', this.handlePreviewMouseMove);
    }

    deactivate = () => {
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.forceTransitionToDeselected();
        
        this.map.off('click', this.handleMapClick);
        this.map.off('dblclick', this.handleDoubleClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ? 
            './images/icon_boundary_red.svg' : 
            './images/icon_boundary_black.svg';
        $(`#boundary-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="BOUNDARY" />`);
    }

    // ===== STATE MANAGEMENT SYSTEM (como arrow) =====

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
        this.map.getCanvas().style.cursor = '';
    }

    // State 2: SELECTED (uses MoveHandler for drag)
    enterSelectedState = (feature) => {
        this.selectedFeature = feature;
        this.map.getCanvas().style.cursor = 'move';
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

        // CLEANUP: Cancel pending operations
        this.cancelPendingUpdates();
    }

    // PERFORMANCE: Cancel pending RAF/debouncing operations
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;

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

        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }
    }

    // ===== SELECTION SYSTEM INTEGRATION (como arrow) =====

    onFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        const isSameFeature = this.selectedFeature && 
            (this.selectedFeature.id || this.selectedFeature.properties.id) === featureId;
        
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
        const currentFeatureId = this.selectedFeature && 
            (this.selectedFeature.id || this.selectedFeature.properties.id);
        
        if (currentFeatureId === featureId) {
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

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive || this.drawingMode !== 'boundary') return;
        
        this.lastClickCoords = [e.lngLat.lng, e.lngLat.lat];
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => {
            this.drawPoints.push(this.lastClickCoords);
            this.lastClickCoords = null;
        }, 250);
    }

    handleDoubleClick = (e) => {
        if (!this.isActive || this.drawingMode !== 'boundary') return;
        
        clearTimeout(this.clickTimer);
        this.lastClickCoords = null;
        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length >= 2) {
            this.createFeature();
        }
        
        this.stopDrawing();
        e.preventDefault();
    }

    // OPTIMIZED: RAF-based preview (como arrow)
    handlePreviewMouseMove = (e) => {
        if (this.drawingMode === 'boundary') {
            this.lastPreviewPoints = [...this.drawPoints];
            if (this.lastClickCoords) {
                this.lastPreviewPoints.push(this.lastClickCoords);
            }
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];
            
            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    // PERFORMANCE: RAF callback for smooth preview
    performPreviewUpdate = () => {
        if (!this.lastPreviewPoints || !this.lastPreviewPosition || this.lastPreviewPoints.length === 0) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Light debouncing for complex boundary geometry
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const previewPoints = [...this.lastPreviewPoints, this.lastPreviewPosition];
            if (previewPoints.length >= 2) {
                const previewGeometry = this.generateBoundaryGeometry({
                    baseCoordinates: previewPoints,
                    ...AddBoundaryControl.DEFAULT_PROPERTIES
                });
                this.showPreview(previewGeometry);
            }
        }, 8); // Light debouncing like arrow

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('boundary-preview').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                preview: true,
                color: AddBoundaryControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddBoundaryControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        this.map.getSource('boundary-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    stopDrawing = () => {
        this.drawingMode = null;
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.clearPreview();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) return;

        // ✅ VALIDAÇÃO: Garantir que os pontos são válidos
        const validPoints = this.drawPoints.filter(point => 
            Array.isArray(point) && 
            point.length >= 2 && 
            !isNaN(point[0]) && 
            !isNaN(point[1])
        );

        if (validPoints.length < 2) {
            console.warn('Insufficient valid points for boundary creation');
            return;
        }

        const featureId = Date.now().toString();
        const properties = {
            ...AddBoundaryControl.DEFAULT_PROPERTIES,
            baseCoordinates: [...validPoints],
            id: featureId
        };

        // ✅ GARANTIR que a geometria seja válida antes de criar a feature
        const geometry = this.generateBoundaryGeometry(properties);
        
        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for boundary');
            return;
        }

        const feature = {
            type: 'Feature',
            id: featureId,
            properties: properties,
            geometry: geometry
        };

        try {
            await addFeature('boundarys', feature);
            
            // Atualizar source principal
            const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
            data.features.push(feature);
            this.map.getSource('boundarys').setData(data);
            
            // Atualizar features dependentes
            this.updateDependentFeatures(feature);
            
            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
        } catch (error) {
            console.error('Erro ao criar boundary:', error);
        }
    }

    // ===== GEOMETRIA PRINCIPAL (FASE 1: MultiLineString) =====

    generateBoundaryGeometry = (properties) => {
        let { baseCoordinates, symbol_position_ratio, symbol_size, echelon } = properties;
        
        // ✅ VALIDAÇÃO ROBUSTA DE COORDENADAS
        baseCoordinates = this.normalizeBaseCoordinates(baseCoordinates);
        
        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for boundary:', baseCoordinates);
            return {
                type: 'LineString',
                coordinates: baseCoordinates || [[0, 0], [0, 0]]
            };
        }

        // ✅ VALIDAR que todas as coordenadas são números válidos
        const hasValidCoords = baseCoordinates.every(coord => 
            Array.isArray(coord) && 
            coord.length >= 2 && 
            typeof coord[0] === 'number' && 
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) && 
            !isNaN(coord[1])
        );

        if (!hasValidCoords) {
            console.warn('Invalid coordinates detected in boundary:', baseCoordinates);
            return {
                type: 'LineString',
                coordinates: [[0, 0], [1, 1]] // Fallback seguro
            };
        }

        try {
            // Criar linha principal com gap
            const lineWithGap = this.createLineWithGap(baseCoordinates, symbol_position_ratio, symbol_size);
            
            // Criar símbolos do escalão
            const symbolLines = this.createEchelonSymbolLines(baseCoordinates, symbol_position_ratio, symbol_size, echelon);
            
            // Combinar tudo em MultiLineString
            const allLines = [...lineWithGap, ...symbolLines];
            
            if (allLines.length === 0) {
                return {
                    type: 'LineString',
                    coordinates: baseCoordinates
                };
            }
            
            return {
                type: 'MultiLineString',
                coordinates: allLines
            };
            
        } catch (error) {
            console.warn('Error generating boundary geometry:', error);
            return {
                type: 'LineString',
                coordinates: baseCoordinates
            };
        }
    }

    // ✅ NOVA: Função para normalizar baseCoordinates
    normalizeBaseCoordinates = (coords) => {
        if (typeof coords === 'string') {
            try {
                coords = JSON.parse(coords);
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates:', coords, e);
                return null;
            }
        }

        if (!Array.isArray(coords)) {
            console.warn('baseCoordinates não é um array:', coords);
            return null;
        }

        return coords;
    }

    createLineWithGap = (coordinates, ratio, symbolSize) => {
        if (coordinates.length < 2) return [];
        
        // ✅ VALIDAÇÃO EXTRA
        const validCoords = coordinates.filter(coord => 
            Array.isArray(coord) && coord.length >= 2 && 
            !isNaN(coord[0]) && !isNaN(coord[1])
        );
        
        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for line with gap');
            return [coordinates];
        }
        
        try {
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });
            
            // ✅ VALIDAÇÃO: evitar divisão por zero ou valores muito pequenos
            if (totalLength < 0.001) { // menos de 1 metro
                return [validCoords];
            }
            
            // Calcular gap baseado no tamanho do símbolo
            const numSymbols = 3; // Default para XXX
            const symbolWidth = numSymbols * symbolSize * 1.5;
            const gapWidth = symbolWidth * 1.2;
            const centerDistance = totalLength * ratio;

            const gapStartDistance = Math.max(0, centerDistance - (gapWidth / 2));
            const gapEndDistance = Math.min(totalLength, centerDistance + (gapWidth / 2));

            // Criar segmentos
            const segments = [];
            
            if (gapStartDistance > 0.001) { // Evitar segmentos muito pequenos
                const startPoint = turf.point(validCoords[0]);
                const gapStartPoint = turf.along(line, gapStartDistance, { units: 'kilometers' });
                const segment1 = turf.lineSlice(startPoint, gapStartPoint, line);
                
                if (segment1.geometry.coordinates.length >= 2) {
                    segments.push(segment1.geometry.coordinates);
                }
            }
            
            if (gapEndDistance < totalLength - 0.001) { // Evitar segmentos muito pequenos
                const gapEndPoint = turf.along(line, gapEndDistance, { units: 'kilometers' });
                const endPoint = turf.point(validCoords[validCoords.length - 1]);
                const segment2 = turf.lineSlice(gapEndPoint, endPoint, line);
                
                if (segment2.geometry.coordinates.length >= 2) {
                    segments.push(segment2.geometry.coordinates);
                }
            }
            
            return segments.length > 0 ? segments : [validCoords];
        } catch (error) {
            console.warn('Error creating line with gap:', error);
            return [validCoords];
        }
    }

    createEchelonSymbolLines = (coordinates, ratio, size, echelon) => {
        if (coordinates.length < 2) return [];
        
        // ✅ VALIDAÇÃO EXTRA
        const validCoords = coordinates.filter(coord => 
            Array.isArray(coord) && coord.length >= 2 && 
            !isNaN(coord[0]) && !isNaN(coord[1])
        );
        
        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for echelon symbols');
            return [];
        }
        
        try {
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });
            
            // ✅ VALIDAÇÃO: evitar linhas muito pequenas
            if (totalLength < 0.001) {
                return [];
            }
            
            const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
            
            // Calcular bearing local com validação
            const distance1 = Math.max(0.001, totalLength * ratio - 0.01);
            const distance2 = Math.min(totalLength - 0.001, totalLength * ratio + 0.01);
            
            const p1 = turf.along(line, distance1, { units: 'kilometers' });
            const p2 = turf.along(line, distance2, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);
            
            const { lines } = this.createEchelonSymbol(echelon, centerPoint, size, localBearing);
            return lines;
        } catch (error) {
            console.warn('Error creating echelon symbol lines:', error);
            return [];
        }
    }

    createEchelonSymbol = (echelon, centerPoint, size, bearing) => {
        const symbolLines = [];
        const polygons = [];
        const numSymbols = echelon.length;
        const spacing = size * 1.5;
        const totalWidth = (numSymbols - 1) * spacing;
        const firstSymbolBearing = bearing;
        const firstSymbolCenter = turf.destination(centerPoint, -totalWidth / 2, firstSymbolBearing, { units: 'kilometers' });

        for (let i = 0; i < numSymbols; i++) {
            const currentCenter = turf.destination(firstSymbolCenter, i * spacing, firstSymbolBearing, { units: 'kilometers' });
            const symbolType = echelon.charAt(i);

            switch (symbolType) {
                case 'X':
                    const xAngle1 = 45;
                    const p1_start = turf.destination(currentCenter, size / 2, bearing + xAngle1, { units: 'kilometers' });
                    const p1_end = turf.destination(currentCenter, size / 2, bearing + xAngle1 + 180, { units: 'kilometers' });
                    symbolLines.push([p1_start.geometry.coordinates, p1_end.geometry.coordinates]);

                    const xAngle2 = -45;
                    const p2_start = turf.destination(currentCenter, size / 2, bearing + xAngle2, { units: 'kilometers' });
                    const p2_end = turf.destination(currentCenter, size / 2, bearing + xAngle2 + 180, { units: 'kilometers' });
                    symbolLines.push([p2_start.geometry.coordinates, p2_end.geometry.coordinates]);
                    break;
                case 'I':
                    const iAngle = bearing - 90;
                    const p_top = turf.destination(currentCenter, size / 1.5, iAngle, { units: 'kilometers' });
                    const p_bottom = turf.destination(currentCenter, -size / 1.5, iAngle, { units: 'kilometers' });
                    symbolLines.push([p_top.geometry.coordinates, p_bottom.geometry.coordinates]);
                    break;
                case 'o':
                    const circle = turf.circle(currentCenter, size / 4, { steps: 32, units: 'kilometers' });
                    polygons.push(circle);
                    break;
            }
        }
        return { lines: symbolLines, polygons: polygons };
    }

    // ===== FEATURES DEPENDENTES (FASE 2 & 3: Círculos e Textos) =====

    updateDependentFeatures = (boundaryFeature) => {
        // Atualizar círculos do escalão
        this.updateBoundaryCircles(boundaryFeature);
        
        // Atualizar textos
        this.updateBoundaryTexts(boundaryFeature);
    }

    updateBoundaryCircles = (boundaryFeature) => {
        const circleData = JSON.parse(JSON.stringify(this.map.getSource('boundary-circles')._data));
        const featureId = boundaryFeature.id || boundaryFeature.properties.id;
        
        // Remover círculos antigos desta boundary
        circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);
        
        // Adicionar novos círculos se necessário
        const circles = this.generateBoundaryCircles(boundaryFeature);
        circleData.features.push(...circles);
        
        this.map.getSource('boundary-circles').setData(circleData);
    }

    generateBoundaryCircles = (boundaryFeature) => {
        const circles = [];
        const { echelon, baseCoordinates, symbol_position_ratio, symbol_size } = boundaryFeature.properties;
        
        if (!echelon.includes('o') || baseCoordinates.length < 2) {
            return circles;
        }
        
        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * symbol_position_ratio, { units: 'kilometers' });
            
            const p1 = turf.along(line, totalLength * symbol_position_ratio - 0.01, { units: 'kilometers' });
            const p2 = turf.along(line, totalLength * symbol_position_ratio + 0.01, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);
            
            const { polygons } = this.createEchelonSymbol(echelon, centerPoint, symbol_size, localBearing);
            
            polygons.forEach((polygon, index) => {
                circles.push({
                    type: 'Feature',
                    id: `${boundaryFeature.id}-circle-${index}`,
                    geometry: polygon.geometry,
                    properties: {
                        parent: boundaryFeature.id,
                        color: boundaryFeature.properties.color,
                        opacity: boundaryFeature.properties.opacity,
                        source: 'boundary-circle'
                    }
                });
            });
        } catch (error) {
            console.warn('Error generating boundary circles:', error);
        }
        
        return circles;
    }

    updateBoundaryTexts = (boundaryFeature) => {
        const textData = JSON.parse(JSON.stringify(this.map.getSource('boundary-texts')._data));
        const featureId = boundaryFeature.id || boundaryFeature.properties.id;
        
        // Remover textos antigos desta boundary
        textData.features = textData.features.filter(f => f.properties.parent !== featureId);
        
        // Adicionar novos textos se necessário
        const texts = this.generateBoundaryTexts(boundaryFeature);
        textData.features.push(...texts);
        
        this.map.getSource('boundary-texts').setData(textData);
    }

    generateBoundaryTexts = (boundaryFeature) => {
        const textFeatures = [];
        const { text_top, text_bottom, text_size, baseCoordinates, symbol_position_ratio, symbol_size } = boundaryFeature.properties;
        
        if ((!text_top && !text_bottom) || baseCoordinates.length < 2) {
            return textFeatures;
        }
        
        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * symbol_position_ratio, { units: 'kilometers' });
            
            const p1 = turf.along(line, totalLength * symbol_position_ratio - 0.01, { units: 'kilometers' });
            const p2 = turf.along(line, totalLength * symbol_position_ratio + 0.01, { units: 'kilometers' });
            const localBearing = turf.bearing(p1, p2);
            
            const labelOffset = symbol_size * 0.8;
            const textPlacementBearing = localBearing - 90;
            const textRotation = (localBearing <= 0 || localBearing >= 180) ? localBearing + 90 : localBearing - 90;

            if (text_top) {
                const pTop = turf.destination(centerPoint, labelOffset, textPlacementBearing, { units: 'kilometers' });
                textFeatures.push({
                    type: 'Feature',
                    id: `${boundaryFeature.id}-text-top`,
                    geometry: {
                        type: 'Point',
                        coordinates: pTop.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.id,
                        text: text_top,
                        rotation: textRotation,
                        text_size: text_size,
                        color: boundaryFeature.properties.color,
                        source: 'boundary-text'
                    }
                });
            }
            
            if (text_bottom) {
                const pBottom = turf.destination(centerPoint, -labelOffset, textPlacementBearing, { units: 'kilometers' });
                textFeatures.push({
                    type: 'Feature',
                    id: `${boundaryFeature.id}-text-bottom`,
                    geometry: {
                        type: 'Point',
                        coordinates: pBottom.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.id,
                        text: text_bottom,
                        rotation: textRotation,
                        text_size: text_size,
                        color: boundaryFeature.properties.color,
                        source: 'boundary-text'
                    }
                });
            }
        } catch (error) {
            console.warn('Error generating boundary texts:', error);
        }
        
        return textFeatures;
    }

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        const handles = [];
        const baseFeature = this.getSelectedFeature() || feature;
        if (!baseFeature || !baseFeature.properties.baseCoordinates) return;
        
        // Add highlighted feature for editing mode visual
        handles.push({
            ...baseFeature,
            properties: {
                ...baseFeature.properties,
                role: 'selected-feature',
                mode: 'boundary_editing'
            }
        });
        
        // Control points
        const controlPoints = this.getControlPoints(baseFeature);
        controlPoints.forEach(p => {
            this.editHandleIds.add(p.id);
            handles.push(p);
        });
        
        this.map.getSource('boundary-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    getControlPoints = (baseFeature) => {
        const points = [];
        
        // ✅ VALIDAÇÃO ROBUSTA das coordenadas
        const coordinates = this.normalizeBaseCoordinates(baseFeature.properties.baseCoordinates);
        const id = baseFeature.properties.id || baseFeature.id;

        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for control points:', coordinates);
            return [];
        }

        // ✅ VERIFICAR se todas as coordenadas são válidas
        const validCoords = coordinates.filter(coord => 
            Array.isArray(coord) && 
            coord.length >= 2 && 
            !isNaN(coord[0]) && 
            !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for control points');
            return [];
        }

        // Vertex handles
        validCoords.forEach((coord, index) => {
            const handleId = `boundary-handle-${id}-vertex-${index}`;
            points.push({
                type: 'Feature',
                id: handleId,
                geometry: {
                    type: 'Point',
                    coordinates: coord
                },
                properties: {
                    parent: id,
                    index: index,
                    type: 'vertex',
                    role: 'handle',
                    handleType: 'vertex',
                    featureId: id,
                    mode: 'boundary_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // Midpoint handles
        for (let i = 0; i < validCoords.length - 1; i++) {
            try {
                const midpoint = turf.midpoint(turf.point(validCoords[i]), turf.point(validCoords[i + 1]));
                const handleId = `boundary-handle-${id}-midpoint-${i}`;
                points.push({
                    type: 'Feature',
                    id: handleId,
                    geometry: midpoint.geometry,
                    properties: {
                        parent: id,
                        index: i + 1,
                        type: 'midpoint',
                        role: 'handle',
                        handleType: 'midpoint',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'midpoint',
                        user_isEditingHandle: true
                    }
                });
            } catch (error) {
                console.warn(`Error creating midpoint handle ${i}:`, error);
            }
        }

        // Symbol handle - position
        try {
            const ratio = baseFeature.properties.symbol_position_ratio || 0.5;
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });
            
            if (totalLength > 0.001) { // Evitar linhas muito pequenas
                const symbolPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
                const symbolHandleId = `boundary-handle-${id}-symbol`;
                points.push({
                    type: 'Feature',
                    id: symbolHandleId,
                    geometry: {
                        type: 'Point',
                        coordinates: symbolPoint.geometry.coordinates
                    },
                    properties: {
                        parent: id,
                        type: 'symbol_handle',
                        role: 'handle',
                        handleType: 'symbol_handle',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                });
                
                // Size handle
                const size = baseFeature.properties.symbol_size || 2;
                const distance1 = Math.max(0.001, totalLength * ratio - 0.01);
                const distance2 = Math.min(totalLength - 0.001, totalLength * ratio + 0.01);
                
                const p1 = turf.along(line, distance1, { units: 'kilometers' });
                const p2 = turf.along(line, distance2, { units: 'kilometers' });
                const localBearing = turf.bearing(p1, p2);
                const sizeHandlePoint = turf.destination(symbolPoint, size / 2, localBearing + 45, { units: 'kilometers' });
                const sizeHandleId = `boundary-handle-${id}-size`;
                points.push({
                    type: 'Feature',
                    id: sizeHandleId,
                    geometry: {
                        type: 'Point',
                        coordinates: sizeHandlePoint.geometry.coordinates
                    },
                    properties: {
                        parent: id,
                        type: 'size_handle',
                        role: 'handle',
                        handleType: 'size_handle',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                });
            }
        } catch (error) {
            console.warn('Error creating symbol handles:', error);
        }
        
        return points;
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();
        this.map.getSource('boundary-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    clearEditPreview = () => {
        this.map.getSource('boundary-edit-handles').setData({
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

    onEditMouseDown = (e) => {
        if (this.currentState !== 'editing') return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['boundary-edit-handles-layer']
        });
        
        const targetLine = this.map.queryRenderedFeatures(e.point, {
            layers: ['boundary-selected-layer']
        });
        
        if (handleFeatures.length > 0) {
            this.activeHandle = handleFeatures[0];
        } else if (targetLine.length > 0) {
            this.activeHandle = targetLine[0];
        } else {
            return;
        }
        
        this.map.dragPan.disable();
        this.isDraggingHandle = true;
        this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
        this.map.getCanvas().style.cursor = 'grabbing';
        
        const baseFeature = this.getSelectedFeature();
        if (baseFeature) {
            this.previewFeature = JSON.parse(JSON.stringify(baseFeature));
        }
    }

    // OPTIMIZED: RAF-based edit updates
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;
        
        this.lastEditPosition = [e.lngLat.lng, e.lngLat.lat];
        
        if (!this.pendingEditUpdate) {
            this.pendingEditUpdate = true;
            this.editRafId = requestAnimationFrame(this.performEditUpdate.bind(this));
        }
    }

    // PERFORMANCE: RAF callback for smooth edit updates
    performEditUpdate = () => {
        if (!this.lastEditPosition || !this.previewFeature) {
            this.pendingEditUpdate = false;
            return;
        }

        // Light debouncing for geometry generation
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.updateEditPreview(this.lastEditPosition);
        }, 8);

        this.pendingEditUpdate = false;
    }

    updateEditPreview = (currentCoords) => {
        if (!this.previewFeature || !this.activeHandle) return;
        
        const props = this.activeHandle.properties;
        let coordinates = [...this.previewFeature.properties.baseCoordinates];

        if (props.type === 'size_handle') {
            // Size handle
            const ratio = this.previewFeature.properties.symbol_position_ratio || 0.5;
            const line = turf.lineString(coordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
            const newSize = turf.distance(centerPoint, turf.point(currentCoords), { units: 'kilometers' }) * 2;
            this.previewFeature.properties.symbol_size = Math.max(0.5, newSize);

        } else if (props.type === 'symbol_handle') {
            // Symbol position handle
            const line = turf.lineString(coordinates);
            const pointOnLine = turf.nearestPointOnLine(line, turf.point(currentCoords), { units: 'kilometers' });
            const distance = pointOnLine.properties.location;
            const totalLength = turf.length(line, { units: 'kilometers' });
            this.previewFeature.properties.symbol_position_ratio = Math.max(0.01, Math.min(0.99, distance / totalLength));
            
        } else if (props.type === 'vertex') {
            // Vertex handle - update coordinates directly
            coordinates[props.index] = currentCoords;
            this.previewFeature.properties.baseCoordinates = coordinates;
            
        } else if (props.type === 'midpoint') {
            // Midpoint handle (insert new vertex)
            coordinates.splice(props.index, 0, currentCoords);
            this.previewFeature.properties.baseCoordinates = coordinates;
            this.activeHandle.properties.type = 'vertex';
            
        } else {
            // Move entire feature
            const dx = currentCoords[0] - this.initialHandlePosition[0];
            const dy = currentCoords[1] - this.initialHandlePosition[1];
            
            coordinates = coordinates.map(c => [c[0] + dx, c[1] + dy]);
            this.previewFeature.properties.baseCoordinates = coordinates;
        }

        // Regenerar geometria
        this.previewFeature.geometry = this.generateBoundaryGeometry(this.previewFeature.properties);
        
        // Atualizar visualização
        this.forceUpdateMainSource(this.previewFeature);
        this.updateDependentFeatures(this.previewFeature);
        this.createEditHandles(this.previewFeature);
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle && this.previewFeature) {
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
            this.updateDependentFeatures(finalFeature);
            this.createEditHandles(finalFeature);
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(finalFeature);
        }
    }

    // ===== UTILITY METHODS =====

    getSelectedFeature = () => {
        if (!this.selectedFeature) return null;
        
        const data = this.map.getSource('boundarys')._data;
        const featureId = this.selectedFeature.id || this.selectedFeature.properties.id;
        const found = data.features.find(f => 
            String(f.id || f.properties.id) === String(featureId) && 
            f.properties.source === 'boundary'
        );

        if (found && found.properties && found.properties.baseCoordinates) {
            return found;
        }

        console.warn('Selected feature not found or invalid:', featureId, found);
        return null;
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        const featureId = feature.id || feature.properties.id;
        const sourceFeature = data.features.find(f => 
            (f.id || f.properties.id) == featureId && 
            f.properties.source === 'boundary'
        );
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('boundarys').setData(data);
        }
    }

    updateSelectionAfterEdit = () => {
        const featureId = this.selectedFeature.id || this.selectedFeature.properties.id;
        this.selectionManager.selectedBoundaryFeatures.set(featureId, this.selectedFeature);
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('boundarys', feature);
        } catch (error) {
            console.error('Erro ao salvar changes da feature:', error);
        }
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        this.map.on('mouseenter', 'boundary-main-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'boundary-main-layer', this.handleMouseLeave);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'boundary-main-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'boundary-main-layer', this.handleMouseLeave);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        // CLEANUP: Cancel all pending operations
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

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        
        features.forEach(feature => {
            if (!feature || !feature.properties) {
                console.warn('Invalid feature in updateFeaturesProperty:', feature);
                return;
            }

            feature.properties[property] = value;
            
            const featureId = feature.id || feature.properties.id;
            const sourceFeature = data.features.find(f => (f.id || f.properties.id) == featureId);
            
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                
                // ✅ VALIDAÇÃO: Garantir que baseCoordinates seja válido antes de regenerar
                const coords = this.normalizeBaseCoordinates(sourceFeature.properties.baseCoordinates);
                if (coords && coords.length >= 2) {
                    
                    // ✅ REGENERAR GEOMETRIA: Para propriedades que afetam a forma
                    if (['baseCoordinates', 'symbol_position_ratio', 'symbol_size', 'echelon'].includes(property)) {
                        sourceFeature.geometry = this.generateBoundaryGeometry(sourceFeature.properties);
                        feature.geometry = sourceFeature.geometry;
                    }
                    
                    // ✅ ATUALIZAR FEATURES DEPENDENTES: Para todas as propriedades visuais e de conteúdo
                    if (['color', 'lineWidth', 'opacity', 'text_top', 'text_bottom', 'text_size', 'echelon', 'symbol_position_ratio', 'symbol_size'].includes(property)) {
                        // Atualizar textos e círculos dependentes
                        this.updateDependentFeatures(sourceFeature);
                    }
                    
                } else {
                    console.warn('Cannot update feature - invalid baseCoordinates:', sourceFeature.properties.baseCoordinates);
                }
            }
            
            // ✅ SINCRONIZAR SELECTED FEATURE se for a mesma
            if (this.selectedFeature && 
                (this.selectedFeature.id || this.selectedFeature.properties.id) === featureId) {
                
                this.selectedFeature.properties[property] = value;
                
                if (['baseCoordinates', 'symbol_position_ratio', 'symbol_size', 'echelon'].includes(property)) {
                    this.selectedFeature.geometry = sourceFeature.geometry;
                    
                    if (this.currentState === 'editing' && !this.isDraggingHandle) {
                        this.createEditHandles(this.selectedFeature);
                    }
                }
            }
        });
        
        // ✅ ATUALIZAR SOURCE PRINCIPAL
        this.map.getSource('boundarys').setData(data);
    }

    updateFeatures = async (features, save = false) => {
        features.forEach(feature => {
            if (feature.properties.baseCoordinates) {
                feature.geometry = this.generateBoundaryGeometry(feature.properties);
                this.forceUpdateMainSource(feature);
                this.updateDependentFeatures(feature);
            }
            if (save) {
                this.saveFeatureChanges(feature);
            }
        });
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('boundarys', f);
            }
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        
        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.text_top !== initialProperties.text_top ||
            feature.properties.text_bottom !== initialProperties.text_bottom ||
            feature.properties.symbol_size !== initialProperties.symbol_size ||
            feature.properties.symbol_position_ratio !== initialProperties.symbol_position_ratio ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                feature.geometry = this.generateBoundaryGeometry(feature.properties);
                this.forceUpdateMainSource(feature);
                this.updateDependentFeatures(feature);
                await updateFeature('boundarys', feature);
            }
        }
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        const mainData = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        const textData = JSON.parse(JSON.stringify(this.map.getSource('boundary-texts')._data));
        const circleData = JSON.parse(JSON.stringify(this.map.getSource('boundary-circles')._data));
        
        for (const feature of features) {
            try {
                const featureId = feature.id || feature.properties.id;
                await removeFeature('boundarys', featureId);
                
                // Remove from all sources
                const idString = String(featureId);
                mainData.features = mainData.features.filter(f => String(f.id || f.properties.id) !== idString);
                textData.features = textData.features.filter(f => f.properties.parent !== featureId);
                circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);
                
            } catch (error) {
                console.error(`Erro ao remover boundary ${featureId}:`, error);
            }
        }
        
        // Update all sources
        this.map.getSource('boundarys').setData(mainData);
        this.map.getSource('boundary-texts').setData(textData);
        this.map.getSource('boundary-circles').setData(circleData);
        
        // Clear selection if necessary
        const deletedIds = features.map(f => String(f.id || f.properties.id));
        if (this.selectedFeature && 
            deletedIds.includes(String(this.selectedFeature.id || this.selectedFeature.properties.id))) {
            this.transitionToState('deselected');
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddBoundaryControl.DEFAULT_PROPERTIES, properties);
    }
}

export default AddBoundaryControl;