// Path: js/3d_models_viewer_tool/components/panel-shared-3d.js

/**
 * @fileoverview Shared UI building blocks for 3D feature panels.
 * Provides reusable components used by marker, measurement, and viewshed panels:
 * - Description section (add/edit/display)
 * - Photo gallery (grid, add, delete, viewer)
 * - Tileset name lookup
 */

import { showToast } from '@utils/index.js';
import { showConfirm } from '@modals/index.js';
import config from '@js/config.js';

/**
 * Gets tileset name by ID from config.
 * @param {string} tilesetId - Tileset ID
 * @returns {string} Tileset name or fallback
 */
export function getTilesetName(tilesetId) {
    const tilesetConfigs = config?.tilesets || [];
    const tilesetConfig = tilesetConfigs.find(t => t.id === tilesetId);
    return tilesetConfig?.name || tilesetId || 'Modelo 3D';
}

/**
 * Creates an editable description section following the 2D pattern.
 * Shows a button to add description when empty, or the description text when filled.
 * @param {Object} feature - Feature data with properties.descricao
 * @param {Function} onUpdate - Callback with { properties: { descricao } }
 * @param {string} [placeholder='Digite uma descrição...'] - Textarea placeholder
 * @returns {HTMLElement} Description section element
 */
export function createDescriptionSection(feature, onUpdate, placeholder = 'Digite uma descrição...') {
    let currentDescription = feature.properties?.descricao || '';

    const section = document.createElement('div');
    section.className = 'feature-description-section';

    const displayContainer = document.createElement('div');
    displayContainer.className = 'feature-description-display';

    const editContainer = document.createElement('div');
    editContainer.className = 'feature-description-edit';
    editContainer.style.display = 'none';

    function renderDisplay() {
        displayContainer.innerHTML = '';

        if (!currentDescription) {
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'feature-description-add-btn';
            addButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Adicionar descrição</span>
            `;
            addButton.addEventListener('click', enterEditMode);
            displayContainer.appendChild(addButton);
        } else {
            const textWrapper = document.createElement('div');
            textWrapper.className = 'feature-description-text-wrapper';

            const descText = document.createElement('div');
            descText.className = 'feature-description-text';
            descText.textContent = currentDescription;
            descText.title = 'Clique para editar';
            descText.addEventListener('click', enterEditMode);

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'feature-description-edit-btn';
            editButton.title = 'Editar descrição';
            editButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            editButton.addEventListener('click', enterEditMode);

            textWrapper.appendChild(descText);
            textWrapper.appendChild(editButton);
            displayContainer.appendChild(textWrapper);
        }
    }

    function renderEdit() {
        editContainer.innerHTML = '';

        const textarea = document.createElement('textarea');
        textarea.className = 'feature-description-textarea';
        textarea.value = currentDescription;
        textarea.placeholder = placeholder;
        textarea.rows = 4;

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'feature-description-buttons';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'feature-description-save-btn';
        saveButton.textContent = 'Salvar';
        saveButton.addEventListener('click', () => saveDescription(textarea.value));

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'feature-description-cancel-btn';
        cancelButton.textContent = 'Cancelar';
        cancelButton.addEventListener('click', exitEditMode);

        buttonsContainer.appendChild(cancelButton);
        buttonsContainer.appendChild(saveButton);

        editContainer.appendChild(textarea);
        editContainer.appendChild(buttonsContainer);

        setTimeout(() => textarea.focus(), 0);
    }

    function enterEditMode() {
        displayContainer.style.display = 'none';
        editContainer.style.display = 'block';
        renderEdit();
    }

    function exitEditMode() {
        editContainer.style.display = 'none';
        displayContainer.style.display = 'block';
        renderDisplay();
    }

    function saveDescription(newValue) {
        const trimmedValue = newValue.trim();
        currentDescription = trimmedValue;
        onUpdate({ properties: { descricao: trimmedValue } });
        exitEditMode();
    }

    renderDisplay();

    section.appendChild(displayContainer);
    section.appendChild(editContainer);

    return section;
}

/**
 * Builds a photo gallery section for 3D features.
 * @param {HTMLElement} placeholder - Placeholder element to replace
 * @param {string} featureId - Feature ID for image operations
 * @param {Object} imageOps - Image operations { add, getAll, remove }
 * @param {Function} imageOps.add - (featureId, file) => Promise
 * @param {Function} imageOps.getAll - (featureId) => Promise<Array>
 * @param {Function} imageOps.remove - (featureId, imageId) => Promise
 * @param {Array} [cleanupFunctions] - Array to push cleanup functions into
 */
export async function buildPhotoGallerySection(placeholder, featureId, imageOps, _cleanupFunctions) {
    const container = document.createElement('div');
    container.className = 'feature-photo-gallery';

    const header = document.createElement('div');
    header.className = 'feature-photo-gallery-header';

    const title = document.createElement('span');
    title.className = 'feature-photo-gallery-title';
    title.textContent = 'Fotos / Imagens';

    const addButton = document.createElement('button');
    addButton.className = 'feature-photo-gallery-add-btn';
    addButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar
    `;

    header.appendChild(title);
    header.appendChild(addButton);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'feature-photo-gallery-grid';
    container.appendChild(grid);

    const counter = document.createElement('div');
    counter.className = 'feature-photo-gallery-counter';
    container.appendChild(counter);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    async function renderImages() {
        grid.innerHTML = '';

        const images = await imageOps.getAll(featureId);
        const maxVisible = 5;
        const visibleImages = images.slice(0, maxVisible);

        for (const img of visibleImages) {
            grid.appendChild(createImageCard(img, featureId, imageOps.remove, renderImages));
        }

        if (images.length <= 2) {
            grid.appendChild(createAddImageCard(fileInput));
        }

        if (images.length > 0) {
            counter.textContent = `${images.length} ${images.length === 1 ? 'imagem anexada' : 'imagens anexadas'}`;
            counter.style.display = 'block';
        } else {
            counter.textContent = '';
            counter.style.display = 'none';
        }
    }

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files?.length) {
            for (const file of Array.from(e.target.files)) {
                if (!file.type.startsWith('image/')) continue;
                if (file.size > 10 * 1024 * 1024) {
                    showToast(`${file.name} excede 10MB`, 'error');
                    continue;
                }
                await imageOps.add(featureId, file);
            }
            fileInput.value = '';
            await renderImages();
        }
    });

    addButton.addEventListener('click', () => fileInput.click());

    await renderImages();

    placeholder.innerHTML = '';
    placeholder.appendChild(container);
}

