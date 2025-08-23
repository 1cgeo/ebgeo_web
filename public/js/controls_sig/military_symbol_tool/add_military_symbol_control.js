// Path: js\controls_sig\military_symbol_tool\add_military_symbol_control.js

import { addFeature, updateFeature, removeFeature, imageStore } from '../store.js';
import { MilitarySymbolGenerator } from './military_symbol_generator.js';
import { IDUtils } from '../id_utils.js';

class AddMilitarySymbolControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.militarySymbolControl = this;
        this.selectionManager = toolManager.selectionManager;
        
        // ✅ CORE STATE - Padronizado
        this.isActive = false;
        this.selectedFeature = null;  // ✅ NOVO - para integração com selection system
        this.symbolGenerator = new MilitarySymbolGenerator();

        // ✅ MANTIDO - Performance optimization específica para símbolos (RAF & Debouncing)
        this.symbolRafId = null;
        this.pendingSymbolUpdate = false;
        this.lastSymbolFeature = null;
        this.symbolDebounceTimer = null;
    }

    // ✅ ATUALIZADO - com novos atributos padrão + todos os campos SIDC específicos mantidos
    static DEFAULT_PROPERTIES = {
        // ✅ MANTIDO - Campos do SIDC específicos (essenciais para símbolos militares)
        context: "0",                   // B: Contexto (0=realidade)
        standardIdentity: "3",          // C: Standard Identity (3=amigo)
        status: "0",                    // E: Status (0=presente)
        hqTfDummy: "0",                // F: HQ/TF/Dummy (0=não aplicável)
        echelon: "16",                  // G: Escalão (16=batalhão)
        mainIcon: "121100",             // H: Ícone principal (121100=infantaria)
        modifier1: "00",                // I: Modificador 1
        modifier2: "00",                // J: Modificador 2

        // ✅ MANTIDO - Propriedades de renderização específicas
        size: 1.0,
        width: 100,
        height: 100,
        opacity: 1.0,
        rotation: 0,

        // Identificadores
        id: null,
        source: 'military_symbol',
        nome: '',           // Será preenchido automaticamente
        descricao: '',      // String vazia
        visivel: true,      // Boolean true
        bloqueado: false    // Boolean false
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
        this.changeButtonColor();

        return this.container;
    }

    onRemove() {
        try {
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

    // ✅ ATUALIZADO - com cleanup hover
    removeEventListeners = () => {
        this.removeHoverListeners(); // ✅ NOVO - cleanup hover
    }

    changeButtonColor = () => {
        const iconSrc = this.isActive ?
            './images/icon_military_red.svg' :
            './images/icon_military_black.svg';
        $("#military-symbol-tool").html(`<img class="icon-military-tool" src="${iconSrc}" alt="MILITARY" />`);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    // ✅ ATUALIZADO - com cleanup ao desativar
    deactivate = () => {
        this.isActive = false;
        this.cancelPendingUpdates();
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
        this.deselectFeature(); // ✅ NOVO - cleanup ao desativar
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const coordinates = [e.lngLat.lng, e.lngLat.lat];
        await this.createMilitarySymbol(coordinates);

        this.toolManager.deactivateCurrentTool();
    }

    // ✅ ATUALIZADO - com geração automática de nomes
    async createMilitarySymbol(coordinates) {
        try {
            // Gerar ID único
            const symbolId = IDUtils.generateUniqueId();

            const properties = {
                ...AddMilitarySymbolControl.DEFAULT_PROPERTIES,
                id: symbolId
            };

            // ✅ NOVO - Geração automática de nomes
            properties.nome = IDUtils.generateFeatureName('military_symbol', this.map);

            // ✅ MANTIDO - Gerar SIDC usando propriedades padrão (lógica específica preservada)
            const sidc = this.symbolGenerator.buildSIDC(properties);
            properties.sidc = sidc;

            const feature = {
                type: 'Feature',
                id: Date.now().toString(),
                geometry: {
                    type: 'Point',
                    coordinates: coordinates
                },
                properties: properties
            };

            // ✅ MANTIDO - Gerar blob do símbolo e salvar no imageStore (lógica específica preservada)
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(properties);
            await imageStore.setItem(symbolId, symbolBlob);

            // Atualizar layer
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
            data.features.push(feature);
            this.map.getSource('military_symbols').setData(data);

            // Salvar feature no store
            await addFeature('military_symbols', feature);

            // ✅ MANTIDO - Carregar imagem no mapa (seguindo padrão do map.js)
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

    // ✅ NOVO - Interface para SelectionManager
    onFeatureSelected = (feature) => {
        this.selectedFeature = feature;
        this.setupHoverListeners(); // ✅ Hover dinâmico quando selecionado
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

    // ✅ NOVO - Método de desseleção
    deselectFeature = () => {
        this.selectedFeature = null;
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    // ✅ NOVO - Sistema hover dinâmico (padrão dos outros controls)
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

    // ✅ NOVO - Interface methods para MoveHandler integration
    isEditingMode = () => {
        return false; // Military Symbol não tem editing mode com handles
    }

    hasEditHandle = (featureId) => {
        return false; // Military Symbol não tem handles para editar
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // N/A - Military Symbol não tem handles para sincronizar
    }

    // ===== BLOB STORAGE E SYMBOL GENERATION - MANTIDOS INALTERADOS =====

    // ✅ MANTIDO - Método que segue exatamente o padrão do map.js
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

            // Timeout para evitar travamento
            setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout ao carregar símbolo ${imageId}`));
            }, 10000);

            image.src = url;
        });
    }

    // ✅ MANTIDO - Sistema RAF otimizado para símbolos (performance crítica)
    scheduleSymbolUpdate = (feature) => {
        this.lastSymbolFeature = feature;

        if (!this.pendingSymbolUpdate) {
            this.pendingSymbolUpdate = true;
            this.symbolRafId = requestAnimationFrame(this.performSymbolUpdate.bind(this));
        }
    }

    // ✅ MANTIDO - Performance optimization específica para símbolos
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

    // ✅ MANTIDO - Atualização inteligente de símbolos
    async updateSymbolImage(feature) {
        try {
            // Gerar nova imagem e salvar no imageStore
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(feature.properties);
            await imageStore.setItem(feature.properties.id, symbolBlob);

            // Atualizar imagem no mapa (seguindo padrão do map.js)
            if (this.map.hasImage(feature.properties.id)) {
                this.map.removeImage(feature.properties.id);
            }
            await this.loadSymbolImageToMap(feature.properties.id, symbolBlob);

        } catch (error) {
            console.error('Erro ao atualizar símbolo:', error);
        }
    }

    // ✅ MANTIDO - Cleanup otimizado específico para símbolos
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

    // ✅ MANTIDO - Lógica específica de detecção de mudanças SIDC preservada
    updateFeaturesProperty = async (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));

        for (const feature of features) {
            const f = data.features.find(f => f.properties.id == feature.properties.id);
            if (f) {
                const oldSIDC = f.properties.sidc;

                f.properties[property] = value;
                feature.properties[property] = value;

                // ✅ MANTIDO - Propriedades que afetam o SIDC devem regenerar a imagem
                const sidcProperties = [
                    'context', 'standardIdentity', 'status', 'hqTfDummy',
                    'echelon', 'mainIcon', 'modifier1', 'modifier2'
                ];

                if (sidcProperties.includes(property)) {
                    // Calcular novo SIDC
                    const newSIDC = this.symbolGenerator.buildSIDC(f.properties);
                    f.properties.sidc = newSIDC;
                    feature.properties.sidc = newSIDC;

                    // Only regenerate if SIDC actually changed
                    if (oldSIDC !== newSIDC) {
                        this.scheduleSymbolUpdate(feature);
                    }
                }
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
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
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

    // ✅ MANTIDO - Lógica específica de discard com regeneração SIDC
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

    // ✅ MANTIDO - Delete com blob storage específico para símbolos
    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        // Primeiro, remover features do source
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));
        this.map.getSource('military_symbols').setData(data);

        // Remover recursos e feições
        for (const feature of features) {
            try {
                // Remover imagem do imageStore usando f.properties.id (garantia de consistência)
                await imageStore.removeItem(feature.properties.id);

                // Remover do IndexedDB
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
            // ✅ MANTIDO - Todas as propriedades específicas de símbolos militares
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