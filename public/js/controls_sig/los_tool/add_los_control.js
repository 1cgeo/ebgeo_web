// Path: js\controls_sig\los_tool\add_los_control.js
import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateLOSFeatures, removeFeatureSilent } from '../store/store.js';
import { getTerrainElevation } from '../terrain_control.js';
import { IDUtils } from '../id_utils.js';

class AddLOSControl {
    static DEFAULT_PROPERTIES = {
        opacity: 1,
        width: 5,
        profile: true,
        measure: false,
        source: 'los',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    static VISIBLE_COLOR = '#00FF00';
    static OBSTRUCTED_COLOR = '#FF0000';

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.losControl = this;
        this.isActive = false;
        this.startPoint = null;
        this.endPoint = null;
        this.selectionManager = toolManager.selectionManager;

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null; // startPoint
        this.geometryDebounceTimer = null;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl los-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "los-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_los_black.svg" alt="LOS" />';
        button.title = 'Adicionar linha de visada (O)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#los-tool").html(`<img class="icon-sig-tool" src="./images/icon_los_black.svg" alt="LOS" />`);
        if (!this.isActive) return
        $("#los-tool").html('<img class="icon-sig-tool" src="./images/icon_los_red.svg" alt="LOS" />');
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
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
    }

    _onTerrainChange = () => {
        const terrainEnabled = this.map.getTerrain() !== null;

        if (terrainEnabled) {
            // Enable LOS tool
            this.container.classList.remove('disabled');
            this.container.querySelector('button').disabled = false;
            this.changeButtonColor();
        } else {
            // Disable LOS tool
            this.container.classList.add('disabled'); // CSS class
            this.container.querySelector('button').disabled = true;
            // Set disabled icon
            this.container.querySelector('button').innerHTML = '<img class="icon-sig-tool" src="./images/icon_los_disabled.svg" alt="LOS DISABLED" />';

            // If tool is active, deactivate it
            if (this.isActive) {
                this.toolManager.setActiveTool(null);
            }
        }
    }

    removeEventListeners = () => {
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        // ✅ CLEANUP: Cancel all pending operations
        this.cancelPendingUpdates();
    }

