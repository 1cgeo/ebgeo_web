import { addFeature, updateFeature, removeFeature } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';
class AddVisibilityControl {
    static DEFAULT_PROPERTIES = {
        opacity: 0.5,
        source: 'visibility'
    };

    static VISIBLE_COLOR = '#00FF00';

    static OBSTRUCTED_COLOR = '#FF0000';

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.visibilityControl = this;
        this.isActive = false;
        this.startPoint = null;
        this.debounceTime = 30;
        this.lastUpdateTime = 0;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "visibility-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_visibility_black.svg" alt="VISIBILITY" />';
        button.title = 'Adicionar análise de visibilidade';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $("#visibility-tool").html(`<img class="icon-sig-tool" src="./images/icon_visibility_${color}.svg" alt="VISIBILITY" />`);
        if (!this.isActive) return
        $("#visibility-tool").html('<img class="icon-sig-tool" src="./images/icon_visibility_red.svg" alt="VISIBILITY" />');
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
        this.map.on('mouseenter', 'visibility-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'visibility-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'visibility-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'visibility-layer', this.handleMouseLeave);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor()
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
        this.changeButtonColor()
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            const endPoint = [lng, lat];
            await this.addVisibilityFeature(this.startPoint, endPoint);
            this.toolManager.deactivateCurrentTool();
        }
    }

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        const currentTime = performance.now();
        if (currentTime - this.lastUpdateTime < this.debounceTime) {
            return;
        }
        this.lastUpdateTime = currentTime;

        const { lng, lat } = e.lngLat;
        const endPoint = [lng, lat];
        this.updateTempPolygon(this.calculateSectorCoordinates(this.startPoint, endPoint));
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

    addVisibilityFeature = async (startPoint, endPoint) => {
        const center = turf.point(startPoint);
        const radius = turf.distance(startPoint, endPoint, { units: 'meters' });
        const angle = turf.bearing(startPoint, endPoint);

        const viewshedResult = await this.calculateViewshed(center, radius, angle);
        const feature = this.createViewshedFeature(viewshedResult.visible, viewshedResult.obstructed, radius, angle);
        addFeature('visibility', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        data.features.push(feature);
        this.map.getSource('visibility').setData(data);

        const processedVisibilityFeatures = this.preprocessVisibilityFeature(feature);
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));
        processedVisibilityFeatures.forEach(processedFeature => {
            addFeature('processed_visibility', processedFeature);
            processedData.features.push(processedFeature);
        });
        this.map.getSource('processed-visibility').setData(processedData);
    }

    preprocessVisibilityFeature(feature) {
        let processedFeatures = [];
    
        feature.geometry.coordinates.forEach((coordinates, index) => {
            processedFeatures.push({
                type: 'Feature',
                id: `${feature.id}-${index === 0 ? 'visible' : 'obstructed'}`,
                properties: {
                    ...feature.properties,
                    color: index === 0 ? AddVisibilityControl.VISIBLE_COLOR : AddVisibilityControl.OBSTRUCTED_COLOR
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: coordinates
                }
            });
        });
            
        return processedFeatures;
    }

    createViewshedFeature = (visible, obstructed, radius, angle) => {
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { 
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                radius: radius,
                angle: angle
            },
            geometry: {
                type: 'MultiPolygon',
                coordinates: [
                    visible.geometry.coordinates,
                    obstructed.geometry.coordinates
                ]
            }
        };
    
        return feature;
    };

    calculateSectorCoordinates = (center, edgePoint) => {
        const [cx, cy] = center;
        const radius = Math.sqrt((edgePoint[0] - cx) ** 2 + (edgePoint[1] - cy) ** 2);
        const sectorAngle = Math.PI / 4; // 45 degrees in radians
        const angleStep = sectorAngle / 45; // Angle step to cover 45 points in the sector
        const startAngle = Math.atan2(edgePoint[1] - cy, edgePoint[0] - cx) - sectorAngle / 2;
    
        const coordinates = [center];
        for (let i = 0; i <= 45; i++) {
            const angle = startAngle + angleStep * i;
            coordinates.push([
                cx + radius * Math.cos(angle),
                cy + radius * Math.sin(angle)
            ]);
        }
        coordinates.push(center); 
    
        return coordinates;
    };

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

        features.forEach(feature => {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;

                const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                processedFeatures.forEach(processedFeature => {
                    processedFeature.properties[property] = value;
                });
            }
        });
        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if(features.length > 0){
            const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
            const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        // Update properties for both 'visibility' and 'processed-visibility' sources
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                        
                        // Update processed features
                        const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                        processedFeatures.forEach(processedFeature => {
                            Object.keys(feature.properties).forEach(key => {
                                if (key !== 'color') {
                                    processedFeature.properties[key] = feature.properties[key];
                                }
                            });
                        });
                    } else {
                        // Recalculate visibility and update both 'visibility' and 'processed-visibility' sources
                        const updatedFeature = await this.recalculateVisibility(feature);
                        data.features[featureIndex] = updatedFeature;
                        // Remove old processed features
                        processedData.features = processedData.features.filter(f => !f.id.startsWith(feature.id));

                        // Add new processed features
                        const newProcessedFeatures = this.preprocessVisibilityFeature(updatedFeature);
                        processedData.features.push(...newProcessedFeatures);
                    }

                    if(save){
                        updateFeature('visibility', data.features[featureIndex]);
                        const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                        processedFeatures.forEach(pf => updateFeature('processed_visibility', pf));
                    }
                }
            };
            this.map.getSource('visibility').setData(data);
            this.map.getSource('processed-visibility').setData(processedData);
        }
    }

    saveFeatures = (features, initialPropertiesMap) => {
        const processedData = this.map.getSource('processed-visibility')._data;

        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('visibility', f);

                const processedFeatures = processedData.features.filter(pf => pf.id.startsWith(f.id));
                processedFeatures.forEach(pf => {
                    const updatedProcessedFeature = {
                        ...pf,
                        properties: {
                            ...f.properties,
                            color: pf.properties.color
                        }
                    };
                    updateFeature('processed_visibility', updatedProcessedFeature);
                });

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
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));
        const idsToDelete = new Set(features.map(f => f.id.toString()));
        data.features = data.features.filter(f => !idsToDelete.has(f.id.toString()));
        processedData.features = processedData.features.filter(f => !idsToDelete.has(f.id.split('-')[0]));
        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);

        features.forEach(f => {
            removeFeature('visibility', f.id);
            removeFeature('processed_visibility', f.id + '-obstructed');
            removeFeature('processed_visibility', f.id + '-visible');
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.opacity !== initialProperties.opacity
        );
    }

    calculateViewshed = async (center, radius, angle, numRays = 20) => {
        const sectorStart = angle - 22.5; // Sector starts at -22.5 degrees relative to the center angle
        const sectorEnd = angle + 22.5; // Sector ends at +22.5 degrees relative to the center angle
      
        const visibleCoordinates = [center.geometry.coordinates];
        const obstructedCoordinates = [];
        const obstructedCoordinatesEnd = [];
      
        for (let i = 0; i <= numRays; i++) {
          const bearing = sectorStart + (i * (sectorEnd - sectorStart)) / numRays;
          const endpoint = turf.destination(center, radius, bearing, { units: 'meters' });
            
          const line = turf.lineString([center.geometry.coordinates, endpoint.geometry.coordinates]);
          const lastVisibleCoordinate = await this.calculateLOSForViewShed(line);
          visibleCoordinates.push(lastVisibleCoordinate);
          obstructedCoordinates.push(lastVisibleCoordinate);
          obstructedCoordinatesEnd.push(endpoint.geometry.coordinates);
        }
      
        visibleCoordinates.push(center.geometry.coordinates);
      
        const visiblePolygon = turf.polygon([visibleCoordinates]);

        const completeObstructed = [...obstructedCoordinates,...obstructedCoordinatesEnd.reverse(),obstructedCoordinates[0]]

        const obstructedPolygon = turf.polygon([completeObstructed]);
      
        return {
          visible: visiblePolygon,
          obstructed: obstructedPolygon
        };
      }
    
    calculateLOSForViewShed = async(line) => {
        const length = turf.length(line, { units: 'meters' });
        const steps = 20; // Number of steps to check elevation along the line
        const stepLength = length / steps;
      
        // Get start and end elevations
        const startCoordinates = line.geometry.coordinates[0];
        const endCoordinates = line.geometry.coordinates[line.geometry.coordinates.length - 1];
        const startElevation = await getTerrainElevation(this.map, startCoordinates);
        const endElevation = await getTerrainElevation(this.map, endCoordinates);
      
        let firstObstructedPoint = endCoordinates;

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
      
        return firstObstructedPoint;
    }

    async recalculateVisibility(feature) {
        let centerCoord
        if (feature.geometry.type === 'MultiPolygon') {
            centerCoord = feature.geometry.coordinates[0][0][0]
        } else if (feature.geometry.type === 'Polygon') {
            centerCoord = feature.geometry.coordinates[0][0]

        }

        const { radius, angle } = feature.properties;
        const center = turf.point(centerCoord);

        const viewshedResult = await this.calculateViewshed(center, radius, angle);
        const updatedFeature = this.createViewshedFeature(viewshedResult.visible, viewshedResult.obstructed, radius, angle);
        
        // Preserve the original ID and other properties
        updatedFeature.id = feature.id;
        updatedFeature.properties = { ...feature.properties, ...updatedFeature.properties };

        return updatedFeature;
    }
}

export default AddVisibilityControl;