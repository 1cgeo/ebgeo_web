import { addFeature, updateFeature, removeFeature } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';
class AddLOSControl {
    static DEFAULT_PROPERTIES = {
        opacity: 1,
        width: 5,
        profile: true,
        measure: false,
        source: 'los'
    };

    static VISIBLE_COLOR = '#00FF00';

    static OBSTRUCTED_COLOR = '#FF0000';

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.losControl = this;
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
        this.map.on('mouseenter', 'los-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'los-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'los-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'los-layer', this.handleMouseLeave);
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
        let losFeature
        if (losResult.obstructed) {
            losFeature = {
                type: 'Feature',
                id: Date.now().toString(),
                properties: { ...AddLOSControl.DEFAULT_PROPERTIES },
                geometry: {
                    type: 'MultiLineString',
                    coordinates: [
                        losResult.visible.geometry.coordinates,
                        losResult.obstructed.geometry.coordinates
                    ]
                }
            };
        } else {
            losFeature = {
                type: 'Feature',
                id: Date.now().toString(),
                properties: { ...AddLOSControl.DEFAULT_PROPERTIES },
                geometry: {
                    type: 'LineString',
                    coordinates: losResult.visible.geometry.coordinates
                }
            };
        }
        
        addFeature('los', losFeature);
        this.updateFeatureMeasurement(losFeature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        data.features.push(losFeature);
        this.map.getSource('los').setData(data);

        const processedLosFeatures = this.preprocessLosFeature(losFeature);
        processedLosFeatures.forEach(processedFeature => {
            addFeature('processed_los', processedFeature);
        });
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));
        processedData.features.push(...processedLosFeatures);
        this.map.getSource('processed-los').setData(processedData);
    }

    preprocessLosFeature(feature) {
        const properties = feature.properties;
        let processedFeatures = [];

        if (feature.geometry.type === 'MultiLineString') {
            processedFeatures.push({
                type: 'Feature',
                id: feature.id + '-visible',
                properties: {
                    ...properties,
                    color: AddLOSControl.VISIBLE_COLOR
                },
                geometry: {
                    type: 'LineString',
                    coordinates: feature.geometry.coordinates[0]
                }
            });

            processedFeatures.push({
                type: 'Feature',
                id: feature.id + '-obstructed',
                properties: {
                    ...properties,
                    color: AddLOSControl.OBSTRUCTED_COLOR
                },
                geometry: {
                    type: 'LineString',
                    coordinates: feature.geometry.coordinates[1]
                }
            });
        } else {
            processedFeatures.push({
                type: 'Feature',
                id: feature.id + '-visible',
                properties: {
                    ...properties,
                    color: AddLOSControl.VISIBLE_COLOR
                },
                geometry: feature.geometry
            });
        }

        return processedFeatures;
    }

    async calculateLOS(linestring) {
        const line = turf.lineString(linestring.geometry.coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 20; // Number of steps to check elevation along the line
        const stepLength = length / steps;
      
        // Get start and end elevations
        const startCoordinates = line.geometry.coordinates[0];
        const endCoordinates = line.geometry.coordinates[line.geometry.coordinates.length - 1];
        const startElevation = await getTerrainElevation(this.map, startCoordinates);
        const endElevation = await getTerrainElevation(this.map, endCoordinates);
      
        let firstObstructedPoint = null;
      
        for (let i = 1; i <= steps; i++) {
          const segment = turf.along(line, i * stepLength, { units: 'meters' });
          const segmentCoordinates = segment.geometry.coordinates;
      
          // Calculate expected elevation on the line
          const expectedElevation = startElevation + (endElevation - startElevation) * (i / steps);
      
          // Query terrain elevation
          const actualElevation = await getTerrainElevation(this.map, segmentCoordinates);
      
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
        const losData = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));
    
        features.forEach(feature => {
            // Update los source
            const losFeature = losData.features.find(f => f.id == feature.id);
            if (losFeature) {
                losFeature.properties[property] = value;
                feature.properties[property] = value;
                this.updateFeatureMeasurement(feature);

                // Update processed-los source
                const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                processedFeatures.forEach(processedFeature => {
                    processedFeature.properties[property] = value;
                });
            }
        });
    
        this.map.getSource('los').setData(losData);
        this.map.getSource('processed-los').setData(processedData);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if(features.length > 0){
            const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }
        
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                        this.updateFeatureMeasurement(featureToUpdate);
                        updateFeature('los', featureToUpdate);
                    }
                }
            };
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
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));
        const idsToDelete = new Set(Array.from(features).map(f => f.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.id));
        processedData.features = processedData.features.filter(f => !idsToDelete.has(f.id.split('-')[0]));
        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);

        features.forEach(f => {
            removeFeature('los', f.id);
            removeFeature('processed_los', f.id + '-obstructed');
            removeFeature('processed_los', f.id + '-visible');
            this.removeFeatureMeasurement(f.id);
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

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.id);
        if (feature.properties.measure) {
            let combinedLine;

            // Check if the feature is a MultiLineString
            if (feature.geometry.type === 'MultiLineString') {
                combinedLine = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            feature.geometry.coordinates[0][0],
                            feature.geometry.coordinates[1][1]
                        ]
                    }
                };
            } else if (feature.geometry.type === 'LineString') {
                combinedLine = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: feature.geometry.coordinates
                    }
                };
            }

            const line = turf.lineString(combinedLine.geometry.coordinates);
            const lengthInMeters = turf.length(line, { units: 'meters' });
            const lengthFormatted = lengthInMeters >= 1000 
                ? `${(lengthInMeters / 1000).toFixed(2)} km`
                : `${lengthInMeters.toFixed(2)} m`;
            const midpoint = turf.along(line, lengthInMeters / 2, { units: 'meters' });
            this.displayMeasurement(midpoint.geometry.coordinates, lengthFormatted, feature.id);
        }
    }

    removeFeatureMeasurement = (featureId) => {
        const measurementLabel = document.querySelector(`.measurement-label[data-feature-id="${featureId}"]`);
        if (measurementLabel) {
            measurementLabel.remove();
        }
    }

    displayMeasurement = (coordinates, measurement, featureId) => {
        const markerElement = this.createMeasurementLabel(measurement, featureId);
        new maplibregl.Marker({ element: markerElement })
            .setLngLat(coordinates)
            .addTo(this.map);
    }

    createMeasurementLabel = (measurement, featureId) => {
        const label = document.createElement('div');
        label.className = 'measurement-label';
        label.innerText = measurement;
        label.dataset.featureId = featureId;
        return label;
    }
}

export default AddLOSControl;