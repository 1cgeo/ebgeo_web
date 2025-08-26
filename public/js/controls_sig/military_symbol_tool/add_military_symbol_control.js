// Path: js\controls_sig\military_symbol_tool\add_military_symbol_control.js

import { addFeature, updateFeature, removeFeature, imageStore } from '../store.js';
import { MilitarySymbolGenerator } from './military_symbol_generator.js';
import { IDUtils } from '../id_utils.js';

class AddMilitarySymbolControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.militarySymbolControl = this;
        this.selectionManager = toolManager.selectionManager;
        
        // Core state
        this.isActive = false;
        this.selectedFeature = null;
        this.symbolGenerator = new MilitarySymbolGenerator();

        // Performance optimization para símbolos (mantido)
        this.symbolRafId = null;
        this.pendingSymbolUpdate = false;
        this.lastSymbolFeature = null;
        this.symbolDebounceTimer = null;

        // Zoom handling (seguindo padrão do text control)
        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
    }

    static DEFAULT_PROPERTIES = {
        // Campos do SIDC específicos (mantidos)
        context: "0",
        standardIdentity: "3",
        status: "0",
        hqTfDummy: "0",
        echelon: "16",
        mainIcon: "121100",
        modifier1: "00",
        modifier2: "00",

        // Propriedades de renderização
        size: 1.0,
        width: 100,
        height: 100,
        opacity: 1.0,
        rotation: 0,

        // Zoom-invariant properties (seguindo text control)
        createdAtZoom: 0,
        calculatedSize: 1.0,
        selectionBox: null,  // GeoJSON Polygon geometry

        // Identificadores
        id: null,
        source: 'military_symbol',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl military-symbol-control controls-column-right';

        this.button = document.createElement('button');
        this.button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        this.button.setAttribute("id", "military-symbol-tool");
        this.button.type = 'button';
        this.button.innerHTML = '<img class="icon-military-tool" src="./images/icon_military_black.svg" alt="MILITARY" />';
        this.button.title = 'Adicionar Símbolo Militar (M)';
        this.button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(this.button);
        this.setupEventListeners();
        this.setupZoomListener();
        this.changeButtonColor();

        return this.container;
    }

    onRemove() {
        try {
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;
            
            this.removeEventListeners();
            this.cancelPendingUpdates();
            this.deactivate();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddMilitarySymbolControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        // Event listeners básicos se necessário
    }

    removeEventListeners = () => {
        this.removeHoverListeners();
    }

    changeButtonColor = () => {
        const iconSrc = this.isActive ?
            './images/icon_military_red.svg' :
            './images/icon_military_black.svg';
        $("#military-symbol-tool").html(`<img class="icon-military-tool" src="${iconSrc}" alt="MILITARY" />`);
    }

    // ===== ZOOM-INVARIANT SYSTEM (seguindo text control) =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllSymbolSizes);
        }
    }

    applyZoomCorrections = (features) => {
        const currentZoom = this.map.getZoom();

        return features.map(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10); // Limite máximo 10x
            return feature;
        });
    }

    updateAllSymbolSizes = () => {
        if (!this.map.getSource('military_symbols')) {
            return;
        }
        
        const currentZoom = this.map.getZoom();
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        let hasChanges = false;

        data.features.forEach(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedSize = Math.min(feature.properties.size * scaleFactor, 10);
            
            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            this.map.getSource('military_symbols').setData(data);
        }

        this.pendingZoomUpdate = false;
    }

    // Método para calcular selection box (seguindo text control)
    calculateSelectionBoxGeometry = (coordinates, width, height, size, rotation, createdAtZoom) => {
        // Aplicar size como fator de escala + correção de 62%
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;
        const expandedDimensions = this.toolManager.uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;
        
        // Usar zoom de criação para conversão
        const centerLat = coordinates[1];
        const widthDegrees = this.toolManager.uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        const heightDegrees = this.toolManager.uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        
        return this.createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees);
    }

    createSelectionBoxFromDegrees = (coordinates, widthDegrees, heightDegrees) => {
        const [lng, lat] = coordinates;
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;
        
        return {
            type: 'Polygon',
            coordinates: [[
                [lng - halfWidth, lat - halfHeight],
                [lng + halfWidth, lat - halfHeight],
                [lng + halfWidth, lat + halfHeight],
                [lng - halfWidth, lat + halfHeight],
                [lng - halfWidth, lat - halfHeight]
            ]]
        };
    }

    // Garantir consistência (seguindo text control)
    ensureFeatureConsistency = (feature, currentZoom = null, forceRecalculateSelectionBox = false) => {
        if (!currentZoom) {
            currentZoom = this.map.getZoom();
        }
        
        // Sempre recalcular calculatedSize baseado no zoom atual
        const zoomDifference = currentZoom - feature.properties.createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10);
        
        // Recalcular selectionBox apenas quando forçado ou se não existir
        if (forceRecalculateSelectionBox || !feature.properties.selectionBox) {
            feature.properties.selectionBox = this.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom
            );
        }
        
        return feature;
    }

    getLatestFeatureData = (featureId) => {
        const data = this.map.getSource('military_symbols')._data;
        return data.features.find(f => f.properties.id == featureId);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.cancelPendingUpdates();
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
        this.deselectFeature();
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const coordinates = [e.lngLat.lng, e.lngLat.lat];
        await this.createMilitarySymbol(coordinates);

        this.toolManager.deactivateCurrentTool();
    }

    async createMilitarySymbol(coordinates) {
        try {
            const symbolId = IDUtils.generateUniqueId();

            const properties = {
                ...AddMilitarySymbolControl.DEFAULT_PROPERTIES,
                id: symbolId
            };

            properties.nome = IDUtils.generateFeatureName('military_symbol', this.map);

            // Gerar SIDC usando propriedades padrão
            const sidc = this.symbolGenerator.buildSIDC(properties);
            properties.sidc = sidc;

            // Definir zoom properties
            const currentZoom = this.map.getZoom();
            properties.createdAtZoom = currentZoom;
            properties.calculatedSize = properties.size;

            const feature = {
                type: 'Feature',
                id: Date.now().toString(),
                geometry: {
                    type: 'Point',
                    coordinates: coordinates
                },
                properties: properties
            };

            // Calcular selection box
            feature.properties.selectionBox = this.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom
            );

            // Gerar blob do símbolo e salvar no imageStore
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(properties);
            await imageStore.setItem(symbolId, symbolBlob);

            // Atualizar layer
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
            data.features.push(feature);
            this.map.getSource('military_symbols').setData(data);

            // Salvar feature no store
            await addFeature('military_symbols', feature);

            // Carregar imagem no mapa
            await this.loadSymbolImageToMap(symbolId, symbolBlob);

            // Selecionar o símbolo criado
            this.selectionManager.toggleFeatureSelection('military_symbol', feature.properties.id, feature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Erro ao criar símbolo militar:', error);
            alert('Erro ao criar símbolo militar');
        }
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectedFeature = feature;
        this.setupHoverListeners();
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;
        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.selectedFeature) {
            this.deselectFeature();
        }
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;
        
        const features = this.map.queryRenderedFeatures(e.point);
        const hasSelectedFeature = features.some(f => 
            f.source === 'military_symbols' && 
            f.properties.id === this.selectedFeature.properties.id
        );
        
        this.map.getCanvas().style.cursor = hasSelectedFeature ? 'move' : '';
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // N/A
    }

    // ===== BLOB STORAGE E SYMBOL GENERATION - MANTIDOS =====

    async loadSymbolImageToMap(imageId, blob) {
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => {
                try {
                    if (!this.map.hasImage(imageId)) {
                        this.map.addImage(imageId, image);
                    }
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Falha ao carregar símbolo ${imageId}`));
            };

            setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout ao carregar símbolo ${imageId}`));
            }, 10000);

            image.src = url;
        });
    }

    // Sistema RAF otimizado para símbolos (mantido)
    scheduleSymbolUpdate = (feature) => {
        this.lastSymbolFeature = feature;

        if (!this.pendingSymbolUpdate) {
            this.pendingSymbolUpdate = true;
            this.symbolRafId = requestAnimationFrame(this.performSymbolUpdate.bind(this));
        }
    }

    performSymbolUpdate = () => {
        if (!this.lastSymbolFeature) {
            this.pendingSymbolUpdate = false;
            return;
        }

        clearTimeout(this.symbolDebounceTimer);
        this.symbolDebounceTimer = setTimeout(() => {
            this.updateSymbolImage(this.lastSymbolFeature);
        }, 8);

        this.pendingSymbolUpdate = false;
    }

    async updateSymbolImage(feature) {
        try {
            // Gerar nova imagem e salvar no imageStore
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(feature.properties);
            await imageStore.setItem(feature.properties.id, symbolBlob);

            // Atualizar imagem no mapa
            if (this.map.hasImage(feature.properties.id)) {
                this.map.removeImage(feature.properties.id);
            }
            await this.loadSymbolImageToMap(feature.properties.id, symbolBlob);

        } catch (error) {
            console.error('Erro ao atualizar símbolo:', error);
        }
    }

    cancelPendingUpdates = () => {
        if (this.symbolRafId) {
            cancelAnimationFrame(this.symbolRafId);
            this.symbolRafId = null;
        }
        this.pendingSymbolUpdate = false;
        this.lastSymbolFeature = null;

        if (this.symbolDebounceTimer) {
            clearTimeout(this.symbolDebounceTimer);
            this.symbolDebounceTimer = null;
        }
    }

    // ===== FEATURE MANAGEMENT METHODS =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                const oldSIDC = sourceFeature.properties.sidc;

                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Propriedades que afetam o SIDC devem regenerar a imagem
                const sidcProperties = [
                    'context', 'standardIdentity', 'status', 'hqTfDummy',
                    'echelon', 'mainIcon', 'modifier1', 'modifier2'
                ];

                if (sidcProperties.includes(property)) {
                    // Calcular novo SIDC
                    const newSIDC = this.symbolGenerator.buildSIDC(sourceFeature.properties);
                    sourceFeature.properties.sidc = newSIDC;
                    feature.properties.sidc = newSIDC;

                    // Only regenerate if SIDC actually changed
                    if (oldSIDC !== newSIDC) {
                        this.scheduleSymbolUpdate(feature);
                    }
                }

                // Recalcular selection box se propriedades intrínsecas mudaram
                const shouldRecalculateSelectionBox = ['size', 'rotation'].includes(property);
                
                // Garantir consistência
                this.ensureFeatureConsistency(sourceFeature, null, shouldRecalculateSelectionBox);
                
                // Sincronizar de volta
                feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
                feature.properties.selectionBox = sourceFeature.properties.selectionBox;
            }
        }

        this.map.getSource('military_symbols').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    const sourceFeature = data.features[featureIndex];
                    
                    if (onlyUpdateProperties) {
                        Object.assign(sourceFeature.properties, feature.properties);
                        this.ensureFeatureConsistency(sourceFeature, null, false);
                    } else {
                        // Atualizar geometria = drag operation
                        sourceFeature.geometry = feature.geometry;
                        // Forçar recálculo da selection box para nova posição
                        this.ensureFeatureConsistency(sourceFeature, null, true);
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? sourceFeature : sourceFeature;
                        await updateFeature('military_symbols', featureToUpdate);
                    }
                }
            }
            this.map.getSource('military_symbols').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('military_symbols')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('military_symbols', featureToSave);
                }
            }
        }
    }

    // Lógica específica de discard com regeneração SIDC (mantida)
    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.properties.id)) {
                const originalProps = initialPropertiesMap.get(feature.properties.id);
                const oldSIDC = feature.properties.sidc;
                feature.properties = { ...originalProps };

                if (feature.properties.sidc !== oldSIDC) {
                    this.scheduleSymbolUpdate(feature);
                }
            }
        }
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));
        this.map.getSource('military_symbols').setData(data);

        for (const feature of features) {
            try {
                await imageStore.removeItem(feature.properties.id);
                await removeFeature('military_symbols', feature.properties.id);
            } catch (error) {
                console.error(`Erro ao deletar símbolo militar ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddMilitarySymbolControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;
        return (
            // Todas as propriedades específicas de símbolos militares (mantidas)
            feature.properties.context !== initialProperties.context ||
            feature.properties.standardIdentity !== initialProperties.standardIdentity ||
            feature.properties.status !== initialProperties.status ||
            feature.properties.hqTfDummy !== initialProperties.hqTfDummy ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.mainIcon !== initialProperties.mainIcon ||
            feature.properties.modifier1 !== initialProperties.modifier1 ||
            feature.properties.modifier2 !== initialProperties.modifier2 ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }
}

export default AddMilitarySymbolControl;