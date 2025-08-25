// Path: js\controls_sig\map.js
import { getCurrentMapFeatures } from './store.js';
import { imageStore } from './store.js';
import baseStyle from './baselayers/carta_topografica.js'
import config from '../config.js';
import { hideLoadingScreen } from '../index.js';

const map = new maplibregl.Map({
    container: 'map-sig',
    style: baseStyle,
    attributionControl: false,
    minZoom: config.map2d.minZoom,
    maxZoom: config.map2d.maxZoom,
    maxPitch: config.map2d.maxPitch,
    bounds: config.map2d.bounds
});

map.setSourceTileLodParams(...config.map2d.sourceTileLodParams);
if (config.map2d.maxBounds) {
    map.setMaxBounds(config.map2d.maxBounds);
}

map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Diretoria de Serviço Geográfico - Exército Brasileiro',
    compact: true
}), 'bottom-right');

export async function setupMapFeatures() {
    try {
        setupAuxiliaryLayers();

        // Carregar dados do IndexedDB
        const features = await getCurrentMapFeatures();
        await setImages(features);

        setupPointLayers(features);
        setupLineLayers(features);
        setupPolygonLayers(features);
        setupEllipseLayers(features);
        setupCircleLayers(features);
        setupVisibilityLayers(features);
        setupImageLayers(features);
        setupMilitarySymbolsLayers(features);
        setupBoundaryLayers(features);
        setupOccupiedFrontLayers(features);
        setupArrowLayers(features);
        setupLOSLayers(features);
        setupTextLayers(features);
        setupRectangleLayers(features);
        setupBrushLayers(features);

        restoreTerrainState();

        // Restaurar medições e marcações
        requestAnimationFrame(() => {
            clearAllMeasurements();
            restoreMeasurements(features);
            restoreCircleXMarks(features);
            restoreBoundaryDependentFeatures(features);
        });
    } catch (error) {
        console.error('Erro ao configurar features do mapa:', error);
    }
}

map.on('load', async () => {
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    await setupMapFeatures();
    hideLoadingScreen();
});

