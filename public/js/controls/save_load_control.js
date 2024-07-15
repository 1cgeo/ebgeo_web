// public/js/controls/saveLoadControl.js
import { saveToFile, loadFromFile } from '../utils.js';

const saveLoadControl = {
    onAdd: function (map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl save-load-control';
        this.container.innerHTML = `
            <button id="save-btn" class="save-load-icon">💾</button>
            <button id="load-btn" class="save-load-icon">📂</button>
            <input type="file" id="load-file" style="display: none;" />
        `;

        this.container.querySelector('#save-btn').addEventListener('click', () => {
            const draw = map._controls.find(control => control instanceof MapboxDraw);
            const allFeatures = {}
            if (draw) {
                allFeatures.drawFeatures = draw.getAll().features;
            }
            allFeatures.textFeatures = map.getSource('texts') ? map.getSource('texts')._data.features : [];
            allFeatures.imageFeatures = map.getSource('images') ? map.getSource('images')._data.features : [];
            console.log(allFeatures)
            saveToFile(allFeatures, 'features.json');
        });

        this.container.querySelector('#load-btn').addEventListener('click', () => {
            this.container.querySelector('#load-file').click();
        });

        this.container.querySelector('#load-file').addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                loadFromFile(file, (data) => {
                    const draw = map._controls.find(control => control instanceof MapboxDraw);
                    if (draw) {
                        draw.deleteAll();
                        draw.set({
                            type: 'FeatureCollection',
                            features: data.drawFeatures
                        });
                    }

                    if (map.getSource('texts')) {
                        map.getSource('texts').setData({
                            type: 'FeatureCollection',
                            features: data.textFeatures
                        });
                    } else {
                        map.addSource('texts', {
                            type: 'geojson',
                            data: {
                                type: 'FeatureCollection',
                                features: data.textFeatures
                            }
                        });

                        map.addLayer({
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

                    if (map.getSource('images')) {
                        map.getSource('images').setData({
                            type: 'FeatureCollection',
                            features: data.imageFeatures
                        });
                    } else {
                        map.addSource('images', {
                            type: 'geojson',
                            data: {
                                type: 'FeatureCollection',
                                features: data.imageFeatures
                            }
                        });

                        map.addLayer({
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

                        data.imageFeatures.forEach(feature => {
                            const image = new Image();
                            image.src = feature.properties.imageBase64;
                            image.onload = () => {
                                if (!map.hasImage(feature.properties.imageId)) {
                                    map.addImage(feature.properties.imageId, image);
                                }
                            };
                        });
                    }
                });
            }
        });

        return this.container;
    },
    onRemove: function () {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
};

export default saveLoadControl;
