// Path: js/features_tab/group-item.component.js

/**
 * @fileoverview Group item rendering component.
 */

import { FEATURES_TAB_ICONS } from './features_tab.icons.js';
import {
    getMapGroups,
    updateGroupProperty,
    getCurrentMapNameSync,
    getStorageTypeFromSource,
    getFeatureIconFromStorage,
} from '../store';
import { zoomToFeature } from '../utilities';

/**
 * @typedef {Object} GroupItemCallbacks
 * @property {Function} onToggleExpansion - Called when group expanded/collapsed
 * @property {Function} onVisibilityToggle - Called when visibility toggled
 * @property {Function} onLockToggle - Called when lock toggled
 * @property {Function} onFeatureClick - Called when feature inside group is clicked
 * @property {Function} propagatePropertyToSource - Propagates property to map source
 */

/**
 * Creates a group item with its features.
 *
 * @param {Object} groupData - Group data object
 * @param {Array} features - Features in the group
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Group item element
 */
export function createGroupItem(groupData, features, callbacks) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'group-container';
    groupContainer.dataset.groupId = groupData.id;

    const groupHeader = createGroupHeader(groupData, features.length, false, features.length, callbacks);
    groupContainer.appendChild(groupHeader);

    const featuresList = createGroupFeaturesList(groupData, features, callbacks);
    groupContainer.appendChild(featuresList);

    return groupContainer;
}

/**
 * Creates a group item inside a layer (with split indicator if cross-layer).
 *
 * @param {Object} groupInfo - Group info object with groupData, features, totalInGroup
 * @param {Object} layer - Parent layer object
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Group item element
 */
export function createGroupItemInLayer(groupInfo, layer, callbacks) {
    const { groupData, features, totalInGroup } = groupInfo;
    const isSplit = features.length < totalInGroup;

    const groupContainer = document.createElement('div');
    groupContainer.className = 'group-container';
    groupContainer.dataset.groupId = groupData.id;

    const groupHeader = createGroupHeader(groupData, features.length, isSplit, totalInGroup, callbacks);
    groupContainer.appendChild(groupHeader);

    const featuresList = createGroupFeaturesList(groupData, features, callbacks);
    groupContainer.appendChild(featuresList);

    return groupContainer;
}

/**
 * Creates group header with controls.
 *
 * @param {Object} groupData - Group data object
 * @param {number} featureCount - Number of features in this layer
 * @param {boolean} isSplit - Whether group is split across layers
 * @param {number} totalInGroup - Total features in group (for cross-layer)
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Group header element
 */
function createGroupHeader(groupData, featureCount, isSplit, totalInGroup, callbacks) {
    const header = document.createElement('div');
    header.className = 'group-header';

    if (!groupData.visible) {
        header.classList.add('group-hidden');
    }
    if (groupData.locked) {
        header.classList.add('group-locked');
    }

    const expandIcon = document.createElement('div');
    expandIcon.className = 'group-expand-icon expanded';
    expandIcon.innerHTML = FEATURES_TAB_ICONS.EXPAND;

    const groupIcon = document.createElement('div');
    groupIcon.className = 'group-icon';
    groupIcon.innerHTML = FEATURES_TAB_ICONS.GROUP;

    const groupName = document.createElement('div');
    groupName.className = 'group-name';
    groupName.textContent = groupData.name;

    const groupCount = document.createElement('div');
    groupCount.className = 'group-count';
    if (isSplit) {
        groupCount.innerHTML = `<span class="group-split-indicator">${featureCount} de ${totalInGroup}</span>`;
        groupCount.title = 'Este grupo contém feições em múltiplas camadas';
    } else {
        groupCount.textContent = featureCount;
    }

    const groupControls = createGroupControls(groupData, callbacks);

    header.appendChild(expandIcon);
    header.appendChild(groupIcon);
    header.appendChild(groupName);
    header.appendChild(groupCount);
    header.appendChild(groupControls);

    header.addEventListener('click', (e) => {
        if (!e.target.closest('.group-controls')) {
            callbacks.onToggleExpansion(groupData.id);
        }
    });

    return header;
}

/**
 * Creates group-specific controls (visibility and lock).
 *
 * @param {Object} groupData - Group data object
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Controls container element
 */
