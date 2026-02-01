// Path: js/features_tab/streetview360-section.component.js

/**
 * @fileoverview Component for displaying Street View 360 features in the features tab.
 * Shows a section with orientations and markers organized by photo,
 * allowing navigation to features in 360 viewer.
 */

import { getAllMarkers360, getAllOrientations, getControl } from '../store';
import { getStateManager, getEventBus } from '../store/services.js';
import { EventTypes } from '../events/index.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    CAMERA_360: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>`,
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    ORIENTATION: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>`,
    CHEVRON_DOWN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    CHEVRON_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    EXTERNAL: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
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

    container.style.display = 'block';
    container.innerHTML = `
        <div class="sidebar-section-header">
            <span>Imagens 360</span>
        </div>
        <div class="streetview360-list"></div>
    `;

    const list = container.querySelector('.streetview360-list');

    // Create photo items
    for (const [photoName, features] of Object.entries(featuresByPhoto)) {
        const photoItem = createPhotoItem(photoName, features, eventBus);
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
 * @param {string} photoName - Photo name
 * @param {Array} features - All features for this photo
 * @param {Object} eventBus - EventBus instance
 * @returns {HTMLElement}
 */
function createPhotoItem(photoName, features, eventBus) {
    const isCollapsed = collapsedPhotos.has(photoName);

    const item = document.createElement('div');
    item.className = 'streetview360-photo-item';
    item.dataset.photoName = photoName;

    // Build features list HTML
    const featuresHtml = features.map(feature => `
        <div class="streetview360-feature-item" data-type="${feature.type}" data-id="${feature.type === 'marker' ? feature.data.id : ''}" data-photo="${photoName}">
            <span class="streetview360-feature-icon">${getFeatureIcon(feature)}</span>
            <span class="streetview360-feature-name" title="${getFeatureName(feature)}">${getFeatureName(feature)}</span>
        </div>
    `).join('');

    item.innerHTML = `
        <div class="streetview360-photo-header">
            <button class="streetview360-photo-toggle" aria-expanded="${!isCollapsed}">
                ${isCollapsed ? ICONS.CHEVRON_RIGHT : ICONS.CHEVRON_DOWN}
            </button>
            <span class="streetview360-photo-icon">${ICONS.CAMERA_360}</span>
            <span class="streetview360-photo-name" title="${photoName}">${photoName}</span>
            <span class="streetview360-feature-count">${features.length}</span>
            <button class="streetview360-open-viewer" title="Abrir no visualizador 360">
                ${ICONS.EXTERNAL}
            </button>
        </div>
        <div class="streetview360-features-list ${isCollapsed ? 'collapsed' : ''}">
            ${featuresHtml}
        </div>
    `;

    // Attach events
    attachPhotoItemEvents(item, photoName, features, eventBus);

    return item;
}

/**
 * Attaches events to a photo item.
 * @param {HTMLElement} item - Photo item element
 * @param {string} photoName - Photo name
 * @param {Array} features - Features for this photo
 * @param {Object} _eventBus - EventBus instance
 */
function attachPhotoItemEvents(item, photoName, features, _eventBus) {
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
 */
async function openPhotoInViewer(photoName) {
    try {
        // Collapse sidebar before opening 360 viewer
        collapseSidebar();

        // Import and use the correct function from street_view_viewer
        const { openViewer360WithPhoto, isStreetView360Open, navigateToTarget } = await import('../street_view_tool/street_view_viewer.js');

        if (isStreetView360Open()) {
            // If already open, navigate to the photo
            await navigateToTarget(photoName);
        } else {
            // Open viewer with the photo
            const streetViewControl = getControl('streetView');
            await openViewer360WithPhoto(photoName, {
                miniMap: streetViewControl?.miniMap,
                controlInstance: streetViewControl
            });
        }
    } catch (error) {
        console.error('Error opening 360 viewer:', error);
    }
}

/**
 * Navigates to a marker in the 360 viewer.
 * @param {Object} marker - Marker data
 */
async function navigateToMarker(marker) {
    try {
        // First, open the photo in viewer
        await openPhotoInViewer(marker.photoName);

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
