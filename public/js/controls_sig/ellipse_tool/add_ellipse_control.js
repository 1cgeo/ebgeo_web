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

    changeButtonColor = () => {
        const button = document.getElementById("ellipse-tool");
        if (!button) return;

        const iconSrc = this.isActive
            ? './images/icon_ellipse_red.svg'
            : './images/icon_ellipse_black.svg';
        button.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="ELLIPSE" />`;
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'ellipse-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'ellipse-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'ellipse-layer', this.handleMouseLeave);
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
        this.exitEditMode();
    }

    // Método obrigatório para integração com SelectionManager
    handleMapClick = (e) => {
        if (this.drawingMode === 'ellipse') {
            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                // Primeiro clique - centro definido
                console.log('Centro da elipse definido');
            } else if (this.drawPoints.length === 2) {
                // Segundo clique - eixo maior e orientação definidos
                this.createFeature();
                this.toolManager.deactivateCurrentTool();
            }
        }
    }

    createFeature = async () => {
        const center = this.drawPoints[0];
        const majorAxisEnd = this.drawPoints[1];
        const majorRadius = this.calculateDistance(center, majorAxisEnd);
        const bearing = this.calculateBearing(center, majorAxisEnd);

        const ellipsePolygon = this.generateEllipseGeometry(
            center, 
            majorRadius, 
            majorRadius * 0.6, // Eixo menor inicial (60% do maior)
            bearing
        );
        
        const feature = {
            type: 'Feature',
            geometry: ellipsePolygon,
            properties: {
                ...AddEllipseControl.DEFAULT_PROPERTIES,
                id: Date.now().toString(),
                center: center,
                majorRadius: majorRadius,
                minorRadius: majorRadius * 0.6,
                bearing: bearing
            }
        };

        await addFeature('ellipses', feature);
        this.updateMapSource();
    }

    generateEllipseGeometry(center, majorRadius, minorRadius, bearing) {
        const steps = 64;
        const coordinates = [];
        
        // Conversão de bearing para radianos
        const bearingRad = bearing * (Math.PI / 180);
        
        for (let i = 0; i <= steps; i++) {
            const angle = (i * 2 * Math.PI) / steps;
            
            // Calcular ponto na elipse não rotacionada
            const x = majorRadius * Math.cos(angle);
            const y = minorRadius * Math.sin(angle);
            
            // Aplicar rotação
            const rotatedX = x * Math.cos(bearingRad) - y * Math.sin(bearingRad);
            const rotatedY = x * Math.sin(bearingRad) + y * Math.cos(bearingRad);
            
            // Converter para coordenadas geográficas
            const radiusXInDegrees = rotatedX / (111320 * Math.cos(center[1] * Math.PI / 180));
            const radiusYInDegrees = rotatedY / 111320;
            
            const lng = center[0] + radiusXInDegrees;
            const lat = center[1] + radiusYInDegrees;
            
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

    calculateBearing(point1, point2) {
        const lat1 = point1[1] * Math.PI / 180;
        const lat2 = point2[1] * Math.PI / 180;
        const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        const bearing = Math.atan2(y, x) * (180 / Math.PI);
        return (bearing + 360) % 360;
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
        const majorRadius = feature.properties.majorRadius;
        const minorRadius = feature.properties.minorRadius;
        const bearing = feature.properties.bearing;

        const bearingRad = bearing * (Math.PI / 180);

        // Handle 1: Eixo maior (vermelho)
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
                handleType: 'primary',
                handleId: 'major-axis',
                featureId: feature.properties.id
            }
        });

        // Handle 2: Eixo menor (azul)
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
                handleType: 'secondary',
                handleId: 'minor-axis',
                featureId: feature.properties.id
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
        this.map.getSource('ellipse-edit-handles').setData({
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

        if (handleId === 'major-axis') {
            // Atualizar eixo maior e orientação
            const newMajorRadius = this.calculateDistance(center, newPosition);
            const newBearing = this.calculateBearing(center, newPosition);
            
            if (newMajorRadius > 10) { // Raio mínimo de 10 metros
                feature.properties.majorRadius = newMajorRadius;
                feature.properties.bearing = newBearing;
            }
        } else if (handleId === 'minor-axis') {
            // Atualizar apenas eixo menor
            const newMinorRadius = this.calculateDistance(center, newPosition);
            
            if (newMinorRadius > 10) { // Raio mínimo de 10 metros
                feature.properties.minorRadius = newMinorRadius;
            }
        }

        // Recalcular geometria da elipse
        feature.geometry = this.generateEllipseGeometry(
            center,
            feature.properties.majorRadius,
            feature.properties.minorRadius,
            feature.properties.bearing
        );

        // Atualizar visualização
        this.updateFeatureVisualization(feature);
        this.createEditHandles(feature); // Recriar handles nas novas posições
    }

    updateFeatureVisualization = (feature) => {
        this.updateMapSource();
    }

    saveFeatureChanges = async (feature) => {
        await updateFeature('ellipses', feature);
        this.updateMapSource();
    }

    clearEditHandles = () => {
        this.map.getSource('ellipse-edit-handles').setData({
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
            await updateFeature('ellipses', feature);
        }
        this.updateMapSource();
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        console.log('Ellipse features saved:', features.length);
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                feature.properties = { ...originalProps };
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
        // A atualização do source será feita via map.js automaticamente
    }

    onRemove = () => {
        this.deactivate();
        this.removeEventListeners();
        this.map = undefined;
    }
}

export default AddEllipseControl;