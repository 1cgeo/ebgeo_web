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
        this.isActive = false;
        
        // Estado de desenho
        this.drawingMode = null;
        this.drawPoints = [];
        
        // Sistema de edição customizada
        this.selectedFeature = null;
        this.editMode = false;
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
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

    changeButtonColor = () => {
        const button = document.getElementById("circle-tool");
        if (!button) return;

        const iconSrc = this.isActive
            ? './images/icon_circle_red.svg'
            : './images/icon_circle_black.svg';
        button.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="CIRCLE" />`;
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'circle-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'circle-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'circle-layer', this.handleMouseLeave);
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
        this.exitEditMode();
    }

    // Método obrigatório para integração com SelectionManager
    handleMapClick = (e) => {
        if (this.drawingMode === 'circle') {
            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                // Primeiro clique - centro definido
                console.log('Centro do círculo definido');
            } else if (this.drawPoints.length === 2) {
                // Segundo clique - raio definido
                this.createFeature();
                this.toolManager.deactivateCurrentTool();
            }
        }
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const radiusPoint = this.drawPoints[1];
        const radius = this.calculateDistance(center, radiusPoint);

        const circlePolygon = this.generateCircleGeometry(center, radius);
        
        const feature = {
            type: 'Feature',
            geometry: circlePolygon,
            properties: {
                ...AddCircleControl.DEFAULT_PROPERTIES,
                id: Date.now().toString(),
                center: center,
                radius: radius
            }
        };

        await addFeature('circles', feature);
        this.updateMapSource();
    }

    generateCircleGeometry(center, radius) {
        const steps = 64;
        const coordinates = [];
        
        for (let i = 0; i <= steps; i++) {
            const angle = (i * 360) / steps;
            const bearing = angle * (Math.PI / 180);
            
            // Conversão aproximada de metros para graus
            const radiusInDegrees = radius / 111320; // 1 grau ≈ 111320 metros no equador
            
            const lat = center[1] + (radiusInDegrees * Math.cos(bearing));
            const lng = center[0] + (radiusInDegrees * Math.sin(bearing)) / Math.cos(center[1] * Math.PI / 180);
            
            coordinates.push([lng, lat]);
        }
        
        return {
            type: 'Polygon',
            coordinates: [coordinates]
        };
    }

    calculateDistance(point1, point2) {
        const R = 6371000; // Raio da Terra em metros
        const lat1 = point1[1] * Math.PI / 180;
        const lat2 = point2[1] * Math.PI / 180;
        const deltaLat = (point2[1] - point1[1]) * Math.PI / 180;
        const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

        const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

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
        
        // Handle único: Raio (vermelho)
        const radiusHandle = [
            center[0] + radiusInDegrees / Math.cos(center[1] * Math.PI / 180),
            center[1]
        ];
        
        handles.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: radiusHandle
            },
            properties: {
                role: 'handle',
                handleType: 'primary',
                handleId: 'radius',
                featureId: feature.properties.id
            }
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
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
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
        const center = feature.properties.center;

        if (handleId === 'radius') {
            // Atualizar raio
            const newRadius = this.calculateDistance(center, newPosition);
            
            if (newRadius > 10) { // Raio mínimo de 10 metros
                feature.properties.radius = newRadius;
                
                // Recalcular geometria do círculo
                feature.geometry = this.generateCircleGeometry(center, newRadius);
            }
        }

        // Atualizar visualização
        this.updateFeatureVisualization(feature);
        this.createEditHandles(feature); // Recriar handles nas novas posições
    }

    updateFeatureVisualization = (feature) => {
        // Atualizar a visualização da feature será feito via updateMapSource
        this.updateMapSource();
    }

    saveFeatureChanges = async (feature) => {
        await updateFeature('circles', feature);
        this.updateMapSource();
    }

    clearEditHandles = () => {
        this.map.getSource('circle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

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
            await updateFeature('circles', feature);
        }
        this.updateMapSource();
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        // Features já salvos em tempo real via updateFeaturesProperty
        console.log('Circle features saved:', features.length);
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
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
        // A atualização do source será feita via map.js automaticamente
        // quando as features forem modificadas no store
    }

    onRemove = () => {
        this.deactivate();
        this.removeEventListeners();
        this.map = undefined;
    }
}

export default AddCircleControl;