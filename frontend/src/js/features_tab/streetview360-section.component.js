// Path: js/features_tab/streetview360-section.component.js

/**
 * @fileoverview Component for displaying Street View 360 features in the features tab.
 * Shows a section with orientations and markers organized by photo,
 * allowing navigation to features in 360 viewer.
 */

import { getAllMarkers360, getAllOrientations, getControl, removeMarkers360ByPhoto, clearOrientation, getStateManager, getEventBus } from '@store';
import { EventTypes } from '@events';
import config from '@js/config.js';
import { showConfirm } from '@modals';
import { showSuccess, showError, escapeHtml } from '@utils';

/**
 * Icons used in the component.
 */
const ICONS = {
    CAMERA_360: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>`,
    WARNING: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    INFO: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    CLOSE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    ORIENTATION: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>`,
    CHEVRON_DOWN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    CHEVRON_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    EXTERNAL: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`
};

// Module state for collapse states
const collapsedPhotos = new Set();

/**
 * Creates the Street View 360 section container element.
 * @returns {HTMLElement}
 */
export function createStreetview360SectionContainer() {
    const container = document.createElement('div');
    container.className = 'streetview360-section';
    container.id = 'streetview360-section-container';
    container.style.display = 'none';
    return container;
}

/**
 * Renders the Street View 360 section with all features.
 * @param {HTMLElement} container - Container element
 * @param {Object} eventBus - EventBus instance
 */
export async function renderStreetview360Section(container, eventBus) {
    if (!container) return;

    // Get all features for current map
    const [markers, orientations] = await Promise.all([
        getAllMarkers360(),
        getAllOrientations()
    ]);

    const orientationCount = Object.keys(orientations || {}).length;
    const markerCount = (markers || []).length;
    const totalFeatures = orientationCount + markerCount;

    if (totalFeatures === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Group all features by photoName
    const featuresByPhoto = groupFeaturesByPhoto(markers || [], orientations || {});

    // Check if streetview service is available
    const isStreetviewAvailable = config.features.imagens_panoramicas === true;

    // Resolve photo UUIDs to display names
    const photoDisplayNames = {};
    if (isStreetviewAvailable) {
        try {
            const { getPhotoDisplayName } = await import(
                '@js/street_view_tool/streetview-api.service.js'
            );
            const entries = await Promise.all(
                Object.keys(featuresByPhoto).map(async (photoId) => [
                    photoId,
                    await getPhotoDisplayName(photoId)
                ])
            );
            for (const [id, name] of entries) {
                photoDisplayNames[id] = name;
            }
        } catch {
            // Fallback: raw IDs will be used
        }
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="sidebar-section-header">
            <span>Imagens 360</span>
        </div>
        <div class="streetview360-list"></div>
    `;

    const list = container.querySelector('.streetview360-list');

    // Create photo items (available or unavailable)
    for (const [photoName, features] of Object.entries(featuresByPhoto)) {
        const displayName = photoDisplayNames[photoName] || photoName;
        const photoItem = isStreetviewAvailable
            ? createPhotoItem(photoName, displayName, features, eventBus)
            : createUnavailablePhotoItem(photoName, displayName, features, eventBus);
        list.appendChild(photoItem);
    }
}

/**
 * Groups all features by their photoName.
 * @param {Array} markers - Array of markers
 * @param {Object} orientations - Object mapping photoName to orientation data
 * @returns {Object} Features grouped by photoName
 */
function groupFeaturesByPhoto(markers, orientations) {
    const grouped = {};

    // Add orientations
    for (const [photoName, orientation] of Object.entries(orientations)) {
        if (!grouped[photoName]) {
            grouped[photoName] = [];
        }
        grouped[photoName].push({
            type: 'orientation',
            photoName,
            data: orientation
        });
    }

    // Add markers
    for (const marker of markers) {
        const photoName = marker.photoName;
        if (!grouped[photoName]) {
            grouped[photoName] = [];
        }
        grouped[photoName].push({
            type: 'marker',
            photoName,
            data: marker
        });
    }

    return grouped;
}

