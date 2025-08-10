// Path: js\controls_sig\circle_tool\add_circle_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddCircleControl {
    static DEFAULT_PROPERTIES = {
        lineColor: '#000000',
        fillColor: '#ffffff', 
        opacity: 0.7,
        lineWidth: 2,
        radius: 1000, // metros
        source: 'circle',
        geometryType: 'circle'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.circleControl = this;
        this.selectionManager = null;
        this.isActive = false;
        
        // Estado de desenho
        this.drawingMode = null;
        this.drawPoints = [];
        
        // Sistema de preview durante desenho
        this.previewCircle = null;
        
        // Sistema de edição customizada (análogo ao draw)
        this.selectedFeature = null;
        this.editMode = false;
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
    }

    // ✅ PADRONIZADO: Método obrigatório para integração
    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl circle-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "circle-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_circle_black.svg" alt="CIRCLE" />';
        button.title = 'Adicionar círculo';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    // ✅ PADRONIZADO: Usando jQuery como as demais ferramentas
    changeButtonColor = () => {
        $("#circle-tool").html(`<img class="icon-sig-tool" src="./images/icon_circle_black.svg" alt="CIRCLE" />`);
        if (!this.isActive) return;
        $("#circle-tool").html('<img class="icon-sig-tool" src="./images/icon_circle_red.svg" alt="CIRCLE" />');
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-layer', this.handleMouseLeave);
        // Limpar listeners de preview e edição
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
    }

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'circle';
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
        this.clearPreview();
        this.exitEditMode();
    }

    // ✅ PADRONIZADO: HandleMapClick seguindo padrão das outras ferramentas
    handleMapClick = (e) => {
        if (this.drawingMode === 'circle') {
            // Validação de coordenadas
            if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
                console.warn('Coordenadas inválidas para círculo');
                return;
            }

            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                // Primeiro clique - centro definido, ativar preview
                console.log('Centro do círculo definido');
                this.map.on('mousemove', this.handlePreviewMouseMove);
            } else if (this.drawPoints.length === 2) {
                // Segundo clique - raio definido
                this.clearPreview();
                this.createFeature();
                this.toolManager.deactivateCurrentTool();
            }
        }
    }

    // ✅ NOVO: Sistema de preview durante desenho (como LOS/Visibility)
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            const center = this.drawPoints[0];
            const currentPoint = [e.lngLat.lng, e.lngLat.lat];
            const radius = this.calculateDistance(center, currentPoint);
            
            // Validação de raio mínimo durante preview
            if (radius >= 10) {
                const previewGeometry = this.generateCircleGeometry(center, radius);
                this.showPreview(previewGeometry);
            }
        }
    }

    showPreview = (geometry) => {
        if (this.map.getSource('circle-preview')) {
            this.map.getSource('circle-preview').setData({
                type: 'Feature',
                geometry: geometry,
                properties: { 
                    preview: true,
                    lineColor: AddCircleControl.DEFAULT_PROPERTIES.lineColor,
                    fillColor: AddCircleControl.DEFAULT_PROPERTIES.fillColor,
                    opacity: 0.5
                }
            });
        }
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        if (this.map.getSource('circle-preview')) {
            this.map.getSource('circle-preview').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const radiusPoint = this.drawPoints[1];
        const radius = this.calculateDistance(center, radiusPoint);

        // Validação de raio mínimo
        if (radius < 10) {
            console.warn('Raio muito pequeno. Mínimo: 10 metros');
            return;
        }

        const circlePolygon = this.generateCircleGeometry(center, radius);
        
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            geometry: circlePolygon,
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                center: center,
                radius: radius
            }
        };

        try {
            // Salvar no IndexedDB
            await addFeature('circles', feature);
            this.updateMapSource();

            // ✅ PADRONIZADO: Seleção automática após criação
            if (this.selectionManager) {
                this.selectionManager.toggleFeatureSelection('circle', feature.id, feature);
                this.selectionManager.updateUI();
            }
        } catch (error) {
            console.error('Erro ao criar círculo:', error);
        }
    }

    calculateDistance = (coord1, coord2) => {
        const R = 6371000; // Raio da Terra em metros
        const lat1 = coord1[1] * Math.PI / 180;
        const lat2 = coord2[1] * Math.PI / 180;
        const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
        const deltaLng = (coord2[0] - coord1[0]) * Math.PI / 180;

        const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    generateCircleGeometry = (center, radius) => {
        const points = 64;
        const coordinates = [[]];
        const radiusInDegrees = radius / 111320;

        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            const lng = center[0] + (radiusInDegrees * Math.cos(angle)) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (radiusInDegrees * Math.sin(angle));
            coordinates[0].push([lng, lat]);
        }

        return {
            type: 'Polygon',
            coordinates: coordinates
        };
    }

    // ===== SISTEMA DE EDIÇÃO CUSTOMIZADA (Análogo ao Draw) =====

    enterEditMode = (feature) => {
        this.selectedFeature = feature;
        this.editMode = true;
        this.createEditHandles(feature);
        this.setupEditEventListeners();
    }

    exitEditMode = () => {
        this.selectedFeature = null;
        this.editMode = false;
        this.clearEditHandles();
        this.removeEditEventListeners();
    }

    createEditHandles = (feature) => {
        const handles = [];
        const center = feature.properties.center;
        const radius = feature.properties.radius;

        // Converter raio de metros para graus aproximadamente
        const radiusInDegrees = radius / 111320;
        
        // Handle do centro (azul)
        handles.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: center
            },
            properties: {
                role: 'handle',
                handleType: 'center',
                handleId: 'center',
                featureId: feature.id
            }
        });
        
        // Handle do raio (vermelho) - 4 pontos cardinais
        const cardinalDirections = [0, 90, 180, 270]; // Norte, Leste, Sul, Oeste
        cardinalDirections.forEach((bearing, index) => {
            const angle = bearing * Math.PI / 180;
            const handlePoint = [
                center[0] + (radiusInDegrees * Math.cos(angle)) / Math.cos(center[1] * Math.PI / 180),
                center[1] + (radiusInDegrees * Math.sin(angle))
            ];
            
            handles.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: handlePoint
                },
                properties: {
                    role: 'handle',
                    handleType: 'radius',
                    handleId: `radius-${index}`,
                    featureId: feature.id
                }
            });
        });

        // Incluir o círculo selecionado destacado
        const highlightedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature'
            }
        };
        handles.push(highlightedFeature);

        // Atualizar source
        if (this.map.getSource('circle-edit-handles')) {
            this.map.getSource('circle-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }
    }

    clearEditHandles = () => {
        if (this.map.getSource('circle-edit-handles')) {
            this.map.getSource('circle-edit-handles').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
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
        if (!this.editMode) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['circle-edit-handles-layer']
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
        const handleType = this.activeHandle.properties.handleType;

        this.updateGeometryFromHandle(handleType, currentPosition);
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

    updateGeometryFromHandle = (handleType, newPosition) => {
        const feature = this.selectedFeature;
        const center = feature.properties.center;

        if (handleType === 'center') {
            // Mover centro do círculo
            feature.properties.center = newPosition;
            feature.geometry = this.generateCircleGeometry(newPosition, feature.properties.radius);
        } else if (handleType === 'radius') {
            // Atualizar raio
            const newRadius = this.calculateDistance(center, newPosition);
            
            if (newRadius > 10) { // Raio mínimo de 10 metros
                feature.properties.radius = newRadius;
                feature.geometry = this.generateCircleGeometry(center, newRadius);
            }
        }

        // Atualizar visualização
        this.updateFeatureVisualization(feature);
        this.createEditHandles(feature); // Recriar handles nas novas posições
    }

    updateFeatureVisualization = (feature) => {
        // Força atualização do mapa
        this.updateMapSource();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('circles', feature);
            this.updateMapSource();
        } catch (error) {
            console.error('Erro ao salvar alterações do círculo:', error);
        }
    }

    // ===== MÉTODOS DE MOUSE INTERACTION =====

    handleMouseEnter = () => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = () => {
        this.map.getCanvas().style.cursor = '';
    }

    // ===== MÉTODOS OBRIGATÓRIOS PARA O SISTEMA DE SELEÇÃO =====

    updateFeaturesProperty = async (features, property, value) => {
        for (const feature of features) {
            feature.properties[property] = value;
            
            // Se alterar raio ou centro, recalcular geometria
            if (property === 'radius' || property === 'center') {
                feature.geometry = this.generateCircleGeometry(
                    feature.properties.center, 
                    feature.properties.radius
                );
            }
            
            await updateFeature('circles', feature);
        }
        this.updateMapSource();
    }

    // ✅ PADRONIZADO: Método updateFeatures seguindo padrão das outras ferramentas
    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        // Atualizar apenas propriedades
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        // Atualizar feature completa
                        data.features[featureIndex] = feature;
                    }
                    
                    if (save) {
                        await updateFeature('circles', data.features[featureIndex]);
                    }
                }
            }
            this.map.getSource('circles').setData(data);
        }
    }

    // ✅ PADRONIZADO: Método saveFeatures seguindo padrão das outras ferramentas
    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('circles', f);
            }
        }
        console.log('Circle features saved:', features.length);
    }

    // ✅ PADRONIZADO: Método hasFeatureChanged seguindo padrão das outras ferramentas
    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        
        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.radius !== initialProperties.radius ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                
                // Recalcular geometria após restaurar propriedades
                feature.geometry = this.generateCircleGeometry(
                    feature.properties.center, 
                    feature.properties.radius
                );
                
                await updateFeature('circles', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        for (const feature of features) {
            await removeFeature('circles', feature.id);
        }
        this.updateMapSource();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddCircleControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('circles')) {
            // Força atualização do source
            const currentData = this.map.getSource('circles')._data;
            this.map.getSource('circles').setData(currentData);
        }
    }

    // ✅ PADRONIZADO: onRemove com try/catch como as demais ferramentas
    onRemove = () => {
        try {
            if (this.uiManager) {
                this.uiManager.removeControl(this.container);
            }
            this.deactivate();
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddCircleControl:', error);
            throw error;
        }
    }

    // ===== INTEGRAÇÃO COM SISTEMA DE SELEÇÃO =====

    // Método chamado quando feature é selecionada via SelectionManager
    onFeatureSelected = (feature) => {
        this.enterEditMode(feature);
    }

    // Método chamado quando feature é desselecionada via SelectionManager
    onFeatureDeselected = (feature) => {
        this.exitEditMode();
    }
}

export default AddCircleControl;