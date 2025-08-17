// Path: js\controls_sig\military_symbol_tool\add_military_symbol_control.js

import { addFeature, updateFeature, removeFeature } from '../store.js';
import { MilitarySymbolGenerator } from './military_symbol_generator.js';

class AddMilitarySymbolControl {
    static DEFAULT_PROPERTIES = {
        // Componentes do SIDC
        version: "10",
        affiliation: "03",      // Amigo
        dimension: "01",        // Terrestre
        status: "00",
        mainIcon: "1211",       // Infantaria
        modifier1: "00",
        modifier2: "00",
        
        // Propriedades de renderização
        size: 35,
        opacity: 1.0,
        rotation: 0,
        
        // Escalão (separado do SIDC)
        echelon: "Btl",
        
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
        
        // Desativar ferramenta após adicionar símbolo
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

        // Gerar SIDC completo
        const sidc = this.symbolGenerator.buildSIDC(properties);
        properties.sidc = sidc;

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
            // Gerar imagem do símbolo
            const symbolImage = await this.symbolGenerator.generateSymbolImage(properties);
            
            // Adicionar imagem ao mapa
            if (!this.map.hasImage(symbolId)) {
                this.map.addImage(symbolId, symbolImage);
            }

            // Salvar no store
            await addFeature('military_symbols', feature);

            // Adicionar ao source do mapa
            const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
            data.features.push(feature);
            this.map.getSource('military_symbols').setData(data);

            // Selecionar o símbolo criado
            this.selectionManager.toggleFeatureSelection('military_symbol', feature.id, feature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Erro ao criar símbolo militar:', error);
        }
    }

    async updateSymbolImage(feature) {
        const symbolImage = await this.symbolGenerator.generateSymbolImage(feature.properties);
        
        // Remover imagem antiga se existir
        if (this.map.hasImage(feature.id)) {
            this.map.removeImage(feature.id);
        }
        
        // Adicionar nova imagem
        this.map.addImage(feature.id, symbolImage);
    }

    updateFeaturesProperty = async (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        
        for (const feature of features) {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                const oldValue = f.properties[property];
                f.properties[property] = value;
                feature.properties[property] = value;
                
                // Se mudou propriedade que afeta o SIDC, regenerar
                if (['affiliation', 'dimension', 'mainIcon', 'modifier1', 'modifier2', 'echelon', 'size'].includes(property)) {
                    f.properties.sidc = this.symbolGenerator.buildSIDC(f.properties);
                    feature.properties.sidc = f.properties.sidc;
                    await this.updateSymbolImage(feature);
                }
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
                        // Only update properties of the existing feature
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        // Replace the entire feature
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
                feature.properties = { ...originalProps };
                
                // Regenerar imagem se necessário
                if (feature.properties.sidc !== originalProps.sidc) {
                    await this.updateSymbolImage(feature);
                }
            }
        }
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;
        
        const data = JSON.parse(JSON.stringify(this.map.getSource('military_symbols')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.id.toString()));
        this.map.getSource('military_symbols').setData(data);

        for (const feature of features) {
            // Remover imagem do mapa
            if (this.map.hasImage(feature.id)) {
                this.map.removeImage(feature.id);
            }
            
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
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.rotation !== initialProperties.rotation
        );
    }
}

export default AddMilitarySymbolControl;