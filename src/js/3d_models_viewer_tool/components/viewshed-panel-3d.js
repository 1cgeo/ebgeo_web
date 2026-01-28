// Path: js/3d_models_viewer_tool/components/viewshed-panel-3d.js

/**
 * @fileoverview Panel component for editing 3D viewshed properties.
 * Simplified version of marker panel with:
 * - Editable name (identification section)
 * - Viewshed parameters (read-only)
 * - Photo gallery
 * - Description
 * - Delete button
 *
 * NO location or style sections (viewsheds have fixed visualization).
 */

import { updateViewshedProperties, deleteViewshed, flyToViewshed, deselectCurrentViewshed, updateViewshedObserverHeight } from '../tools/viewshed_tool_3d.js';
import { addViewshedImage, getViewshedImages, removeViewshedImage } from '../../store/index.js';
import { showSuccess, showToast } from '../../utilities/index.js';
import { showConfirm } from '../../modals/index.js';
import { createModernTextarea } from '../../tool_manager/helpers/index.js';
import config from '../../config.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    VIEWSHED: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    NAVIGATE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    SETTINGS: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
};

/**
 * Icon for description tab.
 */
const ICON_DESCRIPTION = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

/**
 * Creates the content for the 3D viewshed panel.
 * @param {Object} viewshed - Viewshed data
 * @param {string} tilesetId - Tileset ID
 * @param {Function} onClose - Callback when panel should close
 * @returns {Object} Object with element and cleanup function
 */
export function createViewshedPanelContent(viewshed, tilesetId, onClose) {
    const container = document.createElement('div');
    container.className = 'viewshed-3d-panel-content';

    // Store initial properties for discard functionality
    const initialProperties = JSON.parse(JSON.stringify(viewshed.properties || {}));

    // Current viewshed state
    const currentViewshed = { ...viewshed };

    // Track cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section
    buildIdentificationSection(container, currentViewshed, tilesetId, async (updates) => {
        if (updates.properties) {
            currentViewshed.properties = { ...currentViewshed.properties, ...updates.properties };
        }
    });

    // 2. Parameters section (with editable observer height)
    buildParametersSection(container, currentViewshed, async (newHeight) => {
        currentViewshed.observerHeight = newHeight;
        await updateViewshedObserverHeight(currentViewshed.id, newHeight);
    });

    // 3. Photo gallery section
    const photoGalleryPlaceholder = document.createElement('div');
    photoGalleryPlaceholder.className = 'photo-gallery-placeholder';
    container.appendChild(photoGalleryPlaceholder);
    buildPhotoGallerySection(photoGalleryPlaceholder, currentViewshed.id, cleanupFunctions);

    // 4. Description section
    buildDescriptionSection(container, currentViewshed, async (propertyUpdates) => {
        currentViewshed.properties = { ...currentViewshed.properties, ...propertyUpdates };
        await updateViewshedProperties(currentViewshed.id, { properties: currentViewshed.properties });
    });

    // 5. Action buttons (Save/Discard)
    buildActionButtons(container, currentViewshed, initialProperties, onClose);

    // 6. Navigate button
    buildNavigateButton(container, currentViewshed);

    // 7. Delete button at the end
    buildDeleteButton(container, currentViewshed, onClose);

    // Cleanup function
    const cleanup = () => {
        cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        });
    };

    return {
        element: container,
        cleanup
    };
}

/**
 * Gets tileset name by ID.
 * @param {string} tilesetId - Tileset ID
 * @returns {string} Tileset name
 */
function getTilesetName(tilesetId) {
    const tilesetConfigs = config?.tilesets || [];
    const tilesetConfig = tilesetConfigs.find(t => t.id === tilesetId);
    return tilesetConfig?.name || tilesetId || 'Modelo 3D';
}

/**
 * Builds the identification section (icon, editable name, type, model).
 */
