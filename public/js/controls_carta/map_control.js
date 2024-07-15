import store, { addMap, removeMap, setCurrentMap, getCurrentMapFeatures, getCurrentBaseLayer } from '../store.js';
import { switchLayer } from '../map.js';

class MapControl {
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl map-control';

        const addButton = document.createElement('button');
        addButton.textContent = 'Add Map';
        addButton.onclick = () => {
            const mapName = prompt("Enter map name:");
            if (mapName) {
                addMap(mapName);
                this.updateMapList();
            }
        };

        this.mapList = document.createElement('ul');
        this.updateMapList();

        this.container.appendChild(addButton);
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
            listItem.onclick = () => {
                setCurrentMap(mapName);
                this.switchMap();
            };

            const removeButton = document.createElement('button');
            removeButton.textContent = 'X';
            removeButton.onclick = (e) => {
                e.stopPropagation();
                removeMap(mapName);
                this.updateMapList();
            };

            listItem.appendChild(removeButton);
            this.mapList.appendChild(listItem);
        });
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

        if (this.map.getSource('texts')) {
            this.map.getSource('texts').setData({
                type: 'FeatureCollection',
                features: features.texts
            });
        } else {
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
        const allFeatures = features.polygons.concat(features.linestrings).concat(features.points).concat(features.texts).concat(features.images);
        if (allFeatures.length > 0) {
            const bounds = allFeatures.reduce((bounds, feature) => {
                return bounds.extend(feature.geometry.coordinates);
            }, new maplibregl.LngLatBounds(allFeatures[0].geometry.coordinates, allFeatures[0].geometry.coordinates));
            this.map.fitBounds(bounds, { padding: 20 });
        }
    }
}

export default MapControl;
