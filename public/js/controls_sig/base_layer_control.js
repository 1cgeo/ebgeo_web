import { setBaseLayer } from './store.js';

const baseLayerControl = {
    onAdd: function (map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl base-layer-control';
        this.container.innerHTML = `
            <label class="layer-switch">
                <input type="radio" name="base-layer" value="Carta" checked>
                Carta
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
    },
    onRemove: function () {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    },
    switchLayer: async function (layer) {
        setBaseLayer(layer);
        const styleUrl = layer === 'Ortoimagem'
            ? 'https://api.maptiler.com/maps/hybrid/style.json?key=get_your_own_OpIi9ZULNHzrESv6T2vL'
            : 'https://demotiles.maplibre.org/style.json';
        
        this.container.querySelector(`input[value="${layer}"]`).checked = true;

        // Set the new style
        this.map.setStyle(styleUrl);
    }
};

export const switchLayer = baseLayerControl.switchLayer.bind(baseLayerControl);
export default baseLayerControl;