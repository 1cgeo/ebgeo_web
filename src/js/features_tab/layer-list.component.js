// Path: js/features_tab/layer-list.component.js

/**
 * @fileoverview Layer list rendering component.
 */

import { FEATURES_TAB_ICONS } from './features_tab.icons.js';
import {
    getLayers,
    getActiveLayerIdSync,
    setActiveLayer,
    setLayerVisibility,
    setLayerLocked,
    deleteLayer,
    renameLayer,
    reorderLayers,
    getCurrentMapNameSync,
} from '../store';
import { EventTypes } from '../events';
import { showPrompt } from '../modals/prompt.modal.js';
import { IDUtils } from '../utilities';

/**
 * @typedef {Object} LayerListCallbacks
 * @property {Function} onLayerSelect - Called when layer is selected
 * @property {Function} onLayersChanged - Called when layers change
 * @property {Function} onRefresh - Called to refresh the entire list
 * @property {Function} onSyncMapSources - Called to sync map sources after delete
 */

/**
 * Creates a layer header for the features list.
 *
 * @param {Object} layer - Layer data object
 * @param {boolean} isActive - Whether this layer is active
 * @param {number} featureCount - Number of features in the layer
 * @param {LayerListCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Layer header element
 */
export function createLayerHeader(layer, isActive, featureCount, callbacks) {
    const header = document.createElement('div');
    header.className = 'layer-header' + (isActive ? ' active' : '');
    header.dataset.layerId = layer.id;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'active-layer';
    radio.className = 'layer-radio';
    radio.checked = isActive;
    radio.title = 'Definir como camada ativa';
    radio.onclick = (e) => {
        e.stopPropagation();
        callbacks.onLayerSelect(layer.id);
    };

    const expandIcon = document.createElement('div');
    expandIcon.className = 'layer-expand-icon';
    expandIcon.innerHTML = FEATURES_TAB_ICONS.EXPAND;

    const layerName = document.createElement('div');
    layerName.className = 'layer-name';
    layerName.textContent = layer.name;
    layerName.title = 'Duplo-clique para renomear';

    layerName.ondblclick = (e) => {
        e.stopPropagation();
        startLayerRenameInline(layer.id, layerName, callbacks);
    };

    const count = document.createElement('div');
    count.className = 'layer-count';
    count.textContent = `(${featureCount})`;

    const controls = createLayerControls(layer, callbacks);

    const dragHandle = document.createElement('div');
    dragHandle.className = 'layer-drag-handle';
    dragHandle.innerHTML = FEATURES_TAB_ICONS.DRAG;
    dragHandle.title = 'Arraste para reordenar';

    header.appendChild(dragHandle);
    header.appendChild(radio);
    header.appendChild(expandIcon);
    header.appendChild(layerName);
    header.appendChild(count);
    header.appendChild(controls);

    return header;
}

/**
 * Creates layer control buttons (visibility, lock, delete).
 *
 * @param {Object} layer - Layer data object
 * @param {LayerListCallbacks} callbacks - Callback functions
 * @returns {HTMLElement} Controls container element
 */
function createLayerControls(layer, callbacks) {
    const controls = document.createElement('div');
    controls.className = 'layer-controls';

    const visBtn = document.createElement('button');
    visBtn.className = 'visibility-toggle';
    visBtn.innerHTML = layer.visible ? FEATURES_TAB_ICONS.EYE_VISIBLE : FEATURES_TAB_ICONS.EYE_HIDDEN;
    visBtn.title = layer.visible ? 'Ocultar camada' : 'Mostrar camada';
    visBtn.onclick = (e) => {
        e.stopPropagation();
        handleToggleLayerVisibility(layer.id, callbacks);
    };

    const lockBtn = document.createElement('button');
    lockBtn.className = 'lock-toggle';
    lockBtn.innerHTML = layer.locked ? FEATURES_TAB_ICONS.LOCK_LOCKED : FEATURES_TAB_ICONS.LOCK_UNLOCKED;
    lockBtn.title = layer.locked ? 'Desbloquear camada' : 'Bloquear camada';
    lockBtn.onclick = (e) => {
        e.stopPropagation();
        handleToggleLayerLock(layer.id, callbacks);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'layer-delete-btn';
    deleteBtn.innerHTML = FEATURES_TAB_ICONS.DELETE;
    deleteBtn.title = 'Excluir camada';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        handleDeleteLayer(layer.id, callbacks);
    };

    controls.appendChild(visBtn);
    controls.appendChild(lockBtn);
    controls.appendChild(deleteBtn);

    return controls;
}