function buildIdentificationSection(container, viewshed, tilesetId, onUpdate) {
    const section = document.createElement('div');
    section.className = 'feature-identification';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon';
    iconContainer.innerHTML = ICONS.VIEWSHED;

    // Info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-identification-info';

    // Editable name
    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-identification-name';
    nameDisplay.textContent = viewshed.properties?.nome || 'Sem nome';
    nameDisplay.title = 'Clique para editar';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-identification-name-input';
    nameInput.value = viewshed.properties?.nome || '';
    nameInput.style.display = 'none';

    // Edit functionality
    nameDisplay.addEventListener('click', () => {
        nameDisplay.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.select();
    });

    const saveEdit = async () => {
        const newName = nameInput.value.trim() || 'Sem nome';
        nameDisplay.textContent = newName;
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';

        if (newName !== viewshed.properties?.nome) {
            onUpdate({ properties: { nome: newName } });
            await updateViewshedProperties(viewshed.id, { properties: { nome: newName } });
        }
    };

    nameInput.addEventListener('blur', saveEdit);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            nameInput.value = viewshed.properties?.nome || '';
            nameDisplay.style.display = 'block';
            nameInput.style.display = 'none';
        }
    });

    nameContainer.appendChild(nameDisplay);
    nameContainer.appendChild(nameInput);

    // Type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'feature-identification-type';
    typeLabel.textContent = 'Tipo: Análise de Visibilidade';

    // Model info
    const modelLabel = document.createElement('div');
    modelLabel.className = 'feature-identification-layer';
    modelLabel.textContent = `Modelo: ${getTilesetName(tilesetId)}`;

    infoContainer.appendChild(nameContainer);
    infoContainer.appendChild(typeLabel);
    infoContainer.appendChild(modelLabel);

    section.appendChild(iconContainer);
    section.appendChild(infoContainer);
    container.appendChild(section);
}

/**
 * Builds the parameters section with editable observer height.
 * @param {HTMLElement} container - Container element
 * @param {Object} viewshed - Viewshed data
 * @param {Function} onHeightChange - Callback when observer height changes
 */
function buildParametersSection(container, viewshed, onHeightChange) {
    const section = document.createElement('div');
    section.className = 'viewshed-parameters-section';

    const header = document.createElement('div');
    header.className = 'viewshed-parameters-header';
    header.innerHTML = `${ICONS.SETTINGS}<span>Parâmetros</span>`;

    const parametersGrid = document.createElement('div');
    parametersGrid.className = 'viewshed-parameters-grid';

    const params = viewshed.parameters || {};

    // Horizontal angle
    const hAngleItem = createParameterItem('Campo Horizontal', `${params.horizontalAngle || 90}°`);
    parametersGrid.appendChild(hAngleItem);

    // Vertical angle
    const vAngleItem = createParameterItem('Campo Vertical', `${params.verticalAngle || 60}°`);
    parametersGrid.appendChild(vAngleItem);

    // Distance
    const distanceItem = createParameterItem('Distância', `${params.distance || 200} m`);
    parametersGrid.appendChild(distanceItem);

    section.appendChild(header);
    section.appendChild(parametersGrid);

    // Observer height (editable) - separate row
    const heightSection = document.createElement('div');
    heightSection.className = 'viewshed-observer-height-section';

    const heightLabel = document.createElement('label');
    heightLabel.className = 'viewshed-observer-height-label';
    heightLabel.textContent = 'Altura do Observador';

    const heightInputContainer = document.createElement('div');
    heightInputContainer.className = 'viewshed-observer-height-input-container';

    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.className = 'viewshed-observer-height-input';
    heightInput.value = viewshed.observerHeight ?? 1.5;
    heightInput.min = 0;
    heightInput.max = 1000;
    heightInput.step = 0.5;

    const heightUnit = document.createElement('span');
    heightUnit.className = 'viewshed-observer-height-unit';
    heightUnit.textContent = 'm';

    heightInputContainer.appendChild(heightInput);
    heightInputContainer.appendChild(heightUnit);

    const heightHint = document.createElement('div');
    heightHint.className = 'viewshed-observer-height-hint';
    heightHint.textContent = 'Altura acima do ponto clicado (ex: 1.5m para pessoa, 3m para veículo)';

    heightSection.appendChild(heightLabel);
    heightSection.appendChild(heightInputContainer);
    heightSection.appendChild(heightHint);

    // Track state to avoid duplicate/concurrent updates
    let lastAppliedHeight = viewshed.observerHeight ?? 1.5;
    let heightDebounceTimer = null;
    let isUpdating = false;

    const applyHeightChange = async (newHeight) => {
        // Avoid concurrent updates
        if (isUpdating) return;

        // Skip if value hasn't changed (use small epsilon for float comparison)
        if (Math.abs(newHeight - lastAppliedHeight) < 0.001) return;

        isUpdating = true;

        try {
            if (onHeightChange) {
                await onHeightChange(newHeight);
                lastAppliedHeight = newHeight;
            }
        } catch (error) {
            console.error('Error updating observer height:', error);
        } finally {
            isUpdating = false;
        }
    };

    heightInput.addEventListener('input', () => {
        clearTimeout(heightDebounceTimer);
        heightDebounceTimer = setTimeout(() => {
            const newHeight = parseFloat(heightInput.value);
            if (!isNaN(newHeight) && newHeight >= 0) {
                applyHeightChange(newHeight);
            }
        }, 500);
    });

    // Handle blur for immediate save
    heightInput.addEventListener('blur', () => {
        clearTimeout(heightDebounceTimer);
        const newHeight = parseFloat(heightInput.value);
        if (!isNaN(newHeight) && newHeight >= 0) {
            applyHeightChange(newHeight);
        }
    });

    section.appendChild(heightSection);
    container.appendChild(section);
}

