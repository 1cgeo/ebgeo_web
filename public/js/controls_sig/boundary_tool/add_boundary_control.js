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

        // ✅ Constantes do gabarito
        this.initialSymbolSize = 2; // Base size in kilometers (from gabarito)
    }

    static DEFAULT_PROPERTIES = {
        // ✅ OBRIGATÓRIO: Propriedades simples
        color: '#000000',
        lineWidth: 4,
        source: 'boundary',
        geometryType: 'boundary',
        renderType: 'line',
        
        // Propriedades específicas seguindo o gabarito
        echelon: 'XXX',
        symbolPositionRatio: 0.5,
        symbolSize: 2, // kilometers (matching gabarito)
        textScaleFactor: 1,
        
        // Textos
        textTop: '',
        textBottom: ''
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

    // ✅ REFATORADO: Seguindo exatamente o gabarito HTML
    createAllBoundaryFeatures = (baseFeature) => {
        const { properties, geometry: line } = baseFeature;
        const id = properties.id;

        if (!line || line.coordinates.length < 2) {
            return [baseFeature];
        }
        
        const {
            symbolPositionRatio = 0.5,
            symbolSize = this.initialSymbolSize,
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
        
        // 2. Usar turf.js para cálculos (seguindo gabarito)
        const turfLine = turf.lineString(line.coordinates);
        const totalLength = turf.length(turfLine, { units: 'kilometers' });
        const centerPoint = turf.along(turfLine, totalLength * symbolPositionRatio, { units: 'kilometers' });
        
        // 3. Calcular bearing local (seguindo gabarito)
        const p1 = turf.along(turfLine, totalLength * symbolPositionRatio - 0.01, { units: 'kilometers' });
        const p2 = turf.along(turfLine, totalLength * symbolPositionRatio + 0.01, { units: 'kilometers' });
        const localBearing = turf.bearing(p1, p2);
        
        // 4. Criar linha com gap (seguindo gabarito)
        const lineSegments = this.createLineWithGap(turfLine, symbolPositionRatio, symbolSize);
        
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
        
        // 5. Criar símbolos (seguindo gabarito)
        const symbolGeometries = this.createEchelonSymbol(echelon, centerPoint, symbolSize, localBearing);
        
        symbolGeometries.lines.forEach((lineCoords, index) => {
            allFeatures.push(this.createSafeFeature({
                type: 'Feature',
                id: `${id}-symbol-line-${index}`,
                geometry: {
                    type: 'LineString',
                    coordinates: lineCoords
                },
                properties: { ...properties }
            }, {
                renderType: 'symbol',
                parent: id
            }));
        });
        
        symbolGeometries.polygons.forEach((polygon, index) => {
            allFeatures.push(this.createSafeFeature({
                type: 'Feature',
                id: `${id}-symbol-polygon-${index}`,
                geometry: polygon.geometry,
                properties: { ...properties }
            }, {
                renderType: 'symbol',
                parent: id
            }));
        });
        
        // 6. Criar textos (seguindo gabarito)
        const textFeatures = this.createRotatedTexts(centerPoint, localBearing, textTop, textBottom, symbolSize, textScaleFactor, color);
        
        textFeatures.forEach(textFeature => {
            allFeatures.push(this.createSafeFeature(textFeature, {
                renderType: 'text',
                parent: id
            }));
        });
        
        return allFeatures;
    }

    // ✅ CRITICAL: Seguindo exatamente o gabarito HTML
    createLineWithGap = (line, ratio, symbolSize, echelon = 'XXX') => {
        const totalLength = turf.length(line, { units: 'kilometers' });
        const numSymbols = echelon.length;
        const symbolWidth = (numSymbols * symbolSize * 1.5);
        const gapWidth = symbolWidth * 1.2;
        const centerDistance = totalLength * ratio;

        const gapStartDistance = Math.max(0, centerDistance - (gapWidth / 2));
        const gapEndDistance = Math.min(totalLength, centerDistance + (gapWidth / 2));

        const lineStartPoint = turf.point(line.geometry.coordinates[0]);
        const lineEndPoint = turf.point(line.geometry.coordinates[line.geometry.coordinates.length - 1]);
        const gapStartPoint = turf.along(line, gapStartDistance, { units: 'kilometers' });
        const gapEndPoint = turf.along(line, gapEndDistance, { units: 'kilometers' });

        const segment1 = turf.lineSlice(lineStartPoint, gapStartPoint, line);
        const segment2 = turf.lineSlice(gapEndPoint, lineEndPoint, line);
        
        const segments = [];
        if (segment1.geometry.coordinates.length >= 2) segments.push(segment1.geometry.coordinates);
        if (segment2.geometry.coordinates.length >= 2) segments.push(segment2.geometry.coordinates);

        return segments;
    }

    // ✅ SEGUINDO EXATAMENTE O GABARITO HTML
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

    createRotatedTexts = (centerPoint, bearing, textTop, textBottom, size, scaleFactor, color) => {
        const texts = [];
        const labelOffset = size * 1.2;
        const textPlacementBearing = bearing - 90;
        
        const textRotation = (bearing <= 0 || bearing >= 180) ? bearing + 90 : bearing - 90;
        
        if (textTop && textTop.trim()) {
            const pTop = turf.destination(centerPoint, labelOffset, textPlacementBearing, { units: 'kilometers' });
            texts.push({
                type: 'Feature',
                id: `text-top-${Date.now()}`,
                geometry: {
                    type: 'Point',
                    coordinates: pTop.geometry.coordinates
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
            const pBottom = turf.destination(centerPoint, -labelOffset, textPlacementBearing, { units: 'kilometers' });
            texts.push({
                type: 'Feature',
                id: `text-bottom-${Date.now()}`,
                geometry: {
                    type: 'Point',
                    coordinates: pBottom.geometry.coordinates
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
                textScaleFactor: feature.properties.textScaleFactor || 1
            }
        };
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
        const turfLine = turf.lineString(feature.geometry.coordinates);
        const totalLength = turf.length(turfLine, { units: 'kilometers' });
        const symbolPoint = turf.along(turfLine, totalLength * ratio, { units: 'kilometers' });
        
        const handleId = `boundary-symbol-${feature.id}`;
        this.editHandleIds.add(handleId);
        
        return {
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: symbolPoint.geometry.coordinates
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
        const size = feature.properties.symbolSize || this.initialSymbolSize;
        const turfLine = turf.lineString(feature.geometry.coordinates);
        const totalLength = turf.length(turfLine, { units: 'kilometers' });
        const centerPoint = turf.along(turfLine, totalLength * ratio, { units: 'kilometers' });
        
        // Calcular bearing local como no gabarito
        const p1 = turf.along(turfLine, totalLength * ratio - 0.01, { units: 'kilometers' });
        const p2 = turf.along(turfLine, totalLength * ratio + 0.01, { units: 'kilometers' });
        const localBearing = turf.bearing(p1, p2);
        
        const sizeHandlePoint = turf.destination(centerPoint, size / 2, localBearing + 45, { units: 'kilometers' });
        
        const handleId = `boundary-size-${feature.id}`;
        this.editHandleIds.add(handleId);
        
        return {
            type: 'Feature',
            id: handleId,
            geometry: {
                type: 'Point',
                coordinates: sizeHandlePoint.geometry.coordinates
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
            // Seguindo gabarito: usar turf.pointOnLine
            const line = turf.lineString(feature.geometry.coordinates);
            const pointOnLine = turf.pointOnLine(line, turf.point(newPosition), { units: 'kilometers' });
            const distance = pointOnLine.properties.location;
            const totalLength = turf.length(line, { units: 'kilometers' });
            feature.properties.symbolPositionRatio = distance / totalLength;
            
        } else if (handleId === 'symbol-size') {
            // Seguindo gabarito: calcular nova distância
            const ratio = feature.properties.symbolPositionRatio || 0.5;
            const turfLine = turf.lineString(feature.geometry.coordinates);
            const totalLength = turf.length(turfLine, { units: 'kilometers' });
            const centerPoint = turf.along(turfLine, totalLength * ratio, { units: 'kilometers' });
            const newSize = turf.distance(centerPoint, turf.point(newPosition), { units: 'kilometers' }) * 2;
            
            if (newSize > 0.5 && newSize < 50) { // Limites razoáveis em km
                feature.properties.symbolSize = newSize;
                feature.properties.textScaleFactor = newSize / this.initialSymbolSize;
            }
        }

        this.forceUpdateMainSource(feature);
        this.createEditHandles(feature);
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