import { getCurrentMapFeatures } from './store.js';
import 'https://unpkg.com/maplibre-gl/dist/maplibre-gl.js';

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [-74.5, 40],
    zoom: 9,
    attributionControl: false
});

map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Diretoria de Serviço Geográfico - Exército Brasileiro',
    compact: true
}), 'bottom-right');

map.on('styledata', () => { 
    const features = getCurrentMapFeatures();

    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        draw.deleteAll();
        draw.set({
            type: 'FeatureCollection',
            features: features.polygons.concat(features.linestrings).concat(features.points)
        });
    }

    if (!map.getSource('texts')) {
        map.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.texts
            }
        });
    }

    if (!map.getLayer('text-layer')) {
        map.addLayer({
            id: 'text-layer',
            type: 'symbol',
            source: 'texts',
            layout: {
                'text-field': ['get', 'text'],
                'text-size': ['get', 'size'],
                'text-justify': ['get', 'justify'],
                'text-anchor': 'center',
                'text-rotate': ['get', 'rotation'],
                'text-ignore-placement': true
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': ['get', 'backgroundColor'],
                'text-halo-width': 2
            }
        });
    }

    if (!map.getSource('images')) {
        map.addSource('images', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.images
            }
        });
    }

    if (!map.getLayer('image-layer')) {
        map.addLayer({
            id: 'image-layer',
            type: 'symbol',
            source: 'images',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'imageId'],
                'icon-size': ['get', 'size'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
    }

    features.images.forEach(feature => {
        const image = new Image();
        image.src = feature.properties.imageBase64;
        image.onload = () => {
            if (!map.hasImage(feature.properties.imageId)) {
                map.addImage(feature.properties.imageId, image);
            }
        };
    });

    if (!map.getSource('los')) {
        map.addSource('los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.los
            }
        });
    }

    if (!map.getLayer('los-layer')) {
        map.addLayer({
            'id': 'los-layer',
            'type': 'line',
            'source': 'los',
            'paint': {
                'line-color': [
                    'case',
                    ['==', ['array-index', ['get', 'coordinates'], 0], 0],
                    ['get', 'visibleColor'],
                    ['get', 'obstructedColor']
                ],
                'line-opacity': ['get', 'opacity'],
                'line-width': ['get', 'width']
            },
            'filter': ['==', '$type', 'MultiLineString']
        });
    }

    if (!map.getSource('visibility')) {
        map.addSource('visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.visibility
            }
        });
    }

    if (!map.getLayer('visibility-layer')) {
        map.addLayer({
            id: 'visibility-layer',
            type: 'fill',
            source: 'visibility',
            layout: {},
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    if (!map.getSource('selection-boxes')) {
        map.addSource('selection-boxes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!map.getLayer('selection-boxes-layer')) {
        map.addLayer({
            id: 'selection-boxes-layer',
            type: 'line',
            source: 'selection-boxes',
            paint: {
                'line-color': '#FF0000',
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }

    if (!map.getSource('temp-line')) {
        map.addSource('temp-line', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!map.getLayer('temp-line-layer')) {
        map.addLayer({
            id: 'temp-line-layer',
            type: 'line',
            source: 'temp-line',
            paint: {
                'line-color': '#3f4fb5',
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }

    if (!map.getSource('temp-polygon')) {
        map.addSource('temp-polygon', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!map.getLayer('temp-polygon-layer')) {
        map.addLayer({
            id: 'temp-polygon-layer',
            type: 'fill',
            source: 'temp-polygon',
            paint: {
                'fill-color': '#3f4fb5',
                'fill-opacity': 0.5,
                'fill-outline-color': '#3f4fb5'
            }
        });
    }
});


export { map };
