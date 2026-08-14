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

// Lazy-loaded tool functions to avoid static/dynamic import conflicts
let _viewshedTool = null;
async function getViewshedTool() {
    if (!_viewshedTool) {
        _viewshedTool = await import('../tools/viewshed_tool_3d.js');
    }
    return _viewshedTool;
}
import { addViewshedImage, getViewshedImages, removeViewshedImage } from '@store/index.js';
import { showSuccess, showToast } from '@utils/index.js';
import { deepClone } from '@utils/deep-utils.js';
import { showConfirm } from '@modals/index.js';
import { getTilesetName, createDescriptionSection, buildPhotoGallerySection } from './panel-shared-3d.js';

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
    const initialProperties = deepClone(viewshed.properties || {});

    // Current viewshed state
    const currentViewshed = { ...viewshed };

    // Track cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section (includes description)
    buildIdentificationSection(container, currentViewshed, tilesetId, async (updates) => {
        if (updates.properties) {
            currentViewshed.properties = { ...currentViewshed.properties, ...updates.properties };
            const { updateViewshedProperties } = await getViewshedTool();
            await updateViewshedProperties(currentViewshed.id, { properties: currentViewshed.properties });
        }
    });

    // 2. Parameters section (with editable observer height, horizontal angle, and distance)
    buildParametersSection(container, currentViewshed, {
        onHeightChange: async (newHeight) => {
            currentViewshed.observerHeight = newHeight;
            const { updateViewshedObserverHeight } = await getViewshedTool();
            await updateViewshedObserverHeight(currentViewshed.id, newHeight);
        },
        onHorizontalAngleChange: async (newAngle) => {
            if (!currentViewshed.parameters) currentViewshed.parameters = {};
            currentViewshed.parameters.horizontalAngle = newAngle;
            const { updateViewshedHorizontalAngle } = await getViewshedTool();
            await updateViewshedHorizontalAngle(currentViewshed.id, newAngle);
        },
        onDistanceChange: async (newDistance) => {
            if (!currentViewshed.parameters) currentViewshed.parameters = {};
            currentViewshed.parameters.distance = newDistance;
            const { updateViewshedDistance } = await getViewshedTool();
            await updateViewshedDistance(currentViewshed.id, newDistance);
        }
    }, cleanupFunctions);

    // 3. Photo gallery section
    const photoGalleryPlaceholder = document.createElement('div');
    photoGalleryPlaceholder.className = 'photo-gallery-placeholder';
    container.appendChild(photoGalleryPlaceholder);
    buildPhotoGallerySection(photoGalleryPlaceholder, currentViewshed.id, {
        add: addViewshedImage,
        getAll: getViewshedImages,
        remove: removeViewshedImage
    }, cleanupFunctions);

    // 4. Action buttons (Save/Discard)
    buildActionButtons(container, currentViewshed, initialProperties, onClose);

    // 5. Navigate button
    buildNavigateButton(container, currentViewshed);

    // 6. Delete button at the end
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
            const { updateViewshedProperties } = await getViewshedTool();
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

    const descriptionSection = createDescriptionSection(
        viewshed, onUpdate, 'Digite uma descrição para esta análise de visibilidade...'
    );

    infoContainer.appendChild(nameContainer);
    infoContainer.appendChild(typeLabel);
    infoContainer.appendChild(modelLabel);
    infoContainer.appendChild(descriptionSection);

    section.appendChild(iconContainer);
    section.appendChild(infoContainer);
    container.appendChild(section);
}

/**
 * Builds the parameters section with editable observer height, horizontal angle, and distance.
 * @param {HTMLElement} container - Container element
 * @param {Object} viewshed - Viewshed data
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onHeightChange - Callback when observer height changes
 * @param {Function} callbacks.onHorizontalAngleChange - Callback when horizontal angle changes
 * @param {Function} callbacks.onDistanceChange - Callback when distance changes
 * @param {Array} cleanupFunctions - Array to push cleanup functions into
 */
function buildParametersSection(container, viewshed, callbacks, cleanupFunctions) {
    const { onHeightChange, onHorizontalAngleChange, onDistanceChange } = callbacks;
    const section = document.createElement('div');
    section.className = 'viewshed-parameters-section';

    const header = document.createElement('div');
    header.className = 'viewshed-parameters-header';
    header.innerHTML = `${ICONS.SETTINGS}<span>Parâmetros</span>`;

    const params = viewshed.parameters || {};

    section.appendChild(header);

    // Horizontal angle (editable)
    buildEditableParam(section, {
        label: 'Campo Horizontal',
        value: params.horizontalAngle ?? 120,
        min: 1, max: 360, step: 1,
        unit: '°',
        hint: 'Abertura horizontal do campo de visão (1° a 360°)',
        parseValue: v => parseInt(v, 10),
        onChange: onHorizontalAngleChange
    }, cleanupFunctions);

    // Distance (editable)
    buildEditableParam(section, {
        label: 'Distância',
        value: params.distance ?? 500,
        min: 10, max: 5000, step: 5,
        unit: 'm',
        hint: 'Alcance máximo da análise (10 a 5000 m)',
        parseValue: v => parseInt(v, 10),
        onChange: onDistanceChange
    }, cleanupFunctions);

    // Observer height (editable)
    buildEditableParam(section, {
        label: 'Altura do Observador',
        value: viewshed.observerHeight ?? 1.5,
        min: 0, max: 1000, step: 0.1,
        unit: 'm',
        hint: 'Altura acima do ponto clicado (ex: 1.5m para pessoa, 3m para veículo)',
        parseValue: v => parseFloat(v),
        epsilon: 0.001,
        onChange: onHeightChange
    }, cleanupFunctions);

    container.appendChild(section);
}

