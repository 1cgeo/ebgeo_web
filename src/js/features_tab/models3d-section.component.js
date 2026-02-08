// Path: js/features_tab/models3d-section.component.js

/**
 * @fileoverview Component for displaying 3D models and their features in the features tab.
 * Shows a section with markers, measurements, and viewsheds organized by tileset,
 * allowing navigation to features in 3D viewer.
 */

import { getAllMarkers, getAllMeasurements, getAllViewsheds, removeAllFeaturesByTileset, getControl, getAllCameraPositions, clearCameraPosition } from '../store';
import { getStateManager } from '../store/services.js';
import { EventTypes } from '../events/index.js';
import config from '../config.js';
import { showConfirm } from '../modals/confirm.modal.js';
import { showSuccess, showError } from '../utilities/toast_service.js';
import { escapeHtml } from '../utilities/html-escape.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    MODEL_3D: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    DISTANCE: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`,
    AREA: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    VIEWSHED: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    ORIENTATION: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>`,
    CHEVRON_DOWN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    CHEVRON_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    EXTERNAL: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`
};

// Module state for collapse states
const collapsedTilesets = new Set();

/**
 * Creates the 3D models section container element.
 * @returns {HTMLElement}
 */
export function createModels3dSectionContainer() {
    const container = document.createElement('div');
    container.className = 'models3d-section';
    container.id = 'models3d-section-container';
    container.style.display = 'none';
    return container;
}

/**
 * Renders the 3D models section with all features.
 * @param {HTMLElement} container - Container element
 * @param {Object} eventBus - EventBus instance
 */
