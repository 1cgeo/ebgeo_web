// Path: js\controls_sig\boundary_tool\add_boundary_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddBoundaryControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // ✅ ESTADO SIMPLIFICADO (7 variáveis - normalização defensiva implementada)
        this.isActive = false;
        this.selectedFeature = null;           // Substitui currentState system
        this.drawPoints = [];
        this.isDraggingHandle = false;         // Estado de drag único
        this.activeHandleType = null;          // Qual handle está sendo arrastado
        this.activeHandleIndex = null;         // ✅ Índice do handle para vertex/midpoint

        // ✅ RAF CONSOLIDADO - um sistema apenas
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;         // Cache dos pontos durante preview
        this.geometryDebounceTimer = null;     // Debounce para operações de geometria

        // Boundary-specific drawing
        this.clickTimer = null;
        this.lastClickCoords = null;
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
        text_bottom: '',

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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl boundary-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "boundary-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_boundary_black.svg" alt="BOUNDARY" />';
        button.title = 'Adicionar Linha de Divisão (D)';
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
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.deselectFeature();

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
        this.activeHandleIndex = null;         // ✅ Reset índice
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
        this.lastPreviewPoints = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;         // ✅ Reset índice

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
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
            f.layer?.id === 'boundary-handles-layer'  // ✅ Layer-based detection
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'boundarys' &&
            f.properties.id === this.selectedFeature.properties.id
        );
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        // ✅ NORMALIZAÇÃO DEFENSIVA - Features podem vir com coordenadas como string do IndexedDB
        if (feature?.properties?.baseCoordinates) {
            const normalizedCoords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
            if (normalizedCoords && normalizedCoords.length >= 2) {
                feature.properties.baseCoordinates = normalizedCoords;
                this.selectFeature(feature);
            } else {
                console.warn('Cannot select boundary feature - invalid coordinates:', feature.properties.baseCoordinates);
                return;
            }
        } else {
            this.selectFeature(feature);
        }
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
                // ✅ NORMALIZAÇÃO DEFENSIVA - Features movidas podem vir com coordenadas como string
                const normalizedCoords = this.normalizeBaseCoordinates(updatedFeature.properties.baseCoordinates);
                if (normalizedCoords && normalizedCoords.length >= 2) {
                    updatedFeature.properties.baseCoordinates = normalizedCoords;
                    this.selectedFeature = updatedFeature;
                    this.createEditHandles(updatedFeature);
                } else {
                    console.warn('Invalid coordinates in moved feature, keeping current selection');
                }
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        this.lastClickCoords = [e.lngLat.lng, e.lngLat.lat];
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => {
            this.drawPoints.push(this.lastClickCoords);
            this.lastClickCoords = null;
        }, 250);
    }

    handleDoubleClick = (e) => {
        if (!this.isActive) return;

        clearTimeout(this.clickTimer);
        this.lastClickCoords = null;
        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length >= 2) {
            this.createFeature();
        }

        this.stopDrawing();
        e.preventDefault();
    }

    // ✅ RAF-based preview (com cache dos pontos)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPoints = [...this.drawPoints]; // Cache dos pontos
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    // ✅ CONSOLIDATED RAF - handles both preview and edit
    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Edit mode - updating boundary via handle drag
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            this.updateBoundaryPreview(this.lastPreviewPosition);
        }
        // Drawing mode - showing boundary preview
        else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            // Build preview points
            let previewPoints = [...this.lastPreviewPoints];
            if (this.lastClickCoords) {
                previewPoints.push(this.lastClickCoords);
            }
            previewPoints.push(this.lastPreviewPosition);

            if (previewPoints.length >= 2) {
                // Light debouncing for boundary geometry generation
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.generateBoundaryGeometry({
                        baseCoordinates: previewPoints,
                        ...AddBoundaryControl.DEFAULT_PROPERTIES
                    });
                    this.showPreview(previewGeometry);
                }, 8); // 8ms como nos outros controles
            }
        }

        this.pendingPreviewUpdate = false;
    }

    // ✅ UPDATED - uses consolidated feedback source (estilo fixo)
    showPreview = (geometry) => {
        this.map.getSource('boundary-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}  // Sem propriedades - estilo sempre igual
        });
    }

    // ✅ UPDATED - clears consolidated feedback source
    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('boundary-feedback')) {
            this.map.getSource('boundary-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    stopDrawing = () => {
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.clearPreview();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) return;

        // Validation
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

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('boundary', this.map);
        const properties = {
            ...AddBoundaryControl.DEFAULT_PROPERTIES,
            baseCoordinates: [...validPoints],
            id: featureId,
            nome: featureName
        };

        const geometry = this.generateBoundaryGeometry(properties);

        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for boundary');
            return;
        }

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: properties,
            geometry: geometry
        };

        try {
            await addFeature('boundarys', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
            data.features.push(feature);
            this.map.getSource('boundarys').setData(data);

            this.updateDependentFeatures(feature);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            this.selectionManager.toggleFeatureSelection('boundary', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar boundary:', error);
        }
    }

    // ===== BOUNDARY GEOMETRY GENERATION (PRESERVAR LÓGICA ORIGINAL) =====

    generateBoundaryGeometry = (properties) => {
        let { baseCoordinates, symbol_position_ratio, symbol_size, echelon } = properties;

        baseCoordinates = this.normalizeBaseCoordinates(baseCoordinates);

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for boundary:', baseCoordinates);
            return {
                type: 'LineString',
                coordinates: baseCoordinates || [[0, 0], [0, 0]]
            };
        }

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
                coordinates: [[0, 0], [1, 1]]
            };
        }

        try {
            const lineWithGap = this.createLineWithGap(baseCoordinates, symbol_position_ratio, symbol_size, echelon);
            const symbolLines = this.createEchelonSymbolLines(baseCoordinates, symbol_position_ratio, symbol_size, echelon);
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

    normalizeBaseCoordinates = (coords) => {
        // ✅ NORMALIZAÇÃO ROBUSTA - Handle múltiplos formatos
        if (!coords) {
            console.warn('baseCoordinates is null or undefined');
            return null;
        }

        // Se já é um array válido, retornar
        if (Array.isArray(coords)) {
            // Validar que é realmente um array de coordenadas válidas
            const isValidArray = coords.every(coord =>
                Array.isArray(coord) &&
                coord.length >= 2 &&
                typeof coord[0] === 'number' &&
                typeof coord[1] === 'number' &&
                !isNaN(coord[0]) &&
                !isNaN(coord[1])
            );
            
            if (isValidArray) {
                return coords;
            } else {
                console.warn('baseCoordinates array contains invalid coordinates:', coords);
                return null;
            }
        }

        // Se é string, tentar fazer parse
        if (typeof coords === 'string') {
            try {
                const parsed = JSON.parse(coords);
                if (Array.isArray(parsed)) {
                    // Recursão para validar o resultado parseado
                    return this.normalizeBaseCoordinates(parsed);
                } else {
                    console.warn('Parsed baseCoordinates is not an array:', parsed);
                    return null;
                }
            } catch (e) {
                console.error('Erro ao parsear baseCoordinates string:', coords, e);
                return null;
            }
        }

        console.warn('baseCoordinates is neither array nor string:', typeof coords, coords);
        return null;
    }

    createLineWithGap = (coordinates, ratio, symbolSize, echelon) => {
        if (coordinates.length < 2) return [];

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

            if (totalLength < 0.001) {
                return [validCoords];
            }

            // ✅ GAP DINÂMICO: Baseado no número de símbolos do echelon
            const numSymbols = (echelon && echelon.length > 0) ? echelon.length : 3;  // Fallback para 3
            const symbolWidth = numSymbols * symbolSize * 1.5;
            const gapWidth = symbolWidth * 1.2;
            const centerDistance = totalLength * ratio;

            const gapStartDistance = Math.max(0, centerDistance - (gapWidth / 2));
            const gapEndDistance = Math.min(totalLength, centerDistance + (gapWidth / 2));

            const segments = [];

            if (gapStartDistance > 0.001) {
                const startPoint = turf.point(validCoords[0]);
                const gapStartPoint = turf.along(line, gapStartDistance, { units: 'kilometers' });
                const segment1 = turf.lineSlice(startPoint, gapStartPoint, line);

                if (segment1.geometry.coordinates.length >= 2) {
                    segments.push(segment1.geometry.coordinates);
                }
            }

            if (gapEndDistance < totalLength - 0.001) {
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

            if (totalLength < 0.001) {
                return [];
            }

            const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });

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

    // ===== DEPENDENT FEATURES (PRESERVAR LÓGICA ORIGINAL) =====

    updateDependentFeatures = (boundaryFeature) => {
        this.updateBoundaryCircles(boundaryFeature);
        this.updateBoundaryTexts(boundaryFeature);
    }

    updateBoundaryCircles = (boundaryFeature) => {
        const circleData = JSON.parse(JSON.stringify(this.map.getSource('boundary-circles')._data));
        const featureId = boundaryFeature.properties.id;

        circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

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
                    id: `${boundaryFeature.properties.id}-circle-${index}`,
                    geometry: polygon.geometry,
                    properties: {
                        parent: boundaryFeature.properties.id,
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
        const featureId = boundaryFeature.properties.id;

        textData.features = textData.features.filter(f => f.properties.parent !== featureId);

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
                    id: `${boundaryFeature.properties.id}-text-top`,
                    geometry: {
                        type: 'Point',
                        coordinates: pTop.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.properties.id,
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
                    id: `${boundaryFeature.properties.id}-text-bottom`,
                    geometry: {
                        type: 'Point',
                        coordinates: pBottom.geometry.coordinates
                    },
                    properties: {
                        parent: boundaryFeature.properties.id,
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
        if (!feature || !feature.properties.baseCoordinates) return;

        const controlPoints = this.getControlPoints(feature);
        controlPoints.forEach(p => handles.push(p));

        // Show selection feedback using consolidated source (estilo fixo)
        this.map.getSource('boundary-feedback').setData({
            type: 'FeatureCollection',
            features: [
                // Selected feature with simple properties
                {
                    ...feature,
                    properties: {}  // Sem propriedades - estilo sempre igual
                },
                // All handles
                ...handles
            ]
        });
    }

    getControlPoints = (baseFeature) => {
        const points = [];
        const coordinates = this.normalizeBaseCoordinates(baseFeature.properties.baseCoordinates);
        const id = baseFeature.properties.id;

        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for control points:', coordinates);
            return [];
        }

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

        // 1. Vertex handles (vermelho)
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

        // 2. Midpoint handles (laranja)
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

        // 3. Symbol handles (azul e verde)
        try {
            const ratio = baseFeature.properties.symbol_position_ratio || 0.5;
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength > 0.001) {
                // Symbol position handle (azul)
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

                // Size handle (verde)
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
        this.map.getSource('boundary-feedback').setData({
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
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['boundary-handles-layer']  // ✅ CORRIGIDO: Query na layer certa
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            if (handle.properties.user_isEditingHandle) {
                this.isDraggingHandle = true;
                this.activeHandleType = handle.properties.type;
                this.activeHandleIndex = handle.properties.index; // ✅ Store handle index
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
            this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);
            
            // Regenerate geometry
            this.selectedFeature.geometry = this.generateBoundaryGeometry(this.selectedFeature.properties);

            this.forceUpdateMainSource(this.selectedFeature);
            this.updateDependentFeatures(this.selectedFeature);
            this.createEditHandles(this.selectedFeature);
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(this.selectedFeature);
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;         // ✅ Reset índice
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateBoundaryPreview = (newPosition) => {
        if (!this.selectedFeature || !this.activeHandleType) return;

        // ✅ NORMALIZAÇÃO DEFENSIVA - Importante para preview após carregar
        let coordinates = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for boundary preview:', this.selectedFeature.properties.baseCoordinates);
            return;
        }

        // Light debouncing for boundary geometry generation
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.updateGeometryFromHandle(this.activeHandleType, newPosition);
            const previewGeometry = this.generateBoundaryGeometry(this.selectedFeature.properties);
            
            // Show updated preview
            this.showEditPreview(previewGeometry);
        }, 8);
    }

    updateGeometryFromHandle = (handleType, newPosition) => {
        if (!this.selectedFeature) return;

        // ✅ NORMALIZAÇÃO DEFENSIVA - Crítico para coordenadas que vêm do IndexedDB
        let coordinates = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for handle update:', this.selectedFeature.properties.baseCoordinates);
            return;
        }
        coordinates = [...coordinates]; // Safe copy após validação

        if (handleType === 'size_handle') {
            // Size handle logic
            const ratio = this.selectedFeature.properties.symbol_position_ratio || 0.5;
            const line = turf.lineString(coordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
            const newSize = turf.distance(centerPoint, turf.point(newPosition), { units: 'kilometers' }) * 2;
            this.selectedFeature.properties.symbol_size = Math.max(0.5, newSize);

        } else if (handleType === 'symbol_handle') {
            // Symbol position handle logic
            const line = turf.lineString(coordinates);
            const pointOnLine = turf.nearestPointOnLine(line, turf.point(newPosition), { units: 'kilometers' });
            const distance = pointOnLine.properties.location;
            const totalLength = turf.length(line, { units: 'kilometers' });
            this.selectedFeature.properties.symbol_position_ratio = Math.max(0.01, Math.min(0.99, distance / totalLength));

        } else if (handleType === 'vertex' && this.activeHandleIndex !== null) {
            // ✅ CORRIGIDO: Usar activeHandleIndex armazenado
            coordinates[this.activeHandleIndex] = newPosition;
            this.selectedFeature.properties.baseCoordinates = coordinates;

        } else if (handleType === 'midpoint' && this.activeHandleIndex !== null) {
            coordinates.splice(this.activeHandleIndex, 0, newPosition);
            this.selectedFeature.properties.baseCoordinates = coordinates;
            
            this.activeHandleType = 'vertex';
        }
    }

    showEditPreview = (geometry) => {
        this.map.getSource('boundary-feedback').setData({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: geometry,
                    properties: {}  // Sem propriedades - estilo sempre igual
                },
                ...this.getControlPoints(this.selectedFeature)
            ]
        });
    }

    // ===== UTILITY METHODS =====

    getSelectedFeature = () => {
        if (!this.selectedFeature) return null;

        const data = this.map.getSource('boundarys')._data;
        const featureId = this.selectedFeature.properties.id;
        const found = data.features.find(f =>
            String(f.properties.id) === String(featureId) &&
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
        const featureId = feature.properties.id;
        const sourceFeature = data.features.find(f =>
            (f.properties.id) == featureId &&
            f.properties.source === 'boundary'
        );
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('boundarys').setData(data);
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
            await updateFeature('boundarys', feature);
        } catch (error) {
            console.error('Erro ao salvar changes da feature:', error);
        }
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
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

            const featureId = feature.properties.id;
            const sourceFeature = data.features.find(f => (f.properties.id) == featureId);

            if (sourceFeature) {
                sourceFeature.properties[property] = value;

                const coords = this.normalizeBaseCoordinates(sourceFeature.properties.baseCoordinates);
                if (coords && coords.length >= 2) {

                    if (['baseCoordinates', 'symbol_position_ratio', 'symbol_size', 'echelon'].includes(property)) {
                        sourceFeature.geometry = this.generateBoundaryGeometry(sourceFeature.properties);
                        feature.geometry = sourceFeature.geometry;
                    }

                    if (['color', 'lineWidth', 'opacity', 'text_top', 'text_bottom', 'text_size', 'echelon', 'symbol_position_ratio', 'symbol_size'].includes(property)) {
                        this.updateDependentFeatures(sourceFeature);
                    }

                } else {
                    console.warn('Cannot update feature - invalid baseCoordinates:', sourceFeature.properties.baseCoordinates);
                }
            }

            if (this.selectedFeature &&
                (this.selectedFeature.properties.id) === featureId) {

                this.selectedFeature.properties[property] = value;

                if (['baseCoordinates', 'symbol_position_ratio', 'symbol_size', 'echelon'].includes(property)) {
                    this.selectedFeature.geometry = sourceFeature.geometry;

                    if (!this.isDraggingHandle) {
                        this.createEditHandles(this.selectedFeature);
                    }
                }
            }
        });

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
        const currentData = this.map.getSource('boundarys')._data;

        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('boundarys', featureToSave);
                    hasChanges = true;
                }
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
            // ✅ NOVOS ATRIBUTOS
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.generateBoundaryGeometry(f.properties);
        });

        await this.updateFeatures(features, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        const mainData = JSON.parse(JSON.stringify(this.map.getSource('boundarys')._data));
        const textData = JSON.parse(JSON.stringify(this.map.getSource('boundary-texts')._data));
        const circleData = JSON.parse(JSON.stringify(this.map.getSource('boundary-circles')._data));

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('boundarys', featureId);

                const idString = String(featureId);
                mainData.features = mainData.features.filter(f => String(f.properties.id) !== idString);
                textData.features = textData.features.filter(f => f.properties.parent !== featureId);
                circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

            } catch (error) {
                console.error(`Erro ao remover boundary ${featureId}:`, error);
            }
        }

        this.map.getSource('boundarys').setData(mainData);
        this.map.getSource('boundary-texts').setData(textData);
        this.map.getSource('boundary-circles').setData(circleData);

        const deletedIds = features.map(f => String(f.properties.id));
        if (this.selectedFeature &&
            deletedIds.includes(String(this.selectedFeature.properties.id))) {
            this.deselectFeature();
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddBoundaryControl.DEFAULT_PROPERTIES, properties);
    }
}

export default AddBoundaryControl;