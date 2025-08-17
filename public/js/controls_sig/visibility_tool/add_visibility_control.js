// Path: js\controls_sig\visibility_tool\add_visibility_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';

// Configuração do grid polar adaptativo
const VIEWSHED_CONFIG = {
    RINGS: 20,                    // Anéis concêntricos
    MIN_RAYS_PER_RING: 4,        // Mínimo de subdivisões angulares
    MAX_RAYS_PER_RING: 20        // Máximo de subdivisões angulares
};

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
        this.selectionManager = toolManager.selectionManager;

        // ✅ PERFORMANCE OPTIMIZATION: RAF & Debouncing (padrão LOS)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
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
        this.changeButtonColor();

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
        this.map.off('mousemove', this.handleMouseMove);
        // ✅ CLEANUP: Cancel all pending operations
        this.cancelPendingUpdates();
    }

    // ✅ PERFORMANCE: Cancel pending RAF/debouncing operations (padrão LOS)
    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.startPoint = null;
        this.clearPreview();
        this.changeButtonColor();
    }

    // ✅ Clear preview (padrão LOS)
    clearPreview = () => {
        this.cancelPendingUpdates();
        this.map.getSource('temp-polygon').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.lastPreviewCenter = this.startPoint;
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            const endPoint = [lng, lat];
            this.map.off('mousemove', this.handleMouseMove);
            await this.addVisibilityFeature(this.startPoint, endPoint);
            this.toolManager.deactivateCurrentTool();
        }
    }

    // ✅ OPTIMIZED: RAF-based preview (padrão LOS)
    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth preview (padrão LOS)
    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.updateTempPolygon(this.calculateSectorCoordinates(this.lastPreviewCenter, this.lastPreviewPosition));
        }, 8);

        this.pendingPreviewUpdate = false;
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
        const feature = this.createViewshedFeature(viewshedResult, radius, angle);
        
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

        // ✅ ADICIONAR: Auto-seleção após criar (padrão LOS)
        this.selectionManager.toggleFeatureSelection('visibility', feature.id, feature);
        this.selectionManager.updateUI();
    }

    preprocessVisibilityFeature(feature) {
        let processedFeatures = [];
        feature.geometry.coordinates.forEach((polygonCoords, index) => {
            const cellData = feature.properties.cellData[index];
            
            processedFeatures.push({
                type: 'Feature',
                id: `${feature.id}-${index}`,
                properties: {
                    ...feature.properties,
                    color: cellData.isVisible ? AddVisibilityControl.VISIBLE_COLOR : AddVisibilityControl.OBSTRUCTED_COLOR
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: polygonCoords
                }
            });
        });
            
        return processedFeatures;
    }

    createViewshedFeature = (cellsData, radius, angle) => {
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { 
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                radius: radius,
                angle: angle,
                cellData: cellsData.map(cell => ({ isVisible: cell.isVisible }))
            },
            geometry: {
                type: 'MultiPolygon',
                coordinates: cellsData.map(cell => [cell.coordinates])
            }
        };
    
        return feature;
    };

    calculateSectorCoordinates = (center, edgePoint) => {
        const [cx, cy] = center;
        const radius = Math.sqrt((edgePoint[0] - cx) ** 2 + (edgePoint[1] - cy) ** 2);
        const sectorAngle = Math.PI / 4; // 45 degrees in radians
        const angleStep = sectorAngle / 45;
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
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                        
                        const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                        processedFeatures.forEach(processedFeature => {
                            Object.keys(feature.properties).forEach(key => {
                                if (key !== 'color') {
                                    processedFeature.properties[key] = feature.properties[key];
                                }
                            });
                        });
                    } else {
                        const updatedFeature = await this.recalculateVisibility(feature);
                        data.features[featureIndex] = updatedFeature;
                        
                        processedData.features = processedData.features.filter(f => !f.id.startsWith(feature.id));

                        const newProcessedFeatures = this.preprocessVisibilityFeature(updatedFeature);
                        processedData.features.push(...newProcessedFeatures);
                    }

                    if(save){
                        await updateFeature('visibility', data.features[featureIndex]);
                        const processedFeatures = processedData.features.filter(f => f.id.startsWith(feature.id));
                        for (const pf of processedFeatures) {
                            await updateFeature('processed_visibility', pf);
                        }
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
            // Remove todas as células processadas deste viewshed
            const cellsToRemove = this.map.getSource('processed-visibility')._data.features.filter(pf => pf.id.startsWith(f.id));
            for (const cell of cellsToRemove) {
                await removeFeature('processed_visibility', cell.id);
            }
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.opacity !== initialProperties.opacity
        );
    }

    // ✅ CORRIGIDA: Análise de visibilidade mais simples e eficaz
    calculateVisibilityAlongRay = async (line, observer) => {
        const length = turf.length(line, { units: 'meters' });
        const steps = 25; // Resolução fixa por raio
        const stepLength = length / steps;
        const visibilityProfile = [];
        
        // Calcular elevação do ponto final
        const endPoint = turf.along(line, length, { units: 'meters' });
        const endElevation = await getTerrainElevation(this.map, endPoint.geometry.coordinates);
        
        for (let i = 1; i <= steps; i++) {
            const currentPoint = turf.along(line, i * stepLength, { units: 'meters' });
            const currentCoords = currentPoint.geometry.coordinates;
            const currentElevation = await getTerrainElevation(this.map, currentCoords);
            
            // ✅ CORRIGIDA: Linha de visão simples (semelhante ao LOS control)
            const progress = i / steps;
            const expectedElevation = observer.elevation + (endElevation - observer.elevation) * progress;
            
            const isVisible = currentElevation <= expectedElevation;
            
            visibilityProfile.push({
                point: currentCoords,
                visible: isVisible
            });
        }
        
        return visibilityProfile;
    }

    // ✅ NOVA FUNÇÃO: Grid polar adaptativo
    calculateViewshed = async (center, radius, angle) => {
        const sectorStart = angle - 22.5;
        const sectorEnd = angle + 22.5;
        const observerElevation = await getTerrainElevation(this.map, center.geometry.coordinates) + 2;
        const observer = {
            coord: center.geometry.coordinates,
            elevation: observerElevation
        };

        const cells = [];

        // Gerar grid polar adaptativo
        for (let ring = 0; ring < VIEWSHED_CONFIG.RINGS; ring++) {
            const innerRadius = (ring / VIEWSHED_CONFIG.RINGS) * radius;
            const outerRadius = ((ring + 1) / VIEWSHED_CONFIG.RINGS) * radius;
            
            // Mais subdivisões angulares em anéis externos
            const raysInRing = Math.floor(
                VIEWSHED_CONFIG.MIN_RAYS_PER_RING + 
                (ring / (VIEWSHED_CONFIG.RINGS - 1)) * 
                (VIEWSHED_CONFIG.MAX_RAYS_PER_RING - VIEWSHED_CONFIG.MIN_RAYS_PER_RING)
            );
            
            const angleStep = 45 / raysInRing; // 45° é o setor total
            
            for (let ray = 0; ray < raysInRing; ray++) {
                const startAngle = sectorStart + (ray * angleStep);
                const endAngle = sectorStart + ((ray + 1) * angleStep);
                
                // Criar célula do setor polar
                const cell = await this.createSectorCell(center, innerRadius, outerRadius, startAngle, endAngle, observer);
                cells.push(cell);
            }
        }

        console.log(`✅ Viewshed criado: ${cells.length} células`);
        return cells;
    }

    // ✅ IMPLEMENTADA: Teste de visibilidade real similar ao LOS control
    createSectorCell = async (center, innerRadius, outerRadius, startAngle, endAngle, observer) => {
        // Calcular os 4 vértices da célula
        const p1 = turf.destination(center, innerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(center, outerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p3 = turf.destination(center, outerRadius, endAngle, { units: 'meters' }).geometry.coordinates;
        const p4 = turf.destination(center, innerRadius, endAngle, { units: 'meters' }).geometry.coordinates;
        
        // ✅ TESTE REAL DE VISIBILIDADE: Similar ao LOS control
        const midAngle = (startAngle + endAngle) / 2;
        const testPoint = turf.destination(center, outerRadius, midAngle, { units: 'meters' });
        
        // Criar linha de visão do observador até o ponto de teste
        const line = turf.lineString([observer.coord, testPoint.geometry.coordinates]);
        const length = turf.length(line, { units: 'meters' });
        const steps = Math.ceil(length / 60); // 1 passo por ~60m (mesma resolução do LOS)
        const stepLength = length / steps;

        // Obter elevação do ponto de teste
        const testElevation = await getTerrainElevation(this.map, testPoint.geometry.coordinates);
        
        let isVisible = true;

        // Verificar obstruções ao longo da linha de visão (algoritmo do LOS control)
        for (let i = 1; i <= steps; i++) {
            const segment = turf.along(line, i * stepLength, { units: 'meters' });
            const segmentCoordinates = segment.geometry.coordinates;
            
            // Calcular elevação esperada na linha de visão
            const expectedElevation = observer.elevation + (testElevation - observer.elevation) * (i / steps);
            
            // Obter elevação real do terreno
            const actualElevation = await getTerrainElevation(this.map, segmentCoordinates);
            
            // Se o terreno está acima da linha de visão, há obstrução
            if (actualElevation > expectedElevation) {
                isVisible = false;
                break;
            }
        }
        
        return {
            coordinates: [p1, p2, p3, p4, p1],
            isVisible: isVisible
        };
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
        const updatedFeature = this.createViewshedFeature(viewshedResult, radius, angle);
        
        updatedFeature.id = feature.id;
        updatedFeature.properties = { ...feature.properties, ...updatedFeature.properties };

        return updatedFeature;
    }
}

export default AddVisibilityControl;