// Path: js\controls_sig\visibility_tool\add_visibility_control.js
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
        this.selectionManager = toolManager.selectionManager;
    }
    
    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl visibility-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "visibility-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_visibility_black.svg" alt="VISIBILITY" />';
        button.title = 'Adicionar análise de visibilidade (V)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        $("#visibility-tool").html(`<img class="icon-sig-tool" src="./images/icon_visibility_black.svg" alt="VISIBILITY" />`);
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

        // Salvar no IndexedDB
        await addFeature('visibility', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        data.features.push(feature);
        this.map.getSource('visibility').setData(data);

        const processedVisibilityFeatures = this.preprocessVisibilityFeature(feature);
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

        for (const processedFeature of processedVisibilityFeatures) {
            await addFeature('processed_visibility', processedFeature);
            processedData.features.push(processedFeature);
        }
        this.map.getSource('processed-visibility').setData(processedData);

        this.selectionManager.toggleFeatureSelection('visibility', feature.id, feature);
        this.selectionManager.updateUI();
    }

    // Método para encontrar pontos de transição em um raio
    calculateTransitionPointsInRay = async (line) => {
        const length = turf.length(line, { units: 'meters' });
        const steps = Math.ceil(length / 60); // Passos dinâmicos baseados na distância
        const stepLength = length / steps;

        const startCoordinates = line.geometry.coordinates[0];
        const endCoordinates = line.geometry.coordinates[line.geometry.coordinates.length - 1];
        const startElevation = await getTerrainElevation(this.map, startCoordinates) + 2;
        const endElevation = await getTerrainElevation(this.map, endCoordinates);

        let transitions = [];
        let isCurrentlyVisible = true; // Começa sempre visível do observador

        for (let i = 1; i <= steps; i++) {
            const segment = turf.along(line, i * stepLength, { units: 'meters' });
            const segmentCoordinates = segment.geometry.coordinates;
            const distance = i * stepLength;

            // Calculate expected elevation on the line
            const expectedElevation = startElevation + (endElevation - startElevation) * (i / steps);

            // Query terrain elevation
            const actualElevation = await getTerrainElevation(this.map, segmentCoordinates);

            const pointIsVisible = actualElevation <= expectedElevation;

            if (pointIsVisible !== isCurrentlyVisible) {
                // Mudança de estado - ponto de transição
                transitions.push({
                    point: segmentCoordinates,
                    type: pointIsVisible ? 'visible' : 'obstructed',
                    distance: distance
                });
                isCurrentlyVisible = pointIsVisible;
            }
        }

        // Se não houve nenhuma transição, toda a linha é visível até o final
        if (transitions.length === 0) {
            transitions.push({
                point: endCoordinates,
                type: 'visible',
                distance: length
            });
        }

        return transitions;
    }

    // Método principal do viewshed com algoritmo esperto
    calculateViewshed = async (center, radius, angle, numRays = 20) => {
        const sectorStart = angle - 22.5;
        const sectorEnd = angle + 22.5;

        let rayTransitions = [];

        for (let i = 0; i <= numRays; i++) {
            const bearing = sectorStart + (i * (sectorEnd - sectorStart)) / numRays;
            const endpoint = turf.destination(center, radius, bearing, { units: 'meters' });

            const line = turf.lineString([center.geometry.coordinates, endpoint.geometry.coordinates]);
            const transitions = await this.calculateTransitionPointsInRay(line);

            rayTransitions.push({
                bearing: bearing,
                transitions: transitions
            });
        }

        // Reconstrói polígonos baseado nas transições
        return this.reconstructPolygonsFromTransitions(center.geometry.coordinates, rayTransitions);
    }

    // Método principal de reconstrução
    reconstructPolygonsFromTransitions = (centerCoords, rayTransitions, distanceTolerance = 50) => {
        const visiblePolygons = [];
        const obstructedPolygons = [];

        // Separa transições por tipo e posição na sequência
        const transitionsByTypeAndIndex = this.groupTransitionsByTypeAndIndex(rayTransitions);

        // Para cada tipo (visible/obstructed)
        ['visible', 'obstructed'].forEach(type => {
            const polygons = this.buildPolygonsForType(
                centerCoords,
                transitionsByTypeAndIndex[type],
                distanceTolerance
            );

            if (type === 'visible') {
                visiblePolygons.push(...polygons);
            } else {
                obstructedPolygons.push(...polygons);
            }
        });

        return {
            visible: this.mergePolygons(visiblePolygons),
            obstructed: this.mergePolygons(obstructedPolygons)
        };
    }

    // Agrupa transições por tipo e posição na sequência
    groupTransitionsByTypeAndIndex = (rayTransitions) => {
        const grouped = {
            visible: {},    // indexed by position in sequence (0, 1, 2...)
            obstructed: {}
        };

        rayTransitions.forEach((rayData, rayIndex) => {
            rayData.transitions.forEach((transition, transIndex) => {
                const type = transition.type;

                if (!grouped[type][transIndex]) {
                    grouped[type][transIndex] = [];
                }

                grouped[type][transIndex].push({
                    ...transition,
                    rayIndex: rayIndex,
                    bearing: rayData.bearing
                });
            });
        });

        return grouped;
    }

    // Constrói polígonos para um tipo específico
    buildPolygonsForType = (centerCoords, transitionsByIndex, distanceTolerance) => {
        const polygons = [];

        // Para cada índice de transição (1ª transição, 2ª transição, etc.)
        Object.keys(transitionsByIndex).forEach(transIndex => {
            const transitions = transitionsByIndex[transIndex];

            if (transitions.length === 0) return;

            // Ordena por bearing
            transitions.sort((a, b) => a.bearing - b.bearing);

            // Agrupa transições contínuas (dentro da tolerância)
            const continuousGroups = this.groupContinuousTransitions(transitions, distanceTolerance);

            // Cada grupo vira um polígono
            continuousGroups.forEach(group => {
                if (group.length >= 2) { // Precisa de pelo menos 2 pontos
                    const polygonCoords = [centerCoords];
                    group.forEach(t => polygonCoords.push(t.point));
                    polygonCoords.push(centerCoords);

                    try {
                        const polygon = turf.polygon([polygonCoords]);
                        polygons.push(polygon);
                    } catch (error) {
                        console.warn('Erro ao criar polígono:', error);
                    }
                }
            });
        });

        return polygons;
    }

    // Agrupa transições que estão próximas (contínuas)
    groupContinuousTransitions = (transitions, distanceTolerance) => {
        if (transitions.length === 0) return [];

        const groups = [];
        let currentGroup = [transitions[0]];

        for (let i = 1; i < transitions.length; i++) {
            const current = transitions[i];
            const previous = transitions[i - 1];

            // Calcula distância entre pontos consecutivos
            const distance = turf.distance(
                turf.point(previous.point),
                turf.point(current.point),
                { units: 'meters' }
            );

            if (distance <= distanceTolerance) {
                // Dentro da tolerância - adiciona ao grupo atual
                currentGroup.push(current);
            } else {
                // Fora da tolerância - fecha grupo atual e inicia novo
                if (currentGroup.length >= 2) {
                    groups.push([...currentGroup]);
                }
                currentGroup = [current];
            }
        }

        // Adiciona o último grupo
        if (currentGroup.length >= 2) {
            groups.push(currentGroup);
        }

        return groups;
    }

    // Merge múltiplos polígonos em um só usando union
    mergePolygons = (polygons) => {
        if (polygons.length === 0) {
            // Retorna polígono vazio válido
            return turf.polygon([[[0, 0], [0, 0.001], [0.001, 0], [0, 0]]]);
        }

        if (polygons.length === 1) {
            return polygons[0];
        }

        // Merge real usando turf.union() - une todos os polígonos
        try {
            let mergedPolygon = polygons[0];

            for (let i = 1; i < polygons.length; i++) {
                try {
                    // Union com o polígono atual
                    const unionResult = turf.union(mergedPolygon, polygons[i]);
                    if (unionResult) {
                        mergedPolygon = unionResult;
                    }
                } catch (unionError) {
                    console.warn('Erro ao fazer union de polígono:', unionError);
                    // Se union falhar, mantém o polígono atual
                }
            }

            return mergedPolygon;

        } catch (error) {
            console.warn('Erro no merge de polígonos, usando fallback:', error);

            // Fallback: retorna o maior polígono se union falhar
            let largest = polygons[0];
            let largestArea = 0;

            try {
                largestArea = turf.area(largest);
            } catch (error) {
                console.warn('Erro ao calcular área:', error);
            }

            polygons.forEach(polygon => {
                try {
                    const area = turf.area(polygon);
                    if (area > largestArea) {
                        largest = polygon;
                        largestArea = area;
                    }
                } catch (error) {
                    console.warn('Erro ao calcular área do polígono:', error);
                }
            });

            return largest;
        }
    }

    // ===== MÉTODOS UTILITÁRIOS =====

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

    // ===== MÉTODOS DE MANIPULAÇÃO DE FEATURES =====

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

        for (const feature of features) {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;

                const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                processedFeatures.forEach(processedFeature => {
                    processedFeature.properties[property] = value;
                });
            }
        }
        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
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

                    if (save) {
                        await updateFeature('visibility', data.features[featureIndex]);
                        const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                        for (const pf of processedFeatures) {
                            await updateFeature('processed_visibility', pf);
                        }
                    }
                }
            }
            this.map.getSource('visibility').setData(data);
            this.map.getSource('processed-visibility').setData(processedData);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const processedData = this.map.getSource('processed-visibility')._data;

        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('visibility', f);

                const processedFeatures = processedData.features.filter(pf => pf.id.startsWith(f.id));
                for (const pf of processedFeatures) {
                    const updatedProcessedFeature = {
                        ...pf,
                        properties: {
                            ...f.properties,
                            color: pf.properties.color
                        }
                    };
                    await updateFeature('processed_visibility', updatedProcessedFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
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

        for (const f of features) {
            await removeFeature('visibility', f.id);
            await removeFeature('processed_visibility', f.id + '-obstructed');
            await removeFeature('processed_visibility', f.id + '-visible');
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.opacity !== initialProperties.opacity
        );
    }

    async recalculateVisibility(feature) {
        let centerCoord;
        if (feature.geometry.type === 'MultiPolygon') {
            centerCoord = feature.geometry.coordinates[0][0][0];
        } else if (feature.geometry.type === 'Polygon') {
            centerCoord = feature.geometry.coordinates[0][0];
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