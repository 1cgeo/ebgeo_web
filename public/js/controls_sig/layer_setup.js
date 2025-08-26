// Path: js\controls_sig\layer_setup.js
import { getCurrentMapFeatures } from './store/store.js';
import { imageStore } from './store/store.js';

export async function setupMapFeatures(mapInstance) {
    try {
        setupAuxiliaryLayers(mapInstance);

        const features = await getCurrentMapFeatures();
        await setImages(features, mapInstance);
        
        setupImageLayers(features, mapInstance);
        setupPolygonLayers(features, mapInstance);
        setupEllipseLayers(features, mapInstance);
        setupCircleLayers(features, mapInstance);
        setupRectangleLayers(features, mapInstance);
        setupArrowLayers(features, mapInstance);
        setupVisibilityLayers(features, mapInstance);
        setupOccupiedFrontLayers(features, mapInstance);
        setupBoundaryLayers(features, mapInstance);
        setupLineLayers(features, mapInstance);
        setupBrushLayers(features, mapInstance);
        setupLOSLayers(features, mapInstance);
        setupPointLayers(features, mapInstance);
        setupMilitarySymbolsLayers(features, mapInstance);
        setupTextLayers(features, mapInstance);

        restoreTerrainState(mapInstance);

        requestAnimationFrame(() => {
            clearAllMeasurements();
            restoreMeasurements(features, mapInstance);
            restoreCircleXMarks(features, mapInstance);
            restoreBoundaryDependentFeatures(features, mapInstance);
        });
    } catch (error) {
        console.error('Erro ao configurar features do mapa:', error);
    }
}