/**
 * Creates an image card for the photo gallery.
 * @param {Object} imageData - Image data with thumbnail, data, name, id
 * @param {string} featureId - Feature ID for removal
 * @param {Function} removeFn - (featureId, imageId) => Promise
 * @param {Function} onUpdate - Callback to refresh gallery
 * @returns {HTMLElement} Image card element
 */
function createImageCard(imageData, featureId, removeFn, onUpdate) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';
    img.addEventListener('click', () => openImageViewer(imageData));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-photo-gallery-delete';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteBtn.title = 'Remover imagem';

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Remover esta imagem?', { destructive: true });
        if (confirmed) {
            await removeFn(featureId, imageData.id);
            if (onUpdate) onUpdate();
        }
    });

    card.appendChild(img);
    card.appendChild(deleteBtn);

    return card;
}

/**
 * Creates the "add image" button card.
 * @param {HTMLInputElement} fileInput - Hidden file input element
 * @returns {HTMLElement} Add card element
 */
function createAddImageCard(fileInput) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card feature-photo-gallery-add-card';
    card.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    card.title = 'Adicionar imagem';
    card.addEventListener('click', () => fileInput.click());

    return card;
}

/**
 * Opens a full-screen image viewer overlay.
 * @param {Object} imageData - Image data with data and name properties
 */
export function openImageViewer(imageData) {
    const overlay = document.createElement('div');
    overlay.className = 'feature-photo-viewer-overlay';

    const viewer = document.createElement('div');
    viewer.className = 'feature-photo-viewer';

    const img = document.createElement('img');
    img.src = imageData.data;
    img.alt = imageData.name || 'Imagem';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'feature-photo-viewer-close';
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.title = 'Fechar';

    const closeViewer = () => overlay.remove();

    closeBtn.addEventListener('click', closeViewer);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeViewer();
    });

    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            closeViewer();
            document.removeEventListener('keydown', handleKeydown);
        }
    };
    document.addEventListener('keydown', handleKeydown);

    viewer.appendChild(img);
    viewer.appendChild(closeBtn);
    overlay.appendChild(viewer);
    document.body.appendChild(overlay);
}