/**
 * Gets the icon for a feature based on its type.
 * @param {Object} feature - Feature object
 * @returns {string} SVG icon string
 */
function getFeatureIcon(feature) {
    if (feature.type === 'marker') {
        return ICONS.MARKER;
    } else if (feature.type === 'orientation') {
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
    if (feature.type === 'marker') {
        return feature.data.properties?.nome || 'Marcador';
    } else if (feature.type === 'orientation') {
        return 'Orientação salva';
    }
    return 'Feição';
}

/**
 * Creates a photo item with its features.
 * @param {string} photoName - Photo UUID (used for operations)
 * @param {string} displayName - Human-readable display name
 * @param {Array} features - All features for this photo
 * @param {Object} eventBus - EventBus instance
 * @returns {HTMLElement}
 */
function createPhotoItem(photoName, displayName, features, eventBus) {
    const isCollapsed = collapsedPhotos.has(photoName);

    const item = document.createElement('div');
    item.className = 'streetview360-photo-item';
    item.dataset.photoName = photoName;

    // Build features list HTML
    const safePhotoName = escapeHtml(photoName);
    const safeDisplayName = escapeHtml(displayName);
    const featuresHtml = features.map(feature => `
        <div class="streetview360-feature-item" data-type="${escapeHtml(feature.type)}" data-id="${feature.type === 'marker' ? escapeHtml(feature.data.id) : ''}" data-photo="${safePhotoName}">
            <span class="streetview360-feature-icon">${getFeatureIcon(feature)}</span>
            <span class="streetview360-feature-name" title="${escapeHtml(getFeatureName(feature))}">${escapeHtml(getFeatureName(feature))}</span>
        </div>
    `).join('');

    item.innerHTML = `
        <div class="streetview360-photo-header">
            <button class="streetview360-photo-toggle" aria-expanded="${!isCollapsed}">
                ${isCollapsed ? ICONS.CHEVRON_RIGHT : ICONS.CHEVRON_DOWN}
            </button>
            <span class="streetview360-photo-icon">${ICONS.CAMERA_360}</span>
            <span class="streetview360-photo-name" title="${safeDisplayName}">${safeDisplayName}</span>
            <span class="streetview360-feature-count">${features.length}</span>
            <button class="streetview360-delete-all" title="Deletar todas as feições">
                ${ICONS.TRASH}
            </button>
            <button class="streetview360-open-viewer" title="Abrir no visualizador 360">
                ${ICONS.EXTERNAL}
            </button>
        </div>
        <div class="streetview360-features-list ${isCollapsed ? 'collapsed' : ''}">
            ${featuresHtml}
        </div>
    `;

    // Attach events
    attachPhotoItemEvents(item, photoName, displayName, features, eventBus);

    return item;
}

/**
 * Creates an unavailable photo item (streetview service offline).
 * Shows warning visual, allows deletion but not viewer opening.
 * @param {string} photoName - Photo UUID (used for operations)
 * @param {string} displayName - Human-readable display name
 * @param {Array} features - All features for this photo
 * @param {Object} _eventBus - EventBus instance
 * @returns {HTMLElement}
 */
function createUnavailablePhotoItem(photoName, displayName, features, _eventBus) {
    const isCollapsed = collapsedPhotos.has(photoName);

    const item = document.createElement('div');
    item.className = 'streetview360-photo-item streetview360-photo-unavailable';
    item.dataset.photoName = photoName;

    // Build features list HTML (read-only, no click handlers)
    const safePhotoName = escapeHtml(photoName);
    const safeDisplayName = escapeHtml(displayName);
    const featuresHtml = features.map(feature => `
        <div class="streetview360-feature-item streetview360-feature-disabled" data-type="${escapeHtml(feature.type)}" data-photo="${safePhotoName}">
            <span class="streetview360-feature-icon">${getFeatureIcon(feature)}</span>
            <span class="streetview360-feature-name" title="${escapeHtml(getFeatureName(feature))}">${escapeHtml(getFeatureName(feature))}</span>
        </div>
    `).join('');

    item.innerHTML = `
        <div class="streetview360-photo-header">
            <button class="streetview360-photo-toggle" aria-expanded="${!isCollapsed}">
                ${isCollapsed ? ICONS.CHEVRON_RIGHT : ICONS.CHEVRON_DOWN}
            </button>
            <span class="streetview360-photo-icon">${ICONS.WARNING}</span>
            <div class="streetview360-photo-details">
                <span class="streetview360-photo-name" title="${safeDisplayName}">${safeDisplayName}</span>
                <span class="streetview360-status-text">Indisponível</span>
            </div>
            <span class="streetview360-feature-count">${features.length}</span>
            <button class="streetview360-delete-all" title="Deletar todas as feições">
                ${ICONS.TRASH}
            </button>
            <button class="streetview360-info-btn" title="Ver detalhes">
                ${ICONS.INFO}
            </button>
        </div>
        <div class="streetview360-features-list ${isCollapsed ? 'collapsed' : ''}">
            ${featuresHtml}
        </div>
    `;

    // Toggle expansion
    const toggleBtn = item.querySelector('.streetview360-photo-toggle');
    const featuresList = item.querySelector('.streetview360-features-list');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyCollapsed = featuresList.classList.contains('collapsed');

        if (isCurrentlyCollapsed) {
            featuresList.classList.remove('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_DOWN;
            toggleBtn.setAttribute('aria-expanded', 'true');
            collapsedPhotos.delete(photoName);
        } else {
            featuresList.classList.add('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_RIGHT;
            toggleBtn.setAttribute('aria-expanded', 'false');
            collapsedPhotos.add(photoName);
        }
    });

    // Delete all features button (still functional for cleanup)
    const deleteAllBtn = item.querySelector('.streetview360-delete-all');
    deleteAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const hasOrientation = features.some(f => f.type === 'orientation');
        await handleDeleteAllFeatures(photoName, displayName, features.length, hasOrientation);
    });

    // Info button — shows popover with details
    const infoBtn = item.querySelector('.streetview360-info-btn');
    infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showUnavailablePopover(displayName, infoBtn);
    });

    return item;
}

