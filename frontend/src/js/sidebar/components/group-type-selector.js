// Path: js/sidebar/components/group-type-selector.js

/**
 * @fileoverview Group type selector component for heterogeneous groups.
 * Allows selecting a feature type within a group to edit its style.
 */

import { getFeatureIcon, getFeatureDisplayName } from '@store/index.js';

/**
 * Feature type configuration with labels.
 */
const FEATURE_TYPE_LABELS = {
    point: 'Pontos',
    line: 'Linhas',
    polygon: 'Polígonos',
    circle: 'Círculos',
    ellipse: 'Elipses',
    rectangle: 'Retângulos',
    text: 'Textos',
    image: 'Imagens',
    brush: 'Pincéis',
    arrow: 'Setas',
    boundary: 'Limites',
    occupied_front: 'Frentes Ocupadas',
    coordination_line: 'Linhas de Coordenação',
    military_symbol: 'Símbolos Militares',
    coordination_measure: 'Medidas de Coordenação',
    los: 'Linhas de Visada',
    visibility: 'Visibilidade'
};

/**
 * Gets the plural label for a feature type.
 * @param {string} type - Feature type
 * @returns {string} Plural label
 */
function getTypePluralLabel(type) {
    return FEATURE_TYPE_LABELS[type] || getFeatureDisplayName(type) || type;
}

/**
 * Creates a group type selector component.
 * Shows a list of feature types present in the group, allowing selection to edit style.
 * In readOnly mode, shows only types and counts without interaction.
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.selectedFeatures - All selected features in the group
 * @param {Function} options.onTypeSelect - Callback when a type is selected (receives type and features)
 * @param {boolean} [options.readOnly=false] - When true, shows types/counts only without editing
 * @returns {Object} Object with element and cleanup function
 */
export function createGroupTypeSelector(options) {
    const { selectedFeatures, onTypeSelect, readOnly = false } = options;

    const container = document.createElement('div');
    container.className = 'group-type-selector';

    // Group features by type
    const featuresByType = new Map();
    for (const feature of selectedFeatures) {
        const type = feature.properties?.source;
        if (!type) continue;

        if (!featuresByType.has(type)) {
            featuresByType.set(type, []);
        }
        featuresByType.get(type).push(feature);
    }

    if (!readOnly) {
        // Header (only in editable mode)
        const header = document.createElement('div');
        header.className = 'group-type-selector-header';
        header.innerHTML = `
            <span class="group-type-selector-title">Editar por tipo</span>
            <span class="group-type-selector-hint">Selecione um tipo para editar seu estilo</span>
        `;
        container.appendChild(header);
    }

    // Type list
    const typeList = document.createElement('div');
    typeList.className = 'group-type-selector-list';

    let selectedTypeButton = null;

    for (const [type, features] of featuresByType) {
        const iconPath = getFeatureIcon(type) || './images/icon_point_black.svg';
        const label = getTypePluralLabel(type);
        const count = features.length;

        if (readOnly) {
            // Read-only: non-interactive item
            const typeItem = document.createElement('div');
            typeItem.className = 'group-type-selector-item group-type-selector-item--readonly';

            typeItem.innerHTML = `
                <img src="${iconPath}" alt="${label}" class="group-type-selector-icon" />
                <span class="group-type-selector-label">${label}</span>
                <span class="group-type-selector-count">${count}</span>
            `;

            typeList.appendChild(typeItem);
        } else {
            const typeButton = document.createElement('button');
            typeButton.className = 'group-type-selector-item';
            typeButton.type = 'button';

            typeButton.innerHTML = `
                <img src="${iconPath}" alt="${label}" class="group-type-selector-icon" />
                <span class="group-type-selector-label">${label}</span>
                <span class="group-type-selector-count">${count}</span>
            `;

            typeButton.addEventListener('click', () => {
                // Update active state
                if (selectedTypeButton) {
                    selectedTypeButton.classList.remove('active');
                }
                typeButton.classList.add('active');
                selectedTypeButton = typeButton;

                // Call callback with type and its features
                if (onTypeSelect) {
                    onTypeSelect(type, features);
                }
            });

            typeList.appendChild(typeButton);
        }
    }

    container.appendChild(typeList);

    return {
        element: container,
        cleanup: () => {
            // No event listeners to clean up (they'll be GC'd with the element)
        }
    };
}
