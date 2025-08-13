// js/controls_sig/arrow_tool/add_arrow_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddArrowControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        
        // ✅ SISTEMA DE 3 ESTADOS (CRÍTICO)
        // 1. deselected: Estado padrão, sem interação especial
        // 2. selected: Feature pode ser movida via MoveHandler
        // 3. editing: Edição baseada em handles, drag da feature desabilitado
        this.currentState = 'deselected';
        this.selectedFeature = null;
        
        // ✅ Drawing state
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // ✅ Edit mode variables (para ferramentas geométricas)
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.previewFeature = null;
        this.editHandleIds = new Set(); // Tracking de handles ativos
    }

    static DEFAULT_PROPERTIES = {
        width: 1000,                // Largura do corpo em metros
        color: '#3f4fb5',          // Cor da seta
        fillColor: '#3f4fb5',      // Cor do preenchimento
        lineWidth: 3,              // Largura da linha
        fillOpacity: 0.8,          // Opacidade do preenchimento
        lineOpacity: 1.0,          // Opacidade da linha
        source: 'arrow',           // ✅ CRÍTICO: usado pelo sistema de seleção
        geometryType: 'arrow',     // Tipo de geometria
        baseCoordinates: []        // Coordenadas da linha de controle
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

    // ✅ OBRIGATÓRIO: Padrão visual consistente
    updateButtonAppearance = () => {
        const iconSrc = this.isActive ? 
            './images/icon_arrow_red.svg' : 
            './images/icon_arrow_black.svg';
            
        $(`#arrow-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="ARROW" />`);
    }

    // ===== SISTEMA DE 3 ESTADOS (BASEADO NO CIRCLE) =====
    
    transitionToState = (newState, feature = null) => {
        const oldState = this.currentState;
        
        if (oldState === newState) return;
        
        // Limpeza do estado anterior
        if (oldState === 'editing') {
            this.clearEditHandles();
            this.removeEditEventListeners();
        }
        
        // Configuração do novo estado
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
            // Mesma feature selecionada novamente: SELECTED → EDITING
            this.transitionToState('editing', feature);
        } else {
            // Nova feature ou primeira seleção: → SELECTED
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

    // ✅ Interface para integração com move_handler
    isEditingMode = () => {
        return this.currentState === 'editing';
    }
    
    hasEditHandle = (featureId) => {
        return this.editHandleIds.has(featureId);
    }

    // ===== SISTEMA DE DESENHO MULTI-CLIQUE =====

    handleMapClick = (e) => {
        if (!this.isActive) return;
        
        // ✅ OBRIGATÓRIO: Validação de entrada
        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para seta');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
        
        if (this.drawPoints.length === 1) {
            // Primeiro ponto - iniciar preview
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }
        // Continua adicionando pontos até duplo clique
    }

    // ✅ Duplo clique para finalizar (baseado no protótipo)
    handleDoubleClick = (e) => {
        if (!this.isActive) return;
        
        // Remove último ponto duplicado
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

    // ✅ Sistema de preview em tempo real
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            const previewPoints = [...this.drawPoints, [e.lngLat.lng, e.lngLat.lat]];
            
            if (previewPoints.length >= 2) {
                const previewGeometry = this.generateArrowGeometry({
                    baseCoordinates: previewPoints,
                    width: AddArrowControl.DEFAULT_PROPERTIES.width
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
                fillOpacity: 0.5,
                lineOpacity: 0.7
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
                id: featureId
            },
            geometry: this.generateArrowGeometry({
                baseCoordinates: this.drawPoints,
                width: AddArrowControl.DEFAULT_PROPERTIES.width
            })
        };

        try {
            // ✅ OBRIGATÓRIO: Salvar no IndexedDB
            await addFeature('arrows', feature);
            
            // Atualizar source do mapa
            const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
            data.features.push(feature);
            this.map.getSource('arrows').setData(data);
            
            this.drawPoints = [];
            this.toolManager.setActiveTool(null);

            // ✅ Seleção automática após criação
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

    // ===== GERAÇÃO DA GEOMETRIA DA SETA (BASEADO NO PROTÓTIPO) =====

    generateArrowGeometry = (properties) => {
        const coords = properties.baseCoordinates;
        const width = properties.width || 1000;
        
        if (!coords || coords.length < 2) return null;

        const absHalfBodyWidth = Math.abs(width / 2);
        
        try {
            // 1. Criar linha base
            const mainLine = turf.lineString(coords);
            
            // 2. Criar corpo da seta (linhas paralelas)
            const leftLine = turf.lineOffset(mainLine, absHalfBodyWidth, { units: 'meters' });
            const rightLine = turf.lineOffset(mainLine, -absHalfBodyWidth, { units: 'meters' });

            // 3. Criar cabeça da seta
            const lastPoint = coords[coords.length - 1];
            const secondLastPoint = coords[coords.length - 2];
            const bearing = turf.bearing(secondLastPoint, lastPoint);

            // Proporções da cabeça (baseado no protótipo)
            const absHeadBaseWidth = Math.abs(width * 2.5);
            const headLength = absHeadBaseWidth * 1.5;

            // Pontos da cabeça
            const headCornerLeft = turf.destination(
                lastPoint, 
                absHeadBaseWidth / 2, 
                bearing - 90, 
                { units: 'meters' }
            );
            const headCornerRight = turf.destination(
                lastPoint, 
                absHeadBaseWidth / 2, 
                bearing + 90, 
                { units: 'meters' }
            );
            const headTip = turf.destination(
                lastPoint, 
                headLength, 
                bearing, 
                { units: 'meters' }
            );

            // 4. Criar polígono para preenchimento
            const bodyEndLeft = leftLine.geometry.coordinates[leftLine.geometry.coordinates.length - 1];
            const bodyEndRight = rightLine.geometry.coordinates[rightLine.geometry.coordinates.length - 1];
            
            // Criar coordenadas do polígono da seta
            const arrowPolygonCoords = [];
            
            // Lado esquerdo (do início ao fim)
            arrowPolygonCoords.push(...leftLine.geometry.coordinates);
            
            // Conexão com a cabeça (lado esquerdo)
            arrowPolygonCoords.push(headCornerLeft.geometry.coordinates);
            
            // Ponta da seta
            arrowPolygonCoords.push(headTip.geometry.coordinates);
            
            // Conexão com a cabeça (lado direito)
            arrowPolygonCoords.push(headCornerRight.geometry.coordinates);
            
            // Lado direito (do fim ao início - reverso)
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
            // Fallback para linha simples
            return {
                type: 'LineString',
                coordinates: coords
            };
        }
    }

    // ===== SISTEMA DE EDIÇÃO CUSTOMIZADA =====

    createEditHandles = (feature) => {
        const handles = [];
        const coords = feature.properties.baseCoordinates;

        if (!coords || coords.length < 2) return;

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

        // 3. Feature destacada para modo editing
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

    // Detectar clique nos handles
    onEditMouseDown = (e) => {
        if (!this.isEditingMode()) return;

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
            e.preventDefault();
        }
    }

    // Arrastar handles
    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;

        const currentPosition = [e.lngLat.lng, e.lngLat.lat];
        const handleId = this.activeHandle.properties.handleId;

        // Atualizar geometria baseada no handle arrastado
        this.updateGeometryFromHandle(handleId, currentPosition);
    }

    // Finalizar drag
    onEditMouseUp = () => {
        if (this.isDraggingHandle) {
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';

            // Salvar alterações
            if (this.selectedFeature) {
                this.saveFeatureChanges(this.selectedFeature);
            }
        }
    }

    updateGeometryFromHandle = (handleId, newPosition) => {
        const feature = this.selectedFeature;
        const coords = [...feature.properties.baseCoordinates];

        if (handleId.startsWith('vertex-')) {
            // Mover vértice existente
            const index = parseInt(handleId.split('-')[1]);
            coords[index] = newPosition;
        } else if (handleId.startsWith('midpoint-')) {
            // Adicionar novo vértice
            const insertIndex = parseInt(handleId.split('-')[1]) + 1;
            coords.splice(insertIndex, 0, newPosition);
            // Converter para vertex handle
            this.activeHandle.properties.handleType = 'vertex';
            this.activeHandle.properties.handleId = `vertex-${insertIndex}`;
        }

        // Atualizar coordenadas base
        feature.properties.baseCoordinates = coords;
        
        // Recalcular geometria da seta
        feature.geometry = this.generateArrowGeometry(feature.properties);
        
        // Atualizar visualização em tempo real
        this.forceUpdateMainSource(feature);
        this.createEditHandles(feature); // Recriar handles nas novas posições
    }

    forceUpdateMainSource = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('arrows').setData(data);
        }
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
                
                // ✅ Se alterar propriedades geométricas, recalcular geometria
                if (['width'].includes(property)) {
                    feature.properties[property] = value;
                    sourceFeature.geometry = this.generateArrowGeometry(feature.properties);
                }
            }
        }
        
        this.map.getSource('arrows').setData(data);
    }

    // ✅ OBRIGATÓRIO: Método updateFeatures padronizado
    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('arrows')._data));
            
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
                    
                    if (save) {
                        await updateFeature('arrows', data.features[featureIndex]);
                    }
                }
            }
            
            this.map.getSource('arrows').setData(data);
        }
    }

    // ✅ OBRIGATÓRIO: Método saveFeatures com verificação de mudanças
    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('arrows', f);
            }
        }
        console.log('Arrow features saved:', features.length);
    }

    // ✅ OBRIGATÓRIO: Método hasFeatureChanged para otimização
    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        
        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.fillOpacity !== initialProperties.fillOpacity ||
            feature.properties.lineOpacity !== initialProperties.lineOpacity ||
            feature.properties.width !== initialProperties.width ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                // Recalcular geometria com propriedades originais
                feature.geometry = this.generateArrowGeometry(feature.properties);
                await updateFeature('arrows', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        for (const feature of features) {
            await removeFeature('arrows', feature.id);
        }
        this.updateMapSource();
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
    
    setCursorStyle = (style) => {
        this.map.getCanvas().style.cursor = style;
    }

    // ✅ OBRIGATÓRIO: onRemove com try/catch padronizado
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