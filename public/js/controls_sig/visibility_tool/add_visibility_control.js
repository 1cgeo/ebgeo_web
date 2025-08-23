// Path: js\controls_sig\visibility_tool\add_visibility_control.js
import { addFeature, updateFeature, removeFeature, getCurrentMapFeatures, batchUpdateVisibilityFeatures } from '../store.js';
import { getTerrainElevation } from '../terrain_control.js';
import { IDUtils } from '../id_utils.js';

// Configuração do grid polar adaptativo
const VIEWSHED_CONFIG = {
    RINGS: 20,                    // Anéis concêntricos
    MIN_RAYS_PER_RING: 4,        // Mínimo de subdivisões angulares
    MAX_RAYS_PER_RING: 20        // Máximo de subdivisões angulares
};

class AddVisibilityControl {
    static DEFAULT_PROPERTIES = {
        opacity: 0.5,
        source: 'visibility',
        observerHeight: 2,  // Altura do observador em metros
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    static VISIBLE_COLOR = '#00FF00';
    static OBSTRUCTED_COLOR = '#FF0000';

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.visibilityControl = this;
        this.isActive = false;
        this.startPoint = null;
        this.selectionManager = toolManager.selectionManager;

        // ✅ PERFORMANCE OPTIMIZATION: RAF & Debouncing (padrão já otimizado)
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;

        // ✅ Progress Modal (já implementado)
        this.progressModal = null;
        this.progressBar = null;
        this.progressText = null;
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
        this.createProgressModal();

        return this.container;
    }

    // ✅ Progress Modal (já implementado - manter como está)
    createProgressModal = () => {
        this.progressModal = document.createElement('div');
        this.progressModal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            min-width: 300px;
        `;

        const title = document.createElement('h3');
        title.textContent = 'Calculando Visibilidade';
        title.style.cssText = `
            margin: 0 0 20px 0;
            color: #333;
            font-size: 18px;
            font-weight: 500;
        `;

        this.progressText = document.createElement('p');
        this.progressText.textContent = 'Analisando terreno...';
        this.progressText.style.cssText = `
            margin: 0 0 20px 0;
            color: #666;
            font-size: 14px;
        `;

        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 100%;
            height: 8px;
            background-color: #f0f0f0;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 10px;
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background-color: #508D4E;
            border-radius: 4px;
            transition: width 0.3s ease;
        `;

        const progressPercentage = document.createElement('div');
        progressPercentage.id = 'progress-percentage';
        progressPercentage.textContent = '0%';
        progressPercentage.style.cssText = `
            font-size: 12px;
            color: #666;
            font-weight: 500;
        `;

        progressContainer.appendChild(this.progressBar);
        modalContent.appendChild(title);
        modalContent.appendChild(this.progressText);
        modalContent.appendChild(progressContainer);
        modalContent.appendChild(progressPercentage);
        this.progressModal.appendChild(modalContent);
        document.body.appendChild(this.progressModal);
    }

    showProgressModal = () => {
        this.progressModal.style.display = 'flex';
        this.updateProgress(0, 'Iniciando análise...');
    }

    updateProgress = (percentage, text = null) => {
        this.progressBar.style.width = `${percentage}%`;
        document.getElementById('progress-percentage').textContent = `${Math.round(percentage)}%`;

        if (text) {
            this.progressText.textContent = text;
        }
    }

