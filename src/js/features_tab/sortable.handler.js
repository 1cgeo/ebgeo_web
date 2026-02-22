// Path: js/features_tab/sortable.handler.js

/**
 * @fileoverview Handles drag and drop functionality for layer reordering.
 */

import Sortable from 'sortablejs';
import { reorderLayers } from '../store';

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
 * Destroys Sortable instance if it exists.
 * @param {Sortable|null} sortableInstance - Sortable instance to destroy
 */
export function destroySortable(sortableInstance) {
    if (sortableInstance) {
        sortableInstance.destroy();
    }
}