/**
 * Shows a popover with details about an unavailable 360 photo.
 * Reuses the catalog-layer-popover CSS.
 * @param {string} photoName - Photo name
 * @param {HTMLElement} anchorElement - Element to anchor the popover to
 */
function showUnavailablePopover(photoName, anchorElement) {
    // Remove any existing popover
    const existing = document.querySelector('.catalog-layer-popover');
    if (existing) existing.remove();

    const popover = document.createElement('div');
    popover.className = 'catalog-layer-popover';
    popover.innerHTML = `
        <div class="popover-header">
            <span>Foto 360 Indisponível</span>
            <button class="popover-close" title="Fechar">${ICONS.CLOSE}</button>
        </div>
        <div class="popover-body">
            <p>O serviço de imagens 360 está indisponível. Dados salvos para esta foto não podem ser visualizados.</p>
            <dl>
                <dt>Foto:</dt>
                <dd><code>${escapeHtml(photoName)}</code></dd>
            </dl>
            <p class="popover-hint">
                Verifique a conexão com o servidor de imagens 360.
            </p>
        </div>
    `;

    document.body.appendChild(popover);

    // Position popover near anchor
    const anchorRect = anchorElement.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let left = anchorRect.left - popoverRect.width - 8;
    let top = anchorRect.top;
    if (left < 8) left = anchorRect.right + 8;
    if (top + popoverRect.height > window.innerHeight - 8) top = window.innerHeight - popoverRect.height - 8;
    if (top < 8) top = 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    // Shared teardown removes the popover AND the document listener so the latter
    // is not orphaned when closing via the X button.
    const closeOnClickOutside = (e) => {
        if (!popover.contains(e.target) && !anchorElement.contains(e.target)) {
            removePopover();
        }
    };
    const removePopover = () => {
        popover.remove();
        document.removeEventListener('click', closeOnClickOutside);
    };

    // Close button
    popover.querySelector('.popover-close').addEventListener('click', () => removePopover());

    // Close on click outside (async so the opening click doesn't close it)
    setTimeout(() => {
        document.addEventListener('click', closeOnClickOutside);
    }, 0);
}

