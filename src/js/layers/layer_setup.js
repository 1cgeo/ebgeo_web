// Path: js/layers/layer_setup.js

/**
 * @fileoverview Main layer setup orchestrator for MapLibre.
 */

import { getCurrentMapFeatures, getImage, getCurrentMapNameSync, getGridStyle, getCatalogLayers, getControl } from '../store';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { initGridLayers } from '../grid/index.js';
import config from '../config.js';
import { EventTypes } from '../events';

import { generatePointImage, needsPerFeatureImage } from '../draw_tools/point_tool/point-marker-symbols.js';
import { parseCustomMarker, registerCustomFeatureImage } from '../draw_tools/point_tool/point-custom-icons.js';
import { updateAllLayerFilters, invalidateFilterCache, updateMeasurementLabelVisibility } from './visibility-filter.js';
import { applyLayerOpacities, invalidateOpacityCache } from './layer-opacity-applier.js';
import {
    setupPointLayers,
    setupLineLayers,
    setupBrushLayers,
    setupPolygonLayers,
    setupCircleLayers,
    setupRectangleLayers,
    setupEllipseLayers,
    setupSectorLayers,
    setupTextLayers,
    setupImageLayers,
    setupArrowLayers,
    setupMilitarySymbolsLayers,
    setupCoordinationMeasureLayers,
    setupDeclinationLayers,
    setupBoundaryLayers,
    setupOccupiedFrontLayers,
    setupLOSLayers,
    setupVisibilityLayers,
    setupLayerSeparators,
    setupAuxiliaryLayers,
} from './styles/index.js';
import { setupMeasurementLayers } from '../measurement_tool/measurement-labels.js';

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
 * Adds an error placeholder image to the map if the image ID is not already registered.
 * @param {string} imageId - Image ID
 * @param {Object} mapInstance - MapLibre map instance
 */
async function addErrorImageIfNeeded(imageId, mapInstance) {
    try {
        const errorImage = await createErrorImage();
        if (!mapInstance.hasImage(imageId)) {
            mapInstance.addImage(imageId, errorImage);
        }
    } catch (err) {
        console.error(`Erro ao criar imagem de erro para ${imageId}:`, err);
    }
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
            await addErrorImageIfNeeded(imageId, mapInstance);
            return;
        }

        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();
            let settled = false;

            function settle(fn) {
                if (settled) return;
                settled = true;
                URL.revokeObjectURL(url);
                fn();
            }

            image.onload = () => settle(() => {
                if (!mapInstance.hasImage(imageId)) {
                    mapInstance.addImage(imageId, image);
                }
                resolve();
            });

            image.onerror = () => settle(() => {
                console.warn(`Falha ao carregar imagem ${imageId}, usando imagem de erro`);
                addErrorImageIfNeeded(imageId, mapInstance).then(resolve, reject);
            });

            setTimeout(() => settle(() => {
                addErrorImageIfNeeded(imageId, mapInstance).then(resolve, reject);
            }), 10000);

            image.src = url;
        });

    } catch (error) {
        console.warn(`Erro ao processar imagem ${imageId}:`, error);
        await addErrorImageIfNeeded(imageId, mapInstance);
    }
}

/**
 * Loads all images required by features.
 * @param {Object} features - Feature collection
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setImages(features, mapInstance) {
    const allImageFeatures = [
        ...features.images,
        ...features.military_symbols,
        ...(features.coordination_measures || []),
        ...(features.magnetic_declinations || [])
    ];

    const imagePromises = [];

    for (const feature of allImageFeatures) {
        const imageId = feature.properties.id;
        if (!imageId || mapInstance.hasImage(imageId)) continue;
        imagePromises.push(loadSingleImage(imageId, mapInstance));
    }

    await Promise.allSettled(imagePromises);

    // Generate per-feature canvas images for non-circle point markers.
    // Custom icons (uploaded images) register asynchronously from stored blobs;
    // built-in shapes/icons bake a per-feature canvas image synchronously.
    const customIconPromises = [];
    for (const feature of (features.points || [])) {
        const props = feature.properties;
        if (!needsPerFeatureImage(props.markerSymbol)) continue;
        if (mapInstance.hasImage(props.id)) continue;

        const iconId = parseCustomMarker(props.markerSymbol);
        if (iconId) {
            customIconPromises.push(registerCustomFeatureImage(mapInstance, props.id, iconId));
            continue;
        }

        const imageData = generatePointImage(
            props.markerSymbol,
            props.fillColor || '#3f4fb5',
            props.lineColor || '#000000',
            props.lineWidth || 0,
        );
        mapInstance.addImage(props.id, imageData, { pixelRatio: 2 });
    }
    await Promise.allSettled(customIconPromises);
}

/**
 * Restores terrain state (terrain 3D sources only, not hillshade).
 * Hillshade is restored via catalog layers.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function restoreTerrainState() {
    try {
        const terrainControl = getControl('TerrainControl');

        if (terrainControl?.terrainConfig) {
            await terrainControl._setupTerrainSources();
        }
    } catch (error) {
        console.warn('Error restoring terrain state:', error);
    }
}

/**
 * Restores catalog layers (hillshade, analysis layers, data layers) from saved state.
 * Only activates layers that were explicitly added via the catalog.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 * @param {Object} dataLayersManager - Data layers manager
 */
