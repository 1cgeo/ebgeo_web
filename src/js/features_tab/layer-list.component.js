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
    setLayerOpacity,
    deleteLayer,
    renameLayer,
    getAllMapNamesStore,
    getCurrentMapNameSync,
    TransferMode,
} from '@store';
import { previewLayerOpacity } from '@layers/layer-opacity-applier.js';
import { showPrompt, showConfirm } from '@modals';
import { IDUtils, showError, showToast } from '@utils';

/**
 * @typedef {Object} LayerListCallbacks
 * @property {Function} onLayerSelect - Called when layer is selected
 * @property {Function} onLayersChanged - Called when layers change
 * @property {Function} onRefresh - Called to refresh the entire list
 * @property {Function} onSyncMapSources - Called to sync map sources after delete
 * @property {Function} [onTransferLayer] - Called with (layerId, mode) to move/copy a layer
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

    const tableBtn = document.createElement('button');
    tableBtn.className = 'table-toggle';
    tableBtn.innerHTML = FEATURES_TAB_ICONS.TABLE;
    tableBtn.title = 'Tabela de atributos';
    tableBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onOpenAttributeTable?.(layer.id);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'layer-delete-btn';
    deleteBtn.innerHTML = FEATURES_TAB_ICONS.DELETE;
    deleteBtn.title = 'Excluir camada';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        handleDeleteLayer(layer.id, callbacks);
    };

    // "More actions" stays drawn on a locked map, exactly like its four
    // siblings above: the lock is a reversible state, and the store operation
    // is what names it (STORE_OPERATION_BLOCKED, which the house turns into a
    // toast). Hiding the command would leave the user with no way to learn why.
    const menuBtn = document.createElement('button');
    menuBtn.className = 'layer-menu-btn';
    menuBtn.innerHTML = FEATURES_TAB_ICONS.MORE;
    menuBtn.title = 'Mais ações';
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        showLayerActionsMenu(layer, menuBtn, callbacks).catch((error) => {
            console.error('Error opening layer actions menu:', error);
            showError('Erro ao abrir o menu da camada: ' + error.message);
        });
    };

    controls.appendChild(visBtn);
    controls.appendChild(lockBtn);
    controls.appendChild(tableBtn);
    controls.appendChild(menuBtn);
    controls.appendChild(deleteBtn);

    return controls;
}

// ===== LAYER ACTIONS MENU =====

/** Module-level single-menu state (only one layer menu can be open at a time). */
let openMenuEl = null;
let openMenuAnchor = null;
let openMenuCloseHandler = null;

/**
 * Monotonic token for the map-list read the menu awaits before it can be built.
 * A second click during that window would otherwise append a second menu and
 * orphan the first, listener included.
 */
let menuRequestId = 0;

/**
 * Closes the layer actions menu and removes its outside-click listener.
 * Both go together: a menu removed without its listener leaks a document
 * handler that keeps firing for every click in the app. Exported so the tab
 * can close it when it re-renders the list under an open menu, which would
 * otherwise leave the menu floating over a header that no longer exists.
 */
export function closeLayerActionsMenu() {
    // Invalidate any map-list read still in flight. Without this, a menu
    // opened just before a re-render would still be born after it, anchored
    // to a button that has already been thrown away.
    menuRequestId++;

    if (openMenuCloseHandler) {
        document.removeEventListener('click', openMenuCloseHandler);
        openMenuCloseHandler = null;
    }
    if (openMenuAnchor) {
        openMenuAnchor.setAttribute('aria-expanded', 'false');
    }
    if (openMenuEl) {
        openMenuEl.remove();
    }
    openMenuEl = null;
    openMenuAnchor = null;
}

/**
 * Positions the menu below its anchor, flipping when it would leave the viewport.
 * Inline styles here are the runtime-computed exception: the coordinates only
 * exist at click time.
 *
 * @param {HTMLElement} menu - Menu element (already in the document)
 * @param {HTMLElement} anchorEl - Button the menu hangs from
 */
function positionLayerActionsMenu(menu, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;

    let top = rect.bottom + 4;
    let left = rect.right - menuRect.width;

    if (left < padding) {
        left = rect.left;
    }
    if (left + menuRect.width > window.innerWidth - padding) {
        left = window.innerWidth - menuRect.width - padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
        top = rect.top - menuRect.height - 4;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

/**
 * Builds one menu row.
 * @param {{icon: string, label: string, handler: Function}} item
 * @returns {HTMLElement}
 */
function createLayerMenuItem(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer-context-menu-item';
    button.setAttribute('role', 'menuitem');

    const icon = document.createElement('span');
    icon.className = 'layer-context-menu-icon';
    icon.innerHTML = item.icon;

    const label = document.createElement('span');
    label.textContent = item.label;

    button.appendChild(icon);
    button.appendChild(label);

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLayerActionsMenu();
        item.handler();
    });

    return button;
}