function setupBrushLayers(features, mapInstance) {
    const brushControl = mapInstance._controls.find(control =>
        control.constructor.name === 'AddBrushControl'
    );

    let correctedBrushes = features.brushes;
    if (brushControl) {
        correctedBrushes = brushControl.applyZoomCorrections(features.brushes);
    }

    if (!mapInstance.getSource('brushes')) {
        mapInstance.addSource('brushes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedBrushes
            }
        });
    } else {
        mapInstance.getSource('brushes').setData({
            type: 'FeatureCollection',
            features: correctedBrushes
        });
    }

    if (!mapInstance.getSource('brush-feedback')) {
        mapInstance.addSource('brush-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('brush-layer')) {
        mapInstance.addLayer({
            id: 'brush-layer',
            type: 'line',
            source: 'brushes',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'calculatedLineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('brush-feedback-layer')) {
        mapInstance.addLayer({
            id: 'brush-feedback-layer',
            type: 'line',
            source: 'brush-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 0.7
            }
        });
    }
}

function setupRectangleLayers(features, mapInstance) {
    if (!mapInstance.getSource('rectangles')) {
        mapInstance.addSource('rectangles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.rectangles
            }
        });
    } else {
        mapInstance.getSource('rectangles').setData({
            type: 'FeatureCollection',
            features: features.rectangles
        });
    }

    if (!mapInstance.getSource('rectangle-feedback')) {
        mapInstance.addSource('rectangle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('rectangle-edit-handles')) {
        mapInstance.addSource('rectangle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('rectangle-feedback-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-feedback-layer',
            type: 'line',
            source: 'rectangle-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('rectangle-fill-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-fill-layer',
            type: 'fill',
            source: 'rectangles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('rectangle-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-layer',
            type: 'line',
            source: 'rectangles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('rectangle-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-edit-handles-layer',
            type: 'circle',
            source: 'rectangle-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ff0000',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupOccupiedFrontLayers(features, mapInstance) {
    if (!mapInstance.getSource('occupied_fronts')) {
        mapInstance.addSource('occupied_fronts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.occupied_fronts
            }
        });
    } else {
        mapInstance.getSource('occupied_fronts').setData({
            type: 'FeatureCollection',
            features: features.occupied_fronts
        });
    }

    if (!mapInstance.getSource('occupied-front-feedback')) {
        mapInstance.addSource('occupied-front-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('occupied-front-edit-handles')) {
        mapInstance.addSource('occupied-front-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('occupied-front-feedback-layer')) {
        mapInstance.addLayer({
            id: 'occupied-front-feedback-layer',
            type: 'line',
            source: 'occupied-front-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('occupied-front-layer')) {
        mapInstance.addLayer({
            id: 'occupied-front-layer',
            type: 'line',
            source: 'occupied_fronts',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('occupied-front-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'occupied-front-edit-handles-layer',
            type: 'circle',
            source: 'occupied-front-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'center'], '#00ff00',
                    ['==', ['get', 'handleType'], 'primary'], '#ff0000',
                    ['==', ['get', 'handleType'], 'secondary'], '#0066ff',
                    '#888888'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 1
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupMilitarySymbolsLayers(features, mapInstance) {
    const militarySymbolControl = mapInstance._controls.find(control =>
        control.constructor.name === 'AddMilitarySymbolControl'
    );

    let correctedSymbols = features.military_symbols;
    if (militarySymbolControl) {
        correctedSymbols = militarySymbolControl.applyZoomCorrections(features.military_symbols);
    }

    if (!mapInstance.getSource('military_symbols')) {
        mapInstance.addSource('military_symbols', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedSymbols
            }
        });
    } else {
        mapInstance.getSource('military_symbols').setData({
            type: 'FeatureCollection',
            features: correctedSymbols
        });
    }

    if (!mapInstance.getLayer('military-symbols-layer')) {
        mapInstance.addLayer({
            id: 'military-symbols-layer',
            type: 'symbol',
            source: 'military_symbols',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'id'],
                'icon-size': ['get', 'calculatedSize'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

function setupPointLayers(features, mapInstance) {
    if (!mapInstance.getSource('points')) {
        mapInstance.addSource('points', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.points || []
            }
        });
    } else {
        mapInstance.getSource('points').setData({
            type: 'FeatureCollection',
            features: features.points || []
        });
    }

    if (!mapInstance.getSource('point-feedback')) {
        mapInstance.addSource('point-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('point-layer')) {
        mapInstance.addLayer({
            id: 'point-layer',
            type: 'circle',
            source: 'points',
            paint: {
                'circle-radius': ['get', 'size'],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('point-feedback-layer')) {
        mapInstance.addLayer({
            id: 'point-feedback-layer',
            type: 'circle',
            source: 'point-feedback',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ff0000',
                'circle-opacity': 0.8
            }
        });
    }
}

function setupLineLayers(features, mapInstance) {
    if (!mapInstance.getSource('lines')) {
        mapInstance.addSource('lines', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.lines || []
            }
        });
    } else {
        mapInstance.getSource('lines').setData({
            type: 'FeatureCollection',
            features: features.lines || []
        });
    }

    if (!mapInstance.getSource('line-feedback')) {
        mapInstance.addSource('line-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('line-edit-handles')) {
        mapInstance.addSource('line-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('line-feedback-layer')) {
        mapInstance.addLayer({
            id: 'line-feedback-layer',
            type: 'line',
            source: 'line-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('line-layer')) {
        mapInstance.addLayer({
            id: 'line-layer',
            type: 'line',
            source: 'lines',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'size'],
                'line-opacity': ['get', 'opacity']
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'solid'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('line-layer-dashed')) {
        mapInstance.addLayer({
            id: 'line-layer-dashed',
            type: 'line',
            source: 'lines',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'size'],
                'line-opacity': ['get', 'opacity'],
                'line-dasharray': [8, 4]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dashed'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('line-layer-dotted')) {
        mapInstance.addLayer({
            id: 'line-layer-dotted',
            type: 'line',
            source: 'lines',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'size'],
                'line-opacity': ['get', 'opacity'],
                'line-dasharray': [2, 3]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dotted'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('line-layer-dash-dot')) {
        mapInstance.addLayer({
            id: 'line-layer-dash-dot',
            type: 'line',
            source: 'lines',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'size'],
                'line-opacity': ['get', 'opacity'],
                'line-dasharray': [8, 4, 2, 4]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dash-dot'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('line-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'line-edit-handles-layer',
            type: 'circle',
            source: 'line-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupPolygonLayers(features, mapInstance) {
    if (!mapInstance.getSource('polygons')) {
        mapInstance.addSource('polygons', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.polygons || []
            }
        });
    } else {
        mapInstance.getSource('polygons').setData({
            type: 'FeatureCollection',
            features: features.polygons || []
        });
    }

    if (!mapInstance.getSource('polygon-feedback')) {
        mapInstance.addSource('polygon-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('polygon-edit-handles')) {
        mapInstance.addSource('polygon-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('polygon-fill-layer')) {
        mapInstance.addLayer({
            id: 'polygon-fill-layer',
            type: 'fill',
            source: 'polygons',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('polygon-feedback-layer')) {
        mapInstance.addLayer({
            id: 'polygon-feedback-layer',
            type: 'line',
            source: 'polygon-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('polygon-layer')) {
        mapInstance.addLayer({
            id: 'polygon-layer',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'solid'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-layer-dashed')) {
        mapInstance.addLayer({
            id: 'polygon-layer-dashed',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1,
                'line-dasharray': [8, 4]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dashed'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-layer-dotted')) {
        mapInstance.addLayer({
            id: 'polygon-layer-dotted',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1,
                'line-dasharray': [2, 3]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dotted'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-layer-dash-dot')) {
        mapInstance.addLayer({
            id: 'polygon-layer-dash-dot',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1,
                'line-dasharray': [8, 4, 2, 4]
            },
            filter: ['all',
                ['==', ['get', 'lineStyle'], 'dash-dot'],
                ['!=', ['get', 'visivel'], false]
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'polygon-edit-handles-layer',
            type: 'circle',
            source: 'polygon-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

async function setImages(features, mapInstance) {
    const imagePromises = [];

    const allImageFeatures = [
        ...(features.images),
        ...(features.military_symbols)
    ];

    for (const feature of allImageFeatures) {
        const imageId = feature.properties.id;
        if (!imageId) continue;

        if (mapInstance.hasImage(imageId)) continue;

        const imagePromise = loadSingleImage(imageId, mapInstance);
        imagePromises.push(imagePromise);
    }

    await Promise.allSettled(imagePromises);
}

async function loadSingleImage(imageId, mapInstance) {
    try {
        const blob = await imageStore.getItem(imageId);
        if (!blob) {
            console.warn(`Imagem ${imageId} não encontrada no store`);
            return;
        }

        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => {
                try {
                    if (!mapInstance.hasImage(imageId)) {
                        mapInstance.addImage(imageId, image);
                    }
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Falha ao carregar imagem ${imageId}`));
            };

            setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout ao carregar imagem ${imageId}`));
            }, 10000);

            image.src = url;
        });

    } catch (error) {
        console.warn(`Erro ao processar imagem ${imageId}:`, error);
    }
}

function setupBoundaryLayers(features, mapInstance) {
    if (!features.boundarys) return;

    if (!mapInstance.getSource('boundarys')) {
        mapInstance.addSource('boundarys', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.boundarys
            }
        });
    } else {
        mapInstance.getSource('boundarys').setData({
            type: 'FeatureCollection',
            features: features.boundarys
        });
    }

    if (!mapInstance.getSource('boundary-circles')) {
        mapInstance.addSource('boundary-circles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-texts')) {
        mapInstance.addSource('boundary-texts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-feedback')) {
        mapInstance.addSource('boundary-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-edit-handles')) {
        mapInstance.addSource('boundary-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('boundary-feedback-layer')) {
        mapInstance.addLayer({
            id: 'boundary-feedback-layer',
            type: 'line',
            source: 'boundary-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            },
            filter: ['!=', ['get', 'user_isEditingHandle'], true]
        });
    }

    if (!mapInstance.getLayer('boundary-main-layer')) {
        mapInstance.addLayer({
            id: 'boundary-main-layer',
            type: 'line',
            source: 'boundarys',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-circles-layer')) {
        mapInstance.addLayer({
            id: 'boundary-circles-layer',
            type: 'fill',
            source: 'boundary-circles',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-circles-stroke-layer')) {
        mapInstance.addLayer({
            id: 'boundary-circles-stroke-layer',
            type: 'line',
            source: 'boundary-circles',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': 2,
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-text-layer')) {
        mapInstance.addLayer({
            id: 'boundary-text-layer',
            type: 'symbol',
            source: 'boundary-texts',
            layout: {
                'text-field': ['get', 'text'],
                'text-font': ['Noto Sans Regular'],
                'text-size': ['coalesce', ['get', 'text_size'], 14],
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
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-handles-layer')) {
        mapInstance.addLayer({
            id: 'boundary-handles-layer',
            type: 'circle',
            source: 'boundary-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'type'], 'vertex'], '#ff0000',
                    ['==', ['get', 'type'], 'midpoint'], '#ffaa00',
                    ['==', ['get', 'type'], 'symbol_handle'], '#0066ff',
                    ['==', ['get', 'type'], 'size_handle'], '#28a745',
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'type'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupEllipseLayers(features, mapInstance) {
    if (!mapInstance.getSource('ellipses')) {
        mapInstance.addSource('ellipses', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.ellipses
            }
        });
    } else {
        mapInstance.getSource('ellipses').setData({
            type: 'FeatureCollection',
            features: features.ellipses
        });
    }

    if (!mapInstance.getSource('ellipse-feedback')) {
        mapInstance.addSource('ellipse-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('ellipse-edit-handles')) {
        mapInstance.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('ellipse-feedback-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-feedback-layer',
            type: 'line',
            source: 'ellipse-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('ellipse-fill-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-fill-layer',
            type: 'fill',
            source: 'ellipses',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('ellipse-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-layer',
            type: 'line',
            source: 'ellipses',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('ellipse-edit-handles-layer')) {
        mapInstance.addLayer({
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
}

function setupVisibilityLayers(features, mapInstance) {
    if (!mapInstance.getSource('visibility')) {
        mapInstance.addSource('visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.visibility
            }
        });
    } else {
        mapInstance.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: features.visibility
        });
    }

    if (!mapInstance.getSource('processed-visibility')) {
        mapInstance.addSource('processed-visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_visibility
            }
        });
    } else {
        mapInstance.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: features.processed_visibility
        });
    }

    if (!mapInstance.getLayer('visibility-layer')) {
        mapInstance.addLayer({
            id: 'visibility-layer',
            type: 'fill',
            source: 'visibility',
            paint: {
                'fill-color': '#D3D3D3',
                'fill-opacity': 0
            }
        });
    }

    if (!mapInstance.getLayer('processed-visibility-layer')) {
        mapInstance.addLayer({
            id: 'processed-visibility-layer',
            type: 'fill',
            source: 'processed-visibility',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

function setupImageLayers(features, mapInstance) {
    const imageControl = mapInstance._controls.find(control =>
        control.constructor.name === 'AddImageControl'
    );

    let correctedImages = features.images;
    if (imageControl) {
        correctedImages = imageControl.applyZoomCorrections(features.images);
    }

    if (!mapInstance.getSource('images')) {
        mapInstance.addSource('images', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedImages
            }
        });
    } else {
        mapInstance.getSource('images').setData({
            type: 'FeatureCollection',
            features: correctedImages
        });
    }

    if (!mapInstance.getLayer('image-layer')) {
        mapInstance.addLayer({
            id: 'image-layer',
            type: 'symbol',
            source: 'images',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'id'],
                'icon-size': ['get', 'calculatedSize'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

function setupLOSLayers(features, mapInstance) {
    if (!mapInstance.getSource('los')) {
        mapInstance.addSource('los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.los
            }
        });
    } else {
        mapInstance.getSource('los').setData({
            type: 'FeatureCollection',
            features: features.los
        });
    }

    if (!mapInstance.getSource('processed-los')) {
        mapInstance.addSource('processed-los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_los
            }
        });
    } else {
        mapInstance.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: features.processed_los
        });
    }

    if (!mapInstance.getLayer('los-layer')) {
        mapInstance.addLayer({
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

    if (!mapInstance.getLayer('processed-los-layer')) {
        mapInstance.addLayer({
            'id': 'processed-los-layer',
            'type': 'line',
            'source': 'processed-los',
            'paint': {
                'line-color': ['get', 'color'],
                'line-opacity': ['get', 'opacity'],
                'line-width': ['get', 'width']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }
}

function setupArrowLayers(features, mapInstance) {
    if (!mapInstance.getSource('arrows')) {
        mapInstance.addSource('arrows', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.arrows
            }
        });
    } else {
        mapInstance.getSource('arrows').setData({
            type: 'FeatureCollection',
            features: features.arrows
        });
    }

    if (!mapInstance.getSource('arrow-feedback')) {
        mapInstance.addSource('arrow-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('arrow-edit-handles')) {
        mapInstance.addSource('arrow-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('arrow-feedback-layer')) {
        mapInstance.addLayer({
            id: 'arrow-feedback-layer',
            type: 'line',
            source: 'arrow-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('arrow-fill-layer')) {
        mapInstance.addLayer({
            id: 'arrow-fill-layer',
            type: 'fill',
            source: 'arrows',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('arrow-layer')) {
        mapInstance.addLayer({
            id: 'arrow-layer',
            type: 'line',
            source: 'arrows',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'lineOpacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('arrow-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'arrow-edit-handles-layer',
            type: 'circle',
            source: 'arrow-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                    ['==', ['get', 'handleType'], 'width'], '#0066ff',
                    ['==', ['get', 'handleType'], 'headLength'], '#00aa00',
                    ['==', ['get', 'handleType'], 'airmobile'], '#aa00aa',
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupCircleLayers(features, mapInstance) {
    if (!mapInstance.getSource('circles')) {
        mapInstance.addSource('circles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.circles
            }
        });
    } else {
        mapInstance.getSource('circles').setData({
            type: 'FeatureCollection',
            features: features.circles
        });
    }

    if (!mapInstance.getSource('circle-feedback')) {
        mapInstance.addSource('circle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('circle-edit-handles')) {
        mapInstance.addSource('circle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('circle-x-marks')) {
        mapInstance.addSource('circle-x-marks', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('circle-feedback-layer')) {
        mapInstance.addLayer({
            id: 'circle-feedback-layer',
            type: 'line',
            source: 'circle-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('circle-fill-layer')) {
        mapInstance.addLayer({
            id: 'circle-fill-layer',
            type: 'fill',
            source: 'circles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('circle-layer')) {
        mapInstance.addLayer({
            id: 'circle-layer',
            type: 'line',
            source: 'circles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('circle-x-layer')) {
        mapInstance.addLayer({
            id: 'circle-x-layer',
            type: 'line',
            source: 'circle-x-marks',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('circle-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'circle-edit-handles-layer',
            type: 'circle',
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
}

function setupTextLayers(features, mapInstance) {
    const textControl = mapInstance._controls.find(control =>
        control.constructor.name === 'AddTextControl'
    );

    let correctedTexts = features.texts;
    if (textControl) {
        correctedTexts = textControl.applyZoomCorrections(features.texts);
    }

    if (!mapInstance.getSource('texts')) {
        mapInstance.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedTexts
            }
        });
    } else {
        mapInstance.getSource('texts').setData({
            type: 'FeatureCollection',
            features: correctedTexts
        });
    }

    // Source separado para backgrounds (usando selectionBox como geometria)
    const backgroundFeatures = correctedTexts
        .filter(feature => feature.properties.showBackground && feature.properties.selectionBox)
        .map(feature => ({
            type: 'Feature',
            properties: {
                ...feature.properties,
                id: feature.properties.id + '_bg' // ID único para o background
            },
            geometry: feature.properties.selectionBox // Usar selectionBox como geometria
        }));

    if (!mapInstance.getSource('text-backgrounds')) {
        mapInstance.addSource('text-backgrounds', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: backgroundFeatures
            }
        });
    } else {
        mapInstance.getSource('text-backgrounds').setData({
            type: 'FeatureCollection',
            features: backgroundFeatures
        });
    }

    // Layer 1: Background Fill (primeiro layer - atrás de tudo)
    if (!mapInstance.getLayer('text-background-fill-layer')) {
        mapInstance.addLayer({
            id: 'text-background-fill-layer',
            type: 'fill',
            source: 'text-backgrounds',
            paint: {
                'fill-color': ['get', 'backgroundFillColor'],
                'fill-opacity': ['get', 'backgroundFillOpacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'showBackground'], true]
            ]
        });
    }

    // Layer 2: Background Border (segundo layer)
    if (!mapInstance.getLayer('text-background-border-layer')) {
        mapInstance.addLayer({
            id: 'text-background-border-layer',
            type: 'line',
            source: 'text-backgrounds',
            paint: {
                'line-color': ['get', 'backgroundBorderColor'],
                'line-width': ['get', 'backgroundBorderWidth'],
                'line-opacity': ['get', 'backgroundBorderOpacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'showBackground'], true]
            ]
        });
    }

    // Layer 3: Texto (terceiro layer - na frente)
    if (!mapInstance.getLayer('text-layer')) {
        mapInstance.addLayer({
            id: 'text-layer',
            type: 'symbol',
            source: 'texts',
            layout: {
                'text-field': ['get', 'text'],
                'text-size': ['get', 'calculatedSize'],
                'text-justify': ['get', 'justify'],
                'text-anchor': 'center',
                'text-rotate': ['get', 'rotation'],
                'text-ignore-placement': true,
                'text-allow-overlap': true,
                'text-font': ['Noto Sans Regular']
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': ['get', 'backgroundColor'],
                'text-halo-width': 2
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    // Função helper para atualizar backgrounds quando textos mudarem
    const updateBackgroundFeatures = () => {
        const currentTexts = mapInstance.getSource('texts')._data.features;
        const updatedBackgroundFeatures = currentTexts
            .filter(feature => feature.properties.showBackground && feature.properties.selectionBox)
            .map(feature => ({
                type: 'Feature',
                properties: {
                    ...feature.properties,
                    id: feature.properties.id + '_bg'
                },
                geometry: feature.properties.selectionBox
            }));

        mapInstance.getSource('text-backgrounds').setData({
            type: 'FeatureCollection',
            features: updatedBackgroundFeatures
        });
    };

    // Event listener para sincronizar backgrounds quando textos mudarem
    if (textControl && !textControl._backgroundUpdateListener) {
        const originalSetData = mapInstance.getSource('texts').setData.bind(mapInstance.getSource('texts'));
        mapInstance.getSource('texts').setData = function (data) {
            originalSetData(data);
            // Pequeno delay para garantir que o source principal foi atualizado
            setTimeout(updateBackgroundFeatures, 0);
        };
        textControl._backgroundUpdateListener = true; // Flag para evitar múltiplas binding
    }
}

function setupAuxiliaryLayers(mapInstance) {
    if (!mapInstance.getSource('selection-boxes')) {
        mapInstance.addSource('selection-boxes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!mapInstance.getLayer('selection-boxes-layer')) {
        mapInstance.addLayer({
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

    if (!mapInstance.getSource('temp-line')) {
        mapInstance.addSource('temp-line', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!mapInstance.getLayer('temp-line-layer')) {
        mapInstance.addLayer({
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

    if (!mapInstance.getSource('temp-polygon')) {
        mapInstance.addSource('temp-polygon', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!mapInstance.getLayer('temp-polygon-layer')) {
        mapInstance.addLayer({
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

    if (!mapInstance.getSource('lines-street-view')) {
        mapInstance.addSource('lines-street-view', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!mapInstance.getLayer('street-view')) {
        mapInstance.addLayer({
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
}

function restoreTerrainState(mapInstance) {
    try {

        const terrainControl = mapInstance._controls.find(control =>
            control.constructor.name === 'TerrainControl'
        );

        if (!terrainControl) {
            return; // Nenhum controle de terreno encontrado
        }

        if (terrainControl.terrainConfig) {
            terrainControl._setupTerrainSources();

            // Reativar o terreno 3D
            if (mapInstance.getSource('terrainSource') && terrainControl._wasTerrainActive) {
                mapInstance.setTerrain(terrainControl.terrainConfig);
            }
        }

    } catch (error) {
        console.warn('Erro ao restaurar estado do terreno:', error);
    }
}

function clearAllMeasurements() {
    try {
        const measurementLabels = document.querySelectorAll('.measurement-label');
        measurementLabels.forEach(label => {
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

function restoreMeasurements(features, mapInstance) {
    try {

        const lineControl = mapInstance._controls.find(control =>
            control.constructor.name === 'AddLineControl'
        );
        const polygonControl = mapInstance._controls.find(control =>
            control.constructor.name === 'AddPolygonControl'
        );

        const losControl = mapInstance._controls.find(control =>
            control.constructor.name === 'AddLOSControl'
        );

        if (lineControl && features.lines) {
            features.lines.forEach(feature => {
                if (feature.properties?.measure) {
                    lineControl.updateFeatureMeasurement(feature);
                }
            });
        }

        if (polygonControl && features.polygons) {
            features.polygons.forEach(feature => {
                if (feature.properties?.measure) {
                    polygonControl.updateFeatureMeasurement(feature);
                }
            });
        }

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

function restoreCircleXMarks(features, mapInstance) {
    try {
        const circleControl = mapInstance._controls.find(control =>
            control.constructor.name === 'AddCircleControl'
        );

        if (circleControl && typeof circleControl.updateXMarks === 'function') {
            circleControl.updateXMarks();
        }
    } catch (error) {
        console.warn('Erro ao restaurar X marks dos círculos:', error);
    }
}

function restoreBoundaryDependentFeatures(features, mapInstance) {
    try {
        const boundaryControl = mapInstance._controls.find(control =>
            control.constructor.name === 'AddBoundaryControl'
        );

        if (!boundaryControl || !features.boundarys?.length) {
            return;
        }

        features.boundarys.forEach((boundaryFeature, index) => {
            try {
                if (!boundaryFeature?.properties) {
                    console.warn(`Invalid boundary feature ${index}:`, boundaryFeature);
                    return;
                }

                let coords = boundaryFeature.properties.baseCoordinates;

                if (typeof coords === 'string') {
                    try {
                        coords = JSON.parse(coords);
                    } catch (parseError) {
                        console.warn(`Failed to parse coordinates for boundary ${boundaryFeature.properties.id}`);
                        return;
                    }
                }

                if (!Array.isArray(coords) || coords.length < 2) {
                    console.warn(`Invalid coordinates for boundary ${boundaryFeature.properties.id}`);
                    return;
                }

                const validCoords = coords.filter(coord =>
                    Array.isArray(coord) &&
                    coord.length >= 2 &&
                    typeof coord[0] === 'number' &&
                    typeof coord[1] === 'number' &&
                    !isNaN(coord[0]) &&
                    !isNaN(coord[1])
                );

                if (validCoords.length < 2) {
                    console.warn(`Insufficient valid coordinates for boundary ${boundaryFeature.properties.id}`);
                    return;
                }

                boundaryFeature.properties.baseCoordinates = validCoords;

                boundaryControl.updateDependentFeatures(boundaryFeature);

            } catch (featureError) {
                console.error(`Error processing boundary ${index}:`, featureError);
            }
        });

    } catch (error) {
        console.error('Error restoring boundary dependent features:', error);
    }
}