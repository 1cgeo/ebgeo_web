// Path: js\controls_sig\base_layer_control.js
import { 
    setBaseLayer, 
    getCurrentMapName, 
    getCurrentBaseLayer, 
    hasMapSavedPosition, 
    getMapPosition 
} from './store/store.js';
import cartaTopografica from './baselayers/carta_topografica.js';
import cartaOrtoimagem from './baselayers/carta_ortoimagem.js';
import osmLayer from './baselayers/osm_layer.js';
import imagensLayer from './baselayers/imagens_layer.js';
import config from '../config.js';
import { setupMapFeatures } from './layer_setup.js';
import { showError } from './utilities/toast_service.js';

class BaseLayerControl {
    constructor(uiManager, hillshadeConfig) {
        this.container = null;
        this.uiManager = uiManager;
        this.hillshadeConfig = hillshadeConfig;
        this.mapControl = null;
        this.currentLayer = 'carta-topografica';

        this.isChanging = false;
        this.changeDebounceTimer = null;

        // Validar config primeiro
        config.validateBasemapsConfig();

        // Construir styleUrls dinamicamente baseado nos basemaps habilitados
        this.styleUrls = {};
        config.getEnabledBasemaps().forEach(([id, basemapConfig]) => {
            switch(id) {
                case 'carta-topografica':
                    this.styleUrls[id] = cartaTopografica;
                    break;
                case 'carta-ortoimagem':
                    this.styleUrls[id] = cartaOrtoimagem;
                    break;
                case 'osm':
                    this.styleUrls[id] = osmLayer;
                    break;
                case 'imagens':
                    this.styleUrls[id] = imagensLayer;
                    break;
            }
        });
    }

    // Método para resolver referência circular
    setMapControl(mapControl) {
        this.mapControl = mapControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        // Obter basemaps habilitados
        const enabledBasemaps = config.getEnabledBasemaps();
        const layoutClass = config.getBasemapLayoutClass(enabledBasemaps.length);
        
        // Aplicar classe CSS dinâmica baseada na quantidade de basemaps
        this.container.className = `mapboxgl-ctrl base-layer-control ${layoutClass}`;

        // Construir HTML dinamicamente baseado nos basemaps habilitados
        let htmlContent = '';
        enabledBasemaps.forEach(([id, basemapConfig], index) => {
            const isFirst = index === 0;
            
            // Construir o ícone (imagem ou emoji)
            let iconHtml = '';
            if (basemapConfig.icon.startsWith('./')) {
                iconHtml = `<img src="${basemapConfig.icon}" class="layer-icon">`;
            } else {
                iconHtml = basemapConfig.icon;
            }
            
            htmlContent += `
                <label class="layer-switch">
                    <input type="radio" name="base-layer" value="${id}" ${isFirst ? 'checked' : ''}>
                    <span>${iconHtml}${basemapConfig.name}</span>
                </label>
            `;
        });

        this.container.innerHTML = htmlContent;

        this.container.querySelectorAll('input[name="base-layer"]').forEach((input) => {
            input.addEventListener('change', this.handleLayerChange);
        });

        return this.container;
    }

    onRemove() {
        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
            this.changeDebounceTimer = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = null;
    }

    handleLayerChange = async (event) => {
        const layer = event.target.value
        this.syncVisualState(layer);
        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
        }

        if (this.isChanging) {
            return;
        }

