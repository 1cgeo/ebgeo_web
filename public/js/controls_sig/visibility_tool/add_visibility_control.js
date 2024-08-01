import { addFeature, updateFeature, removeFeature } from '../store.js';
class AddVisibilityControl {
    static DEFAULT_PROPERTIES = {
        opacity: 0.5,
        color: '#3f4fb5',
        source: 'visibility'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.textControl = this;
        this.isActive = false;
        this.startPoint = null;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = 'V2';
        button.title = 'Adicionar análise de visibilidade';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        return this.container;
    }
    
    onRemove = () => {
        try {
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddVisibilityControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.startPoint = null;
        this.map.getSource('temp-polygon').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.off('mousemove', this.handleMouseMove);
    }

    handleMapClick = (e) => {
        if (!this.isActive) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            const endPoint = [lng, lat];
            this.addPolygonFeature(this.calculateSectorCoordinates(this.startPoint, endPoint));
            this.deactivate();
        }
    }

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        const { lng, lat } = e.lngLat;
        const endPoint = [lng, lat];
        this.updateTempPolygon(this.calculateSectorCoordinates(this.startPoint, endPoint));
    }

    addTextFeature = (lngLat, text) => {
        const feature = this.createTextFeature(lngLat, text);
        addFeature('visibility', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        data.features.push(feature);
        this.map.getSource('visibility').setData(data);
    }

    updateTempPolygon = (coordinates) => {
        const data = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            }]
        };

        this.map.getSource('temp-polygon').setData(data);
    }

    addPolygonFeature = (coordinates) => {
        const feature = this.createPolygonFeature(coordinates);
        addFeature('visibility', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        data.features.push(feature);
        this.map.getSource('visibility').setData(data);
    }

    createPolygonFeature = (coordinates) => {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { ...AddVisibilityControl.DEFAULT_PROPERTIES },
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
            }
        };
    }

    calculateSectorCoordinates = (center, edgePoint) => {
        const [cx, cy] = center;
        const radius = Math.sqrt((edgePoint[0] - cx) ** 2 + (edgePoint[1] - cy) ** 2);
        const angleStep = Math.PI / 180;
        const sectorAngle = Math.PI / 4;
        const startAngle = Math.atan2(edgePoint[1] - cy, edgePoint[0] - cx) - sectorAngle / 2;

        const coordinates = [];
        coordinates.push(center);
        for (let i = 0; i <= 45; i++) {
            const angle = startAngle + angleStep * i;
            coordinates.push([
                cx + radius * Math.cos(angle),
                cy + radius * Math.sin(angle)
            ]);
        }
        coordinates.push(center);

        return coordinates;
    }

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('visibility').setData(data);
    }

    updateFeatures = (features, save = false, onlyUpdateProperties = false) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        features.forEach(feature => {
            const featureIndex = data.features.findIndex(f => f.id == feature.id);
            if (featureIndex !== -1) {
                if (onlyUpdateProperties) {
                    // Only update properties of the existing feature
                    Object.assign(data.features[featureIndex].properties, feature.properties);
                } else {
                    // Replace the entire feature
                    data.features[featureIndex] = feature;
                }
    
                if (save) {
                    const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                    updateFeature('visibility', featureToUpdate);
                }
            }
        });
        this.map.getSource('visibility').setData(data);
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('visibility', f);
            }
        });
    }

    discardChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features, true, true);
    }

    deleteFeatures = (features) => {
        if (features.length === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        const idsToDelete = new Set(Array.from(features).map(f => f.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.id));
        this.map.getSource('visibility').setData(data);

        features.forEach(f => {
            removeFeature('visibility', f.id);

        });
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddVisibilityControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.profile !== initialProperties.profile
        );
    }
}

export default AddVisibilityControl;