function createGroupControls(groupData, callbacks) {
    const controls = document.createElement('div');
    controls.className = 'group-controls';

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'visibility-toggle';
    visibilityBtn.title = groupData.visible ? 'Ocultar grupo' : 'Mostrar grupo';
    visibilityBtn.innerHTML = groupData.visible
        ? FEATURES_TAB_ICONS.EYE_VISIBLE
        : FEATURES_TAB_ICONS.EYE_HIDDEN;

    visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onVisibilityToggle(groupData.id, groupData.visible);
    });

    const lockBtn = document.createElement('button');
    lockBtn.className = 'lock-toggle';
    lockBtn.title = groupData.locked ? 'Desbloquear grupo' : 'Bloquear grupo';
    lockBtn.innerHTML = groupData.locked
        ? FEATURES_TAB_ICONS.LOCK_LOCKED
        : FEATURES_TAB_ICONS.LOCK_UNLOCKED;

    lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onLockToggle(groupData.id, groupData.locked);
    });

    controls.appendChild(visibilityBtn);
    controls.appendChild(lockBtn);

    return controls;
}

/**
 * Creates group features list.
 *
 * @param {Object} groupData - Group data object
 * @param {Array} features - Features in the group
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Features list element
 */
function createGroupFeaturesList(groupData, features, callbacks) {
    const featuresList = document.createElement('div');
    featuresList.className = 'group-features-list expanded';

    features.forEach((feature) => {
        const featureItem = createGroupFeatureItem(feature, groupData, callbacks);
        featuresList.appendChild(featureItem);
    });

    return featuresList;
}

/**
 * Creates feature item inside group (without individual controls).
 *
 * @param {Object} feature - Feature data object
 * @param {Object} groupData - Parent group data
 * @param {GroupItemCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Feature item element
 */
function createGroupFeatureItem(feature, groupData, callbacks) {
    const item = document.createElement('div');
    item.className = 'group-feature-item';
    item.dataset.featureId = feature.id;
    item.dataset.featureType = feature.storageType;

    if (!groupData.visible) {
        item.classList.add('feature-hidden');
    }

    const main = document.createElement('div');
    main.className = 'group-feature-main';

    const typeIconPath = getFeatureIconFromStorage(feature.storageType);
    const typeIcon = document.createElement('img');
    typeIcon.className = 'group-feature-type-icon';
    typeIcon.src = typeIconPath;
    typeIcon.alt = feature.typeLabel;

    const featureName = document.createElement('div');
    featureName.className = 'group-feature-name';
    featureName.textContent = feature.name;

    main.appendChild(typeIcon);
    main.appendChild(featureName);

    main.addEventListener('click', () => callbacks.onFeatureClick(feature, groupData));

    item.appendChild(main);

    return item;
}

/**
 * Handles click on feature inside group.
 *
 * @param {Object} feature - Feature data object
 * @param {Object} groupData - Parent group data
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - Selection manager instance
 */
export async function handleGroupFeatureClick(feature, groupData, map, selectionManager) {
    try {
        if (groupData.locked) {
            await zoomToFeature(feature.rawFeature, map);
            return;
        }

        await zoomToFeature(feature.rawFeature, map);

        if (selectionManager) {
            selectionManager.deselectAllFeatures();

            for (const featureRef of groupData.features) {
                const completeFeature = await selectionManager.getCompleteFeatureFromSource(
                    featureRef.type,
                    featureRef.id
                );
                if (completeFeature) {
                    await selectionManager.toggleFeatureSelection(
                        featureRef.type,
                        featureRef.id,
                        completeFeature,
                        false
                    );
                }
            }

            selectionManager.updateUI();
        }
    } catch (error) {
        console.error('Error navigating to group feature:', error);

        try {
            await zoomToFeature(feature.rawFeature, map);
        } catch (fallbackError) {
            console.error('Error in zoom fallback:', fallbackError);
        }
    }
}

/**
 * Toggles group expansion.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} groupId - Group ID
 * @param {Function} setCollapsed - Function to persist collapsed state
 */
export function toggleGroupExpansion(container, groupId, setCollapsed) {
    const groupContainer = container.querySelector(`[data-group-id="${groupId}"]`);
    if (!groupContainer) return;

    const expandIcon = groupContainer.querySelector('.group-expand-icon');
    const featuresList = groupContainer.querySelector('.group-features-list');

    if (featuresList.classList.contains('expanded')) {
        featuresList.classList.remove('expanded');
        expandIcon.classList.remove('expanded');
        expandIcon.classList.add('collapsed');
        setCollapsed(groupId, true);
    } else {
        featuresList.classList.add('expanded');
        expandIcon.classList.remove('collapsed');
        expandIcon.classList.add('expanded');
        setCollapsed(groupId, false);
    }
}

/**
 * Toggles group visibility.
 *
 * @param {string} groupId - Group ID
 * @param {boolean} currentVisibility - Current visibility state
 * @param {Function} propagatePropertyToSource - Function to propagate to map source
 * @param {Function} updateVisualState - Function to update visual state
 */
