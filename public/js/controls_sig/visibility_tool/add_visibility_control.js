// Path: js\controls_sig\visibility_tool\add_visibility_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
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
        observerHeight: 2  // ✅ NOVO: Altura do observador em metros (default 2m)
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

        // ✅ NOVO: Progress Modal
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
        this.createProgressModal(); // ✅ NOVO: Criar modal de progresso

        return this.container;
    }

    // ✅ NOVO: Criar modal de progresso
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

    // ✅ NOVO: Mostrar modal de progresso
    showProgressModal = () => {
        this.progressModal.style.display = 'flex';
        this.updateProgress(0, 'Iniciando análise...');
    }

    // ✅ NOVO: Atualizar progresso
    updateProgress = (percentage, text = null) => {
        this.progressBar.style.width = `${percentage}%`;
        document.getElementById('progress-percentage').textContent = `${Math.round(percentage)}%`;

        if (text) {
            this.progressText.textContent = text;
        }
    }

    // ✅ NOVO: Esconder modal de progresso
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

            // ✅ NOVO: Limpar modal de progresso
            if (this.progressModal && this.progressModal.parentNode) {
                this.progressModal.parentNode.removeChild(this.progressModal);
            }
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

    // ✅ MODIFICADO: Progresso completo incluindo dissolve e salvamento
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

            // ✅ CORREÇÃO: Adicionar centro original nas propriedades
            feature.properties.center = startPoint;

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

    preprocessVisibilityFeature(feature) {
        let processedFeatures = [];
        feature.geometry.coordinates.forEach((polygonCoords, index) => {
            const cellData = feature.properties.cellData[index];

            processedFeatures.push({
                type: 'Feature',
                id: `${feature.properties.id}-${index}`,
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

    createViewshedFeature = (cellsData, radius, angle, observerHeight = 2) => {
        const featureId = IDUtils.generateUniqueId();

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddVisibilityControl.DEFAULT_PROPERTIES,
                radius: radius,
                angle: angle,
                observerHeight: observerHeight, // ✅ NOVO: Incluir altura do observador
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
            const f = data.features.find(f => f.properties.id == feature.properties.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;

                const processedFeatures = processedData.features.filter(f => f.properties.id.startsWith(feature.properties.id));
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

                        const processedFeatures = processedData.features.filter(f => f.properties.id.startsWith(feature.properties.id));
                        processedFeatures.forEach(processedFeature => {
                            Object.keys(feature.properties).forEach(key => {
                                if (key !== 'color') {
                                    processedFeature.properties[key] = feature.properties[key];
                                }
                            });
                        });
                    } else {
                        // ✅ MODIFICADO: Passes observerHeight to recalculation
                        const updatedFeature = await this.recalculateVisibility(feature, showModal);
                        data.features[featureIndex] = updatedFeature;

                        if (showModal) {
                            this.updateProgress(75, 'Removendo células antigas...');
                            await this.delay(50);
                        }

                        processedData.features = processedData.features.filter(f => !f.properties.id.startsWith(feature.properties.id));

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

                        await updateFeature('visibility', data.features[featureIndex]);
                        const processedFeatures = processedData.features.filter(f => f.properties.id.startsWith(feature.properties.id));
                        for (const pf of processedFeatures) {
                            await updateFeature('processed_visibility', pf);
                        }
                    }
                }
            };

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
        const currentData = this.map.getSource('visibility')._data;
        const processedData = this.map.getSource('processed-visibility')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('visibility', featureToSave);

                    // Atualizar features processadas também
                    const processedFeatures = processedData.features.filter(pf => pf.properties.id.startsWith(selectedFeature.properties.id));
                    for (const pf of processedFeatures) {
                        const updatedProcessedFeature = {
                            ...pf,
                            properties: {
                                ...selectedFeature.properties,
                                color: pf.properties.color // Manter cor específica processada
                            }
                        };
                        await updateFeature('processed_visibility', updatedProcessedFeature);
                    }
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        // ✅ MODIFICADO: Não mostrar modal para operação de descarte
        await this.updateFeatures(features, true, true, false);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) {
            return;
        }

        // ✅ PASSO 1: Buscar células processadas ANTES de filtrar os dados
        const cellsToRemove = [];
        for (const f of features) {
            const currentProcessedData = this.map.getSource('processed-visibility')._data;
            const relatedCells = currentProcessedData.features.filter(pf => pf.properties.id.startsWith(`${f.properties.id}-`));
            cellsToRemove.push(...relatedCells);
        }

        // ✅ PASSO 2: Remover do IndexedDB PRIMEIRO
        for (const f of features) {
            await removeFeature('visibility', f.properties.id);
        }

        // ✅ PASSO 3: Atualizar fontes visuais POR ÚLTIMO
        const data = JSON.parse(JSON.stringify(this.map.getSource('visibility')._data));
        const processedData = JSON.parse(JSON.stringify(this.map.getSource('processed-visibility')._data));
        const idsToDelete = new Set(features.map(f => f.properties.id.toString()));

        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));
        processedData.features = processedData.features.filter(f => !idsToDelete.has(f.properties.id.split('-')[0]));

        this.map.getSource('visibility').setData(data);
        this.map.getSource('processed-visibility').setData(processedData);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.observerHeight !== initialProperties.observerHeight  // ✅ NOVO: Considera mudança na altura
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

    // ✅ MODIFICADO: calculateViewshed vai até 70%, não esconde modal
    calculateViewshed = async (center, radius, angle, showModal = false) => {
        try {
            if (showModal) {
                this.showProgressModal();
                await this.delay(100); // Pequeno delay para mostrar o modal
            }

            const sectorStart = angle - 22.5;
            const sectorEnd = angle + 22.5;

            if (showModal) {
                this.updateProgress(5, 'Obtendo elevação do observador...');
                await this.delay(50);
            }

            // ✅ MODIFICADO: Usar observerHeight da propriedade da feature ou default
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

                if (showModal) {
                    // ✅ CORRIGIDO: Progresso de 10% a 70% durante o processamento dos anéis
                    const ringProgress = 10 + (60 * (ring + 1) / VIEWSHED_CONFIG.RINGS);
                    this.updateProgress(ringProgress, `Processando anel ${ring + 1}/${VIEWSHED_CONFIG.RINGS}...`);
                    await this.delay(30); // Delay para visualizar o progresso
                }
            }

            // ✅ REMOVIDO: Não esconde mais o modal aqui (feito nas funções chamadoras)
            return cells;

        } catch (error) {
            if (showModal) {
                this.hideProgressModal();
            }
            throw error;
        }
    }

    // ✅ NOVO: Dissolve células de visibilidade para otimizar performance
    dissolveVisibilityCells = (cells) => {
        try {
            // Separar células por visibilidade
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

            // Dissolve células visíveis
            if (visibleCells.length > 0) {
                const visibleCollection = turf.featureCollection(visibleCells);
                const dissolvedVisible = turf.dissolve(visibleCollection, { propertyName: 'isVisible' });

                dissolvedVisible.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0], // Primeiro anel do polígono
                        isVisible: true
                    });
                });
            }

            // Dissolve células obstruídas
            if (obstructedCells.length > 0) {
                const obstructedCollection = turf.featureCollection(obstructedCells);
                const dissolvedObstructed = turf.dissolve(obstructedCollection, { propertyName: 'isVisible' });

                dissolvedObstructed.features.forEach(feature => {
                    optimizedCells.push({
                        coordinates: feature.geometry.coordinates[0], // Primeiro anel do polígono
                        isVisible: false
                    });
                });
            }

            return optimizedCells;

        } catch (error) {
            console.log(`❌ Erro no dissolve, usando geometrias originais:`, error);
            return cells; // Fallback para células originais
        }
    }

    // ✅ NOVO: Função auxiliar para delays
    delay = (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    async recalculateVisibility(feature, showModal = true) {
        // ✅ CORREÇÃO: Usar centro salvo em vez de geometria
        let centerCoord = feature.properties.center;
        // Fallback para compatibilidade com features antigas
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

        // ✅ CORREÇÃO: Preservar centro original
        updatedFeature.properties.center = centerCoord;

        return updatedFeature;
    }
}

export default AddVisibilityControl;