    // ✅ PERFORMANCE: Cancel pending RAF/debouncing operations
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
        if (!this.map.getTerrain()) {
            return false; // Bloqueia ativação
        }
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.startPoint = null;
        this.endPoint = null;
        this.clearPreview();
        this.changeButtonColor();
    }

    // ✅ Clear preview
    clearPreview = () => {
        this.cancelPendingUpdates();
        this.map.getSource('temp-line').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const { lng, lat } = e.lngLat;

        if (!this.startPoint) {
            this.startPoint = [lng, lat];
            this.lastPreviewCenter = this.startPoint; // Store for RAF pattern
            this.map.on('mousemove', this.handleMouseMove);
        } else {
            this.endPoint = [lng, lat];
            this.map.off('mousemove', this.handleMouseMove);
            await this.addLOSFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    // ✅ OPTIMIZED: RAF-based preview
    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
        }
    }

    // ✅ PERFORMANCE: RAF callback for smooth preview
    performPreviewUpdate = () => {
        if (!this.lastPreviewCenter || !this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        // Light debouncing for line preview
        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            this.updateTempLine([this.lastPreviewCenter, this.lastPreviewPosition]);
        }, 8); // 8ms debouncing

        this.pendingPreviewUpdate = false;
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
        let losFeature;
        if (losResult.obstructed) {
            losFeature = {
                type: 'Feature',
                id: Date.now().toString(),
                properties: {
                    ...AddLOSControl.DEFAULT_PROPERTIES,
                    profileData: JSON.stringify(await this.calculateProfile([this.startPoint, this.endPoint]))
                },
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
                properties: {
                    ...AddLOSControl.DEFAULT_PROPERTIES,
                    profileData: JSON.stringify(await this.calculateProfile([this.startPoint, this.endPoint]))
                },
                geometry: {
                    type: 'LineString',
                    coordinates: losResult.visible.geometry.coordinates
                }
            };
        }
        
        // ✅ GERAÇÃO AUTOMÁTICA DE NOMES
        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('los', this.map);
        
        losFeature.properties.id = featureId;
        losFeature.properties.nome = featureName;

        // Salvar no IndexedDB
        await addFeature('los', losFeature);
        this.updateFeatureMeasurement(losFeature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        data.features.push(losFeature);
        this.map.getSource('los').setData(data);

        const processedLosFeatures = this.preprocessLosFeature(losFeature);
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));

        for (const processedFeature of processedLosFeatures) {
            await addFeature('processed_los', processedFeature);
            processedData.features.push(processedFeature);
        }

        this.map.getSource('processed-los').setData(processedData);

        this.selectionManager.toggleFeatureSelection('los', losFeature.properties.id, losFeature);
        this.selectionManager.updateUI();
    }

    preprocessLosFeature(feature) {
        const properties = feature.properties;
        let processedFeatures = [];

        if (feature.geometry.type === 'MultiLineString') {
            processedFeatures.push({
                type: 'Feature',
                id: feature.properties.id + '-visible',
                properties: {
                    ...properties,
                    id: feature.properties.id + '-visible',
                    color: AddLOSControl.VISIBLE_COLOR
                },
                geometry: {
                    type: 'LineString',
                    coordinates: feature.geometry.coordinates[0]
                }
            });

            processedFeatures.push({
                type: 'Feature',
                id: feature.properties.id + '-obstructed',
                properties: {
                    ...properties,
                    id: feature.properties.id + '-obstructed',
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
                id: feature.properties.id + '-visible',
                properties: {
                    ...properties,
                    id: feature.properties.id + '-visible',
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
        const steps = Math.ceil(length / 60); // 1 passo por ~60m (2x resolução do DEM)
        const stepLength = length / steps;

        // Get start and end elevations
        const startCoordinates = line.geometry.coordinates[0];
        const endCoordinates = line.geometry.coordinates[line.geometry.coordinates.length - 1];
        const startElevation = await getTerrainElevation(this.map, startCoordinates) + 2;
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

    // ✅ NOVO: Método para recalcular LOS quando feature é movida
    async recalculateLOSFromCoordinates(coordinates) {
        const linestring = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            }
        };
        
        const losResult = await this.calculateLOS(linestring);
        
        if (losResult.obstructed) {
            return {
                type: 'MultiLineString',
                coordinates: [
                    losResult.visible.geometry.coordinates,
                    losResult.obstructed.geometry.coordinates
                ]
            };
        } else {
            return {
                type: 'LineString',
                coordinates: losResult.visible.geometry.coordinates
            };
        }
    }

    // ✅ INTERFACE PARA MOVE HANDLER - Sincronização após drag
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        // LOS precisa recalcular após movimento pois depende do terreno
        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'los') {
                try {
                    // Extrair coordenadas da nova geometria
                    let coordinates;
                    if (movedFeature.geometry.type === 'MultiLineString') {
                        // Usar primeiro e último ponto das duas linhas
                        const firstLine = movedFeature.geometry.coordinates[0];
                        const secondLine = movedFeature.geometry.coordinates[1];
                        coordinates = [firstLine[0], secondLine[secondLine.length - 1]];
                    } else if (movedFeature.geometry.type === 'LineString') {
                        const coords = movedFeature.geometry.coordinates;
                        coordinates = [coords[0], coords[coords.length - 1]];
                    }

                    if (coordinates) {
                        // Recalcular LOS com nova posição
                        const newGeometry = await this.recalculateLOSFromCoordinates(coordinates);
                        const newProfileData = await this.calculateProfile(coordinates);
                        
                        // Atualizar feature principal
                        movedFeature.geometry = newGeometry;
                        movedFeature.properties.profileData = JSON.stringify(newProfileData);
                        
                        // Salvar no IndexedDB
                        await updateFeature('los', movedFeature);
                        
                        // Atualizar medição se habilitada
                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }
                        
                        // Reprocessar features secundárias
                        const processedFeatures = this.preprocessLosFeature(movedFeature);
                        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));
                        
                        // Remover features processadas antigas
                        processedData.features = processedData.features.filter(f =>
                            f.properties.id !== movedFeature.properties.id + '-visible' &&
                            f.properties.id !== movedFeature.properties.id + '-obstructed'
                        );
                        
                        // Adicionar novas features processadas
                        for (const processedFeature of processedFeatures) {
                            await updateFeature('processed_los', processedFeature);
                            processedData.features.push(processedFeature);
                        }
                        
                        // Atualizar source processada no mapa
                        this.map.getSource('processed-los').setData(processedData);
                    }
                } catch (error) {
                    console.error('Erro ao recalcular LOS após movimento:', error);
                }
            }
        }
    }

    // ✅ INTERFACES OBRIGATÓRIAS PARA SELECTION SYSTEM
    isEditingMode = () => {
        return false; // LOS não tem modo de edição com handles
    }

    hasEditHandle = (featureId) => {
        return false; // LOS não tem handles de edição
    }

    onFeatureSelected = (feature) => {
        // LOS não precisa de handles, mas pode implementar highlight no futuro
    }

    onFeatureDeselected = (feature) => {
        // LOS não precisa de cleanup especial
    }

    onGlobalDeselect = () => {
        // LOS não precisa de cleanup especial
    }

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));

        for (const feature of features) {
            // Update los source
            const losFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (losFeature) {
                losFeature.properties[property] = value;
                feature.properties[property] = value;
                this.updateFeatureMeasurement(feature);

                // ✅ FIXED: Update processed-los source with exact ID matching
                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id === feature.properties.id + '-visible' ||
                    f.properties.id === feature.properties.id + '-obstructed'
                );
                processedFeatures.forEach(processedFeature => {
                    processedFeature.properties[property] = value;
                });
            }
        }

        this.map.getSource('los').setData(data);
        this.map.getSource('processed-los').setData(processedData);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
            const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-los')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);

                        // ✅ FIXED: Update processed features with exact ID matching
                        const processedFeatures = processedData.features.filter(f =>
                            f.properties.id === feature.properties.id + '-visible' ||
                            f.properties.id === feature.properties.id + '-obstructed'
                        );
                        processedFeatures.forEach(processedFeature => {
                            Object.keys(feature.properties).forEach(key => {
                                if (key !== 'color') {
                                    processedFeature.properties[key] = feature.properties[key];
                                }
                            });
                        });
                    } else {
                        // Recalculate LOS and update both 'los' and 'processed-los' sources
                        const updatedFeature = await this.recalculateLOS(feature);
                        data.features[featureIndex] = updatedFeature;

                        // ✅ FIXED: Remove old processed features with exact ID matching
                        processedData.features = processedData.features.filter(f =>
                            f.properties.id !== feature.properties.id + '-visible' &&
                            f.properties.id !== feature.properties.id + '-obstructed'
                        );

                        // Add new processed features
                        const newProcessedFeatures = this.preprocessLosFeature(updatedFeature);
                        processedData.features.push(...newProcessedFeatures);
                    }

                    // ✅ FIXED: Use batch operation to prevent race conditions
                    if (save) {
                        const processedFeatures = processedData.features.filter(f =>
                            f.properties.id === feature.properties.id + '-visible' ||
                            f.properties.id === feature.properties.id + '-obstructed'
                        );
                        await batchUpdateLOSFeatures(data.features[featureIndex], processedFeatures);
                        this.updateFeatureMeasurement(data.features[featureIndex]);
                    }
                }
            }
            this.map.getSource('los').setData(data);
            this.map.getSource('processed-los').setData(processedData);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('los')._data;
        const processedData = this.map.getSource('processed-los')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    // ✅ CORRIGIDO: Merge correto das propriedades
                    const featureToSave = {
                        ...currentFeature,  // Geometria atual (pós-drag)
                        properties: { 
                            ...currentFeature.properties,      // Propriedades originais (como profileData)
                            ...selectedFeature.properties      // Propriedades do painel (opacity, width, etc.)
                        }
                    };

                    // ✅ USAR BATCH OPERATION para consistência
                    const processedFeatures = processedData.features.filter(pf =>
                        pf.properties.id === selectedFeature.properties.id + '-visible' ||
                        pf.properties.id === selectedFeature.properties.id + '-obstructed'
                    );

                    // ✅ ATUALIZAR features processadas com propriedades corretas
                    const updatedProcessedFeatures = processedFeatures.map(pf => ({
                        ...pf,
                        properties: {
                            ...pf.properties,                   // Manter ID e color específicos
                            ...selectedFeature.properties,     // Atualizar propriedades do painel
                            id: pf.properties.id,              // Garantir ID correto
                            color: pf.properties.color         // Manter cor específica (verde/vermelho)
                        }
                    }));

                    // ✅ USAR BATCH se disponível, senão individual
                    try {
                        if (typeof batchUpdateLOSFeatures === 'function') {
                            await batchUpdateLOSFeatures(featureToSave, updatedProcessedFeatures);
                        } else {
                            // Fallback: atualização individual
                            await updateFeature('los', featureToSave);
                            for (const processedFeature of updatedProcessedFeatures) {
                                await updateFeature('processed_los', processedFeature);
                            }
                        }
                    } catch (error) {
                        console.error('Erro ao salvar features LOS:', error);
                        // Fallback: atualização individual mesmo com batch
                        await updateFeature('los', featureToSave);
                        for (const processedFeature of updatedProcessedFeatures) {
                            await updateFeature('processed_los', processedFeature);
                        }
                    }
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        // Remover de cada feature individualmente
        for (const feature of features) {
            try {
                const featureId = feature.properties.id;

                // Remover medição
                this.removeFeatureMeasurement(featureId);

                // Store remove automaticamente features principais E processadas
                await removeFeature('los', featureId);

            } catch (error) {
                console.error(`Error removing LOS feature ${featureId}:`, error);
            }
        }

        // Recarregar sources do zero (mais seguro)
        const currentMapFeatures = await getCurrentMapFeatures();

        // Atualizar source principal
        this.map.getSource('los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.los
        });

        // Atualizar source processada
        this.map.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_los
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.profile !== initialProperties.profile ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    updateFeatureMeasurement = (feature) => {
        this.removeFeatureMeasurement(feature.properties.id);
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
            this.displayMeasurement(midpoint.geometry.coordinates, lengthFormatted, feature.properties.id);
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

        // Adicionar estilos para melhor legibilidade
        label.style.cssText = `
            background-color: rgba(255, 255, 255, 0.9);
            border: 2px solid #508D4E;
            border-radius: 6px;
            padding: 6px 10px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: bold;
            color: #333;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            white-space: nowrap;
            pointer-events: none;
            user-select: none;
            transform: translate(-50%, -50%);
            z-index: 1000;
        `;

        return label;
    }

    async calculateProfile(coordinates) {
        const line = turf.lineString(coordinates);
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;

        let profileData = [];

        for (let i = 0; i <= steps; i++) {
            const point = turf.along(line, i * stepLength, { units: 'meters' });
            const elevation = await getTerrainElevation(this.map, point.geometry.coordinates);
            profileData.push({
                distance: i * stepLength,
                elevation: elevation
            });
        }

        return profileData;
    }

    async recalculateLOS(feature) {
        let linestring;
        if (feature.geometry.type === 'MultiLineString') {
            linestring = {
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
            linestring = {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: feature.geometry.coordinates
                }
            };
        }
        const losResult = await this.calculateLOS(linestring);
        let updatedFeature;

        if (losResult.obstructed) {
            updatedFeature = {
                ...feature,
                geometry: {
                    type: 'MultiLineString',
                    coordinates: [
                        losResult.visible.geometry.coordinates,
                        losResult.obstructed.geometry.coordinates
                    ]
                }
            };
        } else {
            updatedFeature = {
                ...feature,
                geometry: {
                    type: 'LineString',
                    coordinates: losResult.visible.geometry.coordinates
                }
            };
        }

        updatedFeature.properties.profileData = JSON.stringify(await this.calculateProfile(linestring.geometry.coordinates));
        return updatedFeature;
    }
}

export default AddLOSControl;