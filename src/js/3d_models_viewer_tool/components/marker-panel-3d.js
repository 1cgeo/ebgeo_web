// Path: js/3d_models_viewer_tool/components/marker-panel-3d.js

/**
 * @fileoverview Panel component for editing 3D marker properties.
 * Follows the same pattern as 2D point attributes panel with:
 * - Editable name (identification section)
 * - Photo gallery
 * - Style tabs (Marcador / Etiqueta)
 * - Location section with altitude
 * - Save/Discard/Set Default buttons
 * - Delete button
 */

// Lazy-loaded tool functions to avoid static/dynamic import conflicts
let _markerTool = null;
async function getMarkerTool() {
    if (!_markerTool) {
        _markerTool = await import('../tools/marker_tool_3d.js');
    }
    return _markerTool;
}
import { DEFAULT_MARKER_STYLE, addMarkerImage, getMarkerImages, removeMarkerImage } from '../../store/index.js';
import { showSuccess, showToast } from '../../utilities/index.js';
import { showConfirm } from '../../modals/index.js';
import { formatCoordinates } from '../../utilities/coordinate_converter.js';
import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createSectionDivider
} from '../../tool_manager/helpers/index.js';
import config from '../../config.js';

/**
 * Icon for description tab.
 */
const ICON_DESCRIPTION = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

/**
 * Icons used in the component.
 */
