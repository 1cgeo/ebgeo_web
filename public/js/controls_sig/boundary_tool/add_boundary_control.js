// js/controls_sig/boundary_tool/add_boundary_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddBoundaryControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // ✅ SISTEMA DE 3 ESTADOS (CRÍTICO)
        this.currentState = 'deselected';
        this.selectedFeature = null;
        
        // ✅ Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // ✅ Edit mode variables
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.editHandleIds = new Set();
    }

    static DEFAULT_PROPERTIES = {
        // ✅ OBRIGATÓRIO: Propriedades simples
        color: '#000000',
        lineWidth: 4,
        opacity: 1,
        source: 'boundary',
        geometryType: 'boundary',
        renderType: 'line',
        
        // Propriedades específicas
        echelon: 'XXX',
        symbolPositionRatio: 0.5,
        symbolSize: 100,
        
        // Textos
        textTop: '',
        textBottom: '',
        textScaleFactor: 1
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

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ? 
            './images/icon_boundary_red.svg' : 
            './images/icon_boundary_black.svg';
            
        $(`#boundary-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="BOUNDARY" />`);
    }

    // ===== SISTEMA DE 3 ESTADOS =====
    
    transitionToState = (newState, feature = null) => {
        const oldState = this.currentState;
        
        if (oldState === newState) return;
        
        if (oldState === 'editing') {
            this.clearEditHandles();
            this.removeEditEventListeners();
        }
        
        this.currentState = newState;
        
        switch (newState) {
            case 'deselected':
                this.selectedFeature = null;
                this.setCursorStyle('');
                break;
                
            case 'selected':
                this.selectedFeature = feature;
                this.setCursorStyle('move');
                break;
                
            case 'editing':
                this.selectedFeature = feature;
                this.createEditHandles(feature);
                this.setupEditEventListeners();
                this.setCursorStyle('crosshair');
                break;
        }
    }
    
    forceTransitionToDeselected = () => {
        this.transitionToState('deselected');
    }

    // ===== INTEGRAÇÃO COM SELECTION MANAGER =====
    
    onFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        const isSameFeature = this.selectedFeature && this.selectedFeature.id === featureId;
        
        if (isSameFeature && this.currentState === 'selected') {
            this.transitionToState('editing', feature);
        } else {
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

    isEditingMode = () => {
        return this.currentState === 'editing';
    }
    
    hasEditHandle = (featureId) => {
        return this.editHandleIds.has(featureId);
    }

    // ===== SISTEMA DE DESENHO =====

    handleMapClick = (e) => {
        if (!this.isActive) return;
        
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para boundary');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
        
        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }
    }

    handleDoubleClick = (e) => {
        if (!this.isActive) return;
        
        e.preventDefault();
        
        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
        
        if (this.drawPoints.length >= 2) {
            this.createFeature();
        }
        
        this.toolManager.deactivateCurrentTool();
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            const previewPoints = [...this.drawPoints, [e.lngLat.lng, e.lngLat.lat]];
            
            if (this.isValidLineString(previewPoints)) {
                this.showPreview(previewPoints);
            }
        }
    }

    showPreview = (points) => {
        const previewLine = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: points
            },
            properties: { 
                preview: true,
                color: AddBoundaryControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddBoundaryControl.DEFAULT_PROPERTIES.lineWidth
            }
        };

        this.map.getSource('boundary-preview').setData({
            type: 'FeatureCollection',
            features: [previewLine]
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.getSource('boundary-preview').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        if (!this.isValidLineString(this.drawPoints)) {
            this.showValidationError();
            this.drawPoints = [];
            return;
        }

        const featureId = Date.now().toString();
        const feature = {
            type: 'Feature',
            id: featureId,
            properties: {
                ...AddBoundaryControl.DEFAULT_PROPERTIES,
                id: featureId
            },
            geometry: {
                type: 'LineString',
                coordinates: this.drawPoints
            }
        };

        try {
            await addFeature('boundarys', feature);
            this.renderComplexFeature(feature);
            
            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
        } catch (error) {
            console.error('Erro ao criar boundary:', error);
        }
    }

    // ===== SISTEMA DE RENDERIZAÇÃO REFATORADO =====

    renderComplexFeature = (feature) => {
        const allFeatures = this.createAllBoundaryFeatures(feature);
        
        // Atualizar source com todas as geometrias
        const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        
        // Remover features antigas desta boundary
        const featureId = feature.properties.id;
        data.features = data.features.filter(f => 
            f.properties.parent !== featureId && f.id !== featureId
        );
        
        // Adicionar todas as novas features
        data.features.push(...allFeatures);
        
        this.map.getSource('boundarys').setData(data);
    }

    // ✅ REFATORADO: Criar todas as features de uma vez com tipos garantidos
    createAllBoundaryFeatures = (baseFeature) => {
        const { properties, geometry: line } = baseFeature;
        const id = properties.id;

        if (!line || line.coordinates.length < 2) {
            return [baseFeature];
        }
        
        const {
            symbolPositionRatio = 0.5,
            symbolSize = 100,
            echelon = 'XXX',
            textTop = '',
            textBottom = '',
            textScaleFactor = 1,
            color = '#000000'
        } = properties;
        
        const allFeatures = [];
        
        // 1. Feature base (OBRIGATÓRIA)
        allFeatures.push(this.createSafeFeature(baseFeature, {
            renderType: 'line'
        }));
        
        // 2. Calcular posição do símbolo
        const centerPoint = this.getPointAtRatio(line, symbolPositionRatio);
        const localBearing = this.getLocalBearing(line, symbolPositionRatio);
        
        // 3. Criar linha com gap
        const lineSegments = this.createLineWithGap(line, symbolPositionRatio, symbolSize);
        
        lineSegments.forEach((segment, index) => {
            if (segment.length >= 2) {
                allFeatures.push(this.createSafeFeature({
                    type: 'Feature',
                    id: `${id}-line-${index}`,
                    geometry: {
                        type: 'LineString',
                        coordinates: segment
                    },
                    properties: { ...properties }
                }, {
                    renderType: 'line',
                    parent: id
                }));
            }
        });
        
        // 4. Criar símbolos
        const symbolGeometries = this.createEchelonSymbol(echelon, centerPoint, symbolSize, localBearing);
        
        symbolGeometries.forEach((geom, index) => {
            allFeatures.push(this.createSafeFeature({
                type: 'Feature',
                id: `${id}-symbol-${index}`,
                geometry: geom,
                properties: { ...properties }
            }, {
                renderType: 'symbol',
                parent: id
            }));
        });
        
        // 5. Criar textos
        const textFeatures = this.createRotatedTexts(centerPoint, localBearing, textTop, textBottom, symbolSize, textScaleFactor, color);
        
        textFeatures.forEach(textFeature => {
            allFeatures.push(this.createSafeFeature(textFeature, {
                renderType: 'text',
                parent: id
            }));
        });
        
        return allFeatures;
    }

    // ✅ CRÍTICO: Garantir que todas as propriedades sejam simples
    createSafeFeature = (feature, extraProps = {}) => {
        return {
            ...feature,
            properties: {
                ...feature.properties,
                ...extraProps,
                // Garantir propriedades obrigatórias
                renderType: extraProps.renderType || feature.properties.renderType || 'line',
                parent: extraProps.parent || feature.properties.parent,
                role: extraProps.role || feature.properties.role,
                source: feature.properties.source || 'boundary',
                color: feature.properties.color || '#000000',
                id: feature.properties.id || feature.id,
                lineWidth: feature.properties.lineWidth || 4,
                opacity: feature.properties.opacity || 1,
                textScaleFactor: feature.properties.textScaleFactor || 1
            }
        };
    }

    // ===== GEOMETRIA E CÁLCULOS (mantidos iguais) =====

    calculateLineLength = (line) => {
        let length = 0;
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            length += this.calculateDistance(line.coordinates[i], line.coordinates[i + 1]);
        }
        return length;
    }

    getPointAtRatio = (line, ratio) => {
        const totalLength = this.calculateLineLength(line);
        const targetDistance = totalLength * ratio;
        
        let currentDistance = 0;
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            const segmentLength = this.calculateDistance(line.coordinates[i], line.coordinates[i + 1]);
            
            if (currentDistance + segmentLength >= targetDistance) {
                const remainingDistance = targetDistance - currentDistance;
                const segmentRatio = remainingDistance / segmentLength;
                
                return [
                    line.coordinates[i][0] + (line.coordinates[i + 1][0] - line.coordinates[i][0]) * segmentRatio,
                    line.coordinates[i][1] + (line.coordinates[i + 1][1] - line.coordinates[i][1]) * segmentRatio
                ];
            }
            currentDistance += segmentLength;
        }
        
        return line.coordinates[line.coordinates.length - 1];
    }

    getLocalBearing = (line, ratio) => {
        const totalLength = this.calculateLineLength(line);
        const p1Distance = Math.max(0, totalLength * ratio - 10);
        const p2Distance = Math.min(totalLength, totalLength * ratio + 10);
        
        const p1 = this.getPointAtDistance(line, p1Distance);
        const p2 = this.getPointAtDistance(line, p2Distance);
        
        return this.calculateBearing(p1, p2);
    }

    getPointAtDistance = (line, distance) => {
        let currentDistance = 0;
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            const segmentLength = this.calculateDistance(line.coordinates[i], line.coordinates[i + 1]);
            
            if (currentDistance + segmentLength >= distance) {
                const remainingDistance = distance - currentDistance;
                const segmentRatio = remainingDistance / segmentLength;
                
                return [
                    line.coordinates[i][0] + (line.coordinates[i + 1][0] - line.coordinates[i][0]) * segmentRatio,
                    line.coordinates[i][1] + (line.coordinates[i + 1][1] - line.coordinates[i][1]) * segmentRatio
                ];
            }
            currentDistance += segmentLength;
        }
        
        return line.coordinates[line.coordinates.length - 1];
    }

    createLineWithGap = (line, ratio, symbolSize) => {
        const totalLength = this.calculateLineLength(line);
        const gapWidth = symbolSize * 0.012;
        const centerDistance = totalLength * ratio;
        
        const gapStartDistance = Math.max(0, centerDistance - (gapWidth / 2));
        const gapEndDistance = Math.min(totalLength, centerDistance + (gapWidth / 2));
        
        const segments = [];
        
        if (gapStartDistance > 0) {
            segments.push(this.getLineSegment(line, 0, gapStartDistance));
        }
        
        if (gapEndDistance < totalLength) {
            segments.push(this.getLineSegment(line, gapEndDistance, totalLength));
        }
        
        return segments.filter(segment => segment.length >= 2);
    }

    getLineSegment = (line, startDistance, endDistance) => {
        const segment = [];
        let currentDistance = 0;
        let startFound = false;
        
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            const segmentLength = this.calculateDistance(line.coordinates[i], line.coordinates[i + 1]);
            
            if (!startFound && currentDistance + segmentLength >= startDistance) {
                const remainingDistance = startDistance - currentDistance;
                const segmentRatio = remainingDistance / segmentLength;
                
                const startPoint = [
                    line.coordinates[i][0] + (line.coordinates[i + 1][0] - line.coordinates[i][0]) * segmentRatio,
                    line.coordinates[i][1] + (line.coordinates[i + 1][1] - line.coordinates[i][1]) * segmentRatio
                ];
                segment.push(startPoint);
                startFound = true;
            }
            
            if (startFound && currentDistance + segmentLength <= endDistance) {
                segment.push(line.coordinates[i + 1]);
            }
            
            if (startFound && currentDistance + segmentLength >= endDistance) {
                const remainingDistance = endDistance - currentDistance;
                const segmentRatio = remainingDistance / segmentLength;
                
                const endPoint = [
                    line.coordinates[i][0] + (line.coordinates[i + 1][0] - line.coordinates[i][0]) * segmentRatio,
                    line.coordinates[i][1] + (line.coordinates[i + 1][1] - line.coordinates[i][1]) * segmentRatio
                ];
                segment.push(endPoint);
                break;
            }
            
            currentDistance += segmentLength;
        }
        
        return segment;
    }

    createEchelonSymbol = (echelon, centerPoint, size, bearing) => {
        const symbolLines = [];
        const numSymbols = echelon.length;
        const spacing = size * 0.015;
        const totalWidth = (numSymbols - 1) * spacing;
        
        const firstSymbolBearing = bearing;
        const firstSymbolCenter = this.destinationPoint(centerPoint, -totalWidth / 2, firstSymbolBearing);

        for (let i = 0; i < numSymbols; i++) {
            const currentCenter = this.destinationPoint(firstSymbolCenter, i * spacing, firstSymbolBearing);
            const symbolType = echelon.charAt(i);

            switch (symbolType) {
                case 'X':
                    const xSize = size * 0.008;
                    const angle1 = bearing + 45;
                    const angle2 = bearing - 45;
                    
                    const x1_start = this.destinationPoint(currentCenter, xSize, angle1);
                    const x1_end = this.destinationPoint(currentCenter, xSize, angle1 + 180);
                    symbolLines.push({
                        type: 'LineString',
                        coordinates: [x1_start, x1_end]
                    });

                    const x2_start = this.destinationPoint(currentCenter, xSize, angle2);
                    const x2_end = this.destinationPoint(currentCenter, xSize, angle2 + 180);
                    symbolLines.push({
                        type: 'LineString',
                        coordinates: [x2_start, x2_end]
                    });
                    break;
                    
                case 'I':
                    const iSize = size * 0.01;
                    const iAngle = bearing - 90;
                    const i_top = this.destinationPoint(currentCenter, iSize, iAngle);
                    const i_bottom = this.destinationPoint(currentCenter, iSize, iAngle + 180);
                    symbolLines.push({
                        type: 'LineString',
                        coordinates: [i_top, i_bottom]
                    });
                    break;
                    
                case 'o':
                    const circleRadius = size * 0.004;
                    const circlePoints = [];
                    const segments = 16;
                    
                    for (let j = 0; j <= segments; j++) {
                        const angle = (j * 360 / segments) * Math.PI / 180;
                        const dx = circleRadius * Math.cos(angle);
                        const dy = circleRadius * Math.sin(angle);
                        
                        const lng = currentCenter[0] + (dx / 111320) / Math.cos(currentCenter[1] * Math.PI / 180);
                        const lat = currentCenter[1] + (dy / 111320);
                        
                        circlePoints.push([lng, lat]);
                    }
                    
                    symbolLines.push({
                        type: 'Polygon',
                        coordinates: [circlePoints]
                    });
                    break;
            }
        }
        
        return symbolLines;
    }

    createRotatedTexts = (centerPoint, bearing, textTop, textBottom, size, scaleFactor, color) => {
        const texts = [];
        const labelOffset = size * 0.012;
        const textPlacementBearing = bearing - 90;
        
        const textRotation = (bearing <= 0 || bearing >= 180) ? bearing + 90 : bearing - 90;
        
        if (textTop && textTop.trim()) {
            const pTop = this.destinationPoint(centerPoint, labelOffset, textPlacementBearing);
            texts.push({
                type: 'Feature',
                id: `text-top-${Date.now()}`,
                geometry: {
                    type: 'Point',
                    coordinates: pTop
                },
                properties: {
                    text: textTop,
                    rotation: textRotation,
                    textScaleFactor: scaleFactor,
                    color: color
                }
            });
        }
        
        if (textBottom && textBottom.trim()) {
            const pBottom = this.destinationPoint(centerPoint, labelOffset, textPlacementBearing + 180);
            texts.push({
                type: 'Feature',
                id: `text-bottom-${Date.now()}`,
                geometry: {
                    type: 'Point',
                    coordinates: pBottom
                },
                properties: {
                    text: textBottom,
                    rotation: textRotation,
                    textScaleFactor: scaleFactor,
                    color: color
                }
            });
        }
        
        return texts;
    }

    // ===== SISTEMA DE EDIÇÃO =====

    createEditHandles = (feature) => {
        const handles = [];
        
        // 1. Vertex handles
        handles.push(...this.createVertexHandles(feature));
        
        // 2. Midpoint handles
        handles.push(...this.createMidpointHandles(feature));
        
        // 3. Symbol handle
        handles.push(this.createSymbolHandle(feature));
        
        // 4. Size handle
        handles.push(this.createSizeHandle(feature));

        // 5. Feature destacada
        handles.push({
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature',
                mode: 'boundary_editing'
            }
        });

        this.map.getSource('boundary-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    createVertexHandles = (feature) => {
        const handles = [];
        feature.geometry.coordinates.forEach((coord, index) => {
            const handleId = `boundary-vertex-${feature.id}-${index}`;
            this.editHandleIds.add(handleId);
            
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: {
                    type: 'Point',
                    coordinates: coord
                },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    featureId: feature.id,
                    index: index
                }
            });
        });
        return handles;
    }

    createMidpointHandles = (feature) => {
        const handles = [];
        const coords = feature.geometry.coordinates;
        
        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = [
                (coords[i][0] + coords[i + 1][0]) / 2,
                (coords[i][1] + coords[i + 1][1]) / 2
            ];
            
            const handleId = `boundary-midpoint-${feature.id}-${i}`;
            this.editHandleIds.add(handleId);
            
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: {
                    type: 'Point',
                    coordinates: midpoint
                },
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    featureId: feature.id,
                    insertIndex: i + 1
                }
            });
        }
        return handles;
    }

    createSymbolHandle = (feature) => {
        const ratio = feature.properties.symbolPositionRatio || 0.5;
        const symbolPoint = this.getPointAtRatio(feature.geometry, ratio);
        
        const handleId = `boundary-symbol-${feature.id}`;
        this.editHandleIds.add(handleId);
        
        return {
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: symbolPoint
            },
            properties: {
                role: 'handle',
                handleType: 'symbol',
                handleId: 'symbol-position',
                featureId: feature.id
            }
        };
    }

    createSizeHandle = (feature) => {
        const ratio = feature.properties.symbolPositionRatio || 0.5;
        const size = feature.properties.symbolSize || 100;
        const centerPoint = this.getPointAtRatio(feature.geometry, ratio);
        const localBearing = this.getLocalBearing(feature.geometry, ratio);
        
        const sizeHandlePoint = this.destinationPoint(centerPoint, size * 0.006, localBearing + 45);
        
        const handleId = `boundary-size-${feature.id}`;
        this.editHandleIds.add(handleId);
        
        return {
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: sizeHandlePoint
            },
            properties: {
                role: 'handle',
                handleType: 'size',
                handleId: 'symbol-size',
                featureId: feature.id
            }
        };
    }

    clearEditHandles = () => {
        this.editHandleIds.clear();
        this.map.getSource('boundary-edit-handles').setData({
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
        if (!this.isEditingMode()) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['boundary-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
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
        if (this.isDraggingHandle) {
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';

            if (this.selectedFeature) {
                this.saveFeatureChanges(this.selectedFeature);
            }
        }
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        const feature = this.selectedFeature;
        
        if (handleId.startsWith('vertex-')) {
            const index = parseInt(handleId.split('-')[1]);
            feature.geometry.coordinates[index] = newPosition;
            
        } else if (handleId.startsWith('midpoint-')) {
            const index = parseInt(handleId.split('-')[1]) + 1;
            feature.geometry.coordinates.splice(index, 0, newPosition);
            
        } else if (handleId === 'symbol-position') {
            const totalLength = this.calculateLineLength(feature.geometry);
            const distanceToPoint = this.getDistanceToPoint(feature.geometry, newPosition);
            const newRatio = Math.max(0.1, Math.min(0.9, distanceToPoint / totalLength));
            
            feature.properties.symbolPositionRatio = newRatio;
            
        } else if (handleId === 'symbol-size') {
            const ratio = feature.properties.symbolPositionRatio || 0.5;
            const centerPoint = this.getPointAtRatio(feature.geometry, ratio);
            const newSize = this.calculateDistance(centerPoint, newPosition) / 0.006;
            
            if (newSize > 50 && newSize < 500) {
                feature.properties.symbolSize = newSize;
                feature.properties.textScaleFactor = newSize / 100;
            }
        }

        this.forceUpdateMainSource(feature);
        this.createEditHandles(feature);
    }

    getDistanceToPoint = (line, point) => {
        let minDistance = Infinity;
        let closestDistance = 0;
        let currentDistance = 0;
        
        for (let i = 0; i < line.coordinates.length - 1; i++) {
            const segmentLength = this.calculateDistance(line.coordinates[i], line.coordinates[i + 1]);
            
            const distanceToSegment = this.distanceToLineSegment(point, line.coordinates[i], line.coordinates[i + 1]);
            
            if (distanceToSegment < minDistance) {
                minDistance = distanceToSegment;
                closestDistance = currentDistance + (segmentLength / 2);
            }
            
            currentDistance += segmentLength;
        }
        
        return closestDistance;
    }

    distanceToLineSegment = (point, lineStart, lineEnd) => {
        const A = point[0] - lineStart[0];
        const B = point[1] - lineStart[1];
        const C = lineEnd[0] - lineStart[0];
        const D = lineEnd[1] - lineStart[1];

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }

        let xx, yy;

        if (param < 0) {
            xx = lineStart[0];
            yy = lineStart[1];
        } else if (param > 1) {
            xx = lineEnd[0];
            yy = lineEnd[1];
        } else {
            xx = lineStart[0] + param * C;
            yy = lineStart[1] + param * D;
        }

        const dx = point[0] - xx;
        const dy = point[1] - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ===== MÉTODOS OBRIGATÓRIOS PARA O SISTEMA =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        
        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;
            
            const sourceFeature = data.features.find(f => f.id == feature.id && f.properties.source === 'boundary');
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                this.reRenderFeature(sourceFeature, data);
            }
        }
        
        this.map.getSource('boundarys').setData(data);
    }

    reRenderFeature = (feature, data) => {
        const featureId = feature.properties.id;
        data.features = data.features.filter(f => f.properties.parent !== featureId);
        
        const newFeatures = this.createAllBoundaryFeatures(feature);
        data.features.push(...newFeatures);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
            
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id && f.properties.source === 'boundary');
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
                    
                    this.reRenderFeature(data.features[featureIndex], data);
                    
                    if (save) {
                        await updateFeature('boundarys', data.features[featureIndex]);
                    }
                }
            }
            
            this.map.getSource('boundarys').setData(data);
        }
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
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.textTop !== initialProperties.textTop ||
            feature.properties.textBottom !== initialProperties.textBottom ||
            feature.properties.symbolSize !== initialProperties.symbolSize ||
            feature.properties.symbolPositionRatio !== initialProperties.symbolPositionRatio ||
            JSON.stringify(feature.geometry) !== JSON.stringify(initialProperties.geometry)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                await updateFeature('boundarys', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        for (const feature of features) {
            await removeFeature('boundarys', feature.id);
        }
        this.updateMapSource();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddBoundaryControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('boundarys')) {
            const currentData = this.map.getSource('boundarys')._data;
            this.map.getSource('boundarys').setData(currentData);
        }
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id && f.properties.source === 'boundary');
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            
            this.reRenderFeature(sourceFeature, data);
            this.map.getSource('boundarys').setData(data);
        }
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('boundarys', feature);
            this.forceUpdateMainSource(feature);
        } catch (error) {
            console.error('Erro ao salvar changes da feature:', error);
        }
    }

    // ===== EVENT LISTENERS =====
    
    setupBaseEventListeners = () => {
        this.map.on('mouseenter', 'boundary-line-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'boundary-line-layer', this.handleMouseLeave);
        this.map.on('mouseenter', 'boundary-symbol-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'boundary-symbol-layer', this.handleMouseLeave);
    }

    removeAllEventListeners = () => {
        this.map.off('mouseenter', 'boundary-line-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'boundary-line-layer', this.handleMouseLeave);
        this.map.off('mouseenter', 'boundary-symbol-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'boundary-symbol-layer', this.handleMouseLeave);
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
        this.drawingMode = 'boundary';
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
        
        this.map.on('click', this.handleMapClick);
        this.map.on('dblclick', this.handleDoubleClick);
    }

    deactivate = () => {
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.forceTransitionToDeselected();
        
        this.map.off('click', this.handleMapClick);
        this.map.off('dblclick', this.handleDoubleClick);
    }

    // ===== UTILITY METHODS =====
    
    setCursorStyle = (style) => {
        this.map.getCanvas().style.cursor = style;
    }

    isValidLineString = (points) => {
        return points && points.length >= 2;
    }

    showValidationError = () => {
        alert('É necessário pelo menos 2 pontos para criar uma linha de divisão');
    }

    calculateDistance = (point1, point2) => {
        const R = 6371000;
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

        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    destinationPoint = (point, distance, bearing) => {
        const R = 6371000;
        const lat1 = point[1] * Math.PI / 180;
        const lng1 = point[0] * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;

        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance / R) +
                              Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad));

        const lng2 = lng1 + Math.atan2(Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
                                      Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2));

        return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
    }

    setSelectionManager = (selectionManager) => {
        this.selectionManager = selectionManager;
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
            console.error('Error removing AddBoundaryControl:', error);
            throw error;
        }
    }
}

export default AddBoundaryControl;