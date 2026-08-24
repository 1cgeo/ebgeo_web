// Path: js/street_view_tool/tools/marker_tool_360.js

/**
 * @fileoverview Marker placement tool for Street View 360.
 * Allows users to place markers (POIs) on the 360 panorama.
 */

import { addMarker360 } from '@store';
import { showSuccess, showWarning } from '@utils/toast_service.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import { denialNotice } from '@store/denial-phrases.js';

// ===== STATE =====

let isActive = false;
let currentPhotoName = null;
let navigatorRef = null;

// ===== TOOL ACTIVATION =====

/**
 * Activates the marker placement tool.
 * @param {string} photoName - Current photo name
 * @param {Object} navigator - Navigator instance
 */
export function activateMarkerTool(photoName, navigator) {
    // RECUSA A ENTRADA NO MODO, nomeando o motivo, que é o padrão de
    // `CommentOverlay.togglePlacement`. Antes disto o visualizador 360 aceitava a ferramenta,
    // punha o cursor em cruz, deixava a pessoa mirar e clicar, e só então `addMarker360` recusava
    // na store: todo o gesto era gasto para chegar a um "não". Gatear aqui cobre também
    // `toggleMarkerTool`, que é a única outra porta.
    const perm = checkPermission('CREATE_MARKER_360');
    if (!perm.allowed) {
        showWarning(denialNotice(perm.required));
        return;
    }

    isActive = true;
    currentPhotoName = photoName;
    navigatorRef = navigator;

    // Tell navigator we're in marker mode
    if (navigator && typeof navigator.setMarkerToolActive === 'function') {
        navigator.setMarkerToolActive(true);
    }

    // Show active tool chip
    showActiveToolChip('Adicionar Marcador');

    // Set cursor to crosshair
    const canvas = document.getElementById('streetview-nav-canvas');
    if (canvas) {
        canvas.style.cursor = 'crosshair';
    }
}

/**
 * Deactivates the marker placement tool.
 */
export function deactivateMarkerTool() {
    isActive = false;

    // Tell navigator we're no longer in marker mode
    if (navigatorRef && typeof navigatorRef.setMarkerToolActive === 'function') {
        navigatorRef.setMarkerToolActive(false);
    }

    // Hide active tool chip
    hideActiveToolChip();

    // Reset cursor
    const canvas = document.getElementById('streetview-nav-canvas');
    if (canvas) {
        canvas.style.cursor = '';
    }

    // Reset marker button state
    const markerBtn = document.getElementById('add-marker-360');
    if (markerBtn) {
        markerBtn.classList.remove('active');
    }
}

/**
 * Checks if the marker tool is currently active.
 * @returns {boolean} True if active
 */
export function isMarkerToolActive() {
    return isActive;
}

// ===== MARKER CREATION =====

/**
 * Creates a marker at the specified position.
 * @param {Object} position - Position in spherical coordinates
 * @param {number} position.heading - Heading in degrees (0-360)
 * @param {number} position.pitch - Pitch in radians
 * @param {number} [position.distance=5] - Distance from camera
 * @returns {Promise<Object|null>} Created marker or null
 */
export async function createMarkerAtPosition(position) {
    if (!currentPhotoName) {
        console.warn('No photo loaded, cannot create marker');
        return null;
    }

    try {
        const marker = await addMarker360(currentPhotoName, {
            position: {
                heading: position.heading,
                pitch: position.pitch,
                distance: position.distance || 5
            }
        });

        showSuccess('Marcador adicionado');

        // Deactivate tool after creating marker
        deactivateMarkerTool();

        return marker;
    } catch (error) {
        console.error('Failed to create marker:', error);
        return null;
    }
}

// ===== PHOTO TRACKING =====

/**
 * Sets the current photo name for marker creation.
 * @param {string} photoName - Photo name
 */
export function setCurrentPhotoForMarker(photoName) {
    currentPhotoName = photoName;
}

// ===== UI HELPERS =====

/**
 * Shows the active tool chip with the specified tool name.
 * @param {string} toolName - Display name of the active tool
 */
function showActiveToolChip(toolName) {
    const chip = document.getElementById('active-tool-chip-360');
    const chipName = document.getElementById('active-tool-chip-360-name');

    if (chip && chipName) {
        chipName.textContent = toolName;
        chip.style.display = 'flex';
    }
}

/**
 * Hides the active tool chip.
 */
function hideActiveToolChip() {
    const chip = document.getElementById('active-tool-chip-360');
    if (chip) {
        chip.style.display = 'none';
    }
}

// ===== TOGGLE =====

/**
 * Toggles the marker tool on/off.
 * @param {string} photoName - Current photo name
 * @param {Object} navigator - Navigator instance
 */
export function toggleMarkerTool(photoName, navigator) {
    if (isActive) {
        deactivateMarkerTool();
    } else {
        activateMarkerTool(photoName, navigator);
    }
}
