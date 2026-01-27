// Path: js/features_tab/models3d-section.component.js

/**
 * @fileoverview Component for displaying 3D models and their markers in the features tab.
 * Shows a section with markers organized by tileset, allowing navigation to markers in 3D viewer.
 */

import { getAllMarkers } from '../store';
import { getStateManager } from '../store/services.js';
import { EventTypes } from '../events/index.js';
import config from '../config.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    MODEL_3D: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    CHEVRON_DOWN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    CHEVRON_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    EXTERNAL: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
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
 * Renders the 3D models section with markers.
 * @param {HTMLElement} container - Container element
 * @param {Object} eventBus - EventBus instance
 */
export async function renderModels3dSection(container, eventBus) {
    if (!container) return;

    // Get all markers for current map
    const markers = await getAllMarkers();

    if (!markers || markers.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Get tileset configs for names
    const tilesetConfigs = config?.tilesets || [];

    // Group markers by tilesetId
    const markersByTileset = groupMarkersByTileset(markers);

    container.style.display = 'block';
    container.innerHTML = `
        <div class="sidebar-section-header">
            <span>Modelos 3D</span>
        </div>
        <div class="models3d-list"></div>
    `;

    const list = container.querySelector('.models3d-list');

    // Create tileset items
    for (const [tilesetId, tilesetMarkers] of Object.entries(markersByTileset)) {
        const tilesetConfig = tilesetConfigs.find(t => t.id === tilesetId);
        const tilesetName = tilesetConfig?.name || tilesetId;

        const tilesetItem = createTilesetItem(tilesetId, tilesetName, tilesetMarkers, eventBus);
        list.appendChild(tilesetItem);
    }
}

/**
 * Groups markers by their tilesetId.
 * @param {Array} markers - Array of markers
 * @returns {Object} Markers grouped by tilesetId
 */
function groupMarkersByTileset(markers) {
    const grouped = {};

    for (const marker of markers) {
        const tilesetId = marker.tilesetId;
        if (!grouped[tilesetId]) {
            grouped[tilesetId] = [];
        }
        grouped[tilesetId].push(marker);
    }

    return grouped;
}

/**
 * Creates a tileset item with its markers.
 * @param {string} tilesetId - Tileset ID
 * @param {string} tilesetName - Tileset display name
 * @param {Array} markers - Markers for this tileset
 * @param {Object} eventBus - EventBus instance
 * @returns {HTMLElement}
 */
function createTilesetItem(tilesetId, tilesetName, markers, eventBus) {
    const isCollapsed = collapsedTilesets.has(tilesetId);

    const item = document.createElement('div');
    item.className = 'models3d-tileset-item';
    item.dataset.tilesetId = tilesetId;

    item.innerHTML = `
        <div class="models3d-tileset-header">
            <button class="models3d-tileset-toggle" aria-expanded="${!isCollapsed}">
                ${isCollapsed ? ICONS.CHEVRON_RIGHT : ICONS.CHEVRON_DOWN}
            </button>
            <span class="models3d-tileset-icon">${ICONS.MODEL_3D}</span>
            <span class="models3d-tileset-name" title="${tilesetName}">${tilesetName}</span>
            <span class="models3d-marker-count">${markers.length}</span>
            <button class="models3d-open-viewer" title="Abrir no visualizador 3D">
                ${ICONS.EXTERNAL}
            </button>
        </div>
        <div class="models3d-markers-list ${isCollapsed ? 'collapsed' : ''}">
            ${markers.map(marker => createMarkerItemHTML(marker)).join('')}
        </div>
    `;

    // Attach events
    attachTilesetEvents(item, tilesetId, markers, eventBus);

    return item;
}

/**
 * Creates HTML for a marker item.
 * @param {Object} marker - Marker data
 * @returns {string} HTML string
 */
function createMarkerItemHTML(marker) {
    const name = marker.properties?.nome || 'Marcador';
    const label = marker.properties?.rotulo;

    return `
        <div class="models3d-marker-item" data-marker-id="${marker.id}" data-tileset-id="${marker.tilesetId}">
            <span class="models3d-marker-icon">${ICONS.MARKER}</span>
            <div class="models3d-marker-info">
                <span class="models3d-marker-name" title="${name}">${name}</span>
                ${label ? `<span class="models3d-marker-label" title="${label}">${label}</span>` : ''}
            </div>
        </div>
    `;
}

/**
 * Attaches events to a tileset item.
 * @param {HTMLElement} item - Tileset item element
 * @param {string} tilesetId - Tileset ID
 * @param {Array} markers - Markers for this tileset
 * @param {Object} _eventBus - EventBus instance (unused, reserved for future use)
 */
function attachTilesetEvents(item, tilesetId, markers, _eventBus) {
    // Toggle expansion
    const toggleBtn = item.querySelector('.models3d-tileset-toggle');
    const markersList = item.querySelector('.models3d-markers-list');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyCollapsed = markersList.classList.contains('collapsed');

        if (isCurrentlyCollapsed) {
            markersList.classList.remove('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_DOWN;
            toggleBtn.setAttribute('aria-expanded', 'true');
            collapsedTilesets.delete(tilesetId);
        } else {
            markersList.classList.add('collapsed');
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

    // Marker clicks
    const markerItems = item.querySelectorAll('.models3d-marker-item');
    markerItems.forEach((markerItem) => {
        markerItem.addEventListener('click', () => {
            const markerId = markerItem.dataset.markerId;
            const marker = markers.find(m => m.id === markerId);
            if (marker) {
                navigateToMarker(marker);
            }
        });
    });
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

        // Use the global modelsViewerControl to properly show the 3D container
        if (window.modelsViewerControl) {
            await window.modelsViewerControl.openViewer(tilesetId);
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

    // Listen for viewer closed (to refresh markers if any were added)
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
