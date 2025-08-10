// Path: js\controls_sig\ellipse_tool\add_ellipse_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddEllipseControl {
    static DEFAULT_PROPERTIES = {
        lineColor: '#000000',
        fillColor: '#ffffff',
        opacity: 0.7,
        lineWidth: 2,
        majorRadius: 1500, // metros
        minorRadius: 800,  // metros
        bearing: 0,        // orientação em graus
        source: 'ellipse',
        geometryType: 'ellipse'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.ellipseControl = this;
        this.selectionManager = null; // ✅ PADRONIZADO
        this.isActive = false;
        
        // Estado de desenho
        this.drawingMode = null;
        this.drawPoints = [];
        
        // Sistema de preview durante desenho ✅ NOVO
        this.previewEllipse = null;
        
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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl ellipse-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "ellipse-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_ellipse_black.svg" alt="ELLIPSE" />';
        button.title = 'Adicionar elipse';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    // ✅ PADRONIZADO: Usando jQuery como as demais ferramentas
    changeButtonColor = () => {
        $("#ellipse-tool").html(`<img class="icon-sig-tool" src="./images/icon_ellipse_black.svg" alt="ELLIPSE" />`);
        if (!this.isActive) return;
        $("#ellipse-tool").html('<img class="icon-sig-tool" src="./images/icon_ellipse_red.svg" alt="ELLIPSE" />');
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'ellipse-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'ellipse-layer', this.handleMouseLeave);
        // ✅ NOVO: Limpar listeners de preview e edição
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
    }

    activate = () => {
        this.isActive = true;
        this.drawingMode = 'ellipse';
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
        this.clearPreview(); // ✅ NOVO
        this.exitEditMode();
    }

    // ✅ PADRONIZADO: HandleMapClick seguindo padrão das outras ferramentas
    handleMapClick = (e) => {
        if (this.drawingMode === 'ellipse') {
            // Validação de coordenadas
            if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
                console.warn('Coordenadas inválidas para elipse');
                return;
            }

            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                // Primeiro clique - centro definido, ativar preview
                console.log('Centro da elipse definido');
                this.map.on('mousemove', this.handlePreviewMouseMove);
            } else if (this.drawPoints.length === 2) {
                // Segundo clique - eixo maior e orientação definidos
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
            const majorRadius = this.calculateDistance(center, currentPoint);
            const bearing = this.calculateBearing(center, currentPoint);
            
            // Validação de raio mínimo durante preview
            if (majorRadius >= 10) {
                const minorRadius = majorRadius * 0.6; // 60% do eixo maior
                const previewGeometry = this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);
                this.showPreview(previewGeometry);
            }
        }
    }

    showPreview = (geometry) => {
        if (this.map.getSource('ellipse-preview')) {
            this.map.getSource('ellipse-preview').setData({
                type: 'Feature',
                geometry: geometry,
                properties: { 
                    preview: true,
                    lineColor: AddEllipseControl.DEFAULT_PROPERTIES.lineColor,
                    fillColor: AddEllipseControl.DEFAULT_PROPERTIES.fillColor,
                    opacity: 0.5
                }
            });
        }
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        if (this.map.getSource('ellipse-preview')) {
            this.map.getSource('ellipse-preview').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const majorAxisEnd = this.drawPoints[1];
        const majorRadius = this.calculateDistance(center, majorAxisEnd);
        const bearing = this.calculateBearing(center, majorAxisEnd);

        // Validação de raio mínimo
        if (majorRadius < 10) {
            console.warn('Raio muito pequeno. Mínimo: 10 metros');
            return;
        }

        const minorRadius = majorRadius * 0.6; // Eixo menor inicial (60% do maior)
        const ellipsePolygon = this.generateEllipseGeometry(center, majorRadius, minorRadius, bearing);
        
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            geometry: ellipsePolygon,
            properties: {
                ...AddEllipseControl.DEFAULT_PROPERTIES,
                center: center,
                majorRadius: majorRadius,
                minorRadius: minorRadius,
                bearing: bearing
            }
        };

        try {
            // Salvar no IndexedDB
            await addFeature('ellipses', feature);
            this.updateMapSource();

            // ✅ PADRONIZADO: Seleção automática após criação
            if (this.selectionManager) {
                this.selectionManager.toggleFeatureSelection('ellipse', feature.id, feature);
                this.selectionManager.updateUI();
            }
        } catch (error) {
            console.error('Erro ao criar elipse:', error);
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

    calculateBearing = (point1, point2) => {
        const lat1 = point1[1] * Math.PI / 180;
        const lat2 = point2[1] * Math.PI / 180;
        const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        const bearing = Math.atan2(y, x) * (180 / Math.PI);
        return (bearing + 360) % 360;
    }

    generateEllipseGeometry = (center, majorRadius, minorRadius, bearing) => {
        const points = 64;
        const coordinates = [[]];
        const bearingRad = bearing * Math.PI / 180;
        
        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            
            // Coordenadas da elipse no sistema local
            const localX = majorRadius * Math.cos(angle);
            const localY = minorRadius * Math.sin(angle);
            
            // Rotacionar segundo o bearing
            const rotatedX = localX * Math.cos(bearingRad) - localY * Math.sin(bearingRad);
            const rotatedY = localX * Math.sin(bearingRad) + localY * Math.cos(bearingRad);
            
            // Converter para coordenadas geográficas
            const lng = center[0] + (rotatedX / 111320) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (rotatedY / 111320);
            
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
        const majorRadius = feature.properties.majorRadius;
        const minorRadius = feature.properties.minorRadius;
        const bearing = feature.properties.bearing;

        const bearingRad = bearing * Math.PI / 180;

        // Handle do centro (verde)
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

        // Handle do eixo maior (vermelho)
        const majorRadiusInDegrees = majorRadius / (111320 * Math.cos(center[1] * Math.PI / 180));
        const majorAxisEnd = [
            center[0] + majorRadiusInDegrees * Math.cos(bearingRad),
            center[1] + (majorRadius / 111320) * Math.sin(bearingRad)
        ];
        
        handles.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: majorAxisEnd
            },
            properties: {
                role: 'handle',
                handleType: 'major-axis',
                handleId: 'major-axis',
                featureId: feature.id
            }
        });

        // Handle do eixo menor (azul)
        const perpendicularBearing = (bearing + 90) % 360;
        const perpendicularBearingRad = perpendicularBearing * (Math.PI / 180);
        const minorRadiusInDegrees = minorRadius / (111320 * Math.cos(center[1] * Math.PI / 180));
        const minorAxisEnd = [
            center[0] + minorRadiusInDegrees * Math.cos(perpendicularBearingRad),
            center[1] + (minorRadius / 111320) * Math.sin(perpendicularBearingRad)
        ];
        
        handles.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: minorAxisEnd
            },
            properties: {
                role: 'handle',
                handleType: 'minor-axis',
                handleId: 'minor-axis',
                featureId: feature.id
            }
        });

        // Incluir a elipse selecionada destacada
        const highlightedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature'
            }
        };
        handles.push(highlightedFeature);

        // Atualizar source
        if (this.map.getSource('ellipse-edit-handles')) {
            this.map.getSource('ellipse-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }
    }

    clearEditHandles = () => {
        if (this.map.getSource('ellipse-edit-handles')) {
            this.map.getSource('ellipse-edit-handles').setData({
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
            layers: ['ellipse-edit-handles-layer']
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
            // Mover centro da elipse
            feature.properties.center = newPosition;
            feature.geometry = this.generateEllipseGeometry(
                newPosition, 
                feature.properties.majorRadius,
                feature.properties.minorRadius,
                feature.properties.bearing
            );
        } else if (handleType === 'major-axis') {
            // Atualizar eixo maior e rotação
            const newMajorRadius = this.calculateDistance(center, newPosition);
            const newBearing = this.calculateBearing(center, newPosition);
            
            if (newMajorRadius > 10) { // Raio mínimo de 10 metros
                feature.properties.majorRadius = newMajorRadius;
                feature.properties.bearing = newBearing;
                feature.geometry = this.generateEllipseGeometry(
                    center, 
                    newMajorRadius,
                    feature.properties.minorRadius,
                    newBearing
                );
            }
        } else if (handleType === 'minor-axis') {
            // Atualizar eixo menor
            const newMinorRadius = this.calculateDistance(center, newPosition);
            
            if (newMinorRadius > 10 && newMinorRadius <= feature.properties.majorRadius) {
                feature.properties.minorRadius = newMinorRadius;
                feature.geometry = this.generateEllipseGeometry(
                    center, 
                    feature.properties.majorRadius,
                    newMinorRadius,
                    feature.properties.bearing
                );
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
            await updateFeature('ellipses', feature);
            this.updateMapSource();
        } catch (error) {
            console.error('Erro ao salvar alterações da elipse:', error);
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
            
            // Se alterar dimensões ou orientação, recalcular geometria
            if (['majorRadius', 'minorRadius', 'bearing', 'center'].includes(property)) {
                feature.geometry = this.generateEllipseGeometry(
                    feature.properties.center,
                    feature.properties.majorRadius,
                    feature.properties.minorRadius,
                    feature.properties.bearing
                );
            }
            
            await updateFeature('ellipses', feature);
        }
        this.updateMapSource();
    }

    // ✅ PADRONIZADO: Método updateFeatures seguindo padrão das outras ferramentas
    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('ellipses')._data));
            
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
                        await updateFeature('ellipses', data.features[featureIndex]);
                    }
                }
            }
            this.map.getSource('ellipses').setData(data);
        }
    }

    // ✅ PADRONIZADO: Método saveFeatures seguindo padrão das outras ferramentas
    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('ellipses', f);
            }
        }
        console.log('Ellipse features saved:', features.length);
    }

    // ✅ PADRONIZADO: Método hasFeatureChanged seguindo padrão das outras ferramentas
    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        
        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.majorRadius !== initialProperties.majorRadius ||
            feature.properties.minorRadius !== initialProperties.minorRadius ||
            feature.properties.bearing !== initialProperties.bearing ||
            JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
        );
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                
                // Recalcular geometria após restaurar propriedades
                feature.geometry = this.generateEllipseGeometry(
                    feature.properties.center,
                    feature.properties.majorRadius,
                    feature.properties.minorRadius,
                    feature.properties.bearing
                );
                
                await updateFeature('ellipses', feature);
            }
        }
        this.updateMapSource();
    }

    deleteFeatures = async (features) => {
        for (const feature of features) {
            await removeFeature('ellipses', feature.id);
        }
        this.updateMapSource();
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddEllipseControl.DEFAULT_PROPERTIES, properties);
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('ellipses')) {
            // Força atualização do source
            const currentData = this.map.getSource('ellipses')._data;
            this.map.getSource('ellipses').setData(currentData);
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
            console.error('Error removing AddEllipseControl:', error);
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

export default AddEllipseControl;