export async function renderModels3dSection(container, eventBus) {
    if (!container) return;

    // Get all features for current map
    const [markers, measurements, viewsheds, cameraPositions] = await Promise.all([
        getAllMarkers(),
        getAllMeasurements(),
        getAllViewsheds(),
        getAllCameraPositions()
    ]);

    const orientationsCount = Object.keys(cameraPositions || {}).length;
    const totalFeatures = (markers?.length || 0) + (measurements?.length || 0) + (viewsheds?.length || 0) + orientationsCount;

    if (totalFeatures === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Get tileset configs for names
    const tilesetConfigs = config?.tilesets || [];

    // Group all features by tilesetId (including camera orientations)
    const featuresByTileset = groupFeaturesByTileset(markers, measurements, viewsheds, cameraPositions);

    container.style.display = 'block';
    container.innerHTML = `
        <div class="sidebar-section-header">
            <span>Modelos 3D</span>
        </div>
        <div class="models3d-list"></div>
    `;

    const list = container.querySelector('.models3d-list');

    // Create tileset items
    for (const [tilesetId, features] of Object.entries(featuresByTileset)) {
        const tilesetConfig = tilesetConfigs.find(t => t.id === tilesetId);
        const tilesetName = tilesetConfig?.name || tilesetId;

        const tilesetItem = createTilesetItem(tilesetId, tilesetName, features, eventBus);
        list.appendChild(tilesetItem);
    }
}

/**
 * Groups all features by their tilesetId.
 * @param {Array} markers - Array of markers
 * @param {Array} measurements - Array of measurements
 * @param {Array} viewsheds - Array of viewsheds
 * @param {Object} cameraPositions - Object mapping tilesetId to camera position data
 * @returns {Object} Features grouped by tilesetId
 */
function groupFeaturesByTileset(markers, measurements, viewsheds, cameraPositions = {}) {
    const grouped = {};

    // Group camera orientations first (they should appear at the top of each tileset's feature list)
    for (const [tilesetId, position] of Object.entries(cameraPositions || {})) {
        if (!grouped[tilesetId]) {
            grouped[tilesetId] = [];
        }
        grouped[tilesetId].push({
            id: `orientation-${tilesetId}`,
            tilesetId,
            featureType: 'orientation',
            data: position
        });
    }

    // Group markers
    for (const marker of (markers || [])) {
        const tilesetId = marker.tilesetId;
        if (!grouped[tilesetId]) {
            grouped[tilesetId] = [];
        }
        grouped[tilesetId].push({ ...marker, featureType: 'marker' });
    }

    // Group measurements
    for (const measurement of (measurements || [])) {
        const tilesetId = measurement.tilesetId;
        if (!grouped[tilesetId]) {
            grouped[tilesetId] = [];
        }
        grouped[tilesetId].push({ ...measurement, featureType: 'measurement' });
    }

    // Group viewsheds
    for (const viewshed of (viewsheds || [])) {
        const tilesetId = viewshed.tilesetId;
        if (!grouped[tilesetId]) {
            grouped[tilesetId] = [];
        }
        grouped[tilesetId].push({ ...viewshed, featureType: 'viewshed' });
    }

    return grouped;
}

/**
 * Gets the icon for a feature based on its type.
 * @param {Object} feature - Feature object
 * @returns {string} SVG icon string
 */
function getFeatureIcon(feature) {
    if (feature.featureType === 'marker') {
        return ICONS.MARKER;
    } else if (feature.featureType === 'measurement') {
        return feature.type === 'area' ? ICONS.AREA : ICONS.DISTANCE;
    } else if (feature.featureType === 'viewshed') {
        return ICONS.VIEWSHED;
    } else if (feature.featureType === 'orientation') {
        return ICONS.ORIENTATION;
    }
    return ICONS.MARKER;
}

/**
 * Gets the name for a feature.
 * @param {Object} feature - Feature object
 * @returns {string} Feature name
 */
function getFeatureName(feature) {
    if (feature.featureType === 'orientation') {
        return 'Orientação salva';
    }

    if (feature.properties?.nome) {
        return feature.properties.nome;
    }

    if (feature.featureType === 'marker') {
        return 'Marcador';
    } else if (feature.featureType === 'measurement') {
        return feature.type === 'area' ? 'Medição de Área' : 'Medição de Distância';
    } else if (feature.featureType === 'viewshed') {
        return 'Análise de Visibilidade';
    }

    return 'Feição';
}

/**
 * Creates a tileset item with its features.
 * @param {string} tilesetId - Tileset ID
 * @param {string} tilesetName - Tileset display name
 * @param {Array} features - All features for this tileset
 * @param {Object} eventBus - EventBus instance
 * @returns {HTMLElement}
 */
function createTilesetItem(tilesetId, tilesetName, features, eventBus) {
    const isCollapsed = collapsedTilesets.has(tilesetId);

    const item = document.createElement('div');
    item.className = 'models3d-tileset-item';
    item.dataset.tilesetId = tilesetId;

    // Build features list HTML
    const featuresHtml = features.map(feature => `
        <div class="models3d-feature-item" data-feature-type="${escapeHtml(feature.featureType)}" data-feature-id="${escapeHtml(feature.id)}" data-tileset-id="${escapeHtml(tilesetId)}">
            <span class="models3d-feature-icon">${getFeatureIcon(feature)}</span>
            <span class="models3d-feature-name" title="${escapeHtml(getFeatureName(feature))}">${escapeHtml(getFeatureName(feature))}</span>
        </div>
    `).join('');

    const safeTilesetName = escapeHtml(tilesetName);
    item.innerHTML = `
        <div class="models3d-tileset-header">
            <button class="models3d-tileset-toggle" aria-expanded="${!isCollapsed}">
                ${isCollapsed ? ICONS.CHEVRON_RIGHT : ICONS.CHEVRON_DOWN}
            </button>
            <span class="models3d-tileset-icon">${ICONS.MODEL_3D}</span>
            <span class="models3d-tileset-name" title="${safeTilesetName}">${safeTilesetName}</span>
            <span class="models3d-marker-count">${features.length}</span>
            <button class="models3d-delete-all" title="Deletar todas as feições">
                ${ICONS.TRASH}
            </button>
            <button class="models3d-open-viewer" title="Abrir no visualizador 3D">
                ${ICONS.EXTERNAL}
            </button>
        </div>
        <div class="models3d-features-list ${isCollapsed ? 'collapsed' : ''}">
            ${featuresHtml}
        </div>
    `;

    // Attach events
    attachTilesetEvents(item, tilesetId, features, eventBus);

    return item;
}

/**
 * Attaches events to a tileset item.
 * @param {HTMLElement} item - Tileset item element
 * @param {string} tilesetId - Tileset ID
 * @param {Array} features - Features for this tileset
 * @param {Object} _eventBus - EventBus instance
 */
function attachTilesetEvents(item, tilesetId, features, _eventBus) {
    // Toggle tileset expansion
    const toggleBtn = item.querySelector('.models3d-tileset-toggle');
    const featuresList = item.querySelector('.models3d-features-list');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyCollapsed = featuresList.classList.contains('collapsed');

        if (isCurrentlyCollapsed) {
            featuresList.classList.remove('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_DOWN;
            toggleBtn.setAttribute('aria-expanded', 'true');
            collapsedTilesets.delete(tilesetId);
        } else {
            featuresList.classList.add('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_RIGHT;
            toggleBtn.setAttribute('aria-expanded', 'false');
            collapsedTilesets.add(tilesetId);
        }
    });

    // Open viewer button
    const openViewerBtn = item.querySelector('.models3d-open-viewer');
    openViewerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTilesetInViewer(tilesetId);
    });

    // Delete all features button
    const deleteAllBtn = item.querySelector('.models3d-delete-all');
    deleteAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const hasOrientation = features.some(f => f.featureType === 'orientation');
        await handleDeleteAllFeatures(tilesetId, features.length, hasOrientation);
    });

    // Feature clicks
    const featureItems = item.querySelectorAll('.models3d-feature-item');
    featureItems.forEach((featureItem) => {
        featureItem.addEventListener('click', () => {
            const featureType = featureItem.dataset.featureType;
            const featureId = featureItem.dataset.featureId;

            const feature = features.find(f => f.id === featureId);
            if (!feature) return;

            switch (featureType) {
                case 'marker':
                    navigateToMarker(feature);
                    break;
                case 'measurement':
                    navigateToMeasurement(feature);
                    break;
                case 'viewshed':
                    navigateToViewshed(feature);
                    break;
                case 'orientation':
                    // Open tileset in viewer - the orientation will be applied automatically
                    openTilesetInViewer(tilesetId);
                    break;
            }
        });
    });
}

