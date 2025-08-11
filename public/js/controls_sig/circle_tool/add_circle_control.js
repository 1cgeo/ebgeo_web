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
        
        // Sistema de edição
        this.editMode = false;
        this.selectedFeature = null;
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.initialHandlePosition = null;
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
        button.title = 'Adicionar círculo';
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

    // ===== SISTEMA DE DESENHO =====

    handleMapClick = (e) => {
        if (this.drawingMode === 'circle') {
            if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
                console.warn('Coordenadas inválidas para círculo');
                return;
            }

            this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);
            
            if (this.drawPoints.length === 1) {
                this.map.on('mousemove', this.handlePreviewMouseMove);
            } else if (this.drawPoints.length === 2) {
                this.clearPreview();
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
                    opacity: 0.3
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

        if (radius < 10) {
            console.warn('Raio muito pequeno. Mínimo: 10 metros');
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
        } catch (error) {
            console.error('Erro ao criar círculo:', error);
        }
    }


    onFeatureSelected = (feature) => {
        feature.id = feature.id || feature.properties.id;
        this.enterEditMode(feature);
    }

    onFeatureDeselected = (feature) => {
        feature.id = feature.id || feature.properties.id;
        this.exitEditMode();
    }

    enterEditMode = (feature) => {
        this.exitEditMode();
        
        feature.id = feature.id || feature.properties.id;
        
        this.selectedFeature = feature;
        this.editMode = true;
        
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        
    }

    exitEditMode = () => {
        if (!this.editMode) return;
        
        this.selectedFeature = null;
        this.editMode = false;
        this.clearEditHandles();
        this.removeEditEventListeners();
        
    }

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

    updateSelectionAfterEdit = () => {
        // Atualizar a feature selecionada no SelectionManager
        if (this.selectedFeature && this.selectionManager) {
            const featureId = this.selectedFeature.id || this.selectedFeature.properties.id;
            this.selectionManager.selectedCircleFeatures.set(featureId, this.selectedFeature);
            
            this.uiManager.updateSelectionHighlight();
        }
    }

    updateFeatureVisualization = (feature) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        const featureIndex = data.features.findIndex(f => f.id == feature.id);
        
        if (featureIndex !== -1) {
            data.features[featureIndex] = feature;
            this.map.getSource('circles').setData(data);
        }
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('circles', feature);
        } catch (error) {
            console.error('Erro ao salvar alterações do círculo:', error);
        }
    }

    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
                console.log('Center normalizado de string para array:', center);
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

    generateCircleGeometry = (center, radiusInMeters) => {
        center = this.normalizeCenter(center);
        if (!center) {
            console.error('Não foi possível gerar geometria - center inválido');
            return null;
        }
        
        const points = 64;
        const coords = [];
        const radiusInDegrees = radiusInMeters / 111320;

        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * 2 * Math.PI;
            const x = center[0] + (radiusInDegrees * Math.cos(angle)) / Math.cos(center[1] * Math.PI / 180);
            const y = center[1] + (radiusInDegrees * Math.sin(angle));
            coords.push([x, y]);
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

    // ===== MÉTODOS OBRIGATÓRIOS PARA SELEÇÃO =====

    updateFeaturesProperty = async (features, property, value) => {
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
                
                await updateFeature('circles', sourceFeature);
            }
        }
        
        this.map.getSource('circles').setData(data);
        
        if (this.editMode && this.selectedFeature) {
            this.createEditHandles(this.selectedFeature);
        }
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) {
            return;
        }
        
        const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
        const idsToDelete = new Set(features.map(f => {
            const id = f.id || f.properties.id;
            return String(id);
        }));
        
        data.features = data.features.filter(f => !idsToDelete.has(String(f.id)));
        this.map.getSource('circles').setData(data);
        
        for (const feature of features) {
            const id = feature.id || feature.properties.id;
            await removeFeature('circles', id);
        }
        
        if (this.selectedFeature && features.some(f => {
            const fId = f.id || f.properties.id;
            const selectedId = this.selectedFeature.id || this.selectedFeature.properties.id;
            return fId == selectedId;
        })) {
            this.exitEditMode();
        }
    }

    updateMapSource = () => {
        if (this.map && this.map.getSource('circles')) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('circles')._data));
            this.map.getSource('circles').setData(data);
        }
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

    setDefaultProperties = (properties) => {
        Object.assign(AddCircleControl.DEFAULT_PROPERTIES, properties);
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
    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('circles', f);
            }
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
}

export default AddCircleControl;