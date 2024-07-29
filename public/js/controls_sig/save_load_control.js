import { saveToFile, loadFromFile } from './utils.js';
import store, { getCurrentBaseLayer } from './store.js';

class SaveLoadControl {
    constructor(mapControl, baseLayerControl) {
        this.mapControl = mapControl;
        this.baseLayerControl = baseLayerControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl save-load-control';
        this.container.innerHTML = `
            <button id="save-btn" class="save-load-icon">💾</button>
            <button id="load-btn" class="save-load-icon">📂</button>
            <input type="file" id="load-file" style="display: none;" />
        `;

        this.container.querySelector('#save-btn').addEventListener('click', () => {
            const allData = {
                maps: store.maps,
                currentMap: store.currentMap,
            };
            saveToFile(allData, 'maps_data.json');
        });

        this.container.querySelector('#load-btn').addEventListener('click', () => {
            this.container.querySelector('#load-file').click();
        });

        this.container.querySelector('#load-file').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                loadFromFile(file, (data) => {
                    // Atualize o store com os dados carregados
                    store.maps = data.maps;
                    store.currentMap = data.currentMap;

                    // Atualize o mapa para refletir os dados carregados
                    const baseLayer = getCurrentBaseLayer();
                    this.baseLayerControl.switchLayer(baseLayer);     

                    // Atualize a lista de mapas no mapControl
                    this.mapControl.updateMapList();
                });
            }
        });

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default SaveLoadControl;