/**
 * Handles the deletion of all features for a tileset.
 * Shows a confirmation modal before deleting.
 * @param {string} tilesetId - Tileset ID
 * @param {number} featureCount - Number of features to delete
 * @param {boolean} hasOrientation - Whether the tileset has a saved camera orientation
 */
async function handleDeleteAllFeatures(tilesetId, featureCount, hasOrientation = false) {
    const tilesetConfigs = config?.tilesets || [];
    const tilesetConfig = tilesetConfigs.find(t => t.id === tilesetId);
    const tilesetName = tilesetConfig?.name || tilesetId;

    const orientationText = hasOrientation ? ' (incluindo orientação salva)' : '';
    const confirmed = await showConfirm(
        `Deletar todas as feições de "${tilesetName}"?`,
        {
            message: `${featureCount} feição(ões) serão permanentemente excluídas${orientationText}.\nEsta ação não pode ser desfeita.`,
            confirmText: 'Deletar',
            destructive: true
        }
    );

    if (!confirmed) return;

    try {
        const result = await removeAllFeaturesByTileset(tilesetId);

        // Also clear camera orientation if it exists
        if (hasOrientation) {
            await clearCameraPosition(tilesetId);
        }

        const totalDeleted = result.total + (hasOrientation ? 1 : 0);
        if (totalDeleted > 0) {
            showSuccess(`${totalDeleted} feição(ões) deletadas com sucesso!`);
        }
    } catch (error) {
        console.error('Error deleting features:', error);
        showError('Erro ao deletar feições.');
    }
}

/**
 * Collapses the sidebar before opening the 3D viewer.
 */
function collapseSidebar() {
    const stateManager = getStateManager();
    if (stateManager && stateManager.get('sidebar.expanded')) {
        stateManager.collapseSidebar();
    }
}

/**
 * Opens the 3D viewer with a specific tileset.
 * @param {string} tilesetId - Tileset ID to open
 */
async function openTilesetInViewer(tilesetId) {
    try {
        // Collapse sidebar before opening 3D viewer
        collapseSidebar();

        // Use the modelsViewerControl from registry to properly show the 3D container
        const modelsViewerControl = getControl('modelsViewer');
        if (modelsViewerControl) {
            await modelsViewerControl.openViewer(tilesetId);
        } else {
            // Fallback: directly import and call (may not show container properly)
            console.warn('modelsViewerControl not found, using fallback');
            const { openViewerWithTileset } = await import('../3d_models_viewer_tool/map_3d.js');
            await openViewerWithTileset(tilesetId);
        }
    } catch (error) {
        console.error('Error opening 3D viewer:', error);
    }
}

/**
 * Navigates to a marker in the 3D viewer.
 * @param {Object} marker - Marker data
 */
