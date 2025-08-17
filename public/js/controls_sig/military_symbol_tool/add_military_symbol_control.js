// Path: js\controls_sig\military_symbol_tool\add_military_symbol_control.js

import { addFeature, updateFeature, removeFeature, imageStore } from '../store.js';
import { MilitarySymbolGenerator } from './military_symbol_generator.js';

class AddMilitarySymbolControl {
    static DEFAULT_PROPERTIES = {
        // Componentes do SIDC - Padrão: Batalhão de Infantaria Amigo
        affiliation: "03",      // Amigo
        dimension: "10",        // Unidade Terrestre
        echelon: "16",          // Batalhão
        mainIcon: "121100",     // Infantaria
        modifier2: "00",        // Nenhum modificador
        
        // Modificadores lógicos (não entram diretamente no SIDC)
        modifier1: "none",
        modifierTransversal: "none",
        
        // Propriedades de renderização (não afetam SIDC)
        size: 35,
        opacity: 1.0,
        rotation: 0,
        
        // Identificadores
        id: null,
        source: 'military_symbol'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.militarySymbolControl = this;
        this.selectionManager = toolManager.selectionManager;
        this.isActive = false;
        this.symbolGenerator = new MilitarySymbolGenerator();
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl military-symbol-control controls-column-right';
        
        this.button = document.createElement('button');
        this.button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        this.button.setAttribute("id", "military-symbol-tool");
        this.button.type = 'button';
        this.button.innerHTML = '<img class="icon-military-tool" src="./images/icon_military_black.svg" alt="MILITARY" />';
        this.button.title = 'Adicionar Símbolo Militar';
        this.button.onclick = () => this.toolManager.setActiveTool(this);
        
        this.container.appendChild(this.button);
        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    onRemove() {
        try {
            this.removeEventListeners();
            this.deactivate();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddMilitarySymbolControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'military-symbols-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'military-symbols-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'military-symbols-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'military-symbols-layer', this.handleMouseLeave);
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

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        const coordinates = [e.lngLat.lng, e.lngLat.lat];
        await this.createMilitarySymbol(coordinates);
        
        this.toolManager.deactivateCurrentTool();
    }

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }

    async createMilitarySymbol(coordinates) {
        const symbolId = this.generateUniqueId();
        const properties = { 
            ...AddMilitarySymbolControl.DEFAULT_PROPERTIES,
            id: symbolId
        };

        // Gerar SIDC usando propriedades padrão
        const sidc = this.symbolGenerator.buildSIDC(properties);
        properties.sidc = sidc;
        
        // Usar symbolId como imageId (análogo ao image control)
        properties.imageId = symbolId;

        const feature = {
            type: 'Feature',
            id: symbolId,
            geometry: {
                type: 'Point',
                coordinates: coordinates
            },
            properties: properties
        };

        try {
            // Gerar blob do símbolo e salvar no imageStore
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(properties);
            await imageStore.setItem(symbolId, symbolBlob);

            // Carregar imagem no mapa PRIMEIRO
            await this.loadSymbolImageToMap(symbolId, symbolBlob);

            // Só então adicionar feature ao source (evita race condition)
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
            data.features.push(feature);
            this.map.getSource('military_symbols').setData(data);

            // Salvar feature no store
            await addFeature('military_symbols', feature);

            // Selecionar o símbolo criado
            this.selectionManager.toggleFeatureSelection('military_symbol', feature.id, feature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Erro ao criar símbolo militar:', error);
        }
    }

    // Carregar imagem no mapa (análogo ao setImages do map.js)
    async loadSymbolImageToMap(imageId, blob) {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        return new Promise((resolve, reject) => {
            img.onload = () => {
                if (!this.map.hasImage(imageId)) {
                    this.map.addImage(imageId, img);
                }
                URL.revokeObjectURL(url);
                resolve();
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    // Regenerar símbolo (só chamado quando SIDC mudou)
    async updateSymbolImage(feature) {
        try {
            // Gerar nova imagem e salvar no imageStore
            const symbolBlob = await this.symbolGenerator.generateSymbolBlob(feature.properties);
            await imageStore.setItem(feature.properties.imageId, symbolBlob);
            
            // Atualizar imagem no mapa
            if (this.map.hasImage(feature.properties.imageId)) {
                this.map.removeImage(feature.properties.imageId);
            }
            await this.loadSymbolImageToMap(feature.properties.imageId, symbolBlob);
        } catch (error) {
            console.error('Erro ao atualizar símbolo:', error);
        }
    }

    updateFeaturesProperty = async (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        
        for (const feature of features) {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                // Capturar SIDC antigo ANTES de atualizar propriedades
                const oldSIDC = f.properties.sidc;
                
                f.properties[property] = value;
                feature.properties[property] = value;
                
                // Apenas propriedades que afetam o SIDC devem regenerar a imagem
                const sidcProperties = ['affiliation', 'dimension', 'mainIcon', 'modifier2', 'echelon', 'modifier1', 'modifierTransversal'];
                
                if (sidcProperties.includes(property)) {
                    // Calcular novo SIDC
                    const newSIDC = this.symbolGenerator.buildSIDC(f.properties);
                    f.properties.sidc = newSIDC;
                    feature.properties.sidc = newSIDC;
                    
                    // Só regenerar se SIDC realmente mudou
                    if (oldSIDC !== newSIDC) {
                        await this.updateSymbolImage(feature);
                    }
                }
                // size, opacity, rotation são controlados pelo MapLibre GL JS - não regeneram
            }
        }
        
        this.map.getSource('military_symbols').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
            
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
                        await updateFeature('military_symbols', featureToUpdate);
                    }
                }
            }
            this.map.getSource('military_symbols').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('military_symbols', f);
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        for (const feature of features) {
            if (initialPropertiesMap.has(feature.id)) {
                const originalProps = initialPropertiesMap.get(feature.id);
                const oldSIDC = feature.properties.sidc;
                feature.properties = { ...originalProps };
                
                // Só regenerar se SIDC mudou
                if (feature.properties.sidc !== oldSIDC) {
                    await this.updateSymbolImage(feature);
                }
            }
        }
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        // Primeiro, remover features do source
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.id.toString()));
        this.map.getSource('military_symbols').setData(data);

        for (const feature of features) {
            // Remover do imageStore
            await imageStore.removeItem(feature.properties.imageId);
            
            // Remover do IndexedDB
            await removeFeature('military_symbols', feature.id);
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddMilitarySymbolControl.DEFAULT_PROPERTIES, properties);
    }

    generateUniqueId() {
        return 'mil-symbol-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.affiliation !== initialProperties.affiliation ||
            feature.properties.dimension !== initialProperties.dimension ||
            feature.properties.mainIcon !== initialProperties.mainIcon ||
            feature.properties.modifier1 !== initialProperties.modifier1 ||
            feature.properties.modifier2 !== initialProperties.modifier2 ||
            feature.properties.modifierTransversal !== initialProperties.modifierTransversal ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.rotation !== initialProperties.rotation
        );
    }
}

export default AddMilitarySymbolControl;