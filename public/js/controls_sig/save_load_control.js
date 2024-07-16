import { saveToFile, loadFromFile } from './utils.js';
import store, { getCurrentMapFeatures, getCurrentBaseLayer } from './store.js';
import { switchLayer } from './base_layer_control.js';

class SaveLoadControl {
    constructor(mapControl) {
        this.mapControl = mapControl;
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
                    this.switchMap();

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

    switchMap() {
        const features = getCurrentMapFeatures();
        const baseLayer = getCurrentBaseLayer();

        switchLayer(baseLayer);

        // Remova as feições atuais do mapa
        const draw = this.map._controls.find(control => control instanceof MapboxDraw);
        if (draw) {
            draw.deleteAll();
            draw.set({
                type: 'FeatureCollection',
                features: features.polygons.concat(features.linestrings).concat(features.points)
            });
        }

        this.map.getSource('texts').setData({
            type: 'FeatureCollection',
            features: features.texts
        });

        this.map.getSource('images').setData({
            type: 'FeatureCollection',
            features: features.images
        });

        features.images.forEach(feature => {
            const image = new Image();
            image.src = feature.properties.imageBase64;
            image.onload = () => {
                if (!this.map.hasImage(feature.properties.imageId)) {
                    this.map.addImage(feature.properties.imageId, image);
                }
            };
        });

        // Zoom para as feições existentes
        const allFeatures = features.polygons
        .concat(features.linestrings)
        .concat(features.points)
        .concat(features.texts)
        .concat(features.images);
    
        if (allFeatures.length > 0) {
            const featureCollection = turf.featureCollection(allFeatures);
            const bbox = turf.bbox(featureCollection);
            
            // Verificar se há apenas um ponto
            if (allFeatures.length === 1 && allFeatures[0].geometry.type === 'Point') {
                // Usar um buffer para evitar zoom infinito
                const buffered = turf.buffer(allFeatures[0], 0.1, { units: 'degrees' });
                const bufferedBbox = turf.bbox(buffered);
                const bounds = new maplibregl.LngLatBounds([bufferedBbox[0], bufferedBbox[1]], [bufferedBbox[2], bufferedBbox[3]]);
                this.map.fitBounds(bounds, { padding: 100 });
            } else {
                const bounds = new maplibregl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
                this.map.fitBounds(bounds, { padding: 100 });
            }
        }
        
    }
}

export default SaveLoadControl;
