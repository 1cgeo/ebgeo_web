import store, { addMap, removeMap, setCurrentMap, getCurrentMapFeatures, getCurrentBaseLayer } from './store.js';
import { switchLayer } from './base_layer_control.js';
class MapControl {
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl map-control-panel';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'map-control-title-container';

        const title = document.createElement('h3');
        title.className = 'map-control-title';
        title.textContent = 'Mapas';

        const addButton = document.createElement('button');
        addButton.className = 'add-map-button';
        addButton.textContent = '+';
        addButton.title = 'Adicionar mapa';
        addButton.onclick = () => {
            const mapName = prompt("Digite o nome do mapa:");
            if (mapName) {
                addMap(mapName);
                this.updateMapList();
            }
        };

        titleContainer.appendChild(title);
        titleContainer.appendChild(addButton);

        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';

        this.updateMapList();

        this.container.appendChild(titleContainer);
        this.container.appendChild(this.mapList);

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    updateMapList() {
        this.mapList.innerHTML = '';
        Object.keys(store.maps).forEach(mapName => {
            const listItem = document.createElement('li');
            listItem.textContent = mapName;
            listItem.className = mapName === store.currentMap ? 'current-map' : '';

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'button-container';

            const changeButton = document.createElement('button');
            changeButton.className = 'change-map-button';
            changeButton.textContent = '👁️';
            changeButton.title = 'Alterar';
            changeButton.onclick = (e) => {
                e.stopPropagation();
                setCurrentMap(mapName);
                console.log('CLICK')
                this.switchMap();
                this.updateMapList();
            };

            const removeButton = document.createElement('button');
            removeButton.className = 'remove-map-button';
            removeButton.textContent = 'X';
            removeButton.title = 'Excluir';
            removeButton.onclick = (e) => {
                e.stopPropagation();
                if (Object.keys(store.maps).length > 1) {
                    if (confirm("Você tem certeza que deseja deletar este mapa?")) {
                        removeMap(mapName);
                        this.updateMapList();
                    }
                } else {
                    alert("Deve haver pelo menos um mapa.");
                }
            };

            buttonContainer.appendChild(changeButton);
            buttonContainer.appendChild(removeButton);
            listItem.appendChild(buttonContainer);
            this.mapList.appendChild(listItem);
        });
    }

    switchMap() {
        const features = getCurrentMapFeatures();
        const baseLayer = getCurrentBaseLayer();
        switchLayer(this.map, baseLayer);

        // Remova as feições atuais do mapa
        const draw = this.map._controls.find(control => control instanceof MapboxDraw);
        if (draw) {
            draw.deleteAll();
            draw.set({
                type: 'FeatureCollection',
                features: features.polygons.concat(features.linestrings).concat(features.points)
            });
        }

        if (this.map.getSource('texts')) {
            console.log('AQUI')
            console.log(features.texts)
            this.map.getSource('texts').setData({
                type: 'FeatureCollection',
                features: features.texts
            });
        } else {
            console.log('NOT FOUND')
            console.log(features.texts)
            this.map.addSource('texts', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features.texts
                }
            });

            this.map.addLayer({
                id: 'text-layer',
                type: 'symbol',
                source: 'texts',
                layout: {
                    'text-field': ['get', 'text'],
                    'text-size': ['get', 'size'],
                    'text-justify': 'center',
                    'text-anchor': 'center'
                },
                paint: {
                    'text-color': ['get', 'color'],
                    'text-halo-color': ['get', 'backgroundColor'],
                    'text-halo-width': 2
                }
            });
        }

        if (this.map.getSource('images')) {
            this.map.getSource('images').setData({
                type: 'FeatureCollection',
                features: features.images
            });
        } else {
            this.map.addSource('images', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features.images
                }
            });

            this.map.addLayer({
                id: 'image-layer',
                type: 'symbol',
                source: 'images',
                layout: {
                    'icon-image': ['get', 'imageId'],
                    'icon-size': ['get', 'size'],
                    'icon-rotate': ['get', 'rotation'],
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            });
        }

        // Zoom para as feições existentes
        const allFeatures = features.polygons
        .concat(features.linestrings)
        .concat(features.points)
        .concat(features.texts)
        .concat(features.images);
    
        if (allFeatures.length > 0) {
            const featureCollection = turf.featureCollection(allFeatures);
            const bbox = turf.bbox(featureCollection);
            const bounds = new maplibregl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
            this.map.fitBounds(bounds, { padding: 20 });
        }
    }
}

export default MapControl;