/**
 * Attaches events to a photo item.
 * @param {HTMLElement} item - Photo item element
 * @param {string} photoName - Photo UUID (used for operations)
 * @param {string} displayName - Human-readable name for dialogs
 * @param {Array} features - Features for this photo
 * @param {Object} _eventBus - EventBus instance
 */
function attachPhotoItemEvents(item, photoName, displayName, features, _eventBus) {
    // Toggle photo expansion
    const toggleBtn = item.querySelector('.streetview360-photo-toggle');
    const featuresList = item.querySelector('.streetview360-features-list');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyCollapsed = featuresList.classList.contains('collapsed');

        if (isCurrentlyCollapsed) {
            featuresList.classList.remove('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_DOWN;
            toggleBtn.setAttribute('aria-expanded', 'true');
            collapsedPhotos.delete(photoName);
        } else {
            featuresList.classList.add('collapsed');
            toggleBtn.innerHTML = ICONS.CHEVRON_RIGHT;
            toggleBtn.setAttribute('aria-expanded', 'false');
            collapsedPhotos.add(photoName);
        }
    });

    // Open viewer button
    const openViewerBtn = item.querySelector('.streetview360-open-viewer');
    openViewerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhotoInViewer(photoName);
    });

    // Delete all features button
    const deleteAllBtn = item.querySelector('.streetview360-delete-all');
    deleteAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const hasOrientation = features.some(f => f.type === 'orientation');
        await handleDeleteAllFeatures(photoName, displayName, features.length, hasOrientation);
    });

    // Feature clicks
    const featureItems = item.querySelectorAll('.streetview360-feature-item');
    featureItems.forEach((featureItem) => {
        featureItem.addEventListener('click', () => {
            const featureType = featureItem.dataset.type;
            const featureId = featureItem.dataset.id;

            if (featureType === 'marker' && featureId) {
                const marker = features.find(f => f.type === 'marker' && f.data.id === featureId)?.data;
                if (marker) {
                    navigateToMarker(marker);
                }
            } else if (featureType === 'orientation') {
                openPhotoInViewer(photoName);
            }
        });
    });
}

/**
 * Handles the deletion of all features for a photo.
 * Shows a confirmation modal before deleting.
 * @param {string} photoName - Photo UUID (used for deletion)
 * @param {string} displayName - Human-readable name for the dialog
 * @param {number} featureCount - Number of features to delete
 * @param {boolean} hasOrientation - Whether the photo has a saved orientation
 */
async function handleDeleteAllFeatures(photoName, displayName, featureCount, hasOrientation = false) {
    const orientationText = hasOrientation ? ' (incluindo orientação salva)' : '';
    const confirmed = await showConfirm(
        `Deletar todas as feições de "${displayName}"?`,
        {
            message: `${featureCount} feição(ões) serão permanentemente excluídas${orientationText}.\nEsta ação não pode ser desfeita.`,
            confirmText: 'Deletar',
            destructive: true
        }
    );

    if (!confirmed) return;

    try {
        // Remove all markers for this photo
        const markersRemoved = await removeMarkers360ByPhoto(photoName);

        // Also clear orientation if it exists
        let orientationCleared = false;
        if (hasOrientation) {
            orientationCleared = await clearOrientation(photoName);
        }

        const totalDeleted = markersRemoved + (orientationCleared ? 1 : 0);
        if (totalDeleted > 0) {
            showSuccess(`${totalDeleted} feição(ões) deletadas com sucesso!`);
        }
    } catch (error) {
        console.error('Error deleting features:', error);
        showError('Erro ao deletar feições.');
    }
}

/**
 * Collapses the sidebar before opening the 360 viewer.
 */
function collapseSidebar() {
    const stateManager = getStateManager();
    if (stateManager && stateManager.get('sidebar.expanded')) {
        stateManager.collapseSidebar();
    }
}

/**
 * Opens the 360 viewer with a specific photo.
 * @param {string} photoName - Photo name to open
 * @param {Object} [targetOrientation] - Optional orientation override (e.g., to face a marker)
 */
