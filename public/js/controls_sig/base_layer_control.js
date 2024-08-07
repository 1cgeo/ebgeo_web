import { setBaseLayer } from './store.js';
import baseStyle from './base_map_styles.js'
class BaseLayerControl {
    constructor(uiManager) {
        this.map = null;
        this.container = null;
        this.uiManager = uiManager;
        this.styleUrls = {
            'Carta': baseStyle,
            'Ortoimagem': 'https://api.maptiler.com/maps/hybrid/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL'
        };
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl base-layer-control';
        this.container.innerHTML = `
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="Carta" checked>
                Topográficia
            </label>
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="Ortoimagem">
                Ortoimagem
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
        this.uiManager.saveChangesAndClosePanel()

        const styleUrl = this.styleUrls[layer];
        this.map.setStyle(styleUrl);
        this.container.querySelector(`input[value="${layer}"]`).checked = true;
    }
}

export default BaseLayerControl;