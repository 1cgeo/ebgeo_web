import { addFeature, updateFeature, removeFeature } from '../store.js';
class AddLOSControl {
    static DEFAULT_PROPERTIES = {
        opacity: 1,
        width: 5,
        profile: true,
        measure: false,
        visibleColor: '#00FF00',
        obstructedColor: '#FF0000',
        source: 'los'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.textControl = this;
        this.isActive = false;
        this.startPoint = null;
        this.endPoint = null;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = 'V1';
        button.title = 'Adicionar linha de visada';
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
            console.error('Error removing AddLOSControl:', error);
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
        this.endPoint = null;
        this.map.getSource('temp-line').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.off('mousemove', this.handleMouseMove);
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            this.endPoint = [lng, lat];
            await this.addLOSFeature();
            this.deactivate();
        }
    }

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        const { lng, lat } = e.lngLat;
        const endPoint = [lng, lat];
        this.updateTempLine([this.startPoint, endPoint]);
    }

    updateTempLine = (coordinates) => {
        const data = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            }]
        };

        this.map.getSource('temp-line').setData(data);
    }

    async addLOSFeature() {
        const linestring = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [this.startPoint, this.endPoint]
            }
        };

        const losResult = await this.calculateLOS(linestring);

        const losFeature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { ...AddLOSControl.DEFAULT_PROPERTIES },
            geometry: {
                type: 'MultiLineString',
                coordinates: [
                    losResult.visible.geometry.coordinates,
                    losResult.obstructed ? losResult.obstructed.geometry.coordinates : []
                ]
            }
        };
        
        addFeature('los', losFeature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        data.features.push(losFeature);
        this.map.getSource('los').setData(data);
    }

    async calculateLOS(linestring) {
        const line = turf.lineString(linestring.geometry.coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 20; // Number of steps to check elevation along the line
        const stepLength = length / steps;
      
        // Get start and end elevations
        const startCoordinates = line.geometry.coordinates[0];
        const endCoordinates = line.geometry.coordinates[line.geometry.coordinates.length - 1];
        const startElevation = await this.map.queryTerrainElevation(startCoordinates, { exaggerated: false });
        const endElevation = await this.map.queryTerrainElevation(endCoordinates, { exaggerated: false });
      
        let firstObstructedPoint = null;
      
        for (let i = 1; i <= steps; i++) {
          const segment = turf.along(line, i * stepLength, { units: 'meters' });
          const segmentCoordinates = segment.geometry.coordinates;
      
          // Calculate expected elevation on the line
          const expectedElevation = startElevation + (endElevation - startElevation) * (i / steps);
      
          // Query terrain elevation
          const actualElevation = await this.map.queryTerrainElevation(segmentCoordinates, { exaggerated: false });
      
          if (actualElevation > expectedElevation) {
            firstObstructedPoint = segmentCoordinates;
            break;
          }
        }
      
        const visibleLine = firstObstructedPoint 
          ? turf.lineString([startCoordinates, firstObstructedPoint]) 
          : turf.lineString([startCoordinates, endCoordinates]);
      
        const obstructedLine = firstObstructedPoint 
          ? turf.lineString([firstObstructedPoint, endCoordinates]) 
          : null; // Empty line if no obstruction
      
        return {
          visible: visibleLine,
          obstructed: obstructedLine
        };
    }

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('los').setData(data);
    }

    updateFeatures = (features, save = false, onlyUpdateProperties = false) => {
        if(features.length > 0){
            const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
            features.forEach(feature => {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
        
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                        updateFeature('los', featureToUpdate);
                    }
                }
            });
            this.map.getSource('los').setData(data);
        }
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('los', f);
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
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        const idsToDelete = new Set(Array.from(features).map(f => f.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.id));
        this.map.getSource('los').setData(data);

        features.forEach(f => {
            removeFeature('los', f.id);

        });
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLOSControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.profile !== initialProperties.profile
        );
    }
}

export default AddLOSControl;