    hideProgressModal = () => {
        this.progressModal.style.display = 'none';
        this.updateProgress(0, 'Analisando terreno...');
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

            if (this.progressModal && this.progressModal.parentNode) {
                this.progressModal.parentNode.removeChild(this.progressModal);
            }
        } catch (error) {
            console.error('Error removing AddVisibilityControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
    }

    removeEventListeners = () => {
        this.map.off('mousemove', this.handleMouseMove);
        this.map.off('terrain', this._onTerrainChange);
        this.cancelPendingUpdates();
    }

    _onTerrainChange = () => {
        const terrainEnabled = this.map.getTerrain() !== null;

        if (terrainEnabled) {
            this.container.classList.remove('disabled');
            this.container.querySelector('button').disabled = false;
            this.changeButtonColor();
        } else {
            this.container.classList.add('disabled');
            this.container.querySelector('button').disabled = true;
            this.container.querySelector('button').innerHTML = '<img class="icon-sig-tool" src="./images/icon_visibility_disabled.svg" alt="VIEWSHED DISABLED" />';

            if (this.isActive) {
                this.toolManager.setActiveTool(null);
            }
        }
    }

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
            return false;
        }
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

    handleMouseMove = (e) => {
        if (!this.isActive || !this.startPoint) return;

        this.lastPreviewCenter = this.startPoint;
        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
        }
    }

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
        try {
            const center = turf.point(startPoint);
            const radius = turf.distance(startPoint, endPoint, { units: 'meters' });
            const angle = turf.bearing(startPoint, endPoint);
            const observerHeight = AddVisibilityControl.DEFAULT_PROPERTIES.observerHeight;

            const viewshedResult = await this.calculateViewshed(center, radius, angle, true);

            this.updateProgress(72, 'Otimizando geometrias...');
            await this.delay(100);

            const optimizedCells = this.dissolveVisibilityCells(viewshedResult);

            this.updateProgress(75, 'Criando feature...');
            await this.delay(100);

            const feature = this.createViewshedFeature(optimizedCells, radius, angle, observerHeight);

            // ✅ GERAÇÃO AUTOMÁTICA DE NOMES
            const featureId = IDUtils.generateUniqueId();
            const featureName = IDUtils.generateFeatureName('visibility', this.map);

            feature.properties.id = featureId;
            feature.properties.nome = featureName;
            feature.properties.center = startPoint; // Preservar centro original

            this.updateProgress(80, 'Salvando no banco de dados...');
            await this.delay(100);

            await addFeature('visibility', feature);

            this.updateProgress(85, 'Atualizando mapa...');
            await this.delay(50);

            const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
            data.features.push(feature);
            this.map.getSource('visibility').setData(data);

            this.updateProgress(90, 'Processando células...');
            await this.delay(100);

            const processedVisibilityFeatures = this.preprocessVisibilityFeature(feature);
            const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

            this.updateProgress(95, 'Salvando células processadas...');
            await this.delay(100);

            for (const processedFeature of processedVisibilityFeatures) {
                await addFeature('processed_visibility', processedFeature);
                processedData.features.push(processedFeature);
            }

            this.map.getSource('processed-visibility').setData(processedData);

            this.updateProgress(100, 'Concluído!');
            await this.delay(300);

            this.selectionManager.toggleFeatureSelection('visibility', feature.properties.id, feature);
            this.selectionManager.updateUI();

            this.hideProgressModal();

        } catch (error) {
            console.error('Erro ao calcular visibilidade:', error);
            this.hideProgressModal();
            throw error;
        }
    }

    // ✅ NOVO: Sincronização após drag - Recalculação automática completa
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        console.group('🎯 VISIBILITY SYNC - Recalculação após movimento');

        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'visibility') {
                try {
                    const featureId = movedFeature.properties.id;

                    // ✅ MOSTRAR progress modal para operações longas
                    this.showProgressModal();
                    this.updateProgress(5, 'Detectando nova posição...');
                    await this.delay(100);

                    // ✅ EXTRAIR novo centro da geometria movida
                    const newCenter = this.extractCenterFromMovedGeometry(movedFeature.geometry);

                    if (newCenter) {
                        this.updateProgress(10, 'Preparando recálculo...');
                        await this.delay(100);

                        // ✅ USAR propriedades existentes + novo centro
                        const featureForRecalc = {
                            ...movedFeature,
                            properties: {
                                ...movedFeature.properties,
                                center: newCenter  // Atualizar centro
                            }
                        };

                        // ✅ RECALCULAR usando método existente com progress
                        const updatedFeature = await this.recalculateVisibility(featureForRecalc, true);

                        this.updateProgress(85, 'Salvando alterações...');
                        await this.delay(100);

                        // ✅ SALVAR usando batch operation
                        const processedData = this.map.getSource('processed-visibility')._data;
                        const processedFeatures = processedData.features.filter(pf =>
                            pf.properties.id.startsWith(featureId + '-')
                        ).map(pf => ({
                            ...pf,
                            properties: {
                                ...pf.properties,
                                ...updatedFeature.properties,
                                id: pf.properties.id,      // Manter ID específico
                                color: pf.properties.color  // Manter cor específica
                            }
                        }));

                        await batchUpdateVisibilityFeatures(updatedFeature, processedFeatures);

                        this.updateProgress(95, 'Atualizando interface...');
                        await this.delay(100);

                        // ✅ ATUALIZAR feature na memória para sincronização
                        Object.assign(movedFeature.properties, updatedFeature.properties);
                        movedFeature.geometry = updatedFeature.geometry;

                        this.updateProgress(100, 'Recálculo concluído!');
                        await this.delay(300);
                    }

                } catch (error) {
                    console.error('❌ Erro durante recálculo de visibilidade:', error);
                } finally {
                    this.hideProgressModal();
                }
            }
        }

        console.groupEnd();
    }

    // ✅ NOVO: Extrair centro de geometria MultiPolygon movida
    extractCenterFromMovedGeometry = (geometry) => {
        try {
            if (geometry.type === 'MultiPolygon') {
                // Calcular centroide da primeira célula (aproximação do centro original)
                const firstPolygon = geometry.coordinates[0];
                const polygon = turf.polygon(firstPolygon);
                const centroid = turf.centroid(polygon);
                return centroid.geometry.coordinates;
            } else if (geometry.type === 'Polygon') {
                const polygon = turf.polygon(geometry.coordinates);
                const centroid = turf.centroid(polygon);
                return centroid.geometry.coordinates;
            }
            return null;
        } catch (error) {
            console.error('Erro ao extrair centro da geometria movida:', error);
            return null;
        }
    }

    // ✅ INTERFACES OBRIGATÓRIAS PARA SELECTION SYSTEM
    isEditingMode = () => {
        return false; // Visibility não tem modo de edição com handles
    }

    hasEditHandle = (featureId) => {
        return false; // Visibility não tem handles de edição
    }

    onFeatureSelected = (feature) => {
        // Visibility pode implementar highlight no futuro
    }

    onFeatureDeselected = (feature) => {
        // Visibility não precisa de cleanup especial
    }

    onGlobalDeselect = () => {
        // Visibility não precisa de cleanup especial
    }

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

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

        features.forEach(feature => {
            const f = data.features.find(f => f.properties.id == feature.properties.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;

                const processedFeatures = processedData.features.filter(f =>
                    f.properties.id.startsWith(feature.properties.id + '-')
                );
                processedFeatures.forEach(processedFeature => {
                    processedFeature.properties[property] = value;
                });
            }
        });
        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false, showModal = true) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
            const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);

                        const processedFeatures = processedData.features.filter(f =>
                            f.properties.id.startsWith(feature.properties.id + '-')
                        );
                        processedFeatures.forEach(processedFeature => {
                            Object.keys(feature.properties).forEach(key => {
                                if (key !== 'color') {
                                    processedFeature.properties[key] = feature.properties[key];
                                }
                            });
                        });
                    } else {
                        const updatedFeature = await this.recalculateVisibility(feature, showModal);
                        data.features[featureIndex] = updatedFeature;

                        if (showModal) {
                            this.updateProgress(75, 'Removendo células antigas...');
                            await this.delay(50);
                        }

                        processedData.features = processedData.features.filter(f =>
                            !f.properties.id.startsWith(feature.properties.id + '-')
                        );

                        if (showModal) {
                            this.updateProgress(80, 'Criando novas células...');
                            await this.delay(50);
                        }

                        const newProcessedFeatures = this.preprocessVisibilityFeature(updatedFeature);
                        processedData.features.push(...newProcessedFeatures);
                    }

                    if (save) {
                        if (showModal) {
                            this.updateProgress(90, 'Salvando alterações...');
                            await this.delay(100);
                        }

                        const processedFeatures = processedData.features.filter(f =>
                            f.properties.id.startsWith(feature.properties.id + '-')
                        );
                        await batchUpdateVisibilityFeatures(data.features[featureIndex], processedFeatures);
                    }
                }
            }

            if (showModal) {
                this.updateProgress(95, 'Atualizando mapa...');
                await this.delay(50);
            }

            this.map.getSource('visibility').setData(data);
            this.map.getSource('processed-visibility').setData(processedData);

            if (showModal) {
                this.updateProgress(100, 'Concluído!');
                await this.delay(300);
                this.hideProgressModal();
            }
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        try {
            for (const selectedFeature of features) {
                const featureId = selectedFeature.properties.id;
                const initialProps = initialPropertiesMap.get(featureId);

                if (this.hasFeatureChanged(selectedFeature, initialProps)) {

                    const currentData = this.map.getSource('visibility')._data;
                    const processedData = this.map.getSource('processed-visibility')._data;
                    const currentFeature = currentData.features.find(f => f.properties.id == featureId);

                    if (currentFeature) {
                        // ✅ MERGE correto das propriedades
                        const featureToSave = {
                            ...currentFeature,
                            properties: {
                                ...currentFeature.properties,      // Propriedades originais
                                ...selectedFeature.properties      // Propriedades do painel
                            }
                        };

                        // ✅ PROCESSAR features secundárias
                        const processedFeatures = processedData.features.filter(pf =>
                            pf.properties.id.startsWith(featureId + '-')
                        ).map(pf => ({
                            ...pf,
                            properties: {
                                ...pf.properties,
                                ...selectedFeature.properties,
                                id: pf.properties.id,      // Manter ID específico
                                color: pf.properties.color  // Manter cor específica
                            }
                        }));

                        // ✅ USAR BATCH OPERATION
                        await batchUpdateVisibilityFeatures(featureToSave, processedFeatures);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error in Visibility batch save:', error);

            // ✅ FALLBACK: Save individual (mesmo padrão do LOS)
            console.warn('🔄 Using fallback individual save...');

            for (const selectedFeature of features) {
                const featureId = selectedFeature.properties.id;
                const initialProps = initialPropertiesMap.get(featureId);

                if (this.hasFeatureChanged(selectedFeature, initialProps)) {
                    const currentData = this.map.getSource('visibility')._data;
                    const processedData = this.map.getSource('processed-visibility')._data;
                    const currentFeature = currentData.features.find(f => f.properties.id == featureId);

                    if (currentFeature) {
                        const featureToSave = {
                            ...currentFeature,
                            properties: {
                                ...currentFeature.properties,
                                ...selectedFeature.properties
                            }
                        };

                        await updateFeature('visibility', featureToSave);

                        const processedFeatures = processedData.features.filter(pf =>
                            pf.properties.id.startsWith(featureId + '-')
                        );

                        for (const pf of processedFeatures) {
                            const updatedProcessedFeature = {
                                ...pf,
                                properties: {
                                    ...pf.properties,
                                    ...selectedFeature.properties,
                                    id: pf.properties.id,
                                    color: pf.properties.color
                                }
                            };
                            await updateFeature('processed_visibility', updatedProcessedFeature);
                        }
                    }
                }
            }
        } finally {
            console.groupEnd();
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true, false);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('visibility', featureId);
            } catch (error) {
                console.error(`Error removing Visibility feature ${featureId}:`, error);
            }
        }

        const currentMapFeatures = await getCurrentMapFeatures();

        this.map.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.visibility
        });

        this.map.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: currentMapFeatures.processed_visibility
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.observerHeight !== initialProperties.observerHeight ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    preprocessVisibilityFeature(feature) {
        let processedFeatures = [];
        feature.geometry.coordinates.forEach((polygonCoords, index) => {
            const cellData = feature.properties.cellData[index];

            processedFeatures.push({
                type: 'Feature',
                id: `${feature.properties.id}-${index}`,
                properties: {
                    ...feature.properties,
                    id: `${feature.properties.id}-${index}`,
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

    createViewshedFeature = (cellsData, radius, angle, observerHeight = 2) => {
        const featureId = IDUtils.generateUniqueId();

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                radius: radius,
                angle: angle,
                observerHeight: observerHeight,
                cellData: cellsData.map(cell => ({ isVisible: cell.isVisible })),
                id: featureId
            },
            geometry: {
                type: 'MultiPolygon',
                coordinates: cellsData.map(cell => [cell.coordinates])
            }
        };

        return feature;
    };

    calculateVisibilityAlongRay = async (line, observer) => {
        const length = turf.length(line, { units: 'meters' });
        const steps = 25;
        const stepLength = length / steps;
        const visibilityProfile = [];

        const endPoint = turf.along(line, length, { units: 'meters' });
        const endElevation = await getTerrainElevation(this.map, endPoint.geometry.coordinates);

        for (let i = 1; i <= steps; i++) {
            const currentPoint = turf.along(line, i * stepLength, { units: 'meters' });
            const currentCoords = currentPoint.geometry.coordinates;
            const currentElevation = await getTerrainElevation(this.map, currentCoords);

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

    calculateViewshed = async (center, radius, angle, showModal = false) => {
        try {
            if (showModal) {
                this.showProgressModal();
                await this.delay(100);
            }

            const sectorStart = angle - 22.5;
            const sectorEnd = angle + 22.5;

            if (showModal) {
                this.updateProgress(5, 'Obtendo elevação do observador...');
                await this.delay(50);
            }

            const observerHeight = center.properties?.observerHeight || AddVisibilityControl.DEFAULT_PROPERTIES.observerHeight;
            const observerElevation = await getTerrainElevation(this.map, center.geometry.coordinates) + observerHeight;
            const observer = {
                coord: center.geometry.coordinates,
                elevation: observerElevation
            };

            const cells = [];

            if (showModal) {
                this.updateProgress(10, 'Iniciando análise do terreno...');
                await this.delay(50);
            }

            for (let ring = 0; ring < VIEWSHED_CONFIG.RINGS; ring++) {
                const innerRadius = (ring / VIEWSHED_CONFIG.RINGS) * radius;
                const outerRadius = ((ring + 1) / VIEWSHED_CONFIG.RINGS) * radius;

                const raysInRing = Math.floor(
                    VIEWSHED_CONFIG.MIN_RAYS_PER_RING +
                    (ring / (VIEWSHED_CONFIG.RINGS - 1)) *
                    (VIEWSHED_CONFIG.MAX_RAYS_PER_RING - VIEWSHED_CONFIG.MIN_RAYS_PER_RING)
                );

                const angleStep = 45 / raysInRing;

                for (let ray = 0; ray < raysInRing; ray++) {
                    const startAngle = sectorStart + (ray * angleStep);
                    const endAngle = sectorStart + ((ray + 1) * angleStep);

                    const cell = await this.createSectorCell(center, innerRadius, outerRadius, startAngle, endAngle, observer);
                    cells.push(cell);
                }

                if (showModal) {
                    const ringProgress = 10 + (60 * (ring + 1) / VIEWSHED_CONFIG.RINGS);
                    this.updateProgress(ringProgress, `Processando anel ${ring + 1}/${VIEWSHED_CONFIG.RINGS}...`);
                    await this.delay(30);
                }
            }

            return cells;

        } catch (error) {
            if (showModal) {
                this.hideProgressModal();
            }
            throw error;
        }
    }

    dissolveVisibilityCells = (cells) => {
        try {
            const visibleCells = [];
            const obstructedCells = [];

            cells.forEach(cell => {
                const polygon = turf.polygon([cell.coordinates]);
                polygon.properties = { isVisible: cell.isVisible };

                if (cell.isVisible) {
                    visibleCells.push(polygon);
                } else {
                    obstructedCells.push(polygon);
                }
            });

            const optimizedCells = [];

            if (visibleCells.length > 0) {
                const visibleCollection = turf.featureCollection(visibleCells);
                const dissolvedVisible = turf.dissolve(visibleCollection, { propertyName: 'isVisible' });

                dissolvedVisible.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0],
                        isVisible: true
                    });
                });
            }

            if (obstructedCells.length > 0) {
                const obstructedCollection = turf.featureCollection(obstructedCells);
                const dissolvedObstructed = turf.dissolve(obstructedCollection, { propertyName: 'isVisible' });

                dissolvedObstructed.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0],
                        isVisible: false
                    });
                });
            }

            return optimizedCells;

        } catch (error) {
            console.log(`⚠️ Erro no dissolve, usando geometrias originais:`, error);
            return cells;
        }
    }

    delay = (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createSectorCell = async (center, innerRadius, outerRadius, startAngle, endAngle, observer) => {
        const p1 = turf.destination(center, innerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p2 = turf.destination(center, outerRadius, startAngle, { units: 'meters' }).geometry.coordinates;
        const p3 = turf.destination(center, outerRadius, endAngle, { units: 'meters' }).geometry.coordinates;
        const p4 = turf.destination(center, innerRadius, endAngle, { units: 'meters' }).geometry.coordinates;

        const midAngle = (startAngle + endAngle) / 2;
        const testPoint = turf.destination(center, outerRadius, midAngle, { units: 'meters' });

        const line = turf.lineString([observer.coord, testPoint.geometry.coordinates]);
        const length = turf.length(line, { units: 'meters' });
        const steps = Math.ceil(length / 60);
        const stepLength = length / steps;

        const testElevation = await getTerrainElevation(this.map, testPoint.geometry.coordinates);

        let isVisible = true;

        for (let i = 1; i <= steps; i++) {
            const segment = turf.along(line, i * stepLength, { units: 'meters' });
            const segmentCoordinates = segment.geometry.coordinates;

            const expectedElevation = observer.elevation + (testElevation - observer.elevation) * (i / steps);
            const actualElevation = await getTerrainElevation(this.map, segmentCoordinates);

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

    async recalculateVisibility(feature, showModal = true) {
        let centerCoord = feature.properties.center;
        if (!centerCoord) {
            if (feature.geometry.type === 'MultiPolygon') {
                centerCoord = feature.geometry.coordinates[0][0][0];
            } else if (feature.geometry.type === 'Polygon') {
                centerCoord = feature.geometry.coordinates[0][0];
            }
        }

        const { radius, angle, observerHeight } = feature.properties;
        const center = turf.point(centerCoord);
        center.properties = { observerHeight };

        const viewshedResult = await this.calculateViewshed(center, radius, angle, showModal);

        let optimizedCells = viewshedResult;

        if (showModal) {
            this.updateProgress(70, 'Otimizando geometrias...');
            await this.delay(100);
            optimizedCells = this.dissolveVisibilityCells(viewshedResult);
        }

        const updatedFeature = this.createViewshedFeature(optimizedCells, radius, angle, observerHeight);

        updatedFeature.properties.id = feature.properties.id;
        updatedFeature.properties = { ...feature.properties, ...updatedFeature.properties };
        updatedFeature.properties.center = centerCoord;

        return updatedFeature;
    }
}

export default AddVisibilityControl;