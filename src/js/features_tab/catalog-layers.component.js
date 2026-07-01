// Path: js/features_tab/catalog-layers.component.js

/**
 * @fileoverview Component for displaying catalog layers (analysis + hillshade) in the features tab.
 * Only shows when layers have been added via the catalog.
 */

import {
    getCatalogLayers,
    getCatalogLayerById,
    removeCatalogLayer,
    toggleCatalogLayerVisibility,
    validateCatalogLayerAvailability,
    updateCatalogLayerStatus,
    addCatalogLayer,
    hasCatalogLayer,
    revalidateCatalogLayers
} from '@store';
import { EventTypes } from '@events';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_ICONS,
    CATALOG_TYPE_CONFIG
} from '@catalog/catalog.constants.js';
import { showSuccess, showToast } from '@utils';
import { escapeHtml } from '@utils/html-escape.js';
import { showLayerStyleModal } from '@modals';

/**
 * Icons used in the component.
 */
const ICONS = {
    VISIBLE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    HIDDEN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    ZOOM: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    WARNING: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    INFO: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    CLOSE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    LEGEND: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><line x1="14" y1="6" x2="21" y2="6"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="17" x2="21" y2="17"/></svg>`,
    SETTINGS: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
};

/**
 * Whether a layer type supports style configuration via the layer-style modal.
 * @param {string} type
 * @returns {boolean}
 */
function supportsStyleConfig(type) {
    return type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER || type === CATALOG_ITEM_TYPES.DATA_LAYER;
}

/**
 * Applies persisted style overrides for a catalog layer to the map.
 * Safe to call regardless of layer type — no-op for unsupported types.
 * @param {Object} layer - Catalog layer state
 * @param {Object} [analysisLayersManager]
 * @param {Object} [dataLayersManager]
 */
function applyCatalogLayerStyleOverrides(layer, analysisLayersManager, dataLayersManager) {
    if (!layer?.styleOverrides) return;
    const innerId = layer.config?.id;
    if (!innerId) return;

    if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
        analysisLayersManager.applyStyleOverrides(innerId, layer.styleOverrides);
    } else if (layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && dataLayersManager) {
        dataLayersManager.applyStyleOverrides(innerId, layer.styleOverrides);
    }
}

/**
 * Creates the catalog layers container element.
 * @returns {HTMLElement}
 */
export function createCatalogLayersContainer() {
    const container = document.createElement('div');
    container.className = 'catalog-layers-section';
    container.id = 'catalog-layers-container';
    container.style.display = 'none';
    return container;
}

/**
 * Renders the catalog layers in the container.
 * @param {HTMLElement} container - Container element
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
export async function renderCatalogLayers(container, map, eventBus, analysisLayersManager, dataLayersManager) {
    if (!container) return;

    // Revalidate catalog layers against current config before rendering
    // This ensures layers that are no longer in config are marked as unavailable
    await revalidateCatalogLayers();

    const layers = await getCatalogLayers();

    if (!layers || layers.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Separate layers by type for different sections
    const analysisLayers = layers.filter(l =>
        l.type === CATALOG_ITEM_TYPES.HILLSHADE ||
        l.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER
    );
    const dataLayers = layers.filter(l => l.type === CATALOG_ITEM_TYPES.DATA_LAYER);

    container.style.display = 'block';
    container.innerHTML = '';

    // Render Analysis section if has layers
    if (analysisLayers.length > 0) {
        const analysisSection = document.createElement('div');
        analysisSection.className = 'catalog-layers-analysis-section';
        analysisSection.innerHTML = `
            <div class="sidebar-section-header">
                <span>Análise</span>
            </div>
            <div class="catalog-layers-list"></div>
        `;
        const analysisList = analysisSection.querySelector('.catalog-layers-list');
        analysisLayers.forEach(layer => {
            const item = createLayerItem(layer, map, eventBus, analysisLayersManager, dataLayersManager);
            analysisList.appendChild(item);
        });
        container.appendChild(analysisSection);
    }

    // Render Data section if has layers
    if (dataLayers.length > 0) {
        const dataSection = document.createElement('div');
        dataSection.className = 'catalog-layers-data-section';
        dataSection.innerHTML = `
            <div class="sidebar-section-header">
                <span>Dados</span>
            </div>
            <div class="catalog-layers-list"></div>
        `;
        const dataList = dataSection.querySelector('.catalog-layers-list');
        dataLayers.forEach(layer => {
            const item = createLayerItem(layer, map, eventBus, analysisLayersManager, dataLayersManager);
            dataList.appendChild(item);
        });
        container.appendChild(dataSection);
    }
}

/**
 * Creates an individual layer item (active or unavailable).
 * @param {Object} layer - Layer data
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 * @returns {HTMLElement}
 */
function createLayerItem(layer, map, eventBus, analysisLayersManager, dataLayersManager) {
    const isUnavailable = layer.status === 'unavailable';

    const item = document.createElement('div');
    item.className = `catalog-layer-item ${isUnavailable ? 'catalog-layer-unavailable' : ''}`;
    item.dataset.layerId = layer.id;
    item.dataset.status = layer.status || 'active';

    if (isUnavailable) {
        item.innerHTML = createUnavailableLayerHTML(layer);
        attachUnavailableLayerEvents(item, layer, map, eventBus, analysisLayersManager, dataLayersManager);
    } else {
        item.innerHTML = createActiveLayerHTML(layer);
        attachActiveLayerEvents(item, layer, map, eventBus, analysisLayersManager, dataLayersManager);
    }

    return item;
}

/**
 * Creates HTML for an active (available) layer.
 * @param {Object} layer - Layer data
 * @returns {string} HTML string
 */
function createActiveLayerHTML(layer) {
    const icon = getLayerIcon(layer.type);
    // Analysis layers require bounds in config, data layers calculate bounds dynamically
    const hasLocation = layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && layer.config?.bounds;
    // Data layers always support zoom (bounds calculated from vector features)
    const isDataLayer = layer.type === CATALOG_ITEM_TYPES.DATA_LAYER;
    // Check if layer has legend configured
    const hasLegend = layer.config?.legend?.items?.length > 0;
    const hasStyleConfig = supportsStyleConfig(layer.type);

    return `
        <div class="catalog-layer-info">
            <span class="catalog-layer-icon">${icon}</span>
            <span class="catalog-layer-name" title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</span>
        </div>
        <div class="catalog-layer-actions">
            ${hasLegend ? `
                <button class="catalog-layer-btn catalog-layer-legend" title="Ver legenda">
                    ${ICONS.LEGEND}
                </button>
            ` : ''}
            ${(hasLocation || isDataLayer) ? `
                <button class="catalog-layer-btn catalog-layer-zoom" title="Ir para camada">
                    ${ICONS.ZOOM}
                </button>
            ` : ''}
            ${hasStyleConfig ? `
                <button class="catalog-layer-btn catalog-layer-settings" title="Configurar estilo">
                    ${ICONS.SETTINGS}
                </button>
            ` : ''}
            <button class="catalog-layer-btn catalog-layer-visibility" title="Alternar visibilidade" data-visible="${layer.visible}">
                ${layer.visible ? ICONS.VISIBLE : ICONS.HIDDEN}
            </button>
            <button class="catalog-layer-btn catalog-layer-remove" title="Remover camada">
                ${ICONS.TRASH}
            </button>
        </div>
    `;
}

/**
 * Creates HTML for an unavailable layer.
 * @param {Object} layer - Layer data
 * @returns {string} HTML string
 */
function createUnavailableLayerHTML(layer) {
    return `
        <div class="catalog-layer-info">
            <span class="catalog-layer-icon catalog-layer-icon-warning">${ICONS.WARNING}</span>
            <div class="catalog-layer-details">
                <span class="catalog-layer-name" title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</span>
                <span class="catalog-layer-status-text">Indisponível</span>
            </div>
        </div>
        <div class="catalog-layer-actions">
            <button class="catalog-layer-btn catalog-layer-info-btn" title="Ver detalhes">
                ${ICONS.INFO}
            </button>
            <button class="catalog-layer-btn catalog-layer-remove" title="Remover camada">
                ${ICONS.TRASH}
            </button>
        </div>
    `;
}

/**
 * Attaches events to an active layer item.
 * @param {HTMLElement} item - Layer item element
 * @param {Object} layer - Layer data
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function attachActiveLayerEvents(item, layer, map, eventBus, analysisLayersManager, dataLayersManager) {
    // Legend button
    const legendBtn = item.querySelector('.catalog-layer-legend');
    if (legendBtn) {
        legendBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLegendPanel(layer, item);
        });
    }

    // Zoom button
    const zoomBtn = item.querySelector('.catalog-layer-zoom');
    if (zoomBtn) {
        zoomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomToLayer(map, layer, analysisLayersManager, dataLayersManager);
        });
    }

    // Settings (style config)
    const settingsBtn = item.querySelector('.catalog-layer-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openLayerStyleModal(layer, analysisLayersManager, dataLayersManager);
        });
    }

    // Toggle visibility
    const visBtn = item.querySelector('.catalog-layer-visibility');
    visBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newVisibility = visBtn.dataset.visible !== 'true';
        await toggleCatalogLayerVisibility(layer.id, newVisibility);
        visBtn.dataset.visible = newVisibility.toString();
        visBtn.innerHTML = newVisibility ? ICONS.VISIBLE : ICONS.HIDDEN;

        // Apply visibility to map
        applyLayerVisibility(map, layer, newVisibility, analysisLayersManager, dataLayersManager);

        // Re-apply persisted style overrides — toggling visibility re-creates layer
        // sources/paint in some managers, which would otherwise drop overrides.
        // Re-read the layer so edits made via the style modal (which do not trigger a
        // re-render) are not reverted to the overrides captured when the row rendered.
        if (newVisibility) {
            const fresh = await getCatalogLayerById(layer.id);
            applyCatalogLayerStyleOverrides(fresh || layer, analysisLayersManager, dataLayersManager);
        }

        // Emit event
        eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
    });

    // Remove layer
    attachRemoveEvent(item, layer, map, eventBus, analysisLayersManager, dataLayersManager);
}

/**
 * Attaches events to an unavailable layer item.
 * @param {HTMLElement} item - Layer item element
 * @param {Object} layer - Layer data
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function attachUnavailableLayerEvents(item, layer, map, eventBus, analysisLayersManager, dataLayersManager) {
    // Info button - shows popover with details
    const infoBtn = item.querySelector('.catalog-layer-info-btn');
    infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showUnavailableLayerPopover(layer, infoBtn, map, eventBus, analysisLayersManager, dataLayersManager);
    });

    // Remove layer
    attachRemoveEvent(item, layer, map, eventBus, analysisLayersManager, dataLayersManager);
}

/**
 * Attaches remove event to a layer item.
 * @param {HTMLElement} item - Layer item element
 * @param {Object} layer - Layer data
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function attachRemoveEvent(item, layer, map, eventBus, analysisLayersManager, dataLayersManager) {
    const removeBtn = item.querySelector('.catalog-layer-remove');
    removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeCatalogLayer(layer.id);
        item.remove();

        // Remove from map (only if was active)
        if (layer.status !== 'unavailable') {
            removeLayerFromMap(map, layer, analysisLayersManager, dataLayersManager);
        }

        // Check if any layers remaining
        const container = document.getElementById('catalog-layers-container');
        const remaining = container?.querySelectorAll('.catalog-layer-item');
        if (!remaining || remaining.length === 0) {
            container.style.display = 'none';
        }

        // Emit event
        eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
    });
}

/**
 * Opens the style configuration modal for an analysis or data catalog layer.
 * Reads the latest layer state from the store so the form reflects any
 * previously persisted overrides.
 * @param {Object} layer - Catalog layer state at the moment the row was rendered
 * @param {Object} [analysisLayersManager]
 * @param {Object} [dataLayersManager]
 */
async function openLayerStyleModal(layer, analysisLayersManager, dataLayersManager) {
    if (!supportsStyleConfig(layer.type)) return;

    // Read the freshest layer state in case overrides were updated elsewhere.
    const latest = await getCatalogLayerById(layer.id);
    const targetLayer = latest || layer;

    await showLayerStyleModal({
        layer: targetLayer,
        analysisLayersManager,
        dataLayersManager
    });
}

/**
 * Zooms to a layer's bounds.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layer - Layer data
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function zoomToLayer(map, layer, analysisLayersManager, dataLayersManager) {
    if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
        analysisLayersManager.zoomToLayer(layer.config?.id);
    } else if (layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && dataLayersManager) {
        dataLayersManager.zoomToLayer(layer.config?.id);
    }
}

/**
 * Gets the icon for a layer type.
 * @param {string} type - Layer type
 * @returns {string} SVG icon
 */
function getLayerIcon(type) {
    return CATALOG_ICONS[type] || CATALOG_ICONS[CATALOG_ITEM_TYPES.ANALYSIS_LAYER];
}

/**
 * Applies visibility change to the map layer.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layer - Layer data
 * @param {boolean} visible - Visibility state
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function applyLayerVisibility(map, layer, visible, analysisLayersManager, dataLayersManager) {
    if (layer.type === CATALOG_ITEM_TYPES.HILLSHADE) {
        // Use terrain control for hillshade
        const terrainControl = map._controls?.find(
            (control) => control.constructor.name === 'TerrainControl'
        );
        if (terrainControl?.setHillshadeVisibility) {
            terrainControl.setHillshadeVisibility(visible);
        }
    } else if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
        // Use analysis layers manager
        analysisLayersManager.toggleLayer(layer.config?.id, visible);
    } else if (layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && dataLayersManager) {
        // Use data layers manager
        dataLayersManager.toggleLayer(layer.config?.id, visible);
    }
}

/**
 * Removes a layer from the map.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layer - Layer data
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function removeLayerFromMap(map, layer, analysisLayersManager, dataLayersManager) {
    // Set visibility to false first
    applyLayerVisibility(map, layer, false, analysisLayersManager, dataLayersManager);
}

/**
 * Teardown of the currently-open unavailable-layer popover. Lets a new popover
 * fully remove the previous one (node + its document click listener) instead of
 * orphaning the listener via a bare node `.remove()`.
 * @type {?() => void}
 */
let activePopoverTeardown = null;

/**
 * Shows a popover with details about an unavailable layer.
 * @param {Object} layer - Layer data
 * @param {HTMLElement} anchorElement - Element to anchor the popover to
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
function showUnavailableLayerPopover(layer, anchorElement, map, eventBus, analysisLayersManager, dataLayersManager) {
    // Fully tear down any existing popover (node + its document click listener) first.
    if (activePopoverTeardown) {
        activePopoverTeardown();
    }

    const typeConfig = CATALOG_TYPE_CONFIG[layer.type];
    const typeLabel = typeConfig?.label || layer.type;

    const popover = document.createElement('div');
    popover.className = 'catalog-layer-popover';
    popover.innerHTML = `
        <div class="popover-header">
            <span>Camada Indisponível</span>
            <button class="popover-close" title="Fechar">${ICONS.CLOSE}</button>
        </div>
        <div class="popover-body">
            <p>Esta camada foi salva no arquivo .ebgeo mas não está configurada nesta instância do EBGeo.</p>
            <dl>
                <dt>Tipo:</dt>
                <dd>${typeLabel}</dd>
                <dt>ID Original:</dt>
                <dd><code>${escapeHtml(layer.originalId || layer.config?.id || layer.id)}</code></dd>
            </dl>
            <p class="popover-hint">
                Para utilizar esta camada, verifique se o config.js inclui a configuração necessária.
            </p>
            <button class="popover-retry-btn">
                ${ICONS.REFRESH}
                Tentar carregar novamente
            </button>
        </div>
    `;

    document.body.appendChild(popover);

    // Position popover near anchor
    positionPopover(popover, anchorElement);

    // Shared teardown: removes the popover AND its document click listener so the
    // listener is not orphaned when closing via the X button or a successful retry.
    const closeOnClickOutside = (e) => {
        if (!popover.contains(e.target) && !anchorElement.contains(e.target)) {
            removePopover();
        }
    };
    const removePopover = () => {
        popover.remove();
        document.removeEventListener('click', closeOnClickOutside);
        if (activePopoverTeardown === removePopover) {
            activePopoverTeardown = null;
        }
    };
    activePopoverTeardown = removePopover;

    // Close button event
    const closeBtn = popover.querySelector('.popover-close');
    closeBtn.addEventListener('click', () => {
        removePopover();
    });

    // Retry button event
    const retryBtn = popover.querySelector('.popover-retry-btn');
    retryBtn.addEventListener('click', async () => {
        const newStatus = validateCatalogLayerAvailability(layer);

        if (newStatus === 'active') {
            // Update status in store
            await updateCatalogLayerStatus(layer.id, 'active');

            // Apply to map
            if (layer.type === CATALOG_ITEM_TYPES.HILLSHADE) {
                const terrainControl = map._controls?.find(
                    (control) => control.constructor.name === 'TerrainControl'
                );
                if (terrainControl?.setHillshadeVisibility) {
                    terrainControl.setHillshadeVisibility(true);
                }
            } else if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
                await analysisLayersManager.toggleLayer(layer.config?.id, true);
            } else if (layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && dataLayersManager) {
                dataLayersManager.toggleLayer(layer.config?.id, true);
            }

            // Emit event to refresh UI
            eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });

            // Show success message
            showSuccess(`Camada "${layer.name}" carregada com sucesso!`);

            removePopover();
        } else {
            // Show warning
            showToast('Camada ainda não está disponível no config.', 'warning');
        }
    });

    // Close on click outside (registered async so the opening click doesn't close it)
    setTimeout(() => {
        document.addEventListener('click', closeOnClickOutside);
    }, 0);
}

/**
 * Positions a popover relative to an anchor element.
 * @param {HTMLElement} popover - Popover element
 * @param {HTMLElement} anchor - Anchor element
 */
function positionPopover(popover, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();

    // Position to the left of the anchor, aligned at the top
    let left = anchorRect.left - popoverRect.width - 8;
    let top = anchorRect.top;

    // If would go off left edge, position to the right instead
    if (left < 8) {
        left = anchorRect.right + 8;
    }

    // If would go off bottom edge, adjust up
    if (top + popoverRect.height > window.innerHeight - 8) {
        top = window.innerHeight - popoverRect.height - 8;
    }

    // If would go off top edge, adjust down
    if (top < 8) {
        top = 8;
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

/**
 * Creates an SVG symbol for a legend item.
 * @param {Object} item - Legend item configuration
 * @returns {string} SVG string
 */
function createLegendSymbol(item) {
    const { type, color, borderColor, borderWidth = 1, size = 8 } = item;

    switch (type) {
        case 'point':
            return `<svg width="16" height="16" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="${size / 2}" fill="${color}" />
            </svg>`;

        case 'line':
            return `<svg width="24" height="16" viewBox="0 0 24 16">
                <line x1="2" y1="8" x2="22" y2="8" stroke="${color}" stroke-width="${borderWidth + 1}" stroke-linecap="round" />
            </svg>`;

        case 'polygon':
            return `<svg width="16" height="16" viewBox="0 0 16 16">
                <rect x="2" y="2" width="12" height="12"
                    fill="${color}"
                    stroke="${borderColor || color}"
                    stroke-width="${borderWidth}" />
            </svg>`;

        default:
            return '';
    }
}

/**
 * Toggles the inline legend panel below the layer item.
 * @param {Object} layer - Layer data
 * @param {HTMLElement} layerItem - The layer item element
 */
function toggleLegendPanel(layer, layerItem) {
    // Look for existing panel that follows this item
    const existingPanel = layerItem.nextElementSibling?.classList.contains('legend-panel')
        ? layerItem.nextElementSibling
        : null;

    // If panel exists, toggle it
    if (existingPanel) {
        existingPanel.remove();
        layerItem.classList.remove('legend-expanded');
        return;
    }

    const legend = layer.config?.legend;
    if (!legend?.items?.length) return;

    const panel = document.createElement('div');
    panel.className = 'legend-panel';
    panel.dataset.layerId = layer.id;
    panel.innerHTML = `
        <div class="legend-panel-body">
            ${legend.items.map(item => `
                <div class="legend-item">
                    <span class="legend-symbol">${createLegendSymbol(item)}</span>
                    <span class="legend-label">${escapeHtml(item.label)}</span>
                </div>
            `).join('')}
        </div>
    `;

    // Insert after the layer item
    layerItem.after(panel);
    layerItem.classList.add('legend-expanded');
}

/**
 * Handles the CATALOG_ADD_LAYER event.
 * Adds a layer to the catalog and applies it to the map.
 * @param {Object} payload - Event payload
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 */
export async function handleCatalogAddLayer(payload, map, eventBus, analysisLayersManager, dataLayersManager) {
    const { type, item } = payload;

    // Check if already added
    if (await hasCatalogLayer(item.id)) {
        // Just make it visible
        const layers = await getCatalogLayers();
        const existingLayer = layers.find(l => l.id === item.id);
        if (existingLayer) {
            applyLayerVisibility(map, existingLayer, true, analysisLayersManager, dataLayersManager);
            await toggleCatalogLayerVisibility(item.id, true);
        }
        return;
    }

    // Create catalog layer state
    const catalogLayer = {
        id: item.id,
        type: type,
        name: item.name,
        visible: true,
        opacity: 1,
        config: item.originalData
    };

    // Add to store
    await addCatalogLayer(catalogLayer);

    // Apply to map
    if (type === CATALOG_ITEM_TYPES.HILLSHADE) {
        const terrainControl = map._controls?.find(
            (control) => control.constructor.name === 'TerrainControl'
        );
        if (terrainControl?.setHillshadeVisibility) {
            terrainControl.setHillshadeVisibility(true);
        }
        // State is now managed via catalogLayers, no separate hillshadeEnabled needed
    } else if (type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && analysisLayersManager) {
        await analysisLayersManager.toggleLayer(item.originalData.id, true);
    } else if (type === CATALOG_ITEM_TYPES.DATA_LAYER && dataLayersManager) {
        dataLayersManager.toggleLayer(item.originalData.id, true);
    }

    // Apply any persisted style overrides (no-op for new layers).
    applyCatalogLayerStyleOverrides(catalogLayer, analysisLayersManager, dataLayersManager);

    // Emit event to refresh UI
    eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
}

/**
 * Initializes catalog layer event listeners.
 * @param {Object} map - MapLibre map instance
 * @param {Object} eventBus - EventBus instance
 * @param {Object} [analysisLayersManager] - Analysis layers manager instance
 * @param {Object} [dataLayersManager] - Data layers manager instance
 * @returns {Function} Unsubscriber function
 */
export function initCatalogLayerListeners(map, eventBus, analysisLayersManager, dataLayersManager) {
    const handler = (payload) => {
        handleCatalogAddLayer(payload, map, eventBus, analysisLayersManager, dataLayersManager);
    };

    eventBus.on(EventTypes.CATALOG_ADD_LAYER, handler);

    return () => {
        eventBus.off(EventTypes.CATALOG_ADD_LAYER, handler);
    };
}