        this.changeDebounceTimer = setTimeout(async () => {
            await this.executeLayerChange(layer);
        }, 50);
    }

    async executeLayerChange(newLayer) {
        this.isChanging = true;
        const previousLayer = await getCurrentBaseLayer();

        try {
            // Atualizar store
            await setBaseLayer(newLayer);
            
            // Executar mudança
            await this.switchMap(false);
            
        } catch (error) {
            console.error('Error changing base layer:', error);
            
            // ROLLBACK: Voltar ao estado anterior
            setBaseLayer(previousLayer);
            this.syncVisualState(previousLayer);
            
            // Feedback visual de erro (opcional)
            showError('Erro ao trocar camada base');

        } finally {
            this.isChanging = false;
        }
    }

    async switchLayer(layer) {
        setBaseLayer(layer);
        
        // Salvar mudanças e fechar painel se existir
        if (this.uiManager && this.uiManager.saveChangesAndClosePanel) {
            this.uiManager.saveChangesAndClosePanel();
        }

        const styleUrl = this.styleUrls[layer];
        if (this.currentLayer !== layer) {
            const styleLoadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout loading style for layer: ${layer}`));
                }, 10000); // 10s timeout

                const cleanup = () => {
                    clearTimeout(timeout);
                    this.map.off('styledata', handleStyleData);
                };

                const handleStyleData = () => {
                    cleanup();
                    resolve();
                };

                this.map.on('styledata', handleStyleData);
            });

            this.map.setStyle(styleUrl);
            await styleLoadPromise;
            this.currentLayer = layer;
        }
        // Update hillshade visibility based on new base layer
        this._updateHillshadeVisibility(layer);
        this.syncVisualState(layer);
    }

    syncVisualState(layer = null) {
        const targetLayer = layer || this.currentLayer;
        
        const targetInput = this.container.querySelector(`input[value="${targetLayer}"]`);
        if (targetInput) {
            this.container.querySelectorAll('input[name="base-layer"]').forEach(input => {
                input.checked = false;
            });
            
            targetInput.checked = true;
        }

        // Forçar atualização visual
        this.updateActiveState(targetLayer);
    }

    async switchMap(applyPosition = true) {
        const currentMapName = await getCurrentMapName();

        let baseLayer = await getCurrentBaseLayer();

        // Validação robusta com fallback inteligente
        const validFallback = config.getValidBasemapFallback(baseLayer);
        
        if (baseLayer !== validFallback) {
            console.warn(`Base layer "${baseLayer}" não disponível. Usando "${validFallback}".`);
            baseLayer = validFallback;
            await setBaseLayer(baseLayer); // Salvar correção
        }

        this.mapControl.deactivateActiveTools();
        this.mapControl.selectionManager.deselectAllFeatures();
        
        await this.switchLayer(baseLayer);
        await setupMapFeatures(this.map);

        if(applyPosition){
            await this.applyMapSavedPosition(currentMapName);
        }
    }

    async applyMapSavedPosition(mapName = null) {
        try {
            const targetMapName = mapName || await getCurrentMapName();

            // Verificar se há posição salva para este mapa
            const hasSavedPosition = await hasMapSavedPosition(targetMapName);

            if (hasSavedPosition) {
                const position = await getMapPosition(targetMapName);

                // Aplicar a posição com jumpTo
                this.map.jumpTo({
                    center: [position.center_long, position.center_lat],
                    zoom: position.zoom
                });

                return true;
            } else {
                return false;
            }
        } catch (error) {
            console.error('Erro ao aplicar posição salva:', error);
            return false;
        }
    }

    // Control hillshade visibility based on current base layer
    _updateHillshadeVisibility(currentLayer) {
        if (!this.hillshadeConfig?.enabled || !this.map.getLayer('hillshade')) {
            return;
        }
        
        const visibility = 'visible';
        
        try {
            this.map.setLayoutProperty('hillshade', 'visibility', visibility);
        } catch (error) {
            console.warn('Could not update hillshade visibility:', error);
        }
    }

    // Método para garantir que o estado ativo seja aplicado
    updateActiveState(activeLayer) {
        // Remove estado ativo de todos
        this.container.querySelectorAll('.layer-switch span').forEach(span => {
            span.classList.remove('active-layer');
        });

        // Adiciona estado ativo ao selecionado
        const activeInput = this.container.querySelector(`input[value="${activeLayer}"]`);
        if (activeInput) {
            const activeSpan = activeInput.nextElementSibling;
            if (activeSpan) {
                activeSpan.classList.add('active-layer');
            }
        }
    }
}

export default BaseLayerControl;