/**
 * Starts inline editing of layer name.
 *
 * @param {string} layerId - Layer ID
 * @param {HTMLElement} nameElement - Element containing the layer name
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
function startLayerRenameInline(layerId, nameElement, callbacks) {
    const currentName = nameElement.textContent.replace(' ★', '').trim();

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename-input';
    input.value = currentName;
    input.style.cssText = `
        font-size: inherit;
        padding: 2px 4px;
        border: 1px solid #007bff;
        border-radius: 3px;
        outline: none;
        width: 120px;
    `;

    const originalHTML = nameElement.innerHTML;

    nameElement.innerHTML = '';
    nameElement.appendChild(input);
    input.focus();
    input.select();

    const finishEdit = async (save) => {
        const newName = input.value.trim();

        if (save && newName && newName !== currentName) {
            try {
                await renameLayer(layerId, newName);
                callbacks.onRefresh();
            } catch (error) {
                console.error('Error renaming layer:', error);
                nameElement.innerHTML = originalHTML;
            }
        } else {
            nameElement.innerHTML = originalHTML;
        }
    };

    input.onblur = () => finishEdit(true);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishEdit(false);
        }
    };
}

/**
 * Handles setting the active layer.
 *
 * @param {string} layerId - Layer ID to set as active
 * @param {LayerListCallbacks} callbacks - Callback functions
 * @param {Function} updateIndicators - Function to update visual indicators
 */
export async function handleSetActiveLayer(layerId, callbacks, updateIndicators) {
    try {
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === layerId);

        if (layer && layer.locked) {
            console.warn('Cannot activate a locked layer');
            return;
        }

        const previousActiveId = getActiveLayerIdSync();
        await setActiveLayer(layerId);

        if (updateIndicators) {
            updateIndicators(previousActiveId, layerId);
        }
    } catch (error) {
        console.error('Error setting active layer:', error);
    }
}

/**
 * Handles toggling layer visibility.
 *
 * @param {string} layerId - Layer ID to toggle
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
async function handleToggleLayerVisibility(layerId, callbacks) {
    try {
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) return;

        const newVisibility = !layer.visible;
        await setLayerVisibility(layerId, newVisibility);

        callbacks.onLayersChanged();
    } catch (error) {
        console.error('Error changing visibility:', error);
    }
}

/**
 * Handles toggling layer lock state.
 *
 * @param {string} layerId - Layer ID to toggle
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
async function handleToggleLayerLock(layerId, callbacks) {
    try {
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) return;

        const newLockState = !layer.locked;
        await setLayerLocked(layerId, newLockState);

        callbacks.onLayersChanged();
    } catch (error) {
        console.error('Error changing lock state:', error);
    }
}

/**
 * Handles deleting a layer.
 *
 * @param {string} layerId - Layer ID to delete
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
async function handleDeleteLayer(layerId, callbacks) {
    const layers = await getLayers();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    const isLastLayer = layers.length <= 1;
    const warningMessage = isLastLayer
        ? `Excluir a camada "${layer.name}"?\n\n⚠️ ATENÇÃO: Todas as feições desta camada serão PERMANENTEMENTE excluídas!\n\nUma nova camada "Padrão" vazia será criada automaticamente.`
        : `Excluir a camada "${layer.name}"?\n\n⚠️ ATENÇÃO: Todas as feições desta camada serão PERMANENTEMENTE excluídas!`;

    const confirmed = confirm(warningMessage);
    if (!confirmed) return;

    try {
        if (callbacks.onSyncMapSources) {
            await callbacks.onSyncMapSources(layerId);
        }

        const deleteResult = await deleteLayer(layerId);

        if (!deleteResult) {
            return;
        }

        const layersAfterDelete = await getLayers();

        if (isLastLayer && layersAfterDelete.length === 1 && layersAfterDelete[0].name !== 'Padrão') {
            await renameLayer(layersAfterDelete[0].id, 'Padrão');
        }

        callbacks.onRefresh();
        callbacks.onLayersChanged();
    } catch (error) {
        console.error('Error deleting layer:', error);
        alert('Erro ao excluir camada: ' + error.message);
    }
}

/**
 * Handles adding a new layer.
 *
 * @param {Function} createLayer - Function to create a new layer
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
export async function handleAddLayer(createLayer, callbacks) {
    const existingLayers = getLayers();
    const defaultName = IDUtils.generateUniqueLayerName(existingLayers, 'Nova Camada');
    const name = await showPrompt('Nome da nova camada:', defaultName);
    if (!name || !name.trim()) return;

    try {
        const newLayer = await createLayer(name.trim());
        await setActiveLayer(newLayer.id);
        callbacks.onRefresh();
        callbacks.onLayersChanged();
    } catch (error) {
        console.error('Error creating layer:', error);
        alert('Erro ao criar camada: ' + error.message);
    }
}

/**
 * Updates active layer visual indicators without full re-render.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} previousActiveId - Previous active layer ID
 * @param {string} newActiveId - New active layer ID
 */
