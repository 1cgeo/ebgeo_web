// Path: js/3d_models_viewer_tool/components/measurement-panel-3d.js

/**
 * @fileoverview Panel component for editing 3D measurement properties.
 * Simplified version of marker panel with:
 * - Editable name (identification section)
 * - Measurement result (read-only)
 * - Photo gallery
 * - Description
 * - Delete button
 *
 * NO location or style sections (measurements have fixed visualization).
 */

// Lazy-loaded tool functions to avoid static/dynamic import conflicts
let _measurementTool = null;
async function getMeasurementTool() {
    if (!_measurementTool) {
        _measurementTool = await import('../tools/measurement_tool_3d.js');
    }
    return _measurementTool;
}
import { addMeasurementImage, getMeasurementImages, removeMeasurementImage } from '../../store/index.js';
import { showSuccess, showToast } from '../../utilities/index.js';
import { showConfirm } from '../../modals/index.js';
import config from '../../config.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    DISTANCE: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`,
    AREA: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    NAVIGATE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    RULER: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`
};


/**
 * Creates the content for the 3D measurement panel.
 * @param {Object} measurement - Measurement data
 * @param {string} tilesetId - Tileset ID
 * @param {Function} onClose - Callback when panel should close
 * @returns {Object} Object with element and cleanup function
 */
export function createMeasurementPanelContent(measurement, tilesetId, onClose) {
    const container = document.createElement('div');
    container.className = 'measurement-3d-panel-content';

    // Store initial properties for discard functionality
    const initialProperties = JSON.parse(JSON.stringify(measurement.properties || {}));

    // Current measurement state
    const currentMeasurement = { ...measurement };

    // Track cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section (includes description)
    buildIdentificationSection(container, currentMeasurement, tilesetId, async (updates) => {
        if (updates.properties) {
            currentMeasurement.properties = { ...currentMeasurement.properties, ...updates.properties };
            const { updateMeasurementProperties } = await getMeasurementTool();
            await updateMeasurementProperties(currentMeasurement.id, { properties: currentMeasurement.properties });
        }
    });

    // 2. Measurement result section (read-only)
    buildResultSection(container, currentMeasurement);

    // 3. Photo gallery section
    const photoGalleryPlaceholder = document.createElement('div');
    photoGalleryPlaceholder.className = 'photo-gallery-placeholder';
    container.appendChild(photoGalleryPlaceholder);
    buildPhotoGallerySection(photoGalleryPlaceholder, currentMeasurement.id, cleanupFunctions);

    // 4. Action buttons (Save/Discard)
    buildActionButtons(container, currentMeasurement, initialProperties, onClose);

    // 5. Navigate button
    buildNavigateButton(container, currentMeasurement);

    // 6. Delete button at the end
    buildDeleteButton(container, currentMeasurement, onClose);

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
 * Gets the type label for display.
 * @param {string} type - Measurement type ('distance' or 'area')
 * @returns {string} Display label
 */
function getTypeLabel(type) {
    return type === 'area' ? 'Medição de Área' : 'Medição de Distância';
}

/**
 * Gets the icon for the measurement type.
 * @param {string} type - Measurement type
 * @returns {string} SVG icon
 */
function getTypeIcon(type) {
    return type === 'area' ? ICONS.AREA : ICONS.DISTANCE;
}

/**
 * Builds the identification section (icon, editable name, type, model).
 */
function buildIdentificationSection(container, measurement, tilesetId, onUpdate) {
    const section = document.createElement('div');
    section.className = 'feature-identification';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon';
    iconContainer.innerHTML = getTypeIcon(measurement.type);

    // Info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-identification-info';

    // Editable name
    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-identification-name';
    nameDisplay.textContent = measurement.properties?.nome || 'Sem nome';
    nameDisplay.title = 'Clique para editar';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-identification-name-input';
    nameInput.value = measurement.properties?.nome || '';
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

        if (newName !== measurement.properties?.nome) {
            onUpdate({ properties: { nome: newName } });
            const { updateMeasurementProperties } = await getMeasurementTool();
            await updateMeasurementProperties(measurement.id, { properties: { nome: newName } });
        }
    };

    nameInput.addEventListener('blur', saveEdit);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            nameInput.value = measurement.properties?.nome || '';
            nameDisplay.style.display = 'block';
            nameInput.style.display = 'none';
        }
    });

    nameContainer.appendChild(nameDisplay);
    nameContainer.appendChild(nameInput);

    // Type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'feature-identification-type';
    typeLabel.textContent = `Tipo: ${getTypeLabel(measurement.type)}`;

    // Model info
    const modelLabel = document.createElement('div');
    modelLabel.className = 'feature-identification-layer';
    modelLabel.textContent = `Modelo: ${getTilesetName(tilesetId)}`;

    // Description section (following 2D pattern)
    const descriptionSection = createDescriptionSection2D(measurement, onUpdate);

    infoContainer.appendChild(nameContainer);
    infoContainer.appendChild(typeLabel);
    infoContainer.appendChild(modelLabel);
    infoContainer.appendChild(descriptionSection);

    section.appendChild(iconContainer);
    section.appendChild(infoContainer);
    container.appendChild(section);
}

/**
 * Creates description section following the 2D pattern.
 * Shows a button to add description when empty, or the description text when filled.
 */
function createDescriptionSection2D(measurement, onUpdate) {
    let currentDescription = measurement.properties?.descricao || '';

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
        textarea.placeholder = 'Digite uma descrição para esta medição...';
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
 * Builds the measurement result section (read-only).
 */
function buildResultSection(container, measurement) {
    const section = document.createElement('div');
    section.className = 'measurement-result-section';

    const header = document.createElement('div');
    header.className = 'measurement-result-header';
    header.innerHTML = `${ICONS.RULER}<span>Resultado da Medição</span>`;

    const resultValue = document.createElement('div');
    resultValue.className = 'measurement-result-value';
    resultValue.textContent = measurement.result?.formatted || '-';

    section.appendChild(header);
    section.appendChild(resultValue);
    container.appendChild(section);
}

/**
 * Builds the photo gallery section for 3D measurements.
 */
async function buildPhotoGallerySection(placeholder, measurementId, cleanupFunctions) {
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

        const images = await getMeasurementImages(measurementId);

        // Show images (limited to 5 in compact mode + add button)
        const maxVisible = 5;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = createImageCard(img, measurementId, renderImages);
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
                await addMeasurementImage(measurementId, file);
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
function createImageCard(imageData, measurementId, onUpdate) {
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
            await removeMeasurementImage(measurementId, imageData.id);
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
 * Builds the action buttons section (Save, Discard).
 */
function buildActionButtons(container, measurement, initialProperties, _onClose) {
    const section = document.createElement('div');
    section.className = 'attr-modern-buttons';

    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';
    saveButton.addEventListener('click', async () => {
        const { deselectCurrentMeasurement } = await getMeasurementTool();
        deselectCurrentMeasurement(); // Emits MEASUREMENT_3D_DESELECTED which closes panel
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        // Restore initial properties
        const { updateMeasurementProperties, deselectCurrentMeasurement } = await getMeasurementTool();
        await updateMeasurementProperties(measurement.id, {
            properties: initialProperties
        });
        deselectCurrentMeasurement(); // Emits MEASUREMENT_3D_DESELECTED which closes panel
    });
    row.appendChild(discardButton);

    section.appendChild(row);
    container.appendChild(section);
}

/**
 * Builds the navigate button.
 */
function buildNavigateButton(container, measurement) {
    const section = document.createElement('div');
    section.className = 'measurement-navigate-section';

    const navigateBtn = document.createElement('button');
    navigateBtn.className = 'feature-location-center-btn';
    navigateBtn.innerHTML = `${ICONS.NAVIGATE} Centralizar no modelo`;
    navigateBtn.addEventListener('click', async () => {
        const { flyToMeasurement } = await getMeasurementTool();
        flyToMeasurement(measurement);
    });

    section.appendChild(navigateBtn);
    container.appendChild(section);
}

/**
 * Builds the delete button at the end.
 */
function buildDeleteButton(container, measurement, _onClose) {
    const section = document.createElement('div');
    section.className = 'feature-panel-delete-section';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-panel-delete-btn';
    deleteBtn.innerHTML = `${ICONS.TRASH}<span>Deletar</span>`;

    deleteBtn.addEventListener('click', async () => {
        const typeLabel = measurement.type === 'area' ? 'medição de área' : 'medição de distância';
        const confirmed = await showConfirm(`Deletar esta ${typeLabel}?`, {
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (!confirmed) return;

        try {
            const { deleteMeasurement } = await getMeasurementTool();
            const result = await deleteMeasurement(measurement.id);
            if (result) {
                showSuccess('Medição deletada!');
                // deleteMeasurement() already emits MEASUREMENT_3D_DESELECTED which closes panel
            }
        } catch (error) {
            console.error('Error deleting measurement:', error);
            showToast('Erro ao deletar medição', 'error');
        }
    });

    section.appendChild(deleteBtn);
    container.appendChild(section);
}

/**
 * Injects styles for the measurement panel.
 */
export function injectMeasurementPanelStyles() {
    const styleId = 'measurement-panel-3d-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Measurement Panel 3D Styles */
        .measurement-3d-panel-content {
            padding: 0;
        }

        /* Measurement Result Section */
        .measurement-result-section {
            padding: 12px 16px;
            background: var(--gray-50, #f9fafb);
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .measurement-result-header {
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

        .measurement-result-header svg {
            width: 14px;
            height: 14px;
        }

        .measurement-result-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--primary, #16a34a);
            font-family: 'SF Mono', 'Consolas', monospace;
        }

        /* Navigate Section */
        .measurement-navigate-section {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }
    `;

    document.head.appendChild(style);
}