async function openPhotoInViewer(photoName, targetOrientation = null) {
    try {
        // Collapse sidebar before opening 360 viewer
        collapseSidebar();

        // Import and use the correct function from street_view_viewer
        const { openViewer360WithPhoto, isStreetView360Open, navigateToTarget } = await import('@js/street_view_tool/street_view_viewer.js');

        if (isStreetView360Open()) {
            // If already open, navigate to the photo
            await navigateToTarget(photoName, targetOrientation ? { targetOrientation } : undefined);
        } else {
            // Open viewer with the photo
            const streetViewControl = getControl('streetView');
            await openViewer360WithPhoto(photoName, {
                miniMap: streetViewControl?.miniMap,
                controlInstance: streetViewControl,
                targetOrientation
            });
        }
    } catch (error) {
        console.error('Error opening 360 viewer:', error);
    }
}

/**
 * Navigates to a marker in the 360 viewer.
 * Opens the photo oriented toward the marker's position.
 * @param {Object} marker - Marker data
 */
async function navigateToMarker(marker) {
    try {
        // Build orientation to face the marker
        const markerPosition = marker.position;
        const targetOrientation = markerPosition
            ? { worldHeading: markerPosition.heading, pitch: markerPosition.pitch ?? 0 }
            : null;

        // Open the photo in viewer oriented toward the marker
        await openPhotoInViewer(marker.photoName, targetOrientation);

        // Wait for viewer to be ready, then emit marker clicked event
        setTimeout(async () => {
            try {
                const eventBus = getEventBus();
                if (eventBus) {
                    eventBus.emit(EventTypes.MARKER_360_CLICKED, {
                        marker,
                        photoName: marker.photoName
                    });
                }
            } catch (error) {
                console.error('Error selecting marker:', error);
            }
        }, 1500); // Wait for viewer to fully load
    } catch (error) {
        console.error('Error navigating to marker:', error);
    }
}

/**
 * Initializes Street View 360 section event listeners.
 * @param {HTMLElement} container - Container element
 * @param {Object} eventBus - EventBus instance
 * @returns {Function} Unsubscriber function
 */
export function initStreetview360SectionListeners(container, eventBus) {
    const handlers = [];

    // Listen for marker changes
    const markersChangedHandler = () => {
        renderStreetview360Section(container, eventBus);
    };
    eventBus.on(EventTypes.MARKERS_360_CHANGED, markersChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.MARKERS_360_CHANGED, markersChangedHandler));

    // Listen for orientation save
    const orientationSavedHandler = () => {
        renderStreetview360Section(container, eventBus);
    };
    eventBus.on(EventTypes.ORIENTATION_360_SAVED, orientationSavedHandler);
    handlers.push(() => eventBus.off(EventTypes.ORIENTATION_360_SAVED, orientationSavedHandler));

    // Listen for orientation clear
    const orientationClearedHandler = () => {
        renderStreetview360Section(container, eventBus);
    };
    eventBus.on(EventTypes.ORIENTATION_360_CLEARED, orientationClearedHandler);
    handlers.push(() => eventBus.off(EventTypes.ORIENTATION_360_CLEARED, orientationClearedHandler));

    // Listen for viewer closed (to refresh features if any were added)
    const viewerClosedHandler = () => {
        renderStreetview360Section(container, eventBus);
    };
    eventBus.on(EventTypes.STREETVIEW_360_CLOSED, viewerClosedHandler);
    handlers.push(() => eventBus.off(EventTypes.STREETVIEW_360_CLOSED, viewerClosedHandler));

    // Listen for map changes (when user switches to a different map)
    const layersChangedHandler = () => {
        renderStreetview360Section(container, eventBus);
    };
    eventBus.on(EventTypes.LAYERS_CHANGED, layersChangedHandler);
    handlers.push(() => eventBus.off(EventTypes.LAYERS_CHANGED, layersChangedHandler));

    return () => {
        handlers.forEach(unsubscribe => unsubscribe());
    };
}
