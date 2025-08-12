// Path: js\controls_sig\circle_tool\add_circle_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddCircleControl {
    constructor(toolManager) {
        this.map = toolManager.map;
        this.toolManager = toolManager;
        this.uiManager = toolManager.uiManager;
        this.selectionManager = toolManager.selectionManager;
        
        this.isActive = false;
        this.drawingMode = null;
        this.drawPoints = [];
        
        // ===== SISTEMA DE 3 ESTADOS =====
        this.selectedMode = false;    // Estado 2: Selecionado (drag habilitado)
        this.editMode = false;        // Estado 3: Edição (handles de raio)
        this.selectedFeature = null;
        
        // Edição de handles
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        
        // Drag da feature completa
        this.isDraggingFeature = false;
        this.initialFeaturePosition = null;
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'circle'
    };

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl circle-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "circle-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_circle_black.svg" alt="CIRCLE" />';
        button.title = 'Adicionar círculo (C)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#circle-tool").html(`<img class="icon-sig-tool" src="./images/icon_circle_black.svg" alt="CIRCLE" />`);
        if (!this.isActive) return;
        $("#circle-tool").html('<img class="icon-sig-tool" src="./images/icon_circle_red.svg" alt="CIRCLE" />');
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-layer', this.handleMouseLeave);
        this.map.on('mouseenter', 'circle-fill-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-fill-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-layer', this.handleMouseLeave);
        this.map.off('mouseenter', 'circle-fill-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-fill-layer', this.handleMouseLeave);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeSelectedEventListeners();
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
        this.exitAllModes();
        
        // ✅ LIMPEZA EXTRA DE SEGURANÇA
        this.isDraggingFeature = false;
        this.isDraggingHandle = false;
        this.initialFeaturePosition = null;
        this.initialHandlePosition = null;
        this.activeHandle = null;
        this.map.dragPan.enable();
    }

    // ===== SISTEMA DE DESENHO =====

    handleMapClick = (e) => {
        if (this.isActive) {
            if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
                console.warn('Coordenadas inválidas para círculo');
                return;
            }

            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                this.map.on('mousemove', this.handlePreviewMouseMove);
            } else if (this.drawPoints.length === 2) {
                this.map.off('mousemove', this.handlePreviewMouseMove);
                this.createFeature();
                this.toolManager.deactivateCurrentTool();
            }
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            const center = this.drawPoints[0];
            const currentPoint = [e.lngLat.lng, e.lngLat.lat];
            const radius = this.calculateDistance(center, currentPoint);
            
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
        const endPoint = this.drawPoints[1];
        const radius = this.calculateDistance(center, endPoint);

        if (radius < 10) {
            alert('Raio mínimo: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = Date.now().toString();
        const feature = {
            type: 'Feature',
            id: featureId,
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                center: center,
                radius: radius,
                id: featureId
            },
            geometry: this.generateCircleGeometry(center, radius)
        };

        try {
            await addFeature('circles', feature);
            
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            data.features.push(feature);
            this.map.getSource('circles').setData(data);
            
            this.drawPoints = [];
            
            this.toolManager.setActiveTool(null);
        } catch (error) {
            console.error('Erro ao criar círculo:', error);
        }
    }

    // ===== SISTEMA DE 3 ESTADOS =====

    // Estado 1 → Estado 2: Primeiro clique seleciona
    onFeatureSelected = (feature) => {
        const featureId = feature.id || feature.properties.id;
        
        if (this.selectedFeature && this.selectedFeature.id === featureId) {
            this.enterEditMode(feature);
            return;
        }
        
        this.enterSelectedMode(feature);
    }

    // Estado 2 → Estado 1: Desseleção
    onFeatureDeselected = (feature) => {
        feature.id = feature.id || feature.properties.id;
        
        // ✅ PREVENIR LOOP - só processar se for a feature atual
        if (!this.selectedFeature || this.selectedFeature.id !== feature.id) {
            return; // Não é a feature atual, ignorar
        }
        
        this.exitAllModes();
    }

    // Estado 2 → Estado 3: Segundo clique entra em edição (chamado via SelectionManager)
    enterEditMode = (feature) => {
        console.log('edit mode-8=')
        feature.id = feature.id || feature.properties.id;
        
        // ✅ VERIFICAR SE JÁ ESTÁ EM MODO DE EDIÇÃO DA MESMA FEATURE
        if (this.editMode && this.selectedFeature && this.selectedFeature.id === feature.id) {
            return; // Já em edição desta feature
        }
        
        if (!this.selectedMode || !this.selectedFeature || this.selectedFeature.id !== feature.id) {
            // Se não estava selecionado, seleciona primeiro
            this.enterSelectedMode(feature);
        }
        
        // Transição: Selected → Edit
        this.exitSelectedMode();
        
        this.selectedFeature = feature;
        this.editMode = true;
        
        // ✅ RESETAR VARIÁVEIS DE DRAG DE HANDLES
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        
        console.log(`Círculo ${feature.id} entrou em modo de edição`);
    }

    // Estado 2: Selecionado (drag habilitado, sem handles)
    enterSelectedMode = (feature) => {
        this.exitAllModes(); // Limpa estados anteriores
        
        feature.id = feature.id || feature.properties.id;
        this.selectedFeature = feature;
        this.selectedMode = true;
        
        // ✅ RESETAR VARIÁVEIS DE DRAG
        this.isDraggingFeature = false;
        this.initialFeaturePosition = null;
                
        console.log(`Círculo ${feature.id} selecionado (drag habilitado)`);
    }

    exitSelectedMode = () => {
        if (!this.selectedMode) return;
        
        this.selectedMode = false;
        
        // ✅ LIMPAR ESTADO DE DRAG
        this.isDraggingFeature = false;
        this.initialFeaturePosition = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
        
        this.removeSelectedEventListeners();
        
        console.log('Saiu do modo selecionado');
    }

    exitEditMode = () => {
        if (!this.editMode) return;
        
        this.editMode = false;
        
        // ✅ LIMPAR ESTADO DE DRAG DE HANDLES
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
        
        this.clearEditHandles();
        this.removeEditEventListeners();
        
        console.log('Saiu do modo de edição');
    }

    exitAllModes = () => {
        this.exitEditMode();
        this.exitSelectedMode();
        this.selectedFeature = null;
    }

    // ===== ESTADO 2: SELECTED MODE (DRAG) =====

    setupSelectedEventListeners = () => {
        this.map.on('mousedown', this.onSelectedMouseDown);
        this.map.on('mousemove', this.onSelectedMouseMove);
        this.map.on('mouseup', this.onSelectedMouseUp);
    }

    removeSelectedEventListeners = () => {
        this.map.off('mousedown', this.onSelectedMouseDown);
        this.map.off('mousemove', this.onSelectedMouseMove);
        this.map.off('mouseup', this.onSelectedMouseUp);
    }

    onSelectedMouseDown = (e) => {
        if (!this.selectedMode) return;

        // Verificar se clicou na feature selecionada
        const features = this.map.queryRenderedFeatures(e.point, {
            layers: ['circle-layer', 'circle-fill-layer']
        });

        const clickedFeature = features.find(f => 
            (f.id || f.properties.id) === this.selectedFeature.id
        );

        if (clickedFeature) {
            this.isDraggingFeature = true;
            this.initialFeaturePosition = [e.lngLat.lng, e.lngLat.lat];
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onSelectedMouseMove = (e) => {
        if (!this.isDraggingFeature || !this.selectedFeature || !this.initialFeaturePosition) return;
        
        const currentPosition = [e.lngLat.lng, e.lngLat.lat];
        this.updateFeaturePosition(currentPosition);
    }

    onSelectedMouseUp = () => {
        if (this.isDraggingFeature) {
            this.isDraggingFeature = false;
            this.initialFeaturePosition = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';
            
            if (this.selectedFeature) {
                this.saveFeatureChanges(this.selectedFeature);
            }
        }
    }

    updateFeaturePosition = (newPosition) => {

        const deltaLng = newPosition[0] - this.initialFeaturePosition[0];
        const deltaLat = newPosition[1] - this.initialFeaturePosition[1];
        const currentCenter = this.normalizeCenter(this.selectedFeature.properties.center);
        if (!currentCenter) {
            console.error('Centro inválido para atualização de posição');
            return;
        }
        
        const newCenter = [currentCenter[0] + deltaLng, currentCenter[1] + deltaLat];

        this.selectedFeature.properties.center = newCenter;
        this.selectedFeature.geometry = this.generateCircleGeometry(
            newCenter, 
            this.selectedFeature.properties.radius
        );

        this.updateFeatureVisualization(this.selectedFeature);
        this.initialFeaturePosition = newPosition;
    }

    // ===== ESTADO 3: EDIT MODE (HANDLES) =====

    createEditHandles = (feature) => {
        const handles = [];
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Não foi possível criar handles - center inválido');
            return;
        }
        const radius = feature.properties.radius;
        const radiusInDegrees = radius / 111320;
        
        const handlePoint = [
            center[0] + (radiusInDegrees / Math.cos(center[1] * Math.PI / 180)),
            center[1]
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
                handleId: 'radius-main',
                featureId: feature.id
            }
        });

        const highlightedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                role: 'selected-feature'
            }
        };
        handles.push(highlightedFeature);

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
            
            if (handle.properties.handleType === 'radius') {
                this.isDraggingHandle = true;
                this.activeHandle = handle;
                this.initialHandlePosition = [e.lngLat.lng, e.lngLat.lat];
                this.map.dragPan.disable();
                this.map.getCanvas().style.cursor = 'grabbing';
                
                this.clearEditHandles();
                
                e.preventDefault();
            }
        }
    }

    onEditMouseMove = (e) => {
        if (!this.isDraggingHandle || !this.activeHandle || !this.selectedFeature) return;
        
        if (this.activeHandle.properties.handleType === 'radius') {
            const currentPosition = [e.lngLat.lng, e.lngLat.lat];
            this.updateGeometryFromHandleDuringDrag('radius', currentPosition);
        }
    }

    onEditMouseUp = () => {
        if (this.isDraggingHandle) {
            this.isDraggingHandle = false;
            this.activeHandle = null;
            this.initialHandlePosition = null;
            this.map.dragPan.enable();
            this.map.getCanvas().style.cursor = '';
            
            if (this.selectedFeature) {
                this.createEditHandles(this.selectedFeature);
                this.updateSelectionAfterEdit();
                this.saveFeatureChanges(this.selectedFeature);
            }
        }
    }

    updateGeometryFromHandleDuringDrag = (handleType, newPosition) => {
        const feature = this.selectedFeature;
        
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Center inválido, não é possível atualizar geometria');
            return;
        }

        if (handleType === 'radius') {
            const newRadius = this.calculateDistance(center, newPosition);
            
            if (newRadius > 10) {
                feature.properties.radius = newRadius;
                feature.geometry = this.generateCircleGeometry(center, newRadius);
                this.updateFeatureVisualization(feature);
            }
        }
    }

    // ===== UTILITÁRIOS =====

    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (e) {
                console.error('Erro ao parsear center:', center, e);
                return null;
            }
        }
        
        if (!Array.isArray(center) || center.length < 2) {
            console.error('Center inválido:', center);
            return null;
        }
        
        return center;
    }

    generateCircleGeometry = (center, radius) => {
        const points = 64;
        const coords = [];
        
        for (let i = 0; i <= points; i++) {
            const angle = (i * 360 / points) * Math.PI / 180;
            const dx = radius * Math.cos(angle);
            const dy = radius * Math.sin(angle);
            
            const lng = center[0] + (dx / 111320) / Math.cos(center[1] * Math.PI / 180);
            const lat = center[1] + (dy / 111320);
            
            coords.push([lng, lat]);
        }

        return {
            type: 'Polygon',
            coordinates: [coords]
        };
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

    handleMouseEnter = () => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = () => {
        this.map.getCanvas().style.cursor = '';
    }

    updateFeatureVisualization = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        const sourceFeature = data.features.find(f => f.id == feature.id);
        if (sourceFeature) {
            Object.assign(sourceFeature, feature);
            this.map.getSource('circles').setData(data);
        }
    }

    updateSelectionAfterEdit = () => {
        if (this.selectedFeature && this.selectionManager) {
            this.selectionManager.selectedCircleFeatures.set(this.selectedFeature.id, this.selectedFeature);
        }
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('circles', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    // ===== MÉTODOS OBRIGATÓRIOS PARA SELEÇÃO =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        
        for (const feature of features) {
            feature.id = feature.id || feature.properties.id;
            
            const sourceFeature = data.features.find(f => f.id == feature.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
                
                if (property === 'radius' || property === 'center') {
                    const newGeometry = this.generateCircleGeometry(
                        sourceFeature.properties.center, 
                        sourceFeature.properties.radius
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }
        
        this.map.getSource('circles').setData(data);
        
        if (this.editMode && this.selectedFeature) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    hasUnsavedChanges = (features, initialPropertiesMap) => {
        return features.some(feature => {
            const initialProperties = initialPropertiesMap.get(feature.id);
            if (!initialProperties) return false;
            
            return (
                feature.properties.lineColor !== initialProperties.lineColor ||
                feature.properties.fillColor !== initialProperties.fillColor ||
                feature.properties.lineWidth !== initialProperties.lineWidth ||
                feature.properties.opacity !== initialProperties.opacity ||
                feature.properties.radius !== initialProperties.radius ||
                JSON.stringify(feature.properties.center) !== JSON.stringify(initialProperties.center)
            );
        });
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            await updateFeature('circles', feature);
        }
        this.updateMapSource();
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
                
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
            const currentData = this.map.getSource('circles')._data;
            this.map.getSource('circles').setData(currentData);
        }
    }

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

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            
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
                        await updateFeature('circles', featureToUpdate);
                    }
                }
            }
            
            this.map.getSource('circles').setData(data);
        }
    }
}

export default AddCircleControl;