/**
 * Creates a parameter item for the grid.
 */
function createParameterItem(label, value) {
    const item = document.createElement('div');
    item.className = 'viewshed-parameter-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'viewshed-parameter-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'viewshed-parameter-value';
    valueEl.textContent = value;

    item.appendChild(labelEl);
    item.appendChild(valueEl);

    return item;
}

/**
 * Builds the photo gallery section for 3D viewsheds.
 */
async function buildPhotoGallerySection(placeholder, viewshedId, cleanupFunctions) {
    const container = document.createElement('div');
    container.className = 'feature-photo-gallery';

    // Header
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

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'feature-photo-gallery-grid';
    container.appendChild(grid);

    // Counter label
    const counter = document.createElement('div');
    counter.className = 'feature-photo-gallery-counter';
    container.appendChild(counter);

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    /**
     * Renders the images in the grid.
     */
    async function renderImages() {
        grid.innerHTML = '';

        const images = await getViewshedImages(viewshedId);

        // Show images (limited to 5 in compact mode + add button)
        const maxVisible = 5;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = createImageCard(img, viewshedId, renderImages);
            grid.appendChild(card);
        });

        // Add button card (only show if 2 or fewer images)
        if (images.length <= 2) {
            const addCard = createAddImageCard(fileInput);
            grid.appendChild(addCard);
        }

        // Update counter
        if (images.length > 0) {
            counter.textContent = `${images.length} ${images.length === 1 ? 'imagem anexada' : 'imagens anexadas'}`;
            counter.style.display = 'block';
        } else {
            counter.textContent = '';
            counter.style.display = 'none';
        }
    }

    // File input handler
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files?.length) {
            for (const file of Array.from(e.target.files)) {
                if (!file.type.startsWith('image/')) continue;
                if (file.size > 10 * 1024 * 1024) {
                    alert(`${file.name} excede 10MB`);
                    continue;
                }
                await addViewshedImage(viewshedId, file);
            }
            fileInput.value = '';
            await renderImages();
        }
    });

    // Add button click
    addButton.addEventListener('click', () => {
        fileInput.click();
    });

    // Initial render
    await renderImages();

    // Replace placeholder with container
    placeholder.innerHTML = '';
    placeholder.appendChild(container);

    cleanupFunctions.push(() => {});
}

/**
 * Creates an image card for the gallery.
 */
function createImageCard(imageData, viewshedId, onUpdate) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    // Click to view full size
    img.addEventListener('click', () => {
        openImageViewer(imageData);
    });

    // Delete button (shown on hover)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-photo-gallery-delete';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteBtn.title = 'Remover imagem';

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Remover esta imagem?', { destructive: true });
        if (confirmed) {
            await removeViewshedImage(viewshedId, imageData.id);
            if (onUpdate) onUpdate();
        }
    });

    card.appendChild(img);
    card.appendChild(deleteBtn);

    return card;
}

/**
 * Creates the add button card.
 */
function createAddImageCard(fileInput) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card feature-photo-gallery-add-card';
    card.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    card.title = 'Adicionar imagem';

    card.addEventListener('click', () => {
        fileInput.click();
    });

    return card;
}

/**
 * Opens full-screen image viewer.
 */
