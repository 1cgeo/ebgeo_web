// Path: js\controls_sig\arrow_tool\add_arrow_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddArrowControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // ✅ ESTADO SIMPLIFICADO (7 variáveis máximo)
        this.isActive = false;
        this.selectedFeature = null;           // Substitui currentState system
        this.drawPoints = [];
        this.isDraggingHandle = false;         // Estado de drag único
        this.activeHandle = null;              // ✅ RECUPERADO: Objeto handle completo (para midpoint)
        this.activeHandleType = null;          // Qual handle está sendo arrastado (string)

        // ✅ RAF CONSOLIDADO - um sistema apenas
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;         // Cache dos pontos durante preview
        this.geometryDebounceTimer = null;     // Debounce para operações de geometria
    }

    static DEFAULT_PROPERTIES = {
        width: 500,
        fillColor: '#3f4fb5',
        lineColor: '#3f4fb5',
        lineWidth: 3,
        fillOpacity: 0.8,
        lineOpacity: 1.0,
        headLengthRatio: 1.5,
        showArrowHead: true,
        airmobile: false,
        airmobilePosition: 0.7,
        source: 'arrow',
        geometryType: 'arrow',
        baseCoordinates: [],

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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl arrow-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "arrow-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_arrow_black.svg" alt="ARROW" />';
        button.title = 'Adicionar Seta (S)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
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
            './images/icon_arrow_red.svg' :
            './images/icon_arrow_black.svg';
        $(`#arrow-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="ARROW" />`);
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
        this.activeHandle = null;              // ✅ Reset objeto handle
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
        this.lastPreviewPoints = null;
        this.activeHandle = null;              // ✅ Reset objeto handle
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
            f.source === 'arrow-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'arrows' &&
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

    // ✅ RAF-based preview (com cache dos pontos)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];
            this.lastPreviewPoints = [...this.drawPoints, this.lastPreviewPosition];

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

        // Edit mode - updating arrow geometry via handle drag
        if (this.isDraggingHandle && this.selectedFeature && this.activeHandleType) {
            this.updateGeometryFromHandle(this.activeHandleType, this.lastPreviewPosition);
        }
        // Drawing mode - showing arrow preview
        else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 2) {
            const isAirmobile = AddArrowControl.DEFAULT_PROPERTIES.airmobile;
            const debounceTime = isAirmobile ? 12 : 8; // 12ms para airmobile complexo, 8ms para normal

            // ✅ Debounce para operações turf.js pesadas
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.generateArrowGeometry({
                    baseCoordinates: this.lastPreviewPoints,
                    width: AddArrowControl.DEFAULT_PROPERTIES.width,
                    headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                    showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,
                    airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile,
                    airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition
                });

                if (previewGeometry) {
                    this.showPreview(previewGeometry);
                }
            }, debounceTime);
        }

        this.pendingPreviewUpdate = false;
    }

    // ✅ SIMPLIFICADO - uses consolidated feedback source (estilo fixo)
    showPreview = (geometry) => {
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}  // ✅ Sem propriedades - estilo sempre igual
        });
    }

    // ✅ UPDATED - clears consolidated feedback source
    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('arrow-feedback')) {
            this.map.getSource('arrow-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
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

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('arrow', this.map); // ✅ NOVO: Nome automático

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddArrowControl.DEFAULT_PROPERTIES,
                baseCoordinates: [...this.drawPoints],
                id: featureId,
                nome: featureName, // ✅ NOVO: Nome automático
                // ✅ GARANTIR que todas as propriedades visuais existam
                fillColor: AddArrowControl.DEFAULT_PROPERTIES.fillColor,
                lineColor: AddArrowControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddArrowControl.DEFAULT_PROPERTIES.lineWidth,
                fillOpacity: AddArrowControl.DEFAULT_PROPERTIES.fillOpacity,
                lineOpacity: AddArrowControl.DEFAULT_PROPERTIES.lineOpacity,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,
                airmobile: AddArrowControl.DEFAULT_PROPERTIES.airmobile,
                airmobilePosition: AddArrowControl.DEFAULT_PROPERTIES.airmobilePosition
            },
            geometry: this.generateArrowGeometry({
                baseCoordinates: this.drawPoints,
                width: AddArrowControl.DEFAULT_PROPERTIES.width,
                headLengthRatio: AddArrowControl.DEFAULT_PROPERTIES.headLengthRatio,
                showArrowHead: AddArrowControl.DEFAULT_PROPERTIES.showArrowHead,
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

            this.selectionManager.toggleFeatureSelection('arrow', feature.properties.id, feature);
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

    // ===== GERAÇÃO DA GEOMETRIA DA SETA (MANTER LÓGICA ORIGINAL) =====

    generateArrowGeometry = (properties) => {
        const coords = this.normalizeBaseCoordinates(properties.baseCoordinates);
        const width = properties.width || 1000;
        const headLengthRatio = properties.headLengthRatio || 1.5;
        const showArrowHead = properties.showArrowHead !== false;
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

    // ===== EDITING MODE: HANDLE SYSTEM =====

    createEditHandles = (feature) => {
        if (!feature || !feature.properties) {
            console.warn('Feature inválida para criar handles:', feature);
            return;
        }

        // ✅ SIMPLIFICADO: Mostrar feature selecionada via arrow-feedback (estilo fixo)
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {}  // ✅ Sem propriedades - estilo sempre igual
        });

        // ✅ CRIAR: Handles separadamente
        this.createEditHandlesOnly(feature);
    }

    clearEditHandles = () => {
        // ✅ CONSOLIDADO: Limpar feedback
        this.map.getSource('arrow-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });

        // ✅ LIMPAR: Handles
        this.map.getSource('arrow-edit-handles').setData({
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

    // ✅ CORRIGIDO - captura objeto handle completo + tipo
    onEditMouseDown = (e) => {
        if (!this.selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['arrow-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;                        // ✅ OBJETO COMPLETO (para midpoint)
            this.activeHandleType = handle.properties.handleId; // ✅ STRING (para lógica)
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
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

            // Update final feature
            this.selectedFeature.geometry = this.generateArrowGeometry(this.selectedFeature.properties);

            this.forceUpdateMainSource(this.selectedFeature);
            this.createEditHandles(this.selectedFeature);  // ✅ Usar completo para atualizar feedback final
            this.updateSelectionAfterEdit();
            this.updateUIAfterEdit();
            this.saveFeatureChanges(this.selectedFeature);
        }

        this.isDraggingHandle = false;
        this.activeHandle = null;              // ✅ Reset objeto handle
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        if (!this.selectedFeature) return;

        let coords = this.normalizeBaseCoordinates(this.selectedFeature.properties.baseCoordinates);

        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para atualizar geometria:', coords);
            return;
        }

        coords = [...coords]; // Criar cópia

        const isAirmobile = this.selectedFeature.properties.airmobile || false;
        const debounceTime = isAirmobile ? 12 : 8; // 12ms para airmobile, 8ms para normal

        // ✅ Debounce para operações turf.js pesadas
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            if (handleId.startsWith('vertex-')) {
                // Mover vértice existente
                const index = parseInt(handleId.split('-')[1]);
                coords[index] = newPosition;
                this.selectedFeature.properties.baseCoordinates = coords;
            } else if (handleId.startsWith('midpoint-')) {
                // Adicionar novo vértice
                const insertIndex = parseInt(handleId.split('-')[1]) + 1;
                coords.splice(insertIndex, 0, newPosition);
                this.selectedFeature.properties.baseCoordinates = coords;

                // ✅ CORRIGIR: Converter handle de midpoint → vertex
                if (this.activeHandle && this.activeHandle.properties) {
                    this.activeHandle.properties.handleType = 'vertex';
                    this.activeHandle.properties.handleId = `vertex-${insertIndex}`;
                    this.activeHandleType = `vertex-${insertIndex}`;  // ✅ Sincronizar string
                }
            } else if (handleId === 'width') {
                // Handle de largura
                const lastPoint = coords[coords.length - 1];
                const secondLastPoint = coords[coords.length - 2];
                const line = turf.lineString([secondLastPoint, lastPoint]);

                let newWidth = turf.pointToLineDistance(turf.point(newPosition), line, { units: 'meters' });

                // Determinar sinal baseado no lado da linha
                const x1 = secondLastPoint[0], y1 = secondLastPoint[1];
                const x2 = lastPoint[0], y2 = lastPoint[1];
                const x = newPosition[0], y = newPosition[1];
                if ((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1) > 0) newWidth = -newWidth;

                this.selectedFeature.properties.width = newWidth;
            } else if (handleId === 'headLength') {
                // Handle de comprimento da cabeça
                const lastPoint = coords[coords.length - 1];
                const secondLastPoint = coords[coords.length - 2];
                const bearing = turf.bearing(secondLastPoint, lastPoint);

                const line = turf.lineString([lastPoint, newPosition]);
                const distance = turf.length(line, { units: 'meters' });

                const tipBearing = turf.bearing(lastPoint, newPosition);
                const angleDiff = Math.abs(bearing - tipBearing);
                const isForward = angleDiff < 90 || angleDiff > 270;

                if (isForward && distance > 100) {
                    const width = this.selectedFeature.properties.width || 500;
                    const headBaseWidth = Math.abs(width * 2.5);
                    const newHeadLengthRatio = Math.max(0.5, distance / headBaseWidth);

                    this.selectedFeature.properties.headLengthRatio = newHeadLengthRatio;
                }
            } else if (handleId === 'airmobile') {
                // Handle de posição do X aeromóvel
                const line = turf.lineString(coords);
                const lineLength = turf.length(line, { units: 'meters' });

                const snappedPoint = turf.nearestPointOnLine(line, turf.point(newPosition), { units: 'meters' });
                const newDistance = snappedPoint.properties.location;

                let newPositionNormalized = newDistance / lineLength;
                newPositionNormalized = Math.max(0.01, Math.min(0.99, newPositionNormalized));

                this.selectedFeature.properties.airmobilePosition = newPositionNormalized;
            }

            // Show preview
            const previewGeometry = this.generateArrowGeometry(this.selectedFeature.properties);
            this.showEditPreview(previewGeometry);
        }, debounceTime);
    }

    showEditPreview = (geometry) => {
        // ✅ SIMPLIFICADO: Mostrar preview da feature modificada via arrow-feedback (estilo fixo)
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}  // ✅ Sem propriedades - estilo sempre igual
        });

        // ✅ RECRIAR: Handles na nova posição (sem alterar feedback)
        this.createEditHandlesOnly(this.selectedFeature);
    }

    // ✅ NOVO: Criar apenas handles sem modificar arrow-feedback
    createEditHandlesOnly = (feature) => {
        const handles = [];
        const coords = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        if (coords.length < 2) {
            console.warn('Coordenadas insuficientes para criar handles:', coords);
            return;
        }

        // 1. Handles nos vértices da linha base (vermelho)
        coords.forEach((coord, index) => {
            const handleId = `arrow-handle-${feature.properties.id}-vertex-${index}`;

            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: `vertex-${index}`,
                    index: index,
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        // 2. Handles de ponto médio para adicionar vértices (laranja)
        for (let i = 0; i < coords.length - 1; i++) {
            const midpoint = turf.midpoint(turf.point(coords[i]), turf.point(coords[i + 1]));
            const handleId = `arrow-handle-${feature.properties.id}-midpoint-${i}`;

            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: midpoint.geometry,
                properties: {
                    role: 'handle',
                    handleType: 'midpoint',
                    handleId: `midpoint-${i}`,
                    insertIndex: i + 1,
                    featureId: feature.properties.id,
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

        const widthHandleId = `arrow-handle-${feature.properties.id}-width`;

        handles.push({
            type: 'Feature',
            id: widthHandleId,
            geometry: { type: 'Point', coordinates: widthHandlePoint.geometry.coordinates },
            properties: {
                role: 'handle',
                handleType: 'width',
                handleId: 'width',
                featureId: feature.properties.id,
                mode: 'arrow_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        });

        // 4. Handle de comprimento da cabeça (verde) - APENAS SE showArrowHead = true
        const showArrowHead = feature.properties.showArrowHead !== false;
        if (showArrowHead) {
            const headLengthRatio = feature.properties.headLengthRatio || 1.5;
            const headLength = headBaseWidth * headLengthRatio;
            const headTipPoint = turf.destination(lastPoint, headLength, bearing, { units: 'meters' });

            const headLengthHandleId = `arrow-handle-${feature.properties.id}-headlength`;

            handles.push({
                type: 'Feature',
                id: headLengthHandleId,
                geometry: { type: 'Point', coordinates: headTipPoint.geometry.coordinates },
                properties: {
                    role: 'handle',
                    handleType: 'headLength',
                    handleId: 'headLength',
                    featureId: feature.properties.id,
                    mode: 'arrow_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        }

        // 5. Handle de posição do X aeromóvel (roxo)
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

                const airmobileHandleId = `arrow-handle-${feature.properties.id}-airmobile`;

                const handleFeature = {
                    type: 'Feature',
                    id: airmobileHandleId,
                    geometry: { type: 'Point', coordinates: handleCoord },
                    properties: {
                        role: 'handle',
                        handleType: 'airmobile',
                        handleId: 'airmobile',
                        featureId: feature.properties.id,
                        mode: 'arrow_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                };

                handles.push(handleFeature);
            }
        }

        // ✅ APENAS HANDLES: Não incluir feature destacada
        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    // ===== EVENT LISTENER MANAGEMENT =====

    setupBaseEventListeners = () => {
        this.map.on('dblclick', this.handleDoubleClick);
    }

    removeAllEventListeners = () => {
        this.map.off('dblclick', this.handleDoubleClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }

    // ===== UTILITY METHODS =====

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

    forceUpdateMainSource = (feature) => {
        if (!feature || !this.map) {
            console.warn('forceUpdateMainSource: feature ou map inválido');
            return;
        }

        const source = this.map.getSource('arrows');
        if (!source) {
            console.warn('forceUpdateMainSource: source arrows não encontrado');
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
            await updateFeature('arrows', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações da seta:', error);
        }
    }

    // ===== SELECTION SYSTEM INTERFACE METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));

        for (const feature of features) {
            feature.properties.id = feature.properties.id;

            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
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
                if (['width', 'headLengthRatio', 'showArrowHead', 'airmobile', 'airmobilePosition', 'baseCoordinates'].includes(property)) {
                    const newGeometry = this.generateArrowGeometry(sourceFeature.properties);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('arrows').setData(data);

        // Atualizar handles se em modo editing
        if (this.selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
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
        const currentData = this.map.getSource('arrows')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('arrows', featureToSave);
                }
            }
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        const currentHeadRatio = feature.properties.headLengthRatio || 1.5;
        const initialHeadRatio = initialProperties.headLengthRatio || 1.5;

        const currentShowHead = feature.properties.showArrowHead !== false;
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
            currentShowHead !== initialShowHead ||
            currentAirmobile !== initialAirmobile ||
            currentAirmobilePosition !== initialAirmobilePosition ||
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
                const featureId = feature.properties.id;
                await removeFeature('arrows', featureId);
            } catch (error) {
                console.error(`Error removing arrow ${featureId}:`, error);
            }
        }

        // Remove from map source (visual)
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
        const idsToDelete = new Set(features.map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
        this.map.getSource('arrows').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddArrowControl.DEFAULT_PROPERTIES, properties);
    }
}

export default AddArrowControl;