const ICONS = {
    MARKER: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    LOCATION: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
    UTM: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    ALTITUDE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    NAVIGATE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`,
    TRASH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    EDIT: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    STYLE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>`,
    LABEL: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`
};

/**
 * Creates the content for the 3D marker panel.
 * @param {Object} marker - Marker data
 * @param {string} tilesetId - Tileset ID
 * @param {Function} onClose - Callback when panel should close
 * @returns {Object} Object with element and cleanup function
 */
export function createMarkerPanelContent(marker, tilesetId, onClose) {
    const container = document.createElement('div');
    container.className = 'marker-3d-panel-content';

    // Store initial properties for discard functionality
    const initialProperties = JSON.parse(JSON.stringify(marker.properties || {}));
    const initialStyle = JSON.parse(JSON.stringify(marker.style || DEFAULT_MARKER_STYLE));
    const initialPosition = JSON.parse(JSON.stringify(marker.position || {}));

    // Current marker state with style defaults
    const currentMarker = {
        ...marker,
        style: { ...DEFAULT_MARKER_STYLE, ...(marker.style || {}) }
    };

    // Track cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section
    buildIdentificationSection(container, currentMarker, tilesetId, async (updates) => {
        if (updates.properties) {
            currentMarker.properties = { ...currentMarker.properties, ...updates.properties };
        }
    });

    // 2. Photo gallery section (inserted after identification)
    // Create placeholder for photo gallery to maintain order
    const photoGalleryPlaceholder = document.createElement('div');
    photoGalleryPlaceholder.className = 'photo-gallery-placeholder';
    container.appendChild(photoGalleryPlaceholder);

    // Load photo gallery asynchronously
    buildPhotoGallerySection(photoGalleryPlaceholder, currentMarker.id, cleanupFunctions);

    // 3. Style tabs (Marcador / Etiqueta / Descrição)
    buildStyleTabs(container, currentMarker, async (styleUpdates) => {
        currentMarker.style = { ...currentMarker.style, ...styleUpdates };
        // Auto-save style changes
        const { updateMarkerProperties } = await getMarkerTool();
        await updateMarkerProperties(currentMarker.id, { style: currentMarker.style });
    }, async (propertyUpdates) => {
        // Callback for properties updates (description)
        currentMarker.properties = { ...currentMarker.properties, ...propertyUpdates };
        const { updateMarkerProperties } = await getMarkerTool();
        await updateMarkerProperties(currentMarker.id, { properties: currentMarker.properties });
    });

    // 4. Save/Discard/Set Default buttons (before location)
    buildActionButtons(container, currentMarker, initialProperties, initialStyle, initialPosition, onClose);

    // 5. Location section - create placeholder to maintain order
    const locationPlaceholder = document.createElement('div');
    locationPlaceholder.className = 'location-section-placeholder';
    container.appendChild(locationPlaceholder);

    // Load location section asynchronously into placeholder
    buildLocationSection(locationPlaceholder, currentMarker, async (positionUpdates) => {
        currentMarker.position = { ...currentMarker.position, ...positionUpdates };
        const { updateMarkerProperties } = await getMarkerTool();
        await updateMarkerProperties(currentMarker.id, { position: currentMarker.position });
    });

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
function buildIdentificationSection(container, marker, tilesetId, onUpdate) {
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
            const { updateMarkerProperties } = await getMarkerTool();
            await updateMarkerProperties(marker.id, { properties: { nome: newName } });
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
    typeLabel.textContent = 'Tipo: Marcador 3D';

    // Model info (instead of Layer)
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
 * Builds the photo gallery section for 3D markers.
 * Uses marker-specific image storage (not userDataManager).
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

    /**
     * Renders the images in the grid.
     */
    async function renderImages() {
        grid.innerHTML = '';

        const images = await getMarkerImages(markerId);

        // Show images (limited to 5 in compact mode + add button)
        const maxVisible = 5;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = createMarkerImageCard(img, markerId, renderImages);
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
                await addMarkerImage(markerId, file);
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

    // No cleanup needed for this implementation
    cleanupFunctions.push(() => {});
}

/**
 * Creates an image card for the marker gallery.
 */
function createMarkerImageCard(imageData, markerId, onUpdate) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    // Click to view full size
    img.addEventListener('click', () => {
        openMarkerImageViewer(imageData);
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
            await removeMarkerImage(markerId, imageData.id);
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
 * Opens full-screen image viewer for marker images.
 */
function openMarkerImageViewer(imageData) {
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
 * Builds the style tabs (Marcador / Etiqueta / Descrição) using 2D tab pattern.
 */
function buildStyleTabs(container, marker, onStyleChange, onPropertiesChange) {
    const style = marker.style;

    // Tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'feature-tabs-container';

    // Tab buttons
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

    const descTabBtn = document.createElement('button');
    descTabBtn.type = 'button';
    descTabBtn.className = 'feature-tab-btn';
    descTabBtn.innerHTML = `${ICON_DESCRIPTION}<span>Descrição</span>`;
    descTabBtn.dataset.tabId = 'description';

    tabButtonsContainer.appendChild(markerTabBtn);
    tabButtonsContainer.appendChild(labelTabBtn);
    tabButtonsContainer.appendChild(descTabBtn);
    tabsContainer.appendChild(tabButtonsContainer);

    // Tab contents
    const markerTabContent = document.createElement('div');
    markerTabContent.className = 'feature-tab-content active';
    markerTabContent.dataset.tabId = 'marker';

    const labelTabContent = document.createElement('div');
    labelTabContent.className = 'feature-tab-content';
    labelTabContent.dataset.tabId = 'label';

    const descTabContent = document.createElement('div');
    descTabContent.className = 'feature-tab-content';
    descTabContent.dataset.tabId = 'description';

    // Build marker style tab
    buildMarkerStyleTab(markerTabContent, style, onStyleChange);

    // Build label style tab
    buildLabelStyleTab(labelTabContent, style, onStyleChange);

    // Build description tab
    buildDescriptionTab(descTabContent, marker, onPropertiesChange);

    tabsContainer.appendChild(markerTabContent);
    tabsContainer.appendChild(labelTabContent);
    tabsContainer.appendChild(descTabContent);

    // Tab switching
    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (!btn) return;

        const tabId = btn.dataset.tabId;

        // Update buttons
        tabButtonsContainer.querySelectorAll('.feature-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tabId === tabId);
        });

        // Update contents
        markerTabContent.classList.toggle('active', tabId === 'marker');
        labelTabContent.classList.toggle('active', tabId === 'label');
        descTabContent.classList.toggle('active', tabId === 'description');
    });

    container.appendChild(tabsContainer);
}

/**
 * Builds the marker style tab content.
 */
function buildMarkerStyleTab(container, style, onStyleChange) {
    // Show marker toggle
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
        value: style.markerColor || DEFAULT_MARKER_STYLE.markerColor,
        onChange: (color) => onStyleChange({ markerColor: color })
    });
    container.appendChild(colorPicker);

    // Marker size slider
    const sizeSlider = createModernSlider({
        label: 'Tamanho',
        min: 16,
        max: 64,
        step: 2,
        value: style.markerSize || DEFAULT_MARKER_STYLE.markerSize,
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

    // Store control references for toggling
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

    // Label text input using the modern textarea pattern (single line)
    const textField = createModernTextarea({
        label: 'Texto da Etiqueta',
        value: style.labelText || '',
        rows: 1,
        placeholder: 'Texto visível no modelo',
        onChange: (value) => onStyleChange({ labelText: value })
    });
    // Apply single-line style
    const textarea = textField.getTextarea();
    textarea.style.minHeight = '38px';
    textarea.style.resize = 'none';
    container.appendChild(textField);

    container.appendChild(createSectionDivider('Estilo do Texto'));

    // Label color
    const labelColorPicker = createModernColorPicker({
        label: 'Cor do Texto',
        value: style.labelColor || DEFAULT_MARKER_STYLE.labelColor,
        onChange: (color) => onStyleChange({ labelColor: color })
    });
    container.appendChild(labelColorPicker);

    // Label size
    const labelSizeSlider = createModernSlider({
        label: 'Tamanho da Fonte',
        min: 8,
        max: 32,
        step: 1,
        value: style.labelSize || DEFAULT_MARKER_STYLE.labelSize,
        unit: 'px',
        onChange: (value) => onStyleChange({ labelSize: value })
    });
    container.appendChild(labelSizeSlider);

    container.appendChild(createSectionDivider('Contorno do Texto'));

    // Label outline color
    const outlineColorPicker = createModernColorPicker({
        label: 'Cor do Contorno',
        value: style.labelOutlineColor || DEFAULT_MARKER_STYLE.labelOutlineColor,
        onChange: (color) => onStyleChange({ labelOutlineColor: color })
    });
    container.appendChild(outlineColorPicker);

    // Label outline width
    const outlineWidthSlider = createModernSlider({
        label: 'Espessura do Contorno',
        min: 0,
        max: 5,
        step: 1,
        value: style.labelOutlineWidth || DEFAULT_MARKER_STYLE.labelOutlineWidth,
        unit: 'px',
        onChange: (value) => onStyleChange({ labelOutlineWidth: value })
    });
    container.appendChild(outlineWidthSlider);

    container.appendChild(createSectionDivider('Fundo da Etiqueta'));

    // Label background color
    const bgColorPicker = createModernColorPicker({
        label: 'Cor do Fundo',
        value: style.labelBackgroundColor || DEFAULT_MARKER_STYLE.labelBackgroundColor,
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

    // Store control references for toggling
    const controlElements = [textField, labelColorPicker, labelSizeSlider, outlineColorPicker, outlineWidthSlider, bgColorPicker, bgOpacitySlider];

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

    // Initialize state
    toggleLabelControls(style.showLabel !== false);
}

/**
 * Builds the description tab content with a large textarea.
 */
function buildDescriptionTab(container, marker, onPropertiesChange) {
    // Description textarea
    const descTextarea = createModernTextarea({
        label: 'Descrição do Marcador',
        value: marker.properties?.descricao || '',
        rows: 8,
        placeholder: 'Adicione uma descrição detalhada para este marcador...',
        onChange: (value) => onPropertiesChange({ descricao: value })
    });
    container.appendChild(descTextarea);
}

/**
 * Builds the location section with edit capability.
 * Replaces the placeholder content with the location section.
 */
async function buildLocationSection(placeholder, marker, onPositionUpdate) {
    const section = document.createElement('div');
    section.className = 'feature-location-section';

    // Header with edit button
    const headerWrapper = document.createElement('div');
    headerWrapper.className = 'feature-location-header-wrapper';

    const header = document.createElement('div');
    header.className = 'feature-location-header';
    header.textContent = 'Localização';
    headerWrapper.appendChild(header);

    // Edit button
    const editButton = document.createElement('button');
    editButton.className = 'feature-location-edit-btn';
    editButton.title = 'Editar coordenadas';
    editButton.innerHTML = ICONS.EDIT;

    editButton.addEventListener('click', () => {
        showCoordinateEditModal3D(marker, onPositionUpdate, section);
    });

    headerWrapper.appendChild(editButton);
    section.appendChild(headerWrapper);

    // Coordinates container
    const coordsContainer = document.createElement('div');
    coordsContainer.className = 'feature-location-coords';
    coordsContainer.id = 'marker-3d-coords-container';

    if (marker.position) {
        await renderCoordinates(coordsContainer, marker.position);
    }

    section.appendChild(coordsContainer);

    // Center on model button
    const centerButton = document.createElement('button');
    centerButton.className = 'feature-location-center-btn';
    centerButton.innerHTML = `${ICONS.NAVIGATE} Centralizar no modelo`;
    centerButton.addEventListener('click', async () => {
        const { flyToMarker } = await getMarkerTool();
        flyToMarker(marker);
    });
    section.appendChild(centerButton);

    // Replace placeholder content with section
    placeholder.innerHTML = '';
    placeholder.appendChild(section);
}

/**
 * Renders coordinates in the container.
 */
async function renderCoordinates(container, position) {
    container.innerHTML = '';

    const { longitude, latitude, height } = position;

    // Lat/Lng row
    const latLngRow = document.createElement('div');
    latLngRow.className = 'feature-location-row';

    const latLngIcon = document.createElement('span');
    latLngIcon.className = 'feature-location-icon';
    latLngIcon.innerHTML = ICONS.LOCATION;

    const latLngText = document.createElement('span');
    latLngText.className = 'feature-location-text';
    const formattedLatLng = await formatCoordinates(latitude, longitude, 'latlong');
    latLngText.textContent = formattedLatLng;
    latLngText.title = 'Clique para copiar';
    latLngText.style.cursor = 'pointer';
    latLngText.addEventListener('click', () => {
        copyToClipboard(formattedLatLng);
        showCopyFeedback(latLngText);
    });

    latLngRow.appendChild(latLngIcon);
    latLngRow.appendChild(latLngText);
    container.appendChild(latLngRow);

    // UTM row
    const utmRow = document.createElement('div');
    utmRow.className = 'feature-location-row';

    const utmIcon = document.createElement('span');
    utmIcon.className = 'feature-location-icon';
    utmIcon.innerHTML = ICONS.UTM;

    const utmText = document.createElement('span');
    utmText.className = 'feature-location-text';
    const formattedUtm = await formatCoordinates(latitude, longitude, 'utm_wgs84');
    utmText.textContent = formattedUtm;
    utmText.title = 'Clique para copiar';
    utmText.style.cursor = 'pointer';
    utmText.addEventListener('click', () => {
        copyToClipboard(formattedUtm);
        showCopyFeedback(utmText);
    });

    utmRow.appendChild(utmIcon);
    utmRow.appendChild(utmText);
    container.appendChild(utmRow);

    // Altitude row
    const altRow = document.createElement('div');
    altRow.className = 'feature-location-row';

    const altIcon = document.createElement('span');
    altIcon.className = 'feature-location-icon';
    altIcon.innerHTML = ICONS.ALTITUDE;

    const altText = document.createElement('span');
    altText.className = 'feature-location-text';
    altText.textContent = `Altitude: ${height?.toFixed(2) || '-'} m`;

    altRow.appendChild(altIcon);
    altRow.appendChild(altText);
    container.appendChild(altRow);
}

/**
 * Shows coordinate edit modal for 3D markers (with altitude).
 */
function showCoordinateEditModal3D(marker, onPositionUpdate, sectionContainer) {
    const overlay = document.createElement('div');
    overlay.className = 'coordinate-edit-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'coordinate-edit-modal';

    const { longitude, latitude, height } = marker.position;

    modal.innerHTML = `
        <div class="coordinate-edit-modal-header">
            <h3>Editar Coordenadas</h3>
            <button class="coordinate-edit-modal-close" title="Fechar">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div class="coordinate-edit-modal-content">
            <div class="coordinate-edit-field">
                <label>Latitude</label>
                <input type="number" id="edit-lat" step="0.000001" value="${latitude}" />
            </div>
            <div class="coordinate-edit-field">
                <label>Longitude</label>
                <input type="number" id="edit-lng" step="0.000001" value="${longitude}" />
            </div>
            <div class="coordinate-edit-field">
                <label>Altitude (m)</label>
                <input type="number" id="edit-alt" step="0.01" value="${height || 0}" />
            </div>
        </div>
        <div class="coordinate-edit-modal-actions">
            <button class="coordinate-edit-cancel">Cancelar</button>
            <button class="coordinate-edit-confirm">Confirmar</button>
        </div>
    `;

    const closeModal = () => overlay.remove();

    modal.querySelector('.coordinate-edit-modal-close').addEventListener('click', closeModal);
    modal.querySelector('.coordinate-edit-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    modal.querySelector('.coordinate-edit-confirm').addEventListener('click', async () => {
        const newLat = parseFloat(modal.querySelector('#edit-lat').value);
        const newLng = parseFloat(modal.querySelector('#edit-lng').value);
        const newAlt = parseFloat(modal.querySelector('#edit-alt').value);

        if (isNaN(newLat) || isNaN(newLng) || isNaN(newAlt)) {
            alert('Por favor, insira valores válidos para todas as coordenadas.');
            return;
        }

        // Validate ranges
        if (newLat < -90 || newLat > 90) {
            alert('Latitude deve estar entre -90 e 90.');
            return;
        }
        if (newLng < -180 || newLng > 180) {
            alert('Longitude deve estar entre -180 e 180.');
            return;
        }

        const newPosition = {
            longitude: newLng,
            latitude: newLat,
            height: newAlt
        };

        await onPositionUpdate(newPosition);

        // Update coordinates display
        const coordsContainer = sectionContainer.querySelector('#marker-3d-coords-container');
        if (coordsContainer) {
            await renderCoordinates(coordsContainer, newPosition);
        }

        showSuccess('Coordenadas atualizadas!');
        closeModal();
    });

    // Escape to close
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleKeydown);
        }
    };
    document.addEventListener('keydown', handleKeydown);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus first input
    setTimeout(() => {
        modal.querySelector('#edit-lat').focus();
    }, 100);
}

/**
 * Builds the action buttons section (Save, Discard, Set Default).
 */
function buildActionButtons(container, marker, initialProperties, initialStyle, initialPosition, onClose) {
    const section = document.createElement('div');
    section.className = 'attr-modern-buttons';

    // First row: Save + Discard
    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';
    saveButton.addEventListener('click', async () => {
        // Close the panel and deselect marker
        const { deselectCurrentMarker } = await getMarkerTool();
        deselectCurrentMarker();
        if (onClose) onClose();
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        // Restore initial properties, style and position
        const { updateMarkerProperties, deselectCurrentMarker } = await getMarkerTool();
        await updateMarkerProperties(marker.id, {
            properties: initialProperties,
            style: initialStyle,
            position: initialPosition
        });
        // Deselect marker and close
        deselectCurrentMarker();
        if (onClose) onClose();
    });
    row.appendChild(discardButton);

    section.appendChild(row);

    // Second row: Set as default
    const defaultButton = document.createElement('button');
    defaultButton.textContent = 'Definir como padrão';
    defaultButton.className = 'attr-modern-btn-default';
    defaultButton.type = 'button';
    defaultButton.addEventListener('click', () => {
        // Save current marker style as default for new markers
        const styleToSave = { ...marker.style };
        localStorage.setItem('marker3d_default_style', JSON.stringify(styleToSave));
        showSuccess('Estilo definido como padrão!');
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
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (!confirmed) return;

        try {
            // Images are stored in the marker itself and will be deleted with it
            const { deleteMarker } = await getMarkerTool();
            const result = await deleteMarker(marker.id);
            if (result) {
                showSuccess('Marcador deletado!');
                if (onClose) onClose();
            }
        } catch (error) {
            console.error('Error deleting marker:', error);
            showToast('Erro ao deletar marcador', 'error');
        }
    });

    section.appendChild(deleteBtn);
    container.appendChild(section);
}

/**
 * Copies text to clipboard.
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
}

/**
 * Shows copy feedback on element.
 */
function showCopyFeedback(element) {
    const originalText = element.textContent;
    element.textContent = 'Copiado!';
    element.classList.add('copied');

    setTimeout(() => {
        element.textContent = originalText;
        element.classList.remove('copied');
    }, 1500);
}

/**
 * Injects styles for the marker panel.
 */
export function injectMarkerPanelStyles() {
    const styleId = 'marker-panel-3d-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Marker Panel 3D Styles - Following 2D Pattern */
        .marker-3d-panel-content {
            padding: 0;
        }

        /* Coordinate Edit Modal */
        .coordinate-edit-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }

        .coordinate-edit-modal {
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            width: 90%;
            max-width: 400px;
            overflow: hidden;
        }

        .coordinate-edit-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .coordinate-edit-modal-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--gray-900, #111827);
        }

        .coordinate-edit-modal-close {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background: transparent;
            border: none;
            border-radius: 6px;
            color: var(--gray-500, #6b7280);
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .coordinate-edit-modal-close:hover {
            background: var(--gray-100, #f3f4f6);
            color: var(--gray-700, #374151);
        }

        .coordinate-edit-modal-content {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .coordinate-edit-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .coordinate-edit-field label {
            font-size: 13px;
            font-weight: 500;
            color: var(--gray-700, #374151);
        }

        .coordinate-edit-field input {
            padding: 10px 12px;
            border: 1px solid var(--gray-300, #d1d5db);
            border-radius: 8px;
            font-size: 14px;
            font-family: 'SF Mono', 'Consolas', monospace;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .coordinate-edit-field input:focus {
            outline: none;
            border-color: var(--primary, #16a34a);
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
        }

        .coordinate-edit-modal-actions {
            display: flex;
            gap: 8px;
            padding: 16px 20px;
            border-top: 1px solid var(--border-color, #e5e7eb);
            background: var(--gray-50, #f9fafb);
        }

        .coordinate-edit-cancel {
            flex: 1;
            padding: 10px 16px;
            background: white;
            border: 1px solid var(--gray-300, #d1d5db);
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            color: var(--gray-700, #374151);
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .coordinate-edit-cancel:hover {
            background: var(--gray-100, #f3f4f6);
        }

        .coordinate-edit-confirm {
            flex: 1;
            padding: 10px 16px;
            background: var(--primary, #16a34a);
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            color: white;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .coordinate-edit-confirm:hover {
            background: var(--primary-dark, #15803d);
        }
    `;

    document.head.appendChild(style);
}
