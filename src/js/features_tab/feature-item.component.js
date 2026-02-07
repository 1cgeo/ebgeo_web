// Path: js/features_tab/feature-item.component.js

/**
 * @fileoverview Feature item rendering component.
 */

import { FEATURES_TAB_ICONS } from './features_tab.icons.js';
import {
    updateFeatureProperty,
    getFeatureById,
    getFeatureIconFromStorage,
} from '../store';
import { FeatureNavigationUtils, escapeHtml } from '../utilities';

/**
 * @typedef {Object} FeatureItemCallbacks
 * @property {Function} onFeatureClick - Called when feature is clicked
 * @property {Function} onVisibilityToggle - Called when visibility toggled
 * @property {Function} onLockToggle - Called when lock toggled
 * @property {Function} propagatePropertyToSource - Propagates property change to map source
 */

/**
 * Creates a feature item element.
 *
 * @param {Object} feature - Feature data object
 * @param {FeatureItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Feature item element
 */
export function createFeatureItem(feature, callbacks) {
    const item = document.createElement('div');
    item.className = 'feature-item';
    item.dataset.featureId = feature.id;
    item.dataset.featureType = feature.storageType;

    const typeIconPath = getFeatureIconFromStorage(feature.storageType);
    const typeIconAlt = feature.typeLabel;
    const visibilityIcon = feature.visible
        ? FEATURES_TAB_ICONS.EYE_VISIBLE
        : FEATURES_TAB_ICONS.EYE_HIDDEN;
    const visibilityTitle = feature.visible ? 'Ocultar' : 'Mostrar';
    const lockIcon = feature.locked
        ? FEATURES_TAB_ICONS.LOCK_LOCKED
        : FEATURES_TAB_ICONS.LOCK_UNLOCKED;
    const lockTitle = feature.locked ? 'Desbloquear' : 'Bloquear';

    item.innerHTML = `
        <div class="feature-main">
            <img class="feature-type-icon" src="${typeIconPath}" alt="${typeIconAlt}" />
            <div class="feature-name">${escapeHtml(feature.name)}</div>
        </div>
        <div class="feature-controls">
            <button class="visibility-toggle" title="${visibilityTitle}">
                ${visibilityIcon}
            </button>
            <button class="lock-toggle" title="${lockTitle}">
                ${lockIcon}
            </button>
        </div>
    `;

    const nameDiv = item.querySelector('.feature-name');
    nameDiv.addEventListener('click', () => callbacks.onFeatureClick(feature));

    const visibilityBtn = item.querySelector('.visibility-toggle');
    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onVisibilityToggle(feature.id, feature.storageType);
    });

    const lockBtn = item.querySelector('.lock-toggle');
    lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onLockToggle(feature.id, feature.storageType);
    });

    if (!feature.visible) {
        item.classList.add('feature-hidden');
    }
    if (feature.locked) {
        item.classList.add('feature-locked');
    }

    return item;
}

/**
 * Handles feature click: zoom + selection (checks current lock state).
 *
 * @param {Object} feature - Feature data object
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - Selection manager instance
 */
export async function handleFeatureClick(feature, map, selectionManager) {
    try {
        const currentFeature = await getFeatureById(feature.storageType, feature.id);
        const isLocked = currentFeature?.properties?.bloqueado ?? false;

        if (isLocked) {
            await FeatureNavigationUtils.zoomToFeature(feature.rawFeature, map);
            return;
        }

        await FeatureNavigationUtils.zoomAndSelectFeature(
            feature.rawFeature,
            map,
            selectionManager,
            feature.storageType,
            feature.id
        );
    } catch (error) {
        console.error('Error navigating to feature:', error);

        try {
            await FeatureNavigationUtils.zoomToFeature(feature.rawFeature, map);
        } catch (fallbackError) {
            console.error('Error in zoom fallback:', fallbackError);
        }
    }
}

/**
 * Toggles feature visibility using layer filters.
 *
 * @param {string} featureId - Feature ID
 * @param {string} featureType - Feature storage type
 * @param {Function} propagatePropertyToSource - Function to propagate to map source
 * @param {Function} updateVisibilityButton - Function to update button UI
 * @param {Function} updateItemVisualState - Function to update item visual state
 * @param {Object} selectionManager - Selection manager instance
 */