export function updateActiveLayerIndicators(container, previousActiveId, newActiveId) {
    if (!container) return;

    if (previousActiveId) {
        const prevContainer = container.querySelector(
            `.layer-container[data-layer-id="${previousActiveId}"]`
        );
        if (prevContainer) {
            prevContainer.classList.remove('layer-active');
            const prevHeader = prevContainer.querySelector('.layer-header');
            if (prevHeader) {
                prevHeader.classList.remove('active');
            }
            const prevRadio = prevContainer.querySelector('.layer-radio');
            if (prevRadio) prevRadio.checked = false;
        }
    }

    if (newActiveId) {
        const newContainer = container.querySelector(
            `.layer-container[data-layer-id="${newActiveId}"]`
        );
        if (newContainer) {
            newContainer.classList.add('layer-active');
            const newHeader = newContainer.querySelector('.layer-header');
            if (newHeader) {
                newHeader.classList.add('active');
            }
            const newRadio = newContainer.querySelector('.layer-radio');
            if (newRadio) newRadio.checked = true;
        }
    }
}

/**
 * Updates layer visibility indicator.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - New visibility state
 */
export function updateLayerVisibilityIndicator(container, layerId, visible) {
    if (!container) return;

    const layerContainer = container.querySelector(
        `.layer-container[data-layer-id="${layerId}"]`
    );
    if (!layerContainer) return;

    if (visible) {
        layerContainer.classList.remove('layer-hidden');
    } else {
        layerContainer.classList.add('layer-hidden');
    }

    const visBtn = layerContainer.querySelector('.layer-header .visibility-toggle');
    if (visBtn) {
        visBtn.innerHTML = visible ? FEATURES_TAB_ICONS.EYE_VISIBLE : FEATURES_TAB_ICONS.EYE_HIDDEN;
        visBtn.title = visible ? 'Ocultar camada' : 'Mostrar camada';
    }
}

/**
 * Updates layer lock indicator.
 *
 * @param {HTMLElement} container - Container element
 * @param {string} layerId - Layer ID
 * @param {boolean} locked - New lock state
 */
export function updateLayerLockIndicator(container, layerId, locked) {
    if (!container) return;

    const layerContainer = container.querySelector(
        `.layer-container[data-layer-id="${layerId}"]`
    );
    if (!layerContainer) return;

    if (locked) {
        layerContainer.classList.add('layer-locked');
    } else {
        layerContainer.classList.remove('layer-locked');
    }

    const lockBtn = layerContainer.querySelector('.layer-header .lock-toggle');
    if (lockBtn) {
        lockBtn.innerHTML = locked ? FEATURES_TAB_ICONS.LOCK_LOCKED : FEATURES_TAB_ICONS.LOCK_UNLOCKED;
        lockBtn.title = locked ? 'Desbloquear camada' : 'Bloquear camada';

        const svg = lockBtn.querySelector('svg');
        if (svg) {
            svg.style.color = locked ? '#dc3545' : '';
        }
    }
}