export async function toggleGroupVisibility(
    groupId,
    currentVisibility,
    propagatePropertyToSource,
    updateVisualState
) {
    try {
        const newVisibility = !currentVisibility;

        updateGroupProperty(groupId, 'visible', newVisibility);

        const currentMapName = getCurrentMapNameSync();
        const groups = getMapGroups(currentMapName);
        const group = groups[groupId];
        if (group) {
            for (const featureRef of group.features) {
                const storageType = getStorageTypeFromSource(featureRef.type);
                if (!storageType) {
                    console.error(`Could not convert type ${featureRef.type} to storage type`);
                    continue;
                }
                await propagatePropertyToSource(storageType, featureRef.id, 'visivel', newVisibility);
            }
        }

        updateVisualState(groupId, newVisibility, currentVisibility);
    } catch (error) {
        console.error('Error changing group visibility:', error);
    }
}

/**
 * Toggles group lock.
 *
 * @param {string} groupId - Group ID
 * @param {boolean} currentLockState - Current lock state
 * @param {Function} propagatePropertyToSource - Function to propagate to map source
 * @param {Function} updateLockState - Function to update lock state
 * @param {Object} selectionManager - Selection manager instance
 */
export async function toggleGroupLock(
    groupId,
    currentLockState,
    propagatePropertyToSource,
    updateLockState,
    selectionManager
) {
    try {
        const newLockState = !currentLockState;

        updateGroupProperty(groupId, 'locked', newLockState);

        const currentMapName = getCurrentMapNameSync();
        const groups = getMapGroups(currentMapName);
        const group = groups[groupId];
        if (group) {
            for (const featureRef of group.features) {
                const storageType = getStorageTypeFromSource(featureRef.type);
                if (!storageType) {
                    console.error(`Could not convert type ${featureRef.type} to storage type`);
                    continue;
                }
                await propagatePropertyToSource(storageType, featureRef.id, 'bloqueado', newLockState);
            }
        }

        updateLockState(groupId, newLockState);

        if (newLockState && selectionManager && group) {
            group.features.forEach((featureRef) => {
                const isSelected = selectionManager.isFeatureSelected(featureRef.type, featureRef.id);

                if (isSelected) {
                    selectionManager.toggleFeatureSelection(featureRef.type, featureRef.id, null, true);
                }
            });
            selectionManager.updateUI();
        }
    } catch (error) {
        console.error('Error toggling group lock:', error);
    }
}

/**
 * Updates group visual state.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} groupId - Group ID
 * @param {boolean} visible - New visibility state
 */
export function updateGroupVisualState(container, groupId, visible) {
    const groupContainer = container.querySelector(`[data-group-id="${groupId}"]`);
    if (!groupContainer) return;

    const header = groupContainer.querySelector('.group-header');
    const visibilityBtn = groupContainer.querySelector('.visibility-toggle');
    const featureItems = groupContainer.querySelectorAll('.group-feature-item');

    if (visible) {
        header.classList.remove('group-hidden');
    } else {
        header.classList.add('group-hidden');
    }

    visibilityBtn.innerHTML = visible
        ? FEATURES_TAB_ICONS.EYE_VISIBLE
        : FEATURES_TAB_ICONS.EYE_HIDDEN;
    visibilityBtn.title = visible ? 'Ocultar grupo' : 'Mostrar grupo';

    featureItems.forEach((item) => {
        if (visible) {
            item.classList.remove('feature-hidden');
        } else {
            item.classList.add('feature-hidden');
        }
    });
}

/**
 * Updates group lock state.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} groupId - Group ID
 * @param {boolean} locked - New lock state
 */
export function updateGroupLockState(container, groupId, locked) {
    const groupContainer = container.querySelector(`[data-group-id="${groupId}"]`);
    if (!groupContainer) return;

    const header = groupContainer.querySelector('.group-header');
    const lockBtn = groupContainer.querySelector('.lock-toggle');

    if (locked) {
        header.classList.add('group-locked');
    } else {
        header.classList.remove('group-locked');
    }

    lockBtn.innerHTML = locked
        ? FEATURES_TAB_ICONS.LOCK_LOCKED
        : FEATURES_TAB_ICONS.LOCK_UNLOCKED;
    lockBtn.title = locked ? 'Desbloquear grupo' : 'Bloquear grupo';

    const svg = lockBtn.querySelector('svg');
    if (svg && locked) {
        svg.style.color = '#dc3545';
    } else if (svg) {
        svg.style.color = '';
    }
}
