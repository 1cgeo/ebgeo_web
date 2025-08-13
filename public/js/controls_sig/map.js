// Path: js\controls_sig\map.js
import { getCurrentMapFeatures } from './store.js';
import { imageStore } from './store.js';
import baseStyle from './baselayers/carta_topografica.js'

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

map.setSourceTileLodParams(5, 6.0);

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

    if (!map.getSource('circle-preview')) {
        map.addSource('circle-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getSource('ellipse-preview')) {
        map.addSource('ellipse-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer('ellipse-preview-fill-layer')) {
        map.addLayer({
            id: 'ellipse-preview-fill-layer',
            type: 'fill',
            source: 'ellipse-preview',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': 0.3
            }
        });
    }

    // Layer de linha para preview da elipse
    if (!map.getLayer('ellipse-preview-layer')) {
        map.addLayer({
            id: 'ellipse-preview-layer',
            type: 'line',
            source: 'ellipse-preview',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 1
            }
        });
    }

    if (!map.getSource('ellipse-edit-handles')) {
        map.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getSource('circle-x-marks')) {
        map.addSource('circle-x-marks', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Layer de preenchimento para preview
    if (!map.getLayer('circle-preview-fill-layer')) {
        map.addLayer({
            id: 'circle-preview-fill-layer',
            type: 'fill',
            source: 'circle-preview',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': 0.3
            }
        });
    }

    // Layer de linha para preview
    if (!map.getLayer('circle-preview-layer')) {
        map.addLayer({
            id: 'circle-preview-layer',
            type: 'line',
            source: 'circle-preview',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
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

    if (!map.getLayer('circle-x-layer')) {
        map.addLayer({
            id: 'circle-x-layer',
            type: 'line',
            source: 'circle-x-marks',
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
            type: 'circle',
            source: 'ellipse-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
                    '#ffffff'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }

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

    if (!map.getSource('arrows')) {
        map.addSource('arrows', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.arrows
            }
        });
    } else {
        map.getSource('arrows').setData({
            type: 'FeatureCollection',
            features: features.arrows
        });
    }

    if (!map.getLayer('arrow-layer')) {
        map.addLayer({
            id: 'arrow-layer',
            type: 'line',
            source: 'arrows',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'lineOpacity']
            }
        });
    }

    if (!map.getLayer('arrow-fill-layer')) {
        map.addLayer({
            id: 'arrow-fill-layer',
            type: 'fill',
            source: 'arrows',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        }, 'arrow-layer'); // Inserir abaixo da linha
    }

    if (!map.getSource('arrow-preview')) {
        map.addSource('arrow-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer('arrow-preview-layer')) {
        map.addLayer({
            id: 'arrow-preview-layer',
            type: 'line',
            source: 'arrow-preview',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-dasharray': [2, 2],
                'line-opacity': ['get', 'lineOpacity']
            }
        });
    }

    if (!map.getLayer('arrow-preview-fill-layer')) {
        map.addLayer({
            id: 'arrow-preview-fill-layer',
            type: 'fill',
            source: 'arrow-preview',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        }, 'arrow-preview-layer'); // Inserir abaixo da linha de preview
    }

    if (!map.getSource('arrow-edit-handles')) {
        map.addSource('arrow-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!map.getLayer('arrow-edit-handles-layer')) {
        map.addLayer({
            id: 'arrow-edit-handles-layer',
            type: 'circle',
            source: 'arrow-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',    // Vermelho - vértices
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',  // Laranja - midpoints
                    '#00ff00'  // Verde - padrão
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,  // Midpoints mais transparentes
                    1.0
                ]
            },
            filter: ['!=', ['get', 'role'], 'selected-feature'] // Não mostrar a feature, só os handles
        });
    }

    if (!map.getLayer('arrow-selected-layer')) {
        map.addLayer({
            id: 'arrow-selected-layer',
            type: 'line',
            source: 'arrow-edit-handles',
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            },
            filter: ['==', ['get', 'role'], 'selected-feature'] // Só a feature destacada
        });
    }

    if (features.boundarys) {
        if (!map.getSource('boundarys')) {
            map.addSource('boundarys', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: features.boundarys
                }
            });
        } else {
            map.getSource('boundarys').setData({
                type: 'FeatureCollection',
                features: features.boundarys
            });
        }

        if (!map.getLayer('boundary-line-layer')) {
            map.addLayer({
                id: 'boundary-line-layer',
                type: 'line',
                source: 'boundarys',
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': ['get', 'lineWidth'],
                    'line-opacity': ['get', 'opacity']
                },
                filter: ['==', ['get', 'renderType'], 'line']
            });
        }

        if (!map.getLayer('boundary-symbol-layer')) {
            map.addLayer({
                id: 'boundary-symbol-layer',
                type: 'line',
                source: 'boundarys',
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': 3,
                    'line-opacity': ['get', 'opacity']
                },
                filter: ['==', ['get', 'renderType'], 'symbol']
            });
        }

        if (!map.getLayer('boundary-symbol-fill-layer')) {
            map.addLayer({
                id: 'boundary-symbol-fill-layer',
                type: 'fill',
                source: 'boundarys',
                paint: {
                    'fill-color': ['get', 'color'],
                    'fill-opacity': ['*', ['get', 'opacity'], 0.3]
                },
                filter: ['all',
                    ['==', ['get', 'renderType'], 'symbol'],
                    ['==', '$type', 'Polygon']
                ]
            });
        }

        if (!map.getLayer('boundary-text-layer')) {
            map.addLayer({
                id: 'boundary-text-layer',
                type: 'symbol',
                source: 'boundarys',
                layout: {
                    'text-field': ['get', 'text'],
                    'text-font': ['Noto Sans Regular'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        8, ['*', ['coalesce', ['get', 'textScaleFactor'], 1], 8],
                        16, ['*', ['coalesce', ['get', 'textScaleFactor'], 1], 20]
                    ],
                    'text-rotate': ['get', 'rotation'],
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                    'symbol-spacing': 1
                },
                paint: {
                    'text-color': ['get', 'color'],
                    'text-halo-color': '#fff',
                    'text-halo-width': 2
                },
                filter: ['==', ['get', 'renderType'], 'text']
            });
        }

        if (!map.getSource('boundary-preview')) {
            map.addSource('boundary-preview', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        if (!map.getLayer('boundary-preview-layer')) {
            map.addLayer({
                id: 'boundary-preview-layer',
                type: 'line',
                source: 'boundary-preview',
                paint: {
                    'line-color': '#000000',
                    'line-width': 4,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.7
                }
            });
        }

        if (!map.getSource('boundary-edit-handles')) {
            map.addSource('boundary-edit-handles', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        if (!map.getLayer('boundary-edit-handles-layer')) {
            map.addLayer({
                id: 'boundary-edit-handles-layer',
                type: 'circle',
                source: 'boundary-edit-handles',
                paint: {
                    'circle-radius': 8,
                    'circle-color': [
                        'case',
                        ['==', ['get', 'handleType'], 'vertex'], '#ff0000',     // Vermelho - vértices
                        ['==', ['get', 'handleType'], 'midpoint'], '#ff0000',   // Vermelho - midpoints
                        ['==', ['get', 'handleType'], 'symbol'], '#0066ff',     // Azul - símbolo
                        ['==', ['get', 'handleType'], 'size'], '#28a745',       // Verde - tamanho
                        '#000000' // Cor padrão
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                    'circle-opacity': [
                        'case',
                        ['==', ['get', 'handleType'], 'midpoint'], 0.5,  // Midpoints mais transparentes
                        1
                    ]
                },
                filter: ['!=', ['get', 'role'], 'selected-feature']
            });
        }

        if (!map.getLayer('boundary-selected-layer')) {
            map.addLayer({
                id: 'boundary-selected-layer',
                type: 'line',
                source: 'boundary-edit-handles',
                paint: {
                    'line-color': '#ff0000',
                    'line-width': 6,
                    'line-dasharray': [2, 2],
                    'line-opacity': 0.8
                },
                filter: ['all',
                    ['==', ['get', 'role'], 'selected-feature'],
                    ['==', '$type', 'LineString']
                ]
            });
        }

        if (!map.getLayer('boundary-hitzone-layer')) {
            map.addLayer({
                id: 'boundary-hitzone-layer',
                type: 'line',
                source: 'boundarys',
                paint: {
                    'line-color': 'transparent',
                    'line-width': 20  // Área maior para clique
                },
                filter: ['==', ['get', 'renderType'], 'line']
            });
        }
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

    requestAnimationFrame(() => {
        clearAllMeasurements();
        restoreMeasurements(features);
        restoreCircleXMarks(features);
    });
});

function clearAllMeasurements() {
    try {
        // Remover todos os elementos de medição do DOM
        const measurementLabels = document.querySelectorAll('.measurement-label');
        measurementLabels.forEach(label => {
            // Remover o marker do Mapbox que contém o label
            const parentMarker = label.closest('.maplibregl-marker');
            if (parentMarker) {
                parentMarker.remove();
            } else {
                // Fallback: remover apenas o label
                label.remove();
            }
        });

    } catch (error) {
        console.warn('⚠️ Erro ao limpar medições antigas:', error);
    }
}

function restoreMeasurements(features) {
    try {
        const drawControl = map._controls.find(control =>
            control.constructor.name === 'DrawControl'
        );
        const losControl = map._controls.find(control =>
            control.constructor.name === 'AddLOSControl'
        );

        // Restaurar medições do Draw
        if (drawControl) {
            [...features.linestrings, ...features.polygons].forEach(feature => {
                if (feature.properties?.measure) {
                    drawControl.updateFeatureMeasurement(feature);
                }
            });
        }

        // Restaurar medições do LOS
        if (losControl) {
            features.los.forEach(feature => {
                if (feature.properties?.measure) {
                    losControl.updateFeatureMeasurement(feature);
                }
            });
        }
    } catch (error) {
        console.warn('Erro ao restaurar medições:', error);
    }
}

function restoreCircleXMarks() {
    try {
        const circleControl = map._controls.find(control =>
            control.constructor.name === 'AddCircleControl'
        );

        // Restaurar X marks dos círculos
        if (circleControl && typeof circleControl.updateXMarks === 'function') {
            circleControl.updateXMarks();
        }
    } catch (error) {
        console.warn('Erro ao restaurar X marks dos círculos:', error);
    }
}

export { map };