function setupBrushLayers(features) {
    // ===== SOURCES (2 - simples) =====

    const brushControl = map._controls.find(control => 
        control.constructor.name === 'AddBrushControl'
    );
    
    let correctedBrushes = features.brushes;
    if (brushControl) {
        correctedBrushes = brushControl.applyZoomCorrections(features.brushes);
    }
    
    // 1. Source principal
    if (!map.getSource('brushes')) {
        map.addSource('brushes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedBrushes
            }
        });
    } else {
        map.getSource('brushes').setData({
            type: 'FeatureCollection',
            features: correctedBrushes
        });
    }

    // 2. Feedback source (preview)
    if (!map.getSource('brush-feedback')) {
        map.addSource('brush-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS (2 - simples) =====

    // 1. Main layer (editable parameters)
    if (!map.getLayer('brush-layer')) {
        map.addLayer({
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
            }
        });
    }

    // 2. Preview layer
    if (!map.getLayer('brush-feedback-layer')) {
        map.addLayer({
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

function setupRectangleLayers(features) {
    // ===== SOURCES (3 - consolidados) =====
    
    // 1. Source principal
    if (!map.getSource('rectangles')) {
        map.addSource('rectangles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.rectangles
            }
        });
    } else {
        map.getSource('rectangles').setData({
            type: 'FeatureCollection',
            features: features.rectangles
        });
    }

    // 2. Feedback consolidado
    if (!map.getSource('rectangle-feedback')) {
        map.addSource('rectangle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source
    if (!map.getSource('rectangle-edit-handles')) {
        map.addSource('rectangle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS (4 - seguindo padrão) =====

    // 3. Feedback layer
    if (!map.getLayer('rectangle-feedback-layer')) {
        map.addLayer({
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

    // 1. Fill layer (editable parameters)
    if (!map.getLayer('rectangle-fill-layer')) {
        map.addLayer({
            id: 'rectangle-fill-layer',
            type: 'fill',
            source: 'rectangles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    // 2. Stroke layer (editable parameters)
    if (!map.getLayer('rectangle-layer')) {
        map.addLayer({
            id: 'rectangle-layer',
            type: 'line',
            source: 'rectangles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1
            }
        });
    }

    // 4. Edit handles layer
    if (!map.getLayer('rectangle-edit-handles-layer')) {
        map.addLayer({
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

function setupOccupiedFrontLayers(features) {
    // ===== SOURCES (3 - consolidados) =====
    
    // 1. Source principal (inalterado)
    if (!map.getSource('occupied_fronts')) {
        map.addSource('occupied_fronts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.occupied_fronts
            }
        });
    } else {
        map.getSource('occupied_fronts').setData({
            type: 'FeatureCollection',
            features: features.occupied_fronts
        });
    }

    // 2. ✅ NOVO: Feedback consolidado (substitui occupied-front-preview)
    if (!map.getSource('occupied-front-feedback')) {
        map.addSource('occupied-front-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source (inalterado)
    if (!map.getSource('occupied-front-edit-handles')) {
        map.addSource('occupied-front-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS (3 - redução de 4→3) =====

    // 2. ✅ NOVO: Feedback consolidado (substitui preview + selected)
    if (!map.getLayer('occupied-front-feedback-layer')) {
        map.addLayer({
            id: 'occupied-front-feedback-layer',
            type: 'line',
            source: 'occupied-front-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',        // Vermelho sempre
                'line-width': 4,
                'line-dasharray': [3, 3],       // Sempre tracejado
                'line-opacity': 0.8
            }
        });
    }

        // 1. Layer principal (MultiLineString) - inalterado
    if (!map.getLayer('occupied-front-layer')) {
        map.addLayer({
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
            }
        });
    }

    // 3. Edit handles layer (inalterado)
    if (!map.getLayer('occupied-front-edit-handles-layer')) {
        map.addLayer({
            id: 'occupied-front-edit-handles-layer',
            type: 'circle',
            source: 'occupied-front-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'center'], '#00ff00',    // Verde (P1 - origem)
                    ['==', ['get', 'handleType'], 'primary'], '#ff0000',   // Vermelho (P2 - braço superior)
                    ['==', ['get', 'handleType'], 'secondary'], '#0066ff', // Azul (P3 - braço inferior)
                    '#888888' // Fallback cinza
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 1
            },
            filter: ['==', '$type', 'Point'] // Só pontos (handles)
        });
    }
}

function setupMilitarySymbolsLayers(features) {
    // Source
    if (!map.getSource('military_symbols')) {
        map.addSource('military_symbols', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.military_symbols
            }
        });
    } else {
        map.getSource('military_symbols').setData({
            type: 'FeatureCollection',
            features: features.military_symbols
        });
    }

    // Layer
    if (!map.getLayer('military-symbols-layer')) {
        map.addLayer({
            id: 'military-symbols-layer',
            type: 'symbol',
            source: 'military_symbols',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'id'], // Usa imageId igual ao image control
                'icon-size': ['get', 'size'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
    }
}

function setupPointLayers(features) {
    // ===== SOURCES =====
    
    // 1. Source principal
    if (!map.getSource('points')) {
        map.addSource('points', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.points || []
            }
        });
    } else {
        map.getSource('points').setData({
            type: 'FeatureCollection',
            features: features.points || []
        });
    }

    // 2. Feedback source
    if (!map.getSource('point-feedback')) {
        map.addSource('point-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS =====

    // 1. Main layer
    if (!map.getLayer('point-layer')) {
        map.addLayer({
            id: 'point-layer',
            type: 'circle',
            source: 'points',
            paint: {
                'circle-radius': ['get', 'size'],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['get', 'opacity']
            }
        });
    }

    // 2. Feedback layer
    if (!map.getLayer('point-feedback-layer')) {
        map.addLayer({
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

function setupLineLayers(features) {
    // ===== SOURCES =====
    
    // 1. Source principal
    if (!map.getSource('lines')) {
        map.addSource('lines', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.lines || []
            }
        });
    } else {
        map.getSource('lines').setData({
            type: 'FeatureCollection',
            features: features.lines || []
        });
    }

    // 2. Feedback source
    if (!map.getSource('line-feedback')) {
        map.addSource('line-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source
    if (!map.getSource('line-edit-handles')) {
        map.addSource('line-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS =====

    // 1. Main layer
    if (!map.getLayer('line-layer')) {
        map.addLayer({
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
            }
        });
    }

    // 2. Feedback layer
    if (!map.getLayer('line-feedback-layer')) {
        map.addLayer({
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

    // 3. Edit handles layer
    if (!map.getLayer('line-edit-handles-layer')) {
        map.addLayer({
            id: 'line-edit-handles-layer',
            type: 'circle',
            source: 'line-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',      // Red: vertices
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',    // Orange: midpoints
                    '#000000'                                                 // Fallback
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,          // Midpoints transparent
                    1.0                                                       // Others opaque
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

function setupPolygonLayers(features) {
    // ===== SOURCES =====
    
    // 1. Source principal
    if (!map.getSource('polygons')) {
        map.addSource('polygons', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.polygons || []
            }
        });
    } else {
        map.getSource('polygons').setData({
            type: 'FeatureCollection',
            features: features.polygons || []
        });
    }

    // 2. Feedback source
    if (!map.getSource('polygon-feedback')) {
        map.addSource('polygon-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source
    if (!map.getSource('polygon-edit-handles')) {
        map.addSource('polygon-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS =====

    // 1. Fill layer
    if (!map.getLayer('polygon-fill-layer')) {
        map.addLayer({
            id: 'polygon-fill-layer',
            type: 'fill',
            source: 'polygons',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    // 2. Stroke layer
    if (!map.getLayer('polygon-layer')) {
        map.addLayer({
            id: 'polygon-layer',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1
            }
        });
    }

    // 3. Feedback layer
    if (!map.getLayer('polygon-feedback-layer')) {
        map.addLayer({
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

    // 4. Edit handles layer
    if (!map.getLayer('polygon-edit-handles-layer')) {
        map.addLayer({
            id: 'polygon-edit-handles-layer',
            type: 'circle',
            source: 'polygon-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',      // Red: vertices
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',    // Orange: midpoints
                    '#000000'                                                 // Fallback
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,          // Midpoints transparent
                    1.0                                                       // Others opaque
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

async function setImages(features) {
    const imagePromises = [];

    // Coletar todas as features que precisam de imagens
    const allImageFeatures = [
        ...(features.images),
        ...(features.military_symbols)
    ];

    for (const feature of allImageFeatures) {
        const imageId = feature.properties.id;
        if (!imageId) continue;

        // Verificar se já existe
        if (map.hasImage(imageId)) continue;

        const imagePromise = loadSingleImage(imageId);
        imagePromises.push(imagePromise);
    }

    // ✅ AGUARDAR todas as imagens carregarem
    await Promise.allSettled(imagePromises);
}

async function loadSingleImage(imageId) {
    try {
        const blob = await imageStore.getItem(imageId);
        if (!blob) {
            console.warn(`Imagem ${imageId} não encontrada no store`);
            return;
        }

        const url = URL.createObjectURL(blob);

        // ✅ Promise que resolve quando imagem carrega
        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => {
                try {
                    if (!map.hasImage(imageId)) {
                        map.addImage(imageId, image);
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

            // ✅ Timeout para evitar travamento
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

function setupBoundaryLayers(features) {
    if (!features.boundarys) return;

    // ===== SOURCES CONSOLIDADOS (4 sources - reduzido de 5) =====

    // 1. Source principal - feature principal
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

    // 2. Source para círculos do escalão (preservado - dependent features)
    if (!map.getSource('boundary-circles')) {
        map.addSource('boundary-circles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Source para textos (preservado - dependent features)
    if (!map.getSource('boundary-texts')) {
        map.addSource('boundary-texts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 4. ✅ CONSOLIDADO: Feedback source (preview + selected + handles)
    if (!map.getSource('boundary-feedback')) {
        map.addSource('boundary-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS CONSOLIDADOS (6 layers - reduzido de 7+) =====

    // 5. ✅ FEEDBACK LAYER - Preview + Selected (estilo fixo como outros controles)
    if (!map.getLayer('boundary-feedback-layer')) {
        map.addLayer({
            id: 'boundary-feedback-layer',
            type: 'line',
            source: 'boundary-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',        // Vermelho sempre
                'line-width': 4,
                'line-dasharray': [3, 3],       // Sempre tracejado
                'line-opacity': 0.8
            },
            filter: ['!=', ['get', 'user_isEditingHandle'], true] // Não handles
        });
    }

    // 1. LAYER PRINCIPAL - MultiLineString (linha + símbolos)
    if (!map.getLayer('boundary-main-layer')) {
        map.addLayer({
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
            }
        });
    }

    // 2. LAYER CÍRCULOS - Preenchimento dos símbolos 'o'
    if (!map.getLayer('boundary-circles-layer')) {
        map.addLayer({
            id: 'boundary-circles-layer',
            type: 'fill',
            source: 'boundary-circles',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }

    // 3. LAYER CÍRCULOS CONTORNO - Contorno dos símbolos 'o'
    if (!map.getLayer('boundary-circles-stroke-layer')) {
        map.addLayer({
            id: 'boundary-circles-stroke-layer',
            type: 'line',
            source: 'boundary-circles',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': 2,
                'line-opacity': ['get', 'opacity']
            }
        });
    }

    // 4. LAYER TEXTOS - Labels rotativos
    if (!map.getLayer('boundary-text-layer')) {
        map.addLayer({
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
            }
        });
    }

    // 6. ✅ HANDLES LAYER - Pontos de edição consolidados
    if (!map.getLayer('boundary-handles-layer')) {
        map.addLayer({
            id: 'boundary-handles-layer',
            type: 'circle',
            source: 'boundary-feedback',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'type'], 'vertex'], '#ff0000',        // Vermelho: vértices
                    ['==', ['get', 'type'], 'midpoint'], '#ffaa00',      // Laranja: midpoints
                    ['==', ['get', 'type'], 'symbol_handle'], '#0066ff', // Azul: posição símbolo
                    ['==', ['get', 'type'], 'size_handle'], '#28a745',   // Verde: tamanho símbolo
                    '#000000'                                             // Fallback
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'type'], 'midpoint'], 0.6,            // Midpoints transparentes
                    1.0                                                   // Outros opacos
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}
function setupEllipseLayers(features) {
    // ===== SOURCES (3 - consolidados) =====

    // 1. Source principal (inalterado)
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

    // 2. ✅ NOVO: Feedback consolidado (substitui ellipse-preview)
    if (!map.getSource('ellipse-feedback')) {
        map.addSource('ellipse-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source (inalterado)
    if (!map.getSource('ellipse-edit-handles')) {
        map.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS (5 - redução de 6→5) =====

        // 3. ✅ NOVO: Feedback consolidado (substitui preview + selected)
    if (!map.getLayer('ellipse-feedback-layer')) {
        map.addLayer({
            id: 'ellipse-feedback-layer',
            type: 'line',
            source: 'ellipse-feedback',
            paint: {
                'line-color': '#ff0000',        // Vermelho sempre
                'line-width': 3,
                'line-dasharray': [2, 2],       // Sempre tracejado
                'line-opacity': 0.8
            }
        });
    }

    // 1. Fill layer (inalterado - parâmetros editáveis precisam)
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

    // 2. Stroke layer (inalterado - parâmetros editáveis precisam)
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

    // 4. Edit handles (inalterado)
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
}

// ===== VISIBILITY LAYERS (Áreas - Prioridade 3) =====
function setupVisibilityLayers(features) {
    // Source original
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

    // Source processada
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

    // 1. Layer original (invisível)
    if (!map.getLayer('visibility-layer')) {
        map.addLayer({
            id: 'visibility-layer',
            type: 'fill',
            source: 'visibility',
            paint: {
                'fill-color': '#D3D3D3',
                'fill-opacity': 0
            }
        });
    }

    // 2. Layer processada (visível)
    if (!map.getLayer('processed-visibility-layer')) {
        map.addLayer({
            id: 'processed-visibility-layer',
            type: 'fill',
            source: 'processed-visibility',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            }
        });
    }
}

// ===== IMAGE LAYERS (Prioridade 4) =====
function setupImageLayers(features) {
    // Source
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

    // Layer
    if (!map.getLayer('image-layer')) {
        map.addLayer({
            id: 'image-layer',
            type: 'symbol',
            source: 'images',
            paint: {
                'icon-opacity': ['get', 'opacity']
            },
            layout: {
                'icon-image': ['get', 'id'],
                'icon-size': ['get', 'size'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
    }
}

// ===== LOS LAYERS (Linhas - Prioridade 5) =====
function setupLOSLayers(features) {
    // Source original
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

    // Source processada
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

    // 1. Layer original (invisível)
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

    // 2. Layer processada (visível)
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
}

// ===== ARROW LAYERS - CONSOLIDADO SIMPLES (Linhas - Prioridade 6) =====
function setupArrowLayers(features) {
    // ===== SOURCES (3 - otimizado) =====
    
    // 1. Source principal
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

    // 2. ✅ CONSOLIDADO: Feedback source (preview + seleção)
    if (!map.getSource('arrow-feedback')) {
        map.addSource('arrow-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source
    if (!map.getSource('arrow-edit-handles')) {
        map.addSource('arrow-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS (4 - sem fill feedback) =====
    // 3. ✅ SIMPLIFICADO - Feedback layer (mesmo estilo do círculo)
    if (!map.getLayer('arrow-feedback-layer')) {
        map.addLayer({
            id: 'arrow-feedback-layer',
            type: 'line',
            source: 'arrow-feedback',
            paint: {
                'line-color': '#ff0000',        // Vermelho sempre
                'line-width': 4,
                'line-dasharray': [3, 3],       // Sempre tracejado
                'line-opacity': 0.8
            }
        });
    }
    
    // 1. ✅ MANTER - Preenchimento principal (parâmetros editáveis)
    if (!map.getLayer('arrow-fill-layer')) {
        map.addLayer({
            id: 'arrow-fill-layer',
            type: 'fill',
            source: 'arrows',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        });
    }

    // 2. ✅ MANTER - Linha principal (parâmetros editáveis)
    if (!map.getLayer('arrow-layer')) {
        map.addLayer({
            id: 'arrow-layer',
            type: 'line',
            source: 'arrows',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'lineOpacity']
            }
        });
    }

    // 4. ✅ MANTER - Edit handles
    if (!map.getLayer('arrow-edit-handles-layer')) {
        map.addLayer({
            id: 'arrow-edit-handles-layer',
            type: 'circle',
            source: 'arrow-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',      // Vermelho: vértices
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',    // Laranja: midpoints
                    ['==', ['get', 'handleType'], 'width'], '#0066ff',       // Azul: largura
                    ['==', ['get', 'handleType'], 'headLength'], '#00aa00',  // Verde: comprimento cabeça
                    ['==', ['get', 'handleType'], 'airmobile'], '#aa00aa',   // Roxo: posição X aeromóvel
                    '#000000'                                                 // Fallback preto
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,          // Midpoints mais transparentes
                    1.0                                                       // Outros handles opacos
                ]
            },
            filter: ['==', '$type', 'Point']                                  // Apenas pontos (handles)
        });
    }
}

// ===== CIRCLE LAYERS (Pontos - Prioridade 7) =====
function setupCircleLayers(features) {

    // 1. Main circles source
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

    // 2. Consolidated feedback source
    if (!map.getSource('circle-feedback')) {
        map.addSource('circle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 3. Edit handles source (simplified)
    if (!map.getSource('circle-edit-handles')) {
        map.addSource('circle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 4. X marks source
    if (!map.getSource('circle-x-marks')) {
        map.addSource('circle-x-marks', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

        // 4. Feedback layer
    if (!map.getLayer('circle-feedback-layer')) {
        map.addLayer({
            id: 'circle-feedback-layer',
            type: 'line',
            source: 'circle-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],                // Always dashed
                'line-opacity': 0.8
            }
        });
    }

    // 1. Fill layer (editable parameters need separate layer)
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

    // 2. Stroke layer (editable parameters need separate layer)
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

    // 3. X marks layer (fundamental functionality)
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

    // 5. Edit handles layer
    if (!map.getLayer('circle-edit-handles-layer')) {
        map.addLayer({
            id: 'circle-edit-handles-layer',
            type: 'circle',
            source: 'circle-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ff0000',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']  // Only points (handles)
        });
    }
}

// ===== TEXT LAYERS (Maior Prioridade - 8) =====
function setupTextLayers(features) {
    // ✅ NOVO - Aplicar correções de zoom
    const textControl = map._controls.find(control => 
        control.constructor.name === 'AddTextControl'
    );
    
    let correctedTexts = features.texts;
    if (textControl) {
        correctedTexts = textControl.applyZoomCorrections(features.texts);
    }
    
    // Source
    if (!map.getSource('texts')) {
        map.addSource('texts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedTexts
            }
        });
    } else {
        map.getSource('texts').setData({
            type: 'FeatureCollection',
            features: correctedTexts
        });
    }

    // Layer
    if (!map.getLayer('text-layer')) {
        map.addLayer({
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
                "text-font": ["Noto Sans Regular"]
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': ['get', 'backgroundColor'],
                'text-halo-width': 2
            }
        });
    }
}

// ===== AUXILIARY LAYERS =====
function setupAuxiliaryLayers() {
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
}

function restoreTerrainState() {
    try {

        const terrainControl = map._controls.find(control => 
            control.constructor.name === 'TerrainControl'
        );

        if (!terrainControl) {
            return; // Nenhum controle de terreno encontrado
        }
        
        if (terrainControl.terrainConfig) {
            // Garantir que as sources de terreno estão configuradas
            terrainControl._setupTerrainSources();
            
            // Reativar o terreno 3D
            if (map.getSource('terrainSource') && terrainControl._wasTerrainActive) {
                map.setTerrain(terrainControl.terrainConfig);
            }
        }

    } catch (error) {
        console.warn('Erro ao restaurar estado do terreno:', error);
    }
}

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

        const lineControl = map._controls.find(control =>
            control.constructor.name === 'AddLineControl'
        );
        const polygonControl = map._controls.find(control =>
            control.constructor.name === 'AddPolygonControl'
        );

        const losControl = map._controls.find(control =>
            control.constructor.name === 'AddLOSControl'
        );

        // Restaurar medições de linha e poligono
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

function restoreBoundaryDependentFeatures(features) {
    try {
        const boundaryControl = map._controls.find(control =>
            control.constructor.name === 'AddBoundaryControl'
        );

        if (!boundaryControl || !features.boundarys?.length) {
            return;
        }

        features.boundarys.forEach((boundaryFeature, index) => {
            try {
                // Validação básica da feature
                if (!boundaryFeature?.properties) {
                    console.warn(`Invalid boundary feature ${index}:`, boundaryFeature);
                    return;
                }

                // Normalizar coordenadas (pode vir como string do IndexedDB)
                let coords = boundaryFeature.properties.baseCoordinates;

                if (typeof coords === 'string') {
                    try {
                        coords = JSON.parse(coords);
                    } catch (parseError) {
                        console.warn(`Failed to parse coordinates for boundary ${boundaryFeature.properties.id}`);
                        return;
                    }
                }

                // Validar array de coordenadas
                if (!Array.isArray(coords) || coords.length < 2) {
                    console.warn(`Invalid coordinates for boundary ${boundaryFeature.properties.id}`);
                    return;
                }

                // Filtrar apenas coordenadas válidas
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

                // Atualizar coordenadas validadas
                boundaryFeature.properties.baseCoordinates = validCoords;

                // Regenerar textos e círculos dependentes
                boundaryControl.updateDependentFeatures(boundaryFeature);

            } catch (featureError) {
                console.error(`Error processing boundary ${index}:`, featureError);
            }
        });

    } catch (error) {
        console.error('Error restoring boundary dependent features:', error);
    }
}

export function zoomToFeature(feature) {
    if (!feature?.geometry) {
        console.warn('Feature inválida para zoom');
        return;
    }
    
    try {
        const geometry = feature.geometry;
        
        switch (geometry.type) {
            case 'Point':
                map.flyTo({
                    center: geometry.coordinates,
                    zoom: Math.max(map.getZoom(), 16),
                    duration: 800
                });
                break;
                
            case 'LineString':
            case 'Polygon':
            case 'MultiLineString':
            case 'MultiPolygon':
                const bounds = new maplibregl.LngLatBounds();
                extractAllCoordinates(geometry).forEach(coord => bounds.extend(coord));
                
                if (bounds.isEmpty()) {
                    console.warn('Bounds vazio para feature');
                    return;
                }
                
                map.fitBounds(bounds, { 
                    padding: 50, 
                    duration: 800,
                    maxZoom: 18 
                });
                break;
                
            default:
                console.warn('Tipo de geometria não suportado:', geometry.type);
        }
    } catch (error) {
        console.error('Erro ao fazer zoom para feature:', error);
    }
}

function extractAllCoordinates(geometry) {
    const coords = [];
    
    function extract(coordArray) {
        if (Array.isArray(coordArray)) {
            if (typeof coordArray[0] === 'number') {
                coords.push(coordArray);
            } else {
                coordArray.forEach(extract);
            }
        }
    }
    
    extract(geometry.coordinates);
    return coords;
}

export { map };