function openImageViewer(imageData) {
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

    // Escape key to close
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

/**
 * Builds the description section.
 */
function buildDescriptionSection(container, viewshed, onPropertiesChange) {
    const section = document.createElement('div');
    section.className = 'viewshed-description-section';

    const header = document.createElement('div');
    header.className = 'viewshed-section-header';
    header.innerHTML = `${ICON_DESCRIPTION}<span>Descrição</span>`;
    section.appendChild(header);

    const descTextarea = createModernTextarea({
        label: '',
        value: viewshed.properties?.descricao || '',
        rows: 4,
        placeholder: 'Adicione uma descrição para esta análise de visibilidade...',
        onChange: (value) => onPropertiesChange({ descricao: value })
    });
    section.appendChild(descTextarea);

    container.appendChild(section);
}

/**
 * Builds the action buttons section (Save, Discard).
 */
function buildActionButtons(container, viewshed, initialProperties, onClose) {
    const section = document.createElement('div');
    section.className = 'attr-modern-buttons';

    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';
    saveButton.addEventListener('click', () => {
        deselectCurrentViewshed();
        if (onClose) onClose();
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        // Restore initial properties
        await updateViewshedProperties(viewshed.id, {
            properties: initialProperties
        });
        deselectCurrentViewshed();
        if (onClose) onClose();
    });
    row.appendChild(discardButton);

    section.appendChild(row);
    container.appendChild(section);
}

/**
 * Builds the navigate button.
 */
function buildNavigateButton(container, viewshed) {
    const section = document.createElement('div');
    section.className = 'viewshed-navigate-section';

    const navigateBtn = document.createElement('button');
    navigateBtn.className = 'feature-location-center-btn';
    navigateBtn.innerHTML = `${ICONS.NAVIGATE} Centralizar no modelo`;
    navigateBtn.addEventListener('click', () => flyToViewshed(viewshed));

    section.appendChild(navigateBtn);
    container.appendChild(section);
}

/**
 * Builds the delete button at the end.
 */
function buildDeleteButton(container, viewshed, onClose) {
    const section = document.createElement('div');
    section.className = 'feature-panel-delete-section';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-panel-delete-btn';
    deleteBtn.innerHTML = `${ICONS.TRASH}<span>Deletar</span>`;

    deleteBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm('Deletar esta análise de visibilidade?', {
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (!confirmed) return;

        try {
            const result = await deleteViewshed(viewshed.id);
            if (result) {
                showSuccess('Análise de visibilidade deletada!');
                if (onClose) onClose();
            }
        } catch (error) {
            console.error('Error deleting viewshed:', error);
            showToast('Erro ao deletar análise', 'error');
        }
    });

    section.appendChild(deleteBtn);
    container.appendChild(section);
}

/**
 * Injects styles for the viewshed panel.
 */
export function injectViewshedPanelStyles() {
    const styleId = 'viewshed-panel-3d-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Viewshed Panel 3D Styles */
        .viewshed-3d-panel-content {
            padding: 0;
        }

        /* Parameters Section */
        .viewshed-parameters-section {
            padding: 12px 16px;
            background: var(--gray-50, #f9fafb);
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .viewshed-parameters-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 500;
            color: var(--gray-500, #6b7280);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 12px;
        }

        .viewshed-parameters-header svg {
            width: 14px;
            height: 14px;
        }

        .viewshed-parameters-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }

        .viewshed-parameter-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .viewshed-parameter-label {
            font-size: 11px;
            color: var(--gray-500, #6b7280);
        }

        .viewshed-parameter-value {
            font-size: 16px;
            font-weight: 600;
            color: var(--primary, #16a34a);
            font-family: 'SF Mono', 'Consolas', monospace;
        }

        /* Description Section */
        .viewshed-description-section {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .viewshed-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            font-weight: 500;
            color: var(--gray-500, #6b7280);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }

        .viewshed-section-header svg {
            width: 14px;
            height: 14px;
        }

        /* Navigate Section */
        .viewshed-navigate-section {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        /* Observer Height Section */
        .viewshed-observer-height-section {
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--border-color, #e5e7eb);
        }

        .viewshed-observer-height-label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            color: var(--gray-700, #374151);
            margin-bottom: 6px;
        }

        .viewshed-observer-height-input-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .viewshed-observer-height-input {
            width: 100px;
            padding: 8px 12px;
            font-size: 14px;
            font-weight: 600;
            font-family: 'SF Mono', 'Consolas', monospace;
            color: var(--primary, #16a34a);
            background: white;
            border: 1px solid var(--border-color, #e5e7eb);
            border-radius: 6px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .viewshed-observer-height-input:focus {
            outline: none;
            border-color: var(--primary, #16a34a);
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
        }

        .viewshed-observer-height-input::-webkit-inner-spin-button,
        .viewshed-observer-height-input::-webkit-outer-spin-button {
            opacity: 1;
        }

        .viewshed-observer-height-unit {
            font-size: 14px;
            font-weight: 500;
            color: var(--gray-500, #6b7280);
        }

        .viewshed-observer-height-hint {
            margin-top: 6px;
            font-size: 11px;
            color: var(--gray-400, #9ca3af);
            line-height: 1.4;
        }
    `;

    document.head.appendChild(style);
}