/**
 * Builds a single editable parameter row with debounce logic.
 * @param {HTMLElement} parent - Parent element to append to
 * @param {Object} config - Parameter configuration
 * @param {Array} cleanupFunctions - Array to push cleanup functions into
 */
function buildEditableParam(parent, config, cleanupFunctions) {
    const { label, value, min, max, step, unit, hint, parseValue, epsilon, onChange } = config;

    const row = document.createElement('div');
    row.className = 'viewshed-observer-height-section';

    const labelEl = document.createElement('label');
    labelEl.className = 'viewshed-observer-height-label';
    labelEl.textContent = label;

    const inputContainer = document.createElement('div');
    inputContainer.className = 'viewshed-observer-height-input-container';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'viewshed-observer-height-input';
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;

    const unitEl = document.createElement('span');
    unitEl.className = 'viewshed-observer-height-unit';
    unitEl.textContent = unit;

    inputContainer.appendChild(input);
    inputContainer.appendChild(unitEl);

    const hintEl = document.createElement('div');
    hintEl.className = 'viewshed-observer-height-hint';
    hintEl.textContent = hint;

    row.appendChild(labelEl);
    row.appendChild(inputContainer);
    row.appendChild(hintEl);

    // Debounce logic
    let lastApplied = value;
    let debounceTimer = null;
    let isUpdating = false;

    const applyChange = async (newVal) => {
        if (isUpdating) return;
        // Compare with epsilon for floats, strict for integers
        if (epsilon ? Math.abs(newVal - lastApplied) < epsilon : newVal === lastApplied) return;

        isUpdating = true;
        try {
            if (onChange) {
                await onChange(newVal);
                lastApplied = newVal;
            }
        } catch (error) {
            console.error(`Error updating ${label}:`, error);
        } finally {
            isUpdating = false;
        }
    };

    const validate = () => {
        const parsed = parseValue(input.value);
        if (!isNaN(parsed) && parsed >= min && parsed <= max) {
            applyChange(parsed);
        }
    };

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(validate, 500);
    });

    input.addEventListener('blur', () => {
        clearTimeout(debounceTimer);
        validate();
    });

    if (cleanupFunctions) {
        cleanupFunctions.push(() => clearTimeout(debounceTimer));
    }

    parent.appendChild(row);
}

/**
 * Builds the action buttons section (Save, Discard).
 */
function buildActionButtons(container, viewshed, initialProperties, _onClose) {
    const section = document.createElement('div');
    section.className = 'attr-modern-buttons';

    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';
    saveButton.addEventListener('click', async () => {
        // Deselect viewshed - this emits VIEWSHED_3D_DESELECTED which closes panel
        const { deselectCurrentViewshed } = await getViewshedTool();
        deselectCurrentViewshed();
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        // Restore initial properties
        const { updateViewshedProperties, deselectCurrentViewshed } = await getViewshedTool();
        await updateViewshedProperties(viewshed.id, {
            properties: initialProperties
        });
        // Deselect viewshed - this emits VIEWSHED_3D_DESELECTED which closes panel
        deselectCurrentViewshed();
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
    navigateBtn.addEventListener('click', async () => {
        const { flyToViewshed } = await getViewshedTool();
        flyToViewshed(viewshed);
    });

    section.appendChild(navigateBtn);
    container.appendChild(section);
}

/**
 * Builds the delete button at the end.
 */
function buildDeleteButton(container, viewshed, _onClose) {
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
            const { deleteViewshed } = await getViewshedTool();
            const result = await deleteViewshed(viewshed.id);
            if (result) {
                showSuccess('Análise de visibilidade deletada!');
                // No onClose() here: deleteViewshed now emits VIEWSHED_3D_DESELECTED,
                // which the sidebar already turns into a panel close. Calling both
                // closes twice. This mirrors measurement-panel-3d.js, which never
                // had the extra call.
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
 * Styles now in src/css/panels-3d.css — kept as no-op for backward compatibility.
 */
export function injectViewshedPanelStyles() {}
