// Path: js/street_view_tool/components/marker-panel-360.js

/**
 * @fileoverview Panel component for editing 360 marker properties.
 * Follows the same pattern as 3D marker panel with:
 * - Editable name (identification section)
 * - Description
 * - Photo gallery
 * - Style tabs (Marcador / Etiqueta)
 * - Location section (spherical coordinates)
 * - Save/Discard/Set Default buttons
 * - Delete button
 */

import {
    DEFAULT_MARKER_360_STYLE,
    updateMarker360,
    removeMarker360,
    addMarker360Image,
    getMarker360Images,
    removeMarker360Image
} from '../../store/index.js';
import { showSuccess, showToast, showWarning } from '../../utilities/index.js';
import { showConfirm } from '../../modals/index.js';
import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createSectionDivider
} from '../../tool_manager/helpers/index.js';

/**
 * Icons used in the component.
 */
const ICONS = {
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    CAMERA_360: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    HEADING: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>`,
    PITCH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    STYLE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>`,
    LABEL: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`
};

/**
 * Creates the content for the 360 marker panel.
 * @param {Object} marker - Marker data
 * @param {string} photoName - Photo name where marker is located
 * @param {Function} onClose - Callback when panel should close
 * @returns {Object} Object with element and cleanup function
 */
export function createMarkerPanel360Content(marker, photoName, onClose) {
    const container = document.createElement('div');
    container.className = 'marker-360-panel-content';

    // Store initial properties for discard functionality
    const initialProperties = JSON.parse(JSON.stringify(marker.properties || {}));
    const initialStyle = JSON.parse(JSON.stringify(marker.style || DEFAULT_MARKER_360_STYLE));

    // Current marker state with style defaults
    const currentMarker = {
        ...marker,
        style: { ...DEFAULT_MARKER_360_STYLE, ...(marker.style || {}) }
    };

    // Track cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section (includes description)
    buildIdentificationSection(container, currentMarker, photoName, async (updates) => {
        if (updates.properties) {
            currentMarker.properties = { ...currentMarker.properties, ...updates.properties };
            await updateMarker360(currentMarker.id, { properties: currentMarker.properties });
        }
    });

    // 2. Photo gallery section
    const photoGalleryPlaceholder = document.createElement('div');
    photoGalleryPlaceholder.className = 'photo-gallery-placeholder';
    container.appendChild(photoGalleryPlaceholder);
    buildPhotoGallerySection(photoGalleryPlaceholder, currentMarker.id, cleanupFunctions);

    // 3. Style tabs (Marcador / Etiqueta)
    buildStyleTabs(container, currentMarker, async (styleUpdates) => {
        currentMarker.style = { ...currentMarker.style, ...styleUpdates };
        await updateMarker360(currentMarker.id, { style: currentMarker.style });
    });

    // 4. Save/Discard/Set Default buttons
    buildActionButtons(container, currentMarker, initialProperties, initialStyle, onClose);

    // 5. Location section (spherical coordinates)
    const locationPlaceholder = document.createElement('div');
    locationPlaceholder.className = 'location-section-placeholder';
    container.appendChild(locationPlaceholder);
    buildLocationSection(locationPlaceholder, currentMarker, photoName);

    // 6. Delete button at the end
    buildDeleteButton(container, currentMarker, onClose);

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
 * Builds the identification section (icon, editable name, type, photo).
 */
function buildIdentificationSection(container, marker, photoName, onUpdate) {
    const section = document.createElement('div');
    section.className = 'feature-identification';

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon';
    iconContainer.innerHTML = ICONS.MARKER;

    // Info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-identification-info';

    // Editable name
    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-identification-name';
    nameDisplay.textContent = marker.properties?.nome || 'Sem nome';
    nameDisplay.title = 'Clique para editar';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-identification-name-input';
    nameInput.value = marker.properties?.nome || '';
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

        if (newName !== marker.properties?.nome) {
            onUpdate({ properties: { nome: newName } });
        }
    };

    nameInput.addEventListener('blur', saveEdit);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            nameInput.value = marker.properties?.nome || '';
            nameDisplay.style.display = 'block';
            nameInput.style.display = 'none';
        }
    });

    nameContainer.appendChild(nameDisplay);
    nameContainer.appendChild(nameInput);

    // Type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'feature-identification-type';
    typeLabel.textContent = 'Tipo: Marcador 360';

    // Photo info
    const photoLabel = document.createElement('div');
    photoLabel.className = 'feature-identification-layer';
    photoLabel.textContent = `Foto: ${photoName}`;

    // Description section
    const descriptionSection = createDescriptionSection(marker, onUpdate);

    infoContainer.appendChild(nameContainer);
    infoContainer.appendChild(typeLabel);
    infoContainer.appendChild(photoLabel);
    infoContainer.appendChild(descriptionSection);

    section.appendChild(iconContainer);
    section.appendChild(infoContainer);
    container.appendChild(section);
}

/**
 * Creates description section.
 */
function createDescriptionSection(marker, onUpdate) {
    let currentDescription = marker.properties?.descricao || '';

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
                <span>Adicionar descricao</span>
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
            editButton.title = 'Editar descricao';
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
        textarea.placeholder = 'Digite uma descricao para este marcador...';
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
 * Builds the photo gallery section for 360 markers.
 */
async function buildPhotoGallerySection(placeholder, markerId, cleanupFunctions) {
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

    async function renderImages() {
        grid.innerHTML = '';

        const images = await getMarker360Images(markerId);

        const maxVisible = 5;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = createImageCard(img, markerId, renderImages);
            grid.appendChild(card);
        });

        if (images.length <= 2) {
            const addCard = createAddImageCard(fileInput);
            grid.appendChild(addCard);
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
                    showWarning(`${file.name} excede 10MB`);
                    continue;
                }
                await addMarker360Image(markerId, file);
            }
            fileInput.value = '';
            await renderImages();
        }
    });

    addButton.addEventListener('click', () => {
        fileInput.click();
    });

    await renderImages();

    placeholder.innerHTML = '';
    placeholder.appendChild(container);

    cleanupFunctions.push(() => {});
}

/**
 * Creates an image card for the gallery.
 */
function createImageCard(imageData, markerId, onUpdate) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    img.addEventListener('click', () => {
        openImageViewer(imageData);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-photo-gallery-delete';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteBtn.title = 'Remover imagem';

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Remover esta imagem?', { destructive: true });
        if (confirmed) {
            await removeMarker360Image(markerId, imageData.id);
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
 * Builds the style tabs (Marcador / Etiqueta).
 */
function buildStyleTabs(container, marker, onStyleChange) {
    const style = marker.style;

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'feature-tabs-container';

    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'feature-tabs-buttons';

    const markerTabBtn = document.createElement('button');
    markerTabBtn.type = 'button';
    markerTabBtn.className = 'feature-tab-btn active';
    markerTabBtn.innerHTML = `${ICONS.STYLE}<span>Marcador</span>`;
    markerTabBtn.dataset.tabId = 'marker';

    const labelTabBtn = document.createElement('button');
    labelTabBtn.type = 'button';
    labelTabBtn.className = 'feature-tab-btn';
    labelTabBtn.innerHTML = `${ICONS.LABEL}<span>Etiqueta</span>`;
    labelTabBtn.dataset.tabId = 'label';

    tabButtonsContainer.appendChild(markerTabBtn);
    tabButtonsContainer.appendChild(labelTabBtn);
    tabsContainer.appendChild(tabButtonsContainer);

    const markerTabContent = document.createElement('div');
    markerTabContent.className = 'feature-tab-content active';
    markerTabContent.dataset.tabId = 'marker';

    const labelTabContent = document.createElement('div');
    labelTabContent.className = 'feature-tab-content';
    labelTabContent.dataset.tabId = 'label';

    buildMarkerStyleTab(markerTabContent, style, onStyleChange);
    buildLabelStyleTab(labelTabContent, style, onStyleChange);

    tabsContainer.appendChild(markerTabContent);
    tabsContainer.appendChild(labelTabContent);

    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (!btn) return;

        const tabId = btn.dataset.tabId;

        tabButtonsContainer.querySelectorAll('.feature-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tabId === tabId);
        });

        markerTabContent.classList.toggle('active', tabId === 'marker');
        labelTabContent.classList.toggle('active', tabId === 'label');
    });

    container.appendChild(tabsContainer);
}

/**
 * Builds the marker style tab content.
 */
function buildMarkerStyleTab(container, style, onStyleChange) {
    // Show marker toggle (to allow hiding marker and showing only label)
    const showMarkerToggle = createModernToggle({
        label: 'Mostrar Marcador',
        checked: style.showMarker !== false,
        onChange: (checked) => {
            onStyleChange({ showMarker: checked });
            toggleMarkerControls(checked);
        }
    });
    container.appendChild(showMarkerToggle);

    // Marker color picker
    const colorPicker = createModernColorPicker({
        label: 'Cor do Marcador',
        value: style.markerColor || DEFAULT_MARKER_360_STYLE.markerColor,
        onChange: (color) => onStyleChange({ markerColor: color })
    });
    container.appendChild(colorPicker);

    // Marker size slider (smaller range for 360 markers)
    const sizeSlider = createModernSlider({
        label: 'Tamanho',
        min: 4,
        max: 24,
        step: 1,
        value: style.markerSize || DEFAULT_MARKER_360_STYLE.markerSize,
        unit: 'px',
        onChange: (value) => onStyleChange({ markerSize: value })
    });
    container.appendChild(sizeSlider);

    // Marker opacity slider
    const opacitySlider = createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((style.markerOpacity !== undefined ? style.markerOpacity : 1) * 100),
        unit: '%',
        onChange: (value) => onStyleChange({ markerOpacity: value / 100 })
    });
    container.appendChild(opacitySlider);

    // Elements to toggle when showMarker changes
    const controlElements = [colorPicker, sizeSlider, opacitySlider];

    function toggleMarkerControls(enabled) {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.style.opacity = enabled ? '1' : '0.5';
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    // Initialize state
    toggleMarkerControls(style.showMarker !== false);
}

/**
 * Builds the label style tab content.
 */
function buildLabelStyleTab(container, style, onStyleChange) {
    // Show label toggle
    const showLabelToggle = createModernToggle({
        label: 'Mostrar Etiqueta',
        checked: style.showLabel !== false,
        onChange: (checked) => {
            onStyleChange({ showLabel: checked });
            toggleLabelControls(checked);
        }
    });
    container.appendChild(showLabelToggle);

    // Label text input
    const textField = createModernTextarea({
        label: 'Texto da Etiqueta',
        value: style.labelText || '',
        rows: 1,
        placeholder: 'Texto visivel no panorama',
        onChange: (value) => onStyleChange({ labelText: value })
    });
    const textarea = textField.getTextarea();
    textarea.style.minHeight = '38px';
    textarea.style.resize = 'none';
    container.appendChild(textField);

    container.appendChild(createSectionDivider('Estilo do Texto'));

    // Label color
    const labelColorPicker = createModernColorPicker({
        label: 'Cor do Texto',
        value: style.labelColor || DEFAULT_MARKER_360_STYLE.labelColor,
        onChange: (color) => onStyleChange({ labelColor: color })
    });
    container.appendChild(labelColorPicker);

    // Label size
    const labelSizeSlider = createModernSlider({
        label: 'Tamanho da Fonte',
        min: 8,
        max: 24,
        step: 1,
        value: style.labelSize || DEFAULT_MARKER_360_STYLE.labelSize,
        unit: 'px',
        onChange: (value) => onStyleChange({ labelSize: value })
    });
    container.appendChild(labelSizeSlider);

    container.appendChild(createSectionDivider('Fundo da Etiqueta'));

    // Label background color
    const bgColorPicker = createModernColorPicker({
        label: 'Cor do Fundo',
        value: style.labelBackgroundColor || DEFAULT_MARKER_360_STYLE.labelBackgroundColor,
        onChange: (color) => onStyleChange({ labelBackgroundColor: color })
    });
    container.appendChild(bgColorPicker);

    // Label background opacity
    const bgOpacitySlider = createModernSlider({
        label: 'Opacidade do Fundo',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((style.labelBackgroundOpacity !== undefined ? style.labelBackgroundOpacity : 0.9) * 100),
        unit: '%',
        onChange: (value) => onStyleChange({ labelBackgroundOpacity: value / 100 })
    });
    container.appendChild(bgOpacitySlider);

    const controlElements = [textField, labelColorPicker, labelSizeSlider, bgColorPicker, bgOpacitySlider];

    function toggleLabelControls(enabled) {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button, textarea');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.style.opacity = enabled ? '1' : '0.5';
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    }

    toggleLabelControls(style.showLabel !== false);
}

/**
 * Builds the location section (spherical coordinates).
 */
function buildLocationSection(placeholder, marker, photoName) {
    const section = document.createElement('div');
    section.className = 'feature-location-section';

    const header = document.createElement('div');
    header.className = 'feature-location-header';
    header.textContent = 'Localização';
    section.appendChild(header);

    const coordsContainer = document.createElement('div');
    coordsContainer.className = 'feature-location-coords';

    if (marker.position) {
        // Photo row
        const photoRow = document.createElement('div');
        photoRow.className = 'feature-location-row';
        const photoIcon = document.createElement('span');
        photoIcon.className = 'feature-location-icon';
        photoIcon.innerHTML = ICONS.CAMERA_360;
        const photoText = document.createElement('span');
        photoText.className = 'feature-location-text';
        photoText.textContent = `Foto: ${photoName}`;
        photoRow.appendChild(photoIcon);
        photoRow.appendChild(photoText);
        coordsContainer.appendChild(photoRow);

        // Heading row
        const headingRow = document.createElement('div');
        headingRow.className = 'feature-location-row';
        const headingIcon = document.createElement('span');
        headingIcon.className = 'feature-location-icon';
        headingIcon.innerHTML = ICONS.HEADING;
        const headingText = document.createElement('span');
        headingText.className = 'feature-location-text';
        headingText.textContent = `Direção: ${marker.position.heading?.toFixed(1) || '-'}°`;
        headingRow.appendChild(headingIcon);
        headingRow.appendChild(headingText);
        coordsContainer.appendChild(headingRow);

        // Pitch row
        const pitchRow = document.createElement('div');
        pitchRow.className = 'feature-location-row';
        const pitchIcon = document.createElement('span');
        pitchIcon.className = 'feature-location-icon';
        pitchIcon.innerHTML = ICONS.PITCH;
        const pitchText = document.createElement('span');
        pitchText.className = 'feature-location-text';
        const pitchDegrees = (marker.position.pitch * 180 / Math.PI).toFixed(1);
        pitchText.textContent = `Inclinação: ${pitchDegrees}°`;
        pitchRow.appendChild(pitchIcon);
        pitchRow.appendChild(pitchText);
        coordsContainer.appendChild(pitchRow);
    }

    section.appendChild(coordsContainer);

    placeholder.innerHTML = '';
    placeholder.appendChild(section);
}

/**
 * Builds the action buttons section (Save, Discard, Set Default).
 */
function buildActionButtons(container, marker, initialProperties, initialStyle, onClose) {
    const section = document.createElement('div');
    section.className = 'attr-modern-buttons';

    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';
    // Note: Changes are saved in real-time. This button just closes the panel.
    saveButton.addEventListener('click', () => {
        // Prevent multiple triggers by marking as already saved
        if (saveButton.dataset.saved === 'true') return;
        saveButton.dataset.saved = 'true';

        // Show success message only once
        showSuccess('Alterações salvas');

        // Close panel - use setTimeout to avoid recursion with _triggerSave
        setTimeout(() => {
            if (onClose) onClose();
        }, 0);
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        await updateMarker360(marker.id, {
            properties: initialProperties,
            style: initialStyle
        });
        if (onClose) onClose();
    });
    row.appendChild(discardButton);

    section.appendChild(row);

    const defaultButton = document.createElement('button');
    defaultButton.textContent = 'Definir como padrao';
    defaultButton.className = 'attr-modern-btn-default';
    defaultButton.type = 'button';
    defaultButton.addEventListener('click', () => {
        const styleToSave = { ...marker.style };
        localStorage.setItem('marker360_default_style', JSON.stringify(styleToSave));
        showSuccess('Estilo definido como padrao!');
    });
    section.appendChild(defaultButton);

    container.appendChild(section);
}

/**
 * Builds the delete button at the end.
 */
function buildDeleteButton(container, marker, onClose) {
    const section = document.createElement('div');
    section.className = 'feature-panel-delete-section';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-panel-delete-btn';
    deleteBtn.innerHTML = `${ICONS.TRASH}<span>Deletar</span>`;

    deleteBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm('Deletar este marcador?', {
            message: 'Esta acao nao pode ser desfeita.',
            destructive: true
        });
        if (!confirmed) return;

        try {
            await removeMarker360(marker.id);
            showSuccess('Marcador deletado!');
            if (onClose) onClose();
        } catch (error) {
            console.error('Error deleting marker:', error);
            showToast('Erro ao deletar marcador', 'error');
        }
    });

    section.appendChild(deleteBtn);
    container.appendChild(section);
}

/**
 * Injects marker panel 360 styles into the document.
 * Uses existing feature panel styles from tabbed_attribute_panel.
 */
export function injectMarkerPanel360Styles() {
    // Marker 360 panel uses existing styles from feature panel
    // No additional injection needed
}
