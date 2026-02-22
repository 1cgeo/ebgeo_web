// Path: js/sidebar/components/multi-selection-actions.js

/**
 * @fileoverview Action buttons for multi-selection panel (lock/hide batch operations).
 * @module sidebar/components/multi-selection-actions
 */

import { updateFeatureProperty, getStorageTypeFromSource } from '../../store/index.js';

// ============================================================================
// SVG ICONS
// ============================================================================

const ICON_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const ICON_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_LOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const ICON_UNLOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Propagates a property change to the MapLibre source for a single feature.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceType - Source type (e.g., 'point', 'line')
 * @param {string} featureId - Feature ID
 * @param {string} property - Property name
 * @param {*} value - Property value
 */
async function propagateToSource(map, sourceType, featureId, property, value) {
    const storageType = getStorageTypeFromSource(sourceType);
    const source = map.getSource(storageType);
    if (!source) return;

    try {
        const data = await source.getData();
        const feature = data.features.find(
            f => f.properties.id === featureId || f.id === featureId
        );
        if (feature) {
            feature.properties[property] = value;
            source.setData(data);
        }
    } catch (error) {
        console.error(`Error propagating ${property} to source ${storageType}:`, error);
    }
}

// ============================================================================
// MAIN
// ============================================================================

/**
 * Creates action buttons (hide/show, lock/unlock) for multi-selection.
 *
 * @param {Object} options - Options
 * @param {Array<Object>} options.selectedFeatures - Selected features
 * @param {Object} options.selectionManager - SelectionManager instance
 * @param {Object} options.uiManager - UIManager instance
 * @returns {HTMLElement} Action buttons container
 */
export function createMultiSelectionActions({ selectedFeatures, selectionManager, uiManager }) {
    const container = document.createElement('div');
    container.className = 'multi-selection-actions';

    // Determine current state to decide button labels
    const allHidden = selectedFeatures.every(f => f.properties?.visivel === false);
    const allLocked = selectedFeatures.every(f => f.properties?.bloqueado === true);

    // Hide/Show button
    const hideBtn = document.createElement('button');
    hideBtn.className = 'multi-selection-actions__btn';
    hideBtn.type = 'button';

    if (allHidden) {
        hideBtn.innerHTML = `${ICON_EYE}<span>Mostrar</span>`;
        hideBtn.title = 'Mostrar todas as feições selecionadas';
    } else {
        hideBtn.innerHTML = `${ICON_EYE_OFF}<span>Ocultar</span>`;
        hideBtn.title = 'Ocultar todas as feições selecionadas';
    }

    hideBtn.addEventListener('click', async () => {
        const newVisibility = allHidden;
        const map = selectionManager.map;

        for (const feature of selectedFeatures) {
            const sourceType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (!sourceType || !featureId) continue;

            const storageType = getStorageTypeFromSource(sourceType);
            await updateFeatureProperty(storageType, featureId, 'visivel', newVisibility);
            await propagateToSource(map, sourceType, featureId, 'visivel', newVisibility);

            // Update in-memory feature so the rebuilt panel sees the new state
            feature.properties.visivel = newVisibility;
        }

        // Rebuild panel to reflect toggled button state
        uiManager?.updatePanels();
    });

    // Lock/Unlock button
    const lockBtn = document.createElement('button');
    lockBtn.className = 'multi-selection-actions__btn';
    lockBtn.type = 'button';

    if (allLocked) {
        lockBtn.innerHTML = `${ICON_UNLOCK}<span>Desbloquear</span>`;
        lockBtn.title = 'Desbloquear todas as feições selecionadas';
    } else {
        lockBtn.innerHTML = `${ICON_LOCK}<span>Bloquear</span>`;
        lockBtn.title = 'Bloquear todas as feições selecionadas';
    }

    lockBtn.addEventListener('click', async () => {
        const newLockState = !allLocked;
        const map = selectionManager.map;

        for (const feature of selectedFeatures) {
            const sourceType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (!sourceType || !featureId) continue;

            const storageType = getStorageTypeFromSource(sourceType);
            await updateFeatureProperty(storageType, featureId, 'bloqueado', newLockState);
            await propagateToSource(map, sourceType, featureId, 'bloqueado', newLockState);

            // Update in-memory feature so the rebuilt panel sees the new state
            feature.properties.bloqueado = newLockState;
        }

        // Rebuild panel to reflect toggled button state
        uiManager?.updatePanels();
    });

    container.appendChild(hideBtn);
    container.appendChild(lockBtn);

    return container;
}
