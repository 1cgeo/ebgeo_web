// Path: js\controls_sig\map.js
import { getCurrentMapFeatures } from './store.js';
import { imageStore } from './store.js';
import baseStyle from './baselayers/carta_topografica.js'
import config from '../config.js';

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

map.on('styledata', async () => {
    setupAuxiliaryLayers();

    // Carregar dados do IndexedDB
    const features = await getCurrentMapFeatures();
    await setImages(features);

    setupDrawLayers(features);
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


    // Restaurar medições e marcações
    requestAnimationFrame(() => {
        clearAllMeasurements();
        restoreMeasurements(features);
        restoreCircleXMarks(features);
        restoreBoundaryDependentFeatures(features);
    });
});

function setupOccupiedFrontLayers(features) {
    // Source principal
    if (!map.getSource('occupied_fronts')) {
        map.addSource('occupied_fronts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.occupied_fronts || []
            }
        });
    } else {
        map.getSource('occupied_fronts').setData({
            type: 'FeatureCollection',
            features: features.occupied_fronts || []
        });
    }

    // Preview source (durante desenho)
    if (!map.getSource('occupied-front-preview')) {
        map.addSource('occupied-front-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Edit handles source (durante edição)
    if (!map.getSource('occupied-front-edit-handles')) {
        map.addSource('occupied-front-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 1. Layer principal (MultiLineString) ✅ CORRIGIDO
    if (!map.getLayer('occupied-front-layer')) {
        map.addLayer({
            id: 'occupied-front-layer',
            type: 'line',
            source: 'occupied_fronts',
            layout: {
                'line-cap': 'round',      // ✅ MOVIDO para layout
                'line-join': 'round'      // ✅ MOVIDO para layout
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'opacity']
            }
        });
    }

    // 2. Preview layer (durante desenho) ✅ CORRIGIDO
    if (!map.getLayer('occupied-front-preview-layer')) {
        map.addLayer({
            id: 'occupied-front-preview-layer',
            type: 'line',
            source: 'occupied-front-preview',
            layout: {
                'line-cap': 'round',      // ✅ MOVIDO para layout
                'line-join': 'round'      // ✅ MOVIDO para layout
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7
            }
        });
    }

    // 3. Selected layer (feature selecionada para edição) ✅ CORRIGIDO
    if (!map.getLayer('occupied-front-selected-layer')) {
        map.addLayer({
            id: 'occupied-front-selected-layer',
            type: 'line',
            source: 'occupied-front-edit-handles',
            layout: {
                'line-cap': 'round',      // ✅ MOVIDO para layout
                'line-join': 'round'      // ✅ MOVIDO para layout
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            },
            filter: ['==', ['get', 'role'], 'selected-feature']
        });
    }

    // 4. Edit handles layer (pontos arrastáveis P1, P2, P3) ✅ INALTERADO
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
                features: features.military_symbols || []
            }
        });
    } else {
        map.getSource('military_symbols').setData({
            type: 'FeatureCollection',
            features: features.military_symbols || []
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
                'icon-image': ['get', 'imageId'], // Usa imageId igual ao image control
                'icon-size': ['get', 'size'],
                'icon-rotate': ['get', 'rotation'],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
    }
}

function setupDrawLayers(features) {
    const draw = map._controls.find(control => control instanceof MapboxDraw);
    if (draw) {
        draw.deleteAll();
        draw.set({
            type: 'FeatureCollection',
            features: features.polygons.concat(features.linestrings).concat(features.points)
        });
    }
}

async function setImages(features) {
    const imagePromises = [];

    // Coletar todas as features que precisam de imagens
    const allImageFeatures = [
        ...(features.images || []),
        ...(features.military_symbols || [])
    ];

    for (const feature of allImageFeatures) {
        const imageId = feature.properties.imageId;
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

    // ===== SOURCES =====

    // Source principal - feature atômica
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

    // Source para círculos do escalão (separado)
    if (!map.getSource('boundary-circles')) {
        map.addSource('boundary-circles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Source para textos (separado)
    if (!map.getSource('boundary-texts')) {
        map.addSource('boundary-texts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Preview source (durante desenho)
    if (!map.getSource('boundary-preview')) {
        map.addSource('boundary-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Edit handles source (durante edição)
    if (!map.getSource('boundary-edit-handles')) {
        map.addSource('boundary-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // ===== LAYERS SIMPLIFICADAS (apenas 4 principais) =====

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
                'text-size': [
                    'interpolate', ['linear'], ['zoom'],
                    8, ['*', ['coalesce', ['get', 'text_size'], 14], 0.5],
                    16, ['*', ['coalesce', ['get', 'text_size'], 14], 1.2]
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
            }
        });
    }

    // ===== LAYERS AUXILIARES (como arrow tool) =====

    // 5. PREVIEW - Durante desenho
    if (!map.getLayer('boundary-preview-layer')) {
        map.addLayer({
            id: 'boundary-preview-layer',
            type: 'line',
            source: 'boundary-preview',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#000000',
                'line-width': 4,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7
            }
        });
    }

    // 6. SELEÇÃO - Feature selecionada
    if (!map.getLayer('boundary-selected-layer')) {
        map.addLayer({
            id: 'boundary-selected-layer',
            type: 'line',
            source: 'boundary-edit-handles',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 6,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            },
            filter: ['==', ['get', 'role'], 'selected-feature']
        });
    }

    // 7. EDIT HANDLES - Pontos de edição
    if (!map.getLayer('boundary-edit-handles-layer')) {
        map.addLayer({
            id: 'boundary-edit-handles-layer',
            type: 'circle',
            source: 'boundary-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'type'], 'vertex'], '#ff0000',        // Vermelho: vértices
                    ['==', ['get', 'type'], 'midpoint'], '#ff0000',      // Vermelho: midpoints
                    ['==', ['get', 'type'], 'symbol_handle'], '#0066ff', // Azul: posição símbolo
                    ['==', ['get', 'type'], 'size_handle'], '#28a745',   // Verde: tamanho símbolo
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'type'], 'midpoint'], 0.5,  // Midpoints mais transparentes
                    1
                ]
            },
            filter: ['==', '$type', 'Point']  // Apenas pontos (handles)
        });
    }
}

function setupEllipseLayers(features) {
    // Source
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

    // Preview source
    if (!map.getSource('ellipse-preview')) {
        map.addSource('ellipse-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Edit handles source
    if (!map.getSource('ellipse-edit-handles')) {
        map.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 1. Preenchimento
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

    // 2. Linha
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

    // 3. Preview preenchimento
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

    // 4. Preview linha
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

    // 5. Seleção
    if (!map.getLayer('ellipse-selected-layer')) {
        map.addLayer({
            id: 'ellipse-selected-layer',
            type: 'line',
            source: 'ellipse-edit-handles',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            },
            filter: ['!=', ['get', 'role'], 'handle']
        });
    }

    // 6. Edit handles
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
                'icon-image': ['get', 'imageId'],
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

// ===== ARROW LAYERS (Linhas - Prioridade 6) =====
function setupArrowLayers(features) {
    // Source
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

    // Preview source
    if (!map.getSource('arrow-preview')) {
        map.addSource('arrow-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Edit handles source
    if (!map.getSource('arrow-edit-handles')) {
        map.addSource('arrow-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 1. Preenchimento
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

    // 2. Linha
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

    // 3. Preview preenchimento
    if (!map.getLayer('arrow-preview-fill-layer')) {
        map.addLayer({
            id: 'arrow-preview-fill-layer',
            type: 'fill',
            source: 'arrow-preview',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'fillOpacity']
            }
        });
    }

    // 4. Preview linha
    if (!map.getLayer('arrow-preview-layer')) {
        map.addLayer({
            id: 'arrow-preview-layer',
            type: 'line',
            source: 'arrow-preview',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-dasharray': [2, 2],
                'line-opacity': ['get', 'lineOpacity']
            }
        });
    }

    // 5. Seleção
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
            filter: ['==', ['get', 'role'], 'selected-feature']
        });
    }

    // 6. Edit handles
    if (!map.getLayer('arrow-edit-handles-layer')) {
        map.addLayer({
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
            filter: ['!=', ['get', 'role'], 'selected-feature']
        });
    }
}

// ===== CIRCLE LAYERS (Pontos - Prioridade 7) =====
function setupCircleLayers(features) {
    // Source
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

    // Preview source
    if (!map.getSource('circle-preview')) {
        map.addSource('circle-preview', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // Edit handles source
    if (!map.getSource('circle-edit-handles')) {
        map.addSource('circle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // X marks source
    if (!map.getSource('circle-x-marks')) {
        map.addSource('circle-x-marks', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 1. Preenchimento
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

    // 2. Linha
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

    // 3. X marks
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

    // 4. Preview preenchimento
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

    // 5. Preview linha
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

    // 6. Seleção
    if (!map.getLayer('circle-selected-layer')) {
        map.addLayer({
            id: 'circle-selected-layer',
            type: 'line',
            source: 'circle-edit-handles',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            },
            filter: ['!=', ['get', 'role'], 'handle']
        });
    }

    // 7. Edit handles
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
            filter: ['==', '$type', 'Point']
        });
    }
}

// ===== TEXT LAYERS (Maior Prioridade - 8) =====
function setupTextLayers(features) {
    // Source
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

    // Layer (mais alto na hierarquia)
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
                        console.warn(`Failed to parse coordinates for boundary ${boundaryFeature.id}`);
                        return;
                    }
                }

                // Validar array de coordenadas
                if (!Array.isArray(coords) || coords.length < 2) {
                    console.warn(`Invalid coordinates for boundary ${boundaryFeature.id}`);
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
                    console.warn(`Insufficient valid coordinates for boundary ${boundaryFeature.id}`);
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

export { map };