async function navigateToMarker(marker) {
    try {
        // First, open the tileset in viewer
        await openTilesetInViewer(marker.tilesetId);

        // Wait for viewer to be ready, then fly to marker and select it
        setTimeout(async () => {
            try {
                const markerModule = await import('../3d_models_viewer_tool/tools/marker_tool_3d.js');
                markerModule.flyToMarker(marker);

                // Also emit the marker clicked event to open the panel
                const { getEventBus } = await import('../store/services.js');
                const eventBus = getEventBus();
                if (eventBus) {
                    eventBus.emit(EventTypes.MARKER_3D_CLICKED, {
                        marker,
                        tilesetId: marker.tilesetId
                    });
                }
            } catch (error) {
                console.error('Error flying to marker:', error);
            }
        }, 1500); // Wait for viewer to fully load
    } catch (error) {
        console.error('Error navigating to marker:', error);
    }
}

/**
 * Navigates to a measurement in the 3D viewer.
 * @param {Object} measurement - Measurement data
 */
async function navigateToMeasurement(measurement) {
    try {
        // First, open the tileset in viewer
        await openTilesetInViewer(measurement.tilesetId);

        // Wait for viewer to be ready, then fly to measurement and select it
        setTimeout(async () => {
            try {
                const measurementModule = await import('../3d_models_viewer_tool/tools/measurement_tool_3d.js');
                measurementModule.flyToMeasurement(measurement);

                // Also emit the measurement clicked event to open the panel
                const { getEventBus } = await import('../store/services.js');
                const eventBus = getEventBus();
                if (eventBus) {
                    eventBus.emit(EventTypes.MEASUREMENT_3D_CLICKED, {
                        measurement,
                        tilesetId: measurement.tilesetId
                    });
                }
            } catch (error) {
                console.error('Error flying to measurement:', error);
            }
        }, 1500);
    } catch (error) {
        console.error('Error navigating to measurement:', error);
    }
}

/**
 * Navigates to a viewshed in the 3D viewer.
 * @param {Object} viewshed - Viewshed data
 */
async function navigateToViewshed(viewshed) {
    try {
        // First, open the tileset in viewer
        await openTilesetInViewer(viewshed.tilesetId);

        // Wait for viewer to be ready, then fly to viewshed and select it
        setTimeout(async () => {
            try {
                const viewshedModule = await import('../3d_models_viewer_tool/tools/viewshed_tool_3d.js');
                viewshedModule.flyToViewshed(viewshed);

                // Also emit the viewshed clicked event to open the panel
                const { getEventBus } = await import('../store/services.js');
                const eventBus = getEventBus();
                if (eventBus) {
                    eventBus.emit(EventTypes.VIEWSHED_3D_CLICKED, {
                        viewshed,
                        tilesetId: viewshed.tilesetId
                    });
                }
            } catch (error) {
                console.error('Error flying to viewshed:', error);
            }
        }, 1500);
    } catch (error) {
        console.error('Error navigating to viewshed:', error);
    }
}

/**
 * Initializes 3D models section event listeners.
 * @param {HTMLElement} container - Container element
 * @param {Object} eventBus - EventBus instance
 * @returns {Function} Unsubscriber function
 */
export function initModels3dSectionListeners(container, eventBus) {
    const handlers = [];

    // Listen for marker changes
    const markersChangedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.MARKERS_3D_CHANGED, markersChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.MARKERS_3D_CHANGED, markersChangedHandler));

    // Listen for measurement changes
    const measurementsChangedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.MEASUREMENTS_3D_CHANGED, measurementsChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.MEASUREMENTS_3D_CHANGED, measurementsChangedHandler));

    // Listen for viewshed changes
    const viewshedsChangedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.VIEWSHEDS_3D_CHANGED, viewshedsChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.VIEWSHEDS_3D_CHANGED, viewshedsChangedHandler));

    // Listen for camera orientation save
    const cameraSavedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.CAMERA_3D_SAVED, cameraSavedHandler);
    handlers.push(() => eventBus.off(EventTypes.CAMERA_3D_SAVED, cameraSavedHandler));

    // Listen for viewer closed (to refresh features if any were added)
    const viewerClosedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.VIEWER_3D_CLOSED, viewerClosedHandler);
    handlers.push(() => eventBus.off(EventTypes.VIEWER_3D_CLOSED, viewerClosedHandler));

    // Listen for map changes (when user switches to a different map)
    const layersChangedHandler = () => {
        renderModels3dSection(container, eventBus);
    };
    eventBus.on(EventTypes.LAYERS_CHANGED, layersChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.LAYERS_CHANGED, layersChangedHandler));

    return () => {
        handlers.forEach(unsubscribe => unsubscribe());
    };
}