export async function toggleFeatureVisibility(
    featureId,
    featureType,
    propagatePropertyToSource,
    updateVisibilityButton,
    updateItemVisualState,
    selectionManager
) {
    const feature = await getFeatureById(featureType, featureId);
    if (!feature) return;

    const newVisibility = !(feature.properties.visivel ?? true);

    await updateFeatureProperty(featureType, featureId, 'visivel', newVisibility);

    await propagatePropertyToSource(featureType, featureId, 'visivel', newVisibility);

    updateVisibilityButton(featureId, newVisibility);

    updateItemVisualState(featureId, newVisibility, feature.properties.bloqueado ?? false);

    if (!newVisibility && selectionManager?.isFeatureSelected) {
        const selectionManagerType = FeatureNavigationUtils.mapFeatureType(featureType);
        const isSelected = selectionManager.isFeatureSelected(selectionManagerType, featureId);

        if (isSelected && selectionManager.deselectFeature) {
            selectionManager.deselectFeature(featureId, selectionManagerType);
        }
    }
}

/**
 * Toggles feature lock with propagation to map source.
 *
 * @param {string} featureId - Feature ID
 * @param {string} featureType - Feature storage type
 * @param {Function} propagatePropertyToSource - Function to propagate to map source
 * @param {Function} updateLockButton - Function to update button UI
 * @param {Function} updateItemVisualState - Function to update item visual state
 * @param {Object} selectionManager - Selection manager instance
 */
export async function toggleFeatureLock(
    featureId,
    featureType,
    propagatePropertyToSource,
    updateLockButton,
    updateItemVisualState,
    selectionManager
) {
    const feature = await getFeatureById(featureType, featureId);
    if (!feature) return;

    const newLockState = !(feature.properties.bloqueado ?? false);

    await updateFeatureProperty(featureType, featureId, 'bloqueado', newLockState);

    await propagatePropertyToSource(featureType, featureId, 'bloqueado', newLockState);

    updateLockButton(featureId, newLockState);

    updateItemVisualState(featureId, feature.properties.visivel ?? true, newLockState);

    if (newLockState && selectionManager?.isFeatureSelected) {
        const selectionManagerType = FeatureNavigationUtils.mapFeatureType(featureType);
        const isSelected = selectionManager.isFeatureSelected(selectionManagerType, featureId);

        if (isSelected && selectionManager.deselectFeature) {
            selectionManager.deselectFeature(featureId, selectionManagerType);
        }
    }
}

/**
 * Updates visibility button UI.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} featureId - Feature ID
 * @param {boolean} visible - Visibility state
 */
export function updateVisibilityButton(container, featureId, visible) {
    const btn = container.querySelector(`[data-feature-id="${featureId}"] .visibility-toggle`);
    if (btn) {
        const icon = visible ? FEATURES_TAB_ICONS.EYE_VISIBLE : FEATURES_TAB_ICONS.EYE_HIDDEN;
        const title = visible ? 'Ocultar' : 'Mostrar';
        btn.innerHTML = icon;
        btn.title = title;
    }
}

/**
 * Updates lock button UI.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} featureId - Feature ID
 * @param {boolean} locked - Lock state
 */
export function updateLockButton(container, featureId, locked) {
    const btn = container.querySelector(`[data-feature-id="${featureId}"] .lock-toggle`);
    if (btn) {
        const icon = locked ? FEATURES_TAB_ICONS.LOCK_LOCKED : FEATURES_TAB_ICONS.LOCK_UNLOCKED;
        const title = locked ? 'Desbloquear' : 'Bloquear';
        btn.innerHTML = icon;
        btn.title = title;

        const svg = btn.querySelector('svg');
        if (svg && locked) {
            svg.style.color = '#dc3545';
        } else if (svg) {
            svg.style.color = '';
        }
    }
}

/**
 * Updates item visual state (CSS classes).
 *
 * @param {HTMLElement} container - Container element
 * @param {string} featureId - Feature ID
 * @param {boolean} visible - Visibility state
 * @param {boolean} locked - Lock state
 */
export function updateItemVisualState(container, featureId, visible, locked) {
    const item = container.querySelector(`[data-feature-id="${featureId}"]`);
    if (item) {
        item.classList.remove('feature-hidden', 'feature-locked');

        if (!visible) {
            item.classList.add('feature-hidden');
        }

        if (locked) {
            item.classList.add('feature-locked');
        }
    } else {
        console.warn(`Item not found for feature: ${featureId}`);
    }
}
