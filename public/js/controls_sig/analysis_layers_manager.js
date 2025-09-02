// Path: js/controls_sig/analysis_layers_manager.js
import { getMapAnalysisLayersStates, setMapAnalysisLayerState } from './store/store.js';
import config from '../config.js';

/**
 * Gerencia as camadas de análise raster do sistema
 * Responsabilidade única: configurar, posicionar e controlar analysis layers
 */
class AnalysisLayersManager {
    constructor(map) {
        this.map = map;
    }

    /**
     * Configuração inicial das analysis layers
     * Adiciona sources, layers na posição correta e restaura estados salvos
     */
    async setupAnalysisLayers() {
        if (!this.isEnabled()) {
            return;
        }

        try {
            // Adicionar cada layer configurada
            for (const layerConfig of config.analysisLayers.layers) {
                this.addAnalysisLayer(layerConfig);
            }

            // Restaurar estados salvos das layers
            await this.restoreLayersState();

        } catch (error) {
            console.error('Erro ao configurar analysis layers:', error);
        }
    }

    /**
     * Adiciona uma analysis layer individual na posição correta
     * @param {Object} layerConfig - Configuração da layer do config.js
     * @param {string} beforeId - ID da layer antes da qual inserir (padrão: features-separator)
     */
    addAnalysisLayer(layerConfig, beforeId = 'features-separator') {
        const sourceId = `analysis-${layerConfig.id}`;
        const layerId = `analysis-${layerConfig.id}-layer`;

        try {
            // Adicionar source se não existir
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, layerConfig.source);
            }

            // Adicionar layer se não existir
            if (!this.map.getLayer(layerId)) {
                const layer = {
                    id: layerId,
                    type: 'raster',
                    source: sourceId,
                    paint: {
                        ...layerConfig.paint,
                        'raster-opacity': layerConfig.opacity || 1.0
                    },
                    layout: {
                        visibility: 'none' // Iniciar invisível, será restaurado via estado salvo
                    }
                };

                // Posicionar antes do separador de features (garante ordem correta)
                if (this.map.getLayer(beforeId)) {
                    this.map.addLayer(layer, beforeId);
                } else {
                    // Fallback caso separador não exista ainda
                    this.map.addLayer(layer);
                }
            }

        } catch (error) {
            console.error(`Erro ao adicionar analysis layer ${layerConfig.id}:`, error);
        }
    }

    /**
     * Alterna visibilidade de uma analysis layer
     * @param {string} layerId - ID da layer (sem prefixo 'analysis-')
     * @param {boolean} enabled - true para mostrar, false para ocultar
     */
    async toggleLayer(layerId, enabled) {
        try {
            // 1. Salvar estado no store
            await setMapAnalysisLayerState(layerId, enabled);

            // 2. Aplicar mudança visual no mapa
            this.applyLayerState(layerId, enabled);

        } catch (error) {
            console.error(`Erro ao alternar analysis layer ${layerId}:`, error);
        }
    }

    /**
     * Aplica estado de visibilidade de uma layer no mapa
     * @param {string} layerId - ID da layer (sem prefixo 'analysis-')
     * @param {boolean} enabled - true para mostrar, false para ocultar
     */
    applyLayerState(layerId, enabled) {
        const layerMapId = `analysis-${layerId}-layer`;

        if (this.map.getLayer(layerMapId)) {
            const visibility = enabled ? 'visible' : 'none';
            this.map.setLayoutProperty(layerMapId, 'visibility', visibility);
        } else {
            console.warn(`Analysis layer ${layerMapId} não encontrada no mapa`);
        }
    }

    /**
     * Restaura estados salvos de todas as analysis layers
     * Carrega do store e aplica visibilidade no mapa
     */
    async restoreLayersState() {
        if (!this.isEnabled()) {
            return;
        }

        try {
            // Carregar estados salvos do store
            const layersStates = await getMapAnalysisLayersStates();

            // Aplicar estado para cada layer configurada
            for (const layerConfig of config.analysisLayers.layers) {
                const isEnabled = layersStates[layerConfig.id] ?? layerConfig.defaultVisibility ?? false;
                this.applyLayerState(layerConfig.id, isEnabled);
            }

        } catch (error) {
            console.error('Erro ao restaurar estados das analysis layers:', error);
        }
    }

    /**
     * Obtém configurações das layers para construção de UI
     * @returns {Array} Array de configurações das layers
     */
    getLayersConfig() {
        return config.analysisLayers?.layers || [];
    }

    /**
     * Verifica se o sistema de analysis layers está habilitado
     * @returns {boolean} true se habilitado no config
     */
    isEnabled() {
        return config.analysisLayers?.enabled === true && 
               config.analysisLayers.layers?.length > 0;
    }

    /**
     * Obtém estado atual de uma layer específica
     * @param {string} layerId - ID da layer (sem prefixo 'analysis-')
     * @returns {boolean} true se layer está visível
     */
    isLayerVisible(layerId) {
        const layerMapId = `analysis-${layerId}-layer`;
        const layer = this.map.getLayer(layerMapId);
        
        if (!layer) return false;
        
        const visibility = this.map.getLayoutProperty(layerMapId, 'visibility');
        return visibility === 'visible';
    }

    /**
     * Remove todas as analysis layers do mapa
     * Útil para limpeza ou reconfiguração
     */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerConfig of config.analysisLayers.layers) {
            const sourceId = `analysis-${layerConfig.id}`;
            const layerId = `analysis-${layerConfig.id}-layer`;

            try {
                // Remover layer
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }

                // Remover source
                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                }
            } catch (error) {
                console.warn(`Erro ao remover analysis layer ${layerConfig.id}:`, error);
            }
        }
    }
}

export default AnalysisLayersManager;