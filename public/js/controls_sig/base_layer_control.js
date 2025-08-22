// Path: js\controls_sig\base_layer_control.js
import { setBaseLayer } from './store.js';
import cartaTopografica from './baselayers/carta_topografica.js';
import cartaOrtoimagem from './baselayers/carta_ortoimagem.js';
import osmLayer from './baselayers/osm_layer.js';
import imagensLayer from './baselayers/imagens_layer.js';
import config from '../config.js';
import { setupMapFeatures } from './map.js';

class BaseLayerControl {
    constructor(uiManager, hillshadeConfig) {
        this.map = null;
        this.container = null;
        this.uiManager = uiManager;
        this.hillshadeConfig = hillshadeConfig;

        // Construir styleUrls baseado na configuração
        this.styleUrls = {
            'carta-topografica': cartaTopografica,
            'carta-ortoimagem': cartaOrtoimagem
        };

        if (config.showOsmAndImages) {
            this.styleUrls['osm'] = osmLayer;
            this.styleUrls['imagens'] = imagensLayer;
        }
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        // Aplicar classe CSS baseada na configuração
        if (config.showOsmAndImages) {
            this.container.className = 'mapboxgl-ctrl base-layer-control base-layer-grid-2x2';
        } else {
            this.container.className = 'mapboxgl-ctrl base-layer-control base-layer-grid-1x2';
        }

        // Construir HTML baseado na configuração
        let htmlContent = `
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="carta-topografica" checked>
                <span><img src="./images/dsg_symbol.svg" class="layer-icon">Topográfica</span>
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="carta-ortoimagem">
                <span><img src="./images/dsg_symbol.svg" class="layer-icon">Ortoimagem</span>
            </label>
        `;

        if (config.showOsmAndImages) {
            htmlContent += `
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="osm">
                <span>🌐 OSM</span>
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="imagens">
                <span>🌐 Imagens</span>
            </label>
            `;
        }

        this.container.innerHTML = htmlContent;

        this.container.querySelectorAll('input[name="base-layer"]').forEach((input) => {
            input.addEventListener('change', (event) => {
                this.switchLayer(event.target.value);
            });
        });

        return this.container;
    }

    onRemove() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = null;
    }

    async switchLayer(layer) {
        setBaseLayer(layer);
        
        // Salvar mudanças e fechar painel se existir
        if (this.uiManager && this.uiManager.saveChangesAndClosePanel) {
            this.uiManager.saveChangesAndClosePanel();
        }

        const styleUrl = this.styleUrls[layer];

        // Criar Promise que resolve quando style carregar
        const styleLoadPromise = new Promise((resolve) => {
            this.map.once('styledata', resolve);
        });
        this.map.setStyle(styleUrl);

        // Aguardar style carregar
        await styleLoadPromise;

        // Chamar setupMapFeatures após style estar pronto
        await setupMapFeatures();

        // Update hillshade visibility based on new base layer
        this._updateHillshadeVisibility(layer);

        // Atualizar radio button selecionado
        const targetInput = this.container.querySelector(`input[value="${layer}"]`);
        if (targetInput) {
            targetInput.checked = true;
        }

        // Forçar atualização visual
        this.updateActiveState(layer);
    }

    // Control hillshade visibility based on current base layer
    _updateHillshadeVisibility(currentLayer) {
        if (!this.hillshadeConfig?.enabled || !this.map.getLayer('hillshade')) {
            return;
        }
        
        const shouldShow = this.hillshadeConfig.baseLayers.includes(currentLayer);
        const visibility = shouldShow ? 'visible' : 'none';
        
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

    // Método helper para obter o layer ativo atualmente
    getCurrentLayer() {
        const checkedInput = this.container.querySelector('input[name="base-layer"]:checked');
        return checkedInput ? checkedInput.value : 'carta-topografica';
    }

    // Método para definir programaticamente qual layer está ativo
    setActiveLayer(layer) {
        const targetInput = this.container.querySelector(`input[value="${layer}"]`);
        if (targetInput) {
            targetInput.checked = true;
            this.updateActiveState(layer);
        }
    }
}

export default BaseLayerControl;