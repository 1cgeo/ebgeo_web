// Path: js\controls_sig\base_layer_control.js
import { setBaseLayer } from './store.js';
import cartaTopografica from './baselayers/carta_topografica.js';
import cartaOrtoimagem from './baselayers/carta_ortoimagem.js';
import osmLayer from './baselayers/osm_layer.js';
import imagensLayer from './baselayers/imagens_layer.js';

class BaseLayerControl {
    constructor(uiManager) {
        this.map = null;
        this.container = null;
        this.uiManager = uiManager;
        this.styleUrls = {
            'carta-topografica': cartaTopografica,
            'carta-ortoimagem': cartaOrtoimagem,
            'osm': osmLayer,
            'imagens': imagensLayer
        };
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl base-layer-control';
        
        // HTML com disposição 2x2 e ícones
        this.container.innerHTML = `
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="carta-topografica" checked>
                <span><img src="./images/dsg_symbol.svg" class="layer-icon">Topográfica</span>
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="carta-ortoimagem">
                <span><img src="./images/dsg_symbol.svg" class="layer-icon">Ortoimagem</span>
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="osm">
                <span>🌐 OSM</span>
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="imagens">
                <span>🌐 Imagens</span>
            </label>
        `;

        this.container.querySelectorAll('input[name="base-layer"]').forEach((input) => {
            input.addEventListener('change', (event) => {
                this.switchLayer(event.target.value);
            });
        });

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = null;
    }

    switchLayer(layer) {
        setBaseLayer(layer);
        this.uiManager.saveChangesAndClosePanel();

        const styleUrl = this.styleUrls[layer];
        this.map.setStyle(styleUrl);
        this.container.querySelector(`input[value="${layer}"]`).checked = true;
        
        // Forçar atualização visual
        this.updateActiveState(layer);
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