/**
 * Shows the "more actions" menu for a layer.
 *
 * @param {Object} layer - Layer data object
 * @param {HTMLElement} anchorEl - Button the menu hangs from
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
async function showLayerActionsMenu(layer, anchorEl, callbacks) {
    // Toggle: clicking the same button closes the menu.
    if (openMenuEl && openMenuAnchor === anchorEl) {
        closeLayerActionsMenu();
        return;
    }
    closeLayerActionsMenu();

    const requestId = ++menuRequestId;
    const allMapNames = await getAllMapNamesStore();
    // Two ways this read goes stale: another open superseded it, or the list
    // re-rendered and took our anchor out of the document. A menu hung on a
    // detached button positions itself at 0,0 and never closes on click.
    if (requestId !== menuRequestId || !anchorEl.isConnected) return;

    const currentMapName = getCurrentMapNameSync();
    const otherMaps = (allMapNames || []).filter((name) => name !== currentMapName);

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu';
    menu.setAttribute('role', 'menu');
    openMenuEl = menu;
    openMenuAnchor = anchorEl;

    if (otherMaps.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'layer-context-menu-item layer-context-menu-item--disabled';
        empty.setAttribute('aria-disabled', 'true');
        empty.textContent = 'Não há outro mapa neste atlas';
        menu.appendChild(empty);
    } else {
        menu.appendChild(createLayerMenuItem({
            icon: FEATURES_TAB_ICONS.MOVE,
            label: 'Mover para outro mapa…',
            handler: () => handleTransferLayer(layer.id, TransferMode.MOVE, callbacks)
        }));
        menu.appendChild(createLayerMenuItem({
            icon: FEATURES_TAB_ICONS.COPY,
            label: 'Copiar para outro mapa…',
            handler: () => handleTransferLayer(layer.id, TransferMode.COPY, callbacks)
        }));
    }

    document.body.appendChild(menu);
    anchorEl.setAttribute('aria-expanded', 'true');
    positionLayerActionsMenu(menu, anchorEl);

    openMenuCloseHandler = (e) => {
        if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
            closeLayerActionsMenu();
        }
    };
    setTimeout(() => {
        if (openMenuCloseHandler) {
            document.addEventListener('click', openMenuCloseHandler);
        }
    }, 0);
}

/**
 * Routes a transfer request to the tab, which owns the map sources and the
 * selection. Without a handler the command would fail silently, so say so.
 *
 * @param {string} layerId - Layer ID
 * @param {string} mode - TransferMode.MOVE or TransferMode.COPY
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
function handleTransferLayer(layerId, mode, callbacks) {
    if (typeof callbacks.onTransferLayer !== 'function') {
        showToast('Ação indisponível nesta tela.', 'warning');
        return;
    }
    callbacks.onTransferLayer(layerId, mode);
}

/**
 * Creates an inline opacity row for a layer (visible without expanding).
 *
 * @param {Object} layer - Layer data object
 * @returns {HTMLElement} Opacity row element
 */
export function createLayerOpacityRow(layer) {
    const row = document.createElement('div');
    row.className = 'layer-opacity-row';
    row.dataset.layerId = layer.id;
    row.onclick = (e) => e.stopPropagation();

    const label = document.createElement('span');
    label.className = 'layer-opacity-label';
    label.textContent = 'Opacidade';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'layer-opacity-slider';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    const initialPercent = Math.round((typeof layer.opacity === 'number' ? layer.opacity : 1) * 100);
    slider.value = String(initialPercent);
    slider.title = 'Opacidade da camada';
    slider.setAttribute('aria-label', `Opacidade da camada ${layer.name}`);

    const valueLabel = document.createElement('span');
    valueLabel.className = 'layer-opacity-value';
    valueLabel.textContent = `${initialPercent}%`;

    // During the drag only the map paint properties are touched, coalesced to one
    // update per animation frame. Going through setLayerOpacity per frame emitted
    // LAYERS_CHANGED (waking every listener, including the maps tab that reads a
    // map document per map) and wrote one sync operation to IndexedDB per frame.
    // The store is written ONCE, on `change`, at the end of the gesture.
    let rafId = null;
    let pendingOpacity = null;
    slider.addEventListener('input', () => {
        const percent = Number(slider.value);
        valueLabel.textContent = `${percent}%`;
        pendingOpacity = percent / 100;
        if (rafId === null) {
            rafId = requestAnimationFrame(() => {
                rafId = null;
                // Without a map instance (no style loaded yet) fall back to the store
                if (!previewLayerOpacity(layer.id, pendingOpacity)) {
                    setLayerOpacity(layer.id, pendingOpacity);
                }
            });
        }
    });

    slider.addEventListener('change', () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        const percent = Number(slider.value);
        valueLabel.textContent = `${percent}%`;
        setLayerOpacity(layer.id, percent / 100);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueLabel);

    return row;
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
    const message = isLastLayer
        ? 'Todas as feições desta camada serão PERMANENTEMENTE excluídas!\n\nUma nova camada "Padrão" vazia será criada automaticamente.'
        : 'Todas as feições desta camada serão PERMANENTEMENTE excluídas!';

    const confirmed = await showConfirm(`Excluir a camada "${layer.name}"?`, {
        message,
        destructive: true
    });
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
        showError('Erro ao excluir camada: ' + error.message);
    }
}

/**
 * Handles adding a new layer.
 *
 * @param {Function} createLayer - Function to create a new layer
 * @param {LayerListCallbacks} callbacks - Callback functions
 */
export async function handleAddLayer(createLayer, callbacks) {
    const existingLayers = await getLayers();
    const defaultName = IDUtils.generateUniqueLayerName(existingLayers, 'Nova Camada');
    const name = await showPrompt('Nome da nova camada:', defaultName);
    if (!name || !name.trim()) return;

    try {
        const newLayer = await createLayer(name.trim());
        if (!newLayer) return; // Guard: createLayer returns null on locked map
        await setActiveLayer(newLayer.id);
        callbacks.onRefresh();
        callbacks.onLayersChanged();
    } catch (error) {
        console.error('Error creating layer:', error);
        showError('Erro ao criar camada: ' + error.message);
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
        lockBtn.classList.toggle('lock-toggle--active', locked);
    }
}
