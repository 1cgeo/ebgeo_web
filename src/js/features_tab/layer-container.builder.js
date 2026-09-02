// Path: js/features_tab/layer-container.builder.js

/**
 * @fileoverview Builds layer container elements for FeaturesTab.
 */

import { createLayerHeader, createLayerOpacityRow } from './layer-list.component.js';
import { createFeatureItem } from './feature-item.component.js';
import { createGroupItemInLayer } from './group-item.component.js';

/**
 * @typedef {Object} LayerContainerCallbacks
 * @property {Function} onLayerSelect - Called when layer is selected
 * @property {Function} onLayersChanged - Called when layers change
 * @property {Function} onRefresh - Called to refresh features
 * @property {Function} onSyncMapSources - Called to sync map sources
 * @property {Function} onToggleLayerExpansion - Called to toggle layer expansion
 * @property {Function} onToggleLayerVisibility - Called to toggle layer visibility
 * @property {Function} onToggleLayerLock - Called to toggle layer lock
 * @property {Function} onDeleteLayer - Called to delete layer
 * @property {Function} onToggleGroupExpansion - Called to toggle group expansion
 * @property {Function} onToggleGroupVisibility - Called to toggle group visibility
 * @property {Function} onToggleGroupLock - Called to toggle group lock
 * @property {Function} onGroupFeatureClick - Called when group feature is clicked
 * @property {Function} onFeatureClick - Called when feature is clicked
 * @property {Function} onToggleFeatureVisibility - Called to toggle feature visibility
 * @property {Function} onToggleFeatureLock - Called to toggle feature lock
 * @property {Function} propagatePropertyToSource - Called to propagate property
 * @property {Function} onOpenAttributeTable - Called to open attribute table for layer
 */

/**
 * Creates a layer container element with all its contents.
 * @param {Object} layerInfo - Layer information
 * @param {Object} layerInfo.layer - Layer object
 * @param {boolean} layerInfo.isActive - Whether layer is active
 * @param {Map} layerInfo.groups - Groups in layer
 * @param {Array} layerInfo.ungrouped - Ungrouped features
 * @param {number} layerInfo.featureCount - Feature count
 * @param {LayerContainerCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Layer container element
 */
export function createLayerContainer(layerInfo, callbacks) {
    const { layer, isActive, groups, ungrouped, featureCount } = layerInfo;

    const container = document.createElement('div');
    container.className = 'layer-container';
    container.dataset.layerId = layer.id;

    if (isActive) container.classList.add('layer-active');
    if (!layer.visible) container.classList.add('layer-hidden');
    if (layer.locked) container.classList.add('layer-locked');

    // Create header with callbacks for layer-list.component
    const headerCallbacks = {
        onLayerSelect: callbacks.onLayerSelect,
        onLayersChanged: callbacks.onLayersChanged,
        onRefresh: callbacks.onRefresh,
        onSyncMapSources: callbacks.onSyncMapSources,
        onOpenAttributeTable: callbacks.onOpenAttributeTable,
        onTransferLayer: callbacks.onTransferLayer,
    };

    const header = createLayerHeader(layer, isActive, featureCount, headerCallbacks);

    // Attach additional event handlers to header buttons
    attachHeaderEventHandlers(header, layer.id, callbacks);

    container.appendChild(header);

    // Inline opacity slider (always visible, separate row)
    const opacityRow = createLayerOpacityRow(layer);
    container.appendChild(opacityRow);

    // Create content container
    const content = document.createElement('div');
    content.className = 'layer-content';

    // Add groups (sorted alphabetically)
    const groupCallbacks = {
        onToggleExpansion: callbacks.onToggleGroupExpansion,
        onVisibilityToggle: callbacks.onToggleGroupVisibility,
        onLockToggle: callbacks.onToggleGroupLock,
        onFeatureClick: callbacks.onGroupFeatureClick,
        propagatePropertyToSource: callbacks.propagatePropertyToSource,
    };

    const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
        a[1].groupData.name.localeCompare(b[1].groupData.name, 'pt-BR')
    );

    sortedGroups.forEach(([_groupId, groupInfo]) => {
        const groupItem = createGroupItemInLayer(groupInfo, layer, groupCallbacks);
        content.appendChild(groupItem);
    });

    // Add ungrouped features
    const featureCallbacks = {
        onFeatureClick: callbacks.onFeatureClick,
        onVisibilityToggle: callbacks.onToggleFeatureVisibility,
        onLockToggle: callbacks.onToggleFeatureLock,
    };

    ungrouped.forEach((feature) => {
        const item = createFeatureItem(feature, featureCallbacks);
        content.appendChild(item);
    });

    // Show empty message if no features
    if (groups.size === 0 && ungrouped.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'layer-empty-message';
        emptyMessage.textContent = 'Sem feições';
        content.appendChild(emptyMessage);
    }

    container.appendChild(content);
    return container;
}

/**
 * Attaches event handlers to header buttons.
 * @param {HTMLElement} header - Header element
 * @param {string} layerId - Layer ID
 * @param {LayerContainerCallbacks} callbacks - Callback functions
 */
function attachHeaderEventHandlers(header, layerId, callbacks) {
    const expandIcon = header.querySelector('.layer-expand-icon');
    if (expandIcon) {
        expandIcon.onclick = (e) => {
            e.stopPropagation();
            callbacks.onToggleLayerExpansion(layerId);
        };
    }

    const visBtn = header.querySelector('.visibility-toggle');
    if (visBtn) {
        visBtn.onclick = (e) => {
            e.stopPropagation();
            callbacks.onToggleLayerVisibility(layerId);
        };
    }

    const lockBtn = header.querySelector('.lock-toggle');
    if (lockBtn) {
        lockBtn.onclick = (e) => {
            e.stopPropagation();
            callbacks.onToggleLayerLock(layerId);
        };
    }

    const tableBtn = header.querySelector('.table-toggle');
    if (tableBtn) {
        tableBtn.onclick = (e) => {
            e.stopPropagation();
            callbacks.onOpenAttributeTable?.(layerId);
        };
    }

    const deleteBtn = header.querySelector('.layer-delete-btn');
    if (deleteBtn) {
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            callbacks.onDeleteLayer(layerId);
        };
    }
}

/**
 * Applies collapse state to layer container.
 * @param {HTMLElement} container - Layer container
 * @param {boolean} isCollapsed - Whether layer is collapsed
 */
export function applyLayerCollapseState(container, isCollapsed) {
    const content = container.querySelector('.layer-content');
    const expandIcon = container.querySelector('.layer-expand-icon');

    if (isCollapsed) {
        if (content) content.classList.add('collapsed');
        if (expandIcon) expandIcon.classList.add('collapsed');
    } else {
        if (content) content.classList.remove('collapsed');
        if (expandIcon) expandIcon.classList.remove('collapsed');
    }
}

/**
 * Applies collapse state to group container.
 * @param {HTMLElement} container - Group container
 * @param {boolean} isCollapsed - Whether group is collapsed
 */
export function applyGroupCollapseState(container, isCollapsed) {
    const featureList = container.querySelector('.group-features-list');
    const expandIcon = container.querySelector('.group-expand-icon');

    if (isCollapsed) {
        if (featureList) featureList.classList.remove('expanded');
        if (expandIcon) {
            expandIcon.classList.remove('expanded');
            expandIcon.classList.add('collapsed');
        }
    } else {
        if (featureList) featureList.classList.add('expanded');
        if (expandIcon) {
            expandIcon.classList.add('expanded');
            expandIcon.classList.remove('collapsed');
        }
    }
}
