import { getCurrentMapFeatures } from './store.js';
import '../../vendors/maplibre-gl.js';
import baseStyle from './base_map_styles.js'

const map = new maplibregl.Map({
    container: 'map-sig',
    style: baseStyle,
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

    // Check if the 'highlighted_bbox' source and layer exist before adding them
    if (!map.getSource('highlighted_bbox')) {
        map.addSource('highlighted_bbox', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.images
            }
        });
    }

    if (!map.getLayer('highlighted_bbox-layer')) {
        map.addLayer({
            id: 'highlighted_bbox-layer',
            type: 'line',
            source: 'highlighted_bbox',
            layout: {},
            paint: {
              'line-color': '#ff0000',
              'line-width': 2
            }
        });
    }
});


export { map };