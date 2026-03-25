// Path: js/features_tab/sortable.handler.js

/**
 * @fileoverview Handles drag and drop functionality for layer and feature reordering.
 */

import Sortable from 'sortablejs';
import { reorderLayers, getSourceTypeFromStorage } from '@store';

/**
 * Initializes Sortable.js for layer reordering.
 * @param {HTMLElement} container - Features list container
 * @returns {Sortable|null} Sortable instance or null if container is not valid
 */
export function initLayerSortable(container) {
    if (!container) return null;

    const sortable = Sortable.create(container, {
        handle: '.layer-drag-handle',
        animation: 150,
        ghostClass: 'layer-sortable-ghost',
        chosenClass: 'layer-sortable-chosen',
        dragClass: 'layer-sortable-drag',
        onEnd: async (_evt) => {
            await handleLayerReorder(container);
        },
    });

    return sortable;
}

/**
 * Handles layer reorder after drag ends.
 * @param {HTMLElement} container - Features list container
 */
async function handleLayerReorder(container) {
    const layerContainers = container.querySelectorAll('.layer-container');
    const newOrder = Array.from(layerContainers)
        .map((el) => el.dataset.layerId)
        .filter(Boolean);

    try {
        await reorderLayers(newOrder);
    } catch (error) {
        console.error('Error reordering layers:', error);
    }
}

/**
 * Initializes Sortable.js for feature drag-and-drop between layers.
 * Supports both individual features (.feature-item) and groups (.group-container).
 * @param {HTMLElement} layerContent - The .layer-content element inside a layer container
 * @param {Function} onMoveFeatures - Callback(featureRefs, targetLayerId) to persist the move
 * @returns {Sortable|null} Sortable instance or null
 */
export function initFeatureSortable(layerContent, onMoveFeatures) {
    if (!layerContent) return null;

    return Sortable.create(layerContent, {
        group: 'features',
        handle: '.feature-drag-handle',
        animation: 150,
        ghostClass: 'feature-sortable-ghost',
        chosenClass: 'feature-sortable-chosen',
        dragClass: 'feature-sortable-drag',
        draggable: '.feature-item, .group-container',
        onEnd: async (evt) => {
            if (evt.from === evt.to) return;

            const item = evt.item;
            const targetLayerContainer = evt.to.closest('.layer-container');
            const targetLayerId = targetLayerContainer?.dataset.layerId;
            if (!targetLayerId) return;

            const featureRefs = collectFeatureRefs(item);
            if (featureRefs.length === 0) return;

            try {
                await onMoveFeatures(featureRefs, targetLayerId);
            } catch (error) {
                console.error('Error moving feature between layers:', error);
            }
        },
    });
}

/**
 * Collects feature references from a dragged element.
 * For a .feature-item, returns one ref. For a .group-container, returns all child refs.
 * DOM dataset stores storageType (plural, e.g. "points"); moveFeaturesToLayer
 * expects source type (singular, e.g. "point"), so we convert here.
 * @param {HTMLElement} item - Dragged DOM element
 * @returns {Array<{type: string, id: string}>}
 */
function collectFeatureRefs(item) {
    if (item.classList.contains('group-container')) {
        const children = item.querySelectorAll('[data-feature-id][data-feature-type]');
        return Array.from(children)
            .map(el => {
                const sourceType = getSourceTypeFromStorage(el.dataset.featureType);
                return { type: sourceType, id: el.dataset.featureId };
            })
            .filter(ref => ref.type && ref.id);
    }

    const featureId = item.dataset.featureId;
    const featureType = item.dataset.featureType;
    if (!featureId || !featureType) return [];
    const sourceType = getSourceTypeFromStorage(featureType);
    return [{ type: sourceType, id: featureId }];
}

/**
 * Destroys Sortable instance if it exists.
 * @param {Sortable|null} sortableInstance - Sortable instance to destroy
 */
export function destroySortable(sortableInstance) {
    if (sortableInstance) {
        sortableInstance.destroy();
    }
}
