// Path: js/layers/layer_setup.js

/**
 * @fileoverview Main layer setup orchestrator for MapLibre.
 */

import { getCurrentMapFeatures, getImage, getCurrentMapNameSync, getFrameStyle, getGridStyle, getCatalogLayers, getControl } from '../store';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { initFrameLayers } from '../frame/index.js';
import { initGridLayers } from '../grid/index.js';
import config from '../config.js';
import { EventTypes } from '../events';

import { updateAllLayerFilters, invalidateFilterCache } from './visibility-filter.js';
import {
    setupPointLayers,
    setupLineLayers,
    setupBrushLayers,
    setupPolygonLayers,
    setupCircleLayers,
    setupRectangleLayers,
    setupEllipseLayers,
    setupTextLayers,
    setupImageLayers,
    setupArrowLayers,
    setupMilitarySymbolsLayers,
    setupCoordinationMeasureLayers,
    setupBoundaryLayers,
    setupOccupiedFrontLayers,
    setupLOSLayers,
    setupVisibilityLayers,
    setupLayerSeparators,
    setupAuxiliaryLayers
} from './styles/index.js';

/**
 * Creates an error placeholder image for failed image loads.
 * @returns {Promise<HTMLImageElement>} Error placeholder image
 */
function createErrorImage() {
    const errorSvg = `
        <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <rect x="4" y="4" width="56" height="56"
                  fill="#f8f9fa"
                  stroke="#dc3545"
                  stroke-width="2"
                  stroke-dasharray="4,4"
                  rx="4"/>
            <path d="M12 48 L20 36 L28 42 L36 30 L52 48 Z"
                  fill="#dee2e6"
                  stroke="#6c757d"
                  stroke-width="1"/>
            <line x1="16" y1="16" x2="48" y2="48"
                  stroke="#dc3545"
                  stroke-width="3"
                  stroke-linecap="round"/>
            <line x1="48" y1="16" x2="16" y2="48"
                  stroke="#dc3545"
                  stroke-width="3"
                  stroke-linecap="round"/>
            <text x="32" y="58"
                  text-anchor="middle"
                  font-family="Arial, sans-serif"
                  font-size="8"
                  fill="#6c757d">
                ERRO
            </text>
        </svg>
    `;

    const dataUrl = `data:image/svg+xml;base64,${btoa(errorSvg)}`;

    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to create error image'));
        image.src = dataUrl;
    });
}

/**
 * Loads a single image to the map.
 * @param {string} imageId - Image ID
 * @param {Object} mapInstance - MapLibre map instance
 */
async function loadSingleImage(imageId, mapInstance) {
    try {
        const blob = await getImage(imageId);

        if (!blob) {
            console.warn(`Imagem ${imageId} não encontrada no store, usando imagem de erro`);
            try {
                const errorImage = await createErrorImage();
                if (!mapInstance.hasImage(imageId)) {
                    mapInstance.addImage(imageId, errorImage);
                }
                return;
            } catch (errorImageError) {
                console.error(`Erro ao criar imagem de erro para ${imageId}:`, errorImageError);
                return;
            }
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
                console.warn(`Falha ao carregar imagem ${imageId}, usando imagem de erro`);
                createErrorImage()
                    .then(errorImage => {
                        if (!mapInstance.hasImage(imageId)) {
                            mapInstance.addImage(imageId, errorImage);
                        }
                        resolve();
                    })
                    .catch(errorImageError => {
                        console.error(`Erro ao criar imagem de erro para ${imageId}:`, errorImageError);
                        reject(new Error(`Falha ao carregar imagem ${imageId}`));
                    });
            };

            setTimeout(() => {
                URL.revokeObjectURL(url);
                console.warn(`Timeout ao carregar imagem ${imageId}, usando imagem de erro`);
                createErrorImage()
                    .then(errorImage => {
                        if (!mapInstance.hasImage(imageId)) {
                            mapInstance.addImage(imageId, errorImage);
                        }
                        resolve();
                    })
                    .catch(errorImageError => {
                        console.error(`Erro ao criar imagem de erro para ${imageId}:`, errorImageError);
                        reject(new Error(`Timeout ao carregar imagem ${imageId}`));
                    });
            }, 10000);

            image.src = url;
        });

    } catch (error) {
        console.warn(`Erro ao processar imagem ${imageId}:`, error);
        try {
            const errorImage = await createErrorImage();
            if (!mapInstance.hasImage(imageId)) {
                mapInstance.addImage(imageId, errorImage);
            }
        } catch (errorImageError) {
            console.error(`Erro ao criar imagem de erro para ${imageId}:`, errorImageError);
        }
    }
}

/**
 * Loads all images required by features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setImages(features, mapInstance) {
    const imagePromises = [];

    const allImageFeatures = [
        ...(features.images),
        ...(features.military_symbols),
        ...(features.coordination_measures || [])
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

/**
 * Restores terrain state (terrain 3D sources only, not hillshade).
 * Hillshade is restored via catalog layers.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function restoreTerrainState(mapInstance) {
    try {
        const terrainControl = getControl('TerrainControl');

        if (!terrainControl) {
            return;
        }

        if (terrainControl.terrainConfig) {
            await terrainControl._setupTerrainSources();
        }

    } catch (error) {
        console.warn('Error restoring terrain state:', error);
    }
}

/**
 * Restores catalog layers (hillshade, analysis layers) from saved state.
 * Only activates layers that were explicitly added via the catalog.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 */
async function restoreCatalogLayers(mapInstance, analysisLayersManager) {
    try {
        const catalogLayers = await getCatalogLayers();

        if (!catalogLayers || catalogLayers.length === 0) {
            return;
        }

        const terrainControl = getControl('TerrainControl');

        for (const layer of catalogLayers) {
            // Skip unavailable layers
            if (layer.status === 'unavailable') {
                continue;
            }

            // Only restore if layer was visible
            if (!layer.visible) {
                continue;
            }

            if (layer.type === CATALOG_ITEM_TYPES.HILLSHADE) {
                if (terrainControl?.setHillshadeVisibility) {
                    terrainControl.setHillshadeVisibility(true);
                }
            } else if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
                await analysisLayersManager.toggleLayer(layer.config?.id, true);
            }
        }
    } catch (error) {
        console.warn('Error restoring catalog layers:', error);
    }
}

/**
 * Clears all measurement labels from the map.
 */
function clearAllMeasurements() {
    try {
        const measurementLabels = document.querySelectorAll('.measurement-label');
        measurementLabels.forEach(label => {
            const parentMarker = label.closest('.maplibregl-marker');
            if (parentMarker) {
                parentMarker.remove();
            } else {
                label.remove();
            }
        });

    } catch (error) {
        console.warn('Error clearing old measurements:', error);
    }
}

/**
 * Restores measurements for features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
function restoreMeasurements(features, mapInstance) {
    try {
        const lineControl = getControl('AddLineControl');
        const polygonControl = getControl('AddPolygonControl');
        const losControl = getControl('AddLOSControl');

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
        console.warn('Error restoring measurements:', error);
    }
}

/**
 * Restores boundary dependent features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
function restoreBoundaryDependentFeatures(features, mapInstance) {
    try {
        const boundaryControl = getControl('AddBoundaryControl');

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

/**
 * Sets up frame layers on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setupFrameLayers(mapInstance) {
    initFrameLayers(mapInstance);

    try {
        const mouseCoordinatesControl = getControl('MouseCoordinatesControl');

        if (!mouseCoordinatesControl) {
            console.log('Nenhum controle de mouse encontrado');
            return;
        }

        const frameControl = mouseCoordinatesControl.frameControl;

        if (!frameControl) {
            console.log('Nenhum controle de moldura encontrado');
            return;
        }
        const mapName = getCurrentMapNameSync();
        const savedFrame = await getFrameStyle(mapName);

        let scale = 'scale_25k';
        let visible = false;
        let fillVisible = true;

        if (savedFrame) {
            scale = savedFrame.scale ?? 'scale_25k';
            visible = savedFrame.visible ?? false;
            fillVisible = savedFrame.fillVisible ?? true;
        }
        frameControl._getFrame(scale, visible, fillVisible);
        frameControl._toggleFillVisibility(null, scale, fillVisible, visible);
        frameControl._updateButtonState(visible);
        console.info(`Moldura restaurada: scale = ${scale}, fillVisible = ${fillVisible}, visível=${visible}`);

    } catch (error) {
        console.warn('Error restoring frame:', error);
    }
}

/**
 * Sets up grid layers on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setupGridLayers(mapInstance) {
    initGridLayers(mapInstance);
    try {
        const mouseCoordinatesControl = getControl('MouseCoordinatesControl');

        if (!mouseCoordinatesControl) {
            console.log('Nenhum controle de mouse encontrado');
            return;
        }

        const gridControl = mouseCoordinatesControl.gridControl;

        if (!gridControl) {
            console.log('Nenhum controle de grid encontrado');
            return;
        }
        const mapName = getCurrentMapNameSync();
        const savedGrid = await getGridStyle(mapName);

        let format = 'latlong';
        let visible = false;

        if (savedGrid) {
            format = savedGrid.format ?? 'latlong';
            visible = savedGrid.visible ?? false;
        }
        gridControl._getGrid(format, visible, false);
        gridControl._updateButtonState(visible);
        console.info(`Grid restaurado: format = ${format}, visível=${visible}`);

    } catch (error) {
        console.warn('Error restoring grid:', error);
    }
}

/**
 * Sets up listener for layer visibility changes via EventBus.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 * @returns {Function} Unsubscribe function
 */
function setupLayerVisibilityListener(mapInstance, eventBus) {
    const handler = () => {
        invalidateFilterCache();
        updateAllLayerFilters(mapInstance);
    };
    return eventBus.on(EventTypes.LAYERS_CHANGED, handler);
}

/**
 * Sets up all map feature layers and visibility system.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 */
export async function setupMapFeatures(mapInstance, analysisLayersManager, eventBus) {
    try {
        invalidateFilterCache();

        setupLayerSeparators(mapInstance);

        await restoreTerrainState(mapInstance);

        await analysisLayersManager.setupAnalysisLayers();

        // Restore catalog layers (hillshade, analysis) from saved state
        await restoreCatalogLayers(mapInstance, analysisLayersManager);

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
        setupCoordinationMeasureLayers(features, mapInstance);
        setupTextLayers(features, mapInstance);
        setupAuxiliaryLayers(mapInstance);

        if (config.features.grid) {
            setupGridLayers(mapInstance);
        }
        if (config.features.frame) {
            setupFrameLayers(mapInstance);
        }

        setupLayerVisibilityListener(mapInstance, eventBus);
        updateAllLayerFilters(mapInstance);

        requestAnimationFrame(() => {
            clearAllMeasurements();
            restoreMeasurements(features, mapInstance);
            restoreBoundaryDependentFeatures(features, mapInstance);
        });
    } catch (error) {
        console.error('Error setting up map features:', error);
    }
}

export { updateAllLayerFilters, invalidateFilterCache } from './visibility-filter.js';
export { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, FEATURE_SOURCES } from './layer.constants.js';