async function restoreCatalogLayer(layer, terrainControl, analysisLayersManager, dataLayersManager) {
    const innerId = layer.config?.id;

    if (layer.type === CATALOG_ITEM_TYPES.HILLSHADE) {
        terrainControl?.setHillshadeVisibility?.(true);
        return;
    }

    const manager = layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER ? analysisLayersManager
        : layer.type === CATALOG_ITEM_TYPES.DATA_LAYER ? dataLayersManager
        : null;
    if (!manager || !innerId) return;

    await manager.toggleLayer(innerId, true);
    if (layer.styleOverrides) {
        manager.applyStyleOverrides(innerId, layer.styleOverrides);
    }
}

async function restoreCatalogLayers(mapInstance, analysisLayersManager, dataLayersManager) {
    try {
        const catalogLayers = await getCatalogLayers();

        if (!catalogLayers?.length) return;

        const terrainControl = getControl('TerrainControl');

        const restorations = catalogLayers
            .filter(layer => layer.status !== 'unavailable' && layer.visible)
            .map(layer => restoreCatalogLayer(layer, terrainControl, analysisLayersManager, dataLayersManager));

        await Promise.all(restorations);
    } catch (error) {
        console.warn('Error restoring catalog layers:', error);
    }
}

/**
 * Clears all measurement labels from the map.
 */
function clearAllMeasurements() {
    const measurementLabels = document.querySelectorAll('.measurement-label');
    measurementLabels.forEach(label => {
        const parentMarker = label.closest('.maplibregl-marker');
        if (parentMarker) {
            parentMarker.remove();
        } else {
            label.remove();
        }
    });
}

/**
 * Restores measurements for features.
 * @param {Object} features - Feature collection
 */
function restoreMeasurements(features) {
    try {
        const controlFeaturePairs = [
            ['AddLineControl', features.lines],
            ['AddPolygonControl', features.polygons],
            ['AddLOSControl', features.los],
        ];

        for (const [controlName, featureList] of controlFeaturePairs) {
            const control = getControl(controlName);
            if (!control || !featureList) continue;

            for (const feature of featureList) {
                if (feature.properties?.measure) {
                    control.updateFeatureMeasurement(feature);
                }
            }
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
        const emptyCollection = { type: 'FeatureCollection', features: [] };

        // Clear existing circles and texts before restoring (fixes persistence bug on map switch)
        mapInstance.getSource('boundary-circles')?.setData(emptyCollection);
        mapInstance.getSource('boundary-texts')?.setData(emptyCollection);

        if (!boundaryControl || !features.boundarys?.length) return;

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
                    } catch (_parseError) {
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
 * Sets up grid layers on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
async function setupGridLayers(mapInstance) {
    initGridLayers(mapInstance);
    try {
        const mouseCoordinatesControl = getControl('MouseCoordinatesControl');
        const gridControl = mouseCoordinatesControl?.gridControl;

        if (!gridControl) {
            console.warn('Grid control not found');
            return;
        }

        const mapName = getCurrentMapNameSync();
        const savedGrid = await getGridStyle(mapName);
        const format = savedGrid?.format ?? 'latlong';
        const visible = savedGrid?.visible ?? false;

        gridControl.syncState(format, visible);
        gridControl._getGrid(format, visible, false);
        gridControl._updateButtonState(visible);

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
// Holds the active LAYERS_CHANGED unsubscribe so it can be detached before a
// re-subscribe. setupMapFeatures() runs on every map/base-layer switch; without
// this, the anonymous listener accumulated unbounded on the session-lived eventBus.
let layerVisibilityUnsub = null;

function setupLayerVisibilityListener(mapInstance, eventBus) {
    return eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        invalidateFilterCache();
        updateAllLayerFilters(mapInstance);
        updateMeasurementLabelVisibility();
        applyLayerOpacities(mapInstance);
    });
}

/**
 * Sets up all map feature layers and visibility system.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} analysisLayersManager - Analysis layers manager
 * @param {Object} dataLayersManager - Data layers manager
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 */
export async function setupMapFeatures(mapInstance, analysisLayersManager, dataLayersManager, eventBus) {
    try {
        invalidateFilterCache();
        invalidateOpacityCache();

        setupLayerSeparators(mapInstance);

        await restoreTerrainState();

        await analysisLayersManager.setupAnalysisLayers();
        await dataLayersManager.setupDataLayers();

        await restoreCatalogLayers(mapInstance, analysisLayersManager, dataLayersManager);

        const features = await getCurrentMapFeatures();
        await setImages(features, mapInstance);

        setupImageLayers(features, mapInstance);
        setupPolygonLayers(features, mapInstance);
        setupEllipseLayers(features, mapInstance);
        setupCircleLayers(features, mapInstance);
        setupRectangleLayers(features, mapInstance);
        setupSectorLayers(features, mapInstance);
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
        setupDeclinationLayers(features, mapInstance);
        setupTextLayers(features, mapInstance);
        setupAuxiliaryLayers(mapInstance);
        setupMeasurementLayers(mapInstance);

        if (config.features.grid) {
            await setupGridLayers(mapInstance);
        }

        if (layerVisibilityUnsub) layerVisibilityUnsub();
        layerVisibilityUnsub = setupLayerVisibilityListener(mapInstance, eventBus);
        updateAllLayerFilters(mapInstance);
        applyLayerOpacities(mapInstance);

        requestAnimationFrame(() => {
            clearAllMeasurements();
            restoreMeasurements(features);
            restoreBoundaryDependentFeatures(features, mapInstance);
        });
    } catch (error) {
        console.error('Error setting up map features:', error);
    }
}

export { updateAllLayerFilters, invalidateFilterCache } from './visibility-filter.js';
export { applyLayerOpacities, invalidateOpacityCache } from './layer-opacity-applier.js';
export { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, FEATURE_SOURCES } from './layer.constants.js';
