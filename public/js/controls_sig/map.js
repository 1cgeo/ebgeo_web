// Path: js\controls_sig\map.js
import { getCurrentMapFeatures } from './store.js';
import { imageStore } from './store.js';
import baseStyle from './base_map_styles.js'

const map = new maplibregl.Map({
    container: 'map-sig',
    style: baseStyle,
    attributionControl: false,
    minZoom: 11,
    maxZoom: 17.9,
    maxPitch: 65,
    bounds: [
        [-44.4633992903047, -22.46265178239199],
        [-44.439695820515325, -22.444666254876367]
    ],
});

const bounds = [
    [-45.82515, -22.69950],
    [-43.92333, -21.30216]
];

map.setMaxBounds(bounds);

map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Diretoria de Serviço Geográfico - Exército Brasileiro',
    compact: true
}), 'bottom-right');

map.on('styledata', async () => {
    // Carregar dados do IndexedDB
    const features = await getCurrentMapFeatures();

    // Configurar draw com dados do IndexedDB
    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        draw.deleteAll();
        draw.set({
            type: 'FeatureCollection',
            features: features.polygons.concat(features.linestrings).concat(features.points)
        });
    }

    if (!map.getSource('circles')) {
        map.addSource('circles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.circles
            }
        });
    } else {
        map.getSource('circles').setData({
            type: 'FeatureCollection',
            features: features.circles
        });
    }

    //  Source da elipse
    if (!map.getSource('ellipses')) {
        map.addSource('ellipses', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.ellipses
            }
        });
    } else {
        map.getSource('ellipses').setData({
            type: 'FeatureCollection',
            features: features.ellipses
        });
    }

    //  Layer do círculo (preenchimento)
    if (!map.getLayer('circle-fill-layer')) {
        map.addLayer({
            id: 'circle-fill-layer',
            type: 'fill',
            source: 'circles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    //  Layer do círculo (linha)
    if (!map.getLayer('circle-layer')) {
        map.addLayer({
            id: 'circle-layer',
            type: 'line',
            source: 'circles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            }
        });
    }

    //  Layer da elipse (preenchimento)
    if (!map.getLayer('ellipse-fill-layer')) {
        map.addLayer({
            id: 'ellipse-fill-layer',
            type: 'fill',
            source: 'ellipses',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    //  Layer da elipse (linha)
    if (!map.getLayer('ellipse-layer')) {
        map.addLayer({
            id: 'ellipse-layer',
            type: 'line',
            source: 'ellipses',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            }
        });
    }

    // Texts source
    if (!map.getSource('texts')) {
        map.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.texts
            }
        });
    } else {
        map.getSource('texts').setData({
            type: 'FeatureCollection',
            features: features.texts
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
                'text-ignore-placement': true,
                "text-font": ["Noto Sans Regular"]
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': ['get', 'backgroundColor'],
                'text-halo-width': 2
            }
        });
    }

    // Images source
    if (!map.getSource('images')) {
        map.addSource('images', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.images
            }
        });
    } else {
        map.getSource('images').setData({
            type: 'FeatureCollection',
            features: features.images
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

    // Carregar blobs das imagens do IndexedDB
    for (const feature of features.images) {
        const imageId = feature.properties.imageId;
        try {
            const blob = await imageStore.getItem(imageId);
            if (blob) {
                const url = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => {
                    if (!map.hasImage(imageId)) {
                        map.addImage(imageId, image);
                    }
                    URL.revokeObjectURL(url);
                };
                image.src = url;
            }
        } catch (error) {
            console.warn(`Erro ao carregar imagem ${imageId}:`, error);
        }
    }

    // LOS source
    if (!map.getSource('los')) {
        map.addSource('los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.los
            }
        });
    } else {
        map.getSource('los').setData({
            type: 'FeatureCollection',
            features: features.los
        });
    }

    if (!map.getLayer('los-layer')) {
        map.addLayer({
            'id': 'los-layer',
            'type': 'line',
            'source': 'los',
            'paint': {
                'line-color': '#D3D3D3',
                'line-opacity': 0,
                'line-width': ['get', 'width']
            }
        });
    }

    // Processed LOS source
    if (!map.getSource('processed-los')) {
        map.addSource('processed-los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_los
            }
        });
    } else {
        map.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: features.processed_los
        });
    }

    if (!map.getLayer('processed-los-layer')) {
        map.addLayer({
            'id': 'processed-los-layer',
            'type': 'line',
            'source': 'processed-los',
            'paint': {
                'line-color': ['get', 'color'],
                'line-opacity': ['get', 'opacity'],
                'line-width': ['get', 'width']
            }
        });
    }

    // Visibility source
    if (!map.getSource('visibility')) {
        map.addSource('visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.visibility
            }
        });
    } else {
        map.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: features.visibility
        });
    }

    if (!map.getLayer('visibility-layer')) {
        map.addLayer({
            id: 'visibility-layer',
            type: 'fill',
            source: 'visibility',
            layout: {},
            paint: {
                'fill-color': '#D3D3D3',
                'fill-opacity': 0
            }
        });
    }

    // Processed visibility source
    if (!map.getSource('processed-visibility')) {
        map.addSource('processed-visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_visibility
            }
        });
    } else {
        map.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: features.processed_visibility
        });
    }

    if (!map.getLayer('processed-visibility-layer')) {
        map.addLayer({
            id: 'processed-visibility-layer',
            type: 'fill',
            source: 'processed-visibility',
            layout: {},
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    // Selection boxes source
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

    // Temp line source
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

    // Temp polygon source
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

    // Source para handles de edição
    if (!map.getSource('circle-edit-handles')) {
        map.addSource('circle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Layer para handles (pontos arrastáveis)
    if (!map.getLayer('circle-edit-handles-layer')) {
        map.addLayer({
            id: 'circle-edit-handles-layer',
            type: 'circle',  // ✅ Correto para handles
            source: 'circle-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ff0000',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }

    // Layer para o círculo selecionado (destacado)
    if (!map.getLayer('circle-selected-layer')) {
        map.addLayer({
            id: 'circle-selected-layer',
            type: 'line',
            source: 'circle-edit-handles',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8  // ✅ Adicionado: opacity para linha
            },
            filter: ['!=', ['get', 'role'], 'handle']
        });
    }

    // Source para handles de edição
    if (!map.getSource('ellipse-edit-handles')) {
        map.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Layer para handles (pontos arrastáveis)
    if (!map.getLayer('ellipse-edit-handles-layer')) {
        map.addLayer({
            id: 'ellipse-edit-handles-layer',
            type: 'circle',  // ✅ Correto para handles
            source: 'ellipse-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'primary'], '#ff0000',
                    ['==', ['get', 'handleType'], 'secondary'], '#0066ff',
                    '#ffffff'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }

    // Layer para a elipse selecionada (destacada)
    if (!map.getLayer('ellipse-selected-layer')) {
        map.addLayer({
            id: 'ellipse-selected-layer',
            type: 'line',
            source: 'ellipse-edit-handles',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8  // ✅ Adicionado para consistência
            },
            filter: ['!=', ['get', 'role'], 'handle']
        });
    }

    // Street view source
    if (!map.getSource('lines-street-view')) {
        map.addSource('lines-street-view', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!map.getLayer('street-view')) {
        map.addLayer({
            'id': 'street-view',
            'type': 'line',
            'source': 'lines-street-view',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#0d6efd',
                'line-width': 4
            }
        });
    }
});

export { map };