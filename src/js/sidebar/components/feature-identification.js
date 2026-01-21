// Path: js/sidebar/components/feature-identification.js

/**
 * @fileoverview Feature identification component for the feature panel.
 * Displays feature icon, name, type, and layer information.
 */

import { getLayers, getFeatureIcon, getFeatureDisplayName } from '../../store/index.js';
import { createFeatureOptionsButton } from '../../tool_manager/helpers/feature-header.helpers.js';

/**
 * Feature type configuration with labels.
 * Icons are loaded from existing tool icon files via getFeatureIcon.
 */
export const FEATURE_TYPE_CONFIG = {
    point: { label: 'Ponto' },
    line: { label: 'Linha' },
    polygon: { label: 'Polígono' },
    circle: { label: 'Círculo' },
    ellipse: { label: 'Elipse' },
    rectangle: { label: 'Retângulo' },
    text: { label: 'Texto' },
    image: { label: 'Imagem' },
    brush: { label: 'Pincel' },
    arrow: { label: 'Seta' },
    boundary: { label: 'Limite' },
    occupied_front: { label: 'Frente Ocupada' },
    military_symbol: { label: 'Símbolo Militar' },
    coordination_measure: { label: 'Medida de Coordenação' },
    los: { label: 'Linha de Visada' },
    visibility: { label: 'Visibilidade' }
};

/**
 * Gets feature type configuration.
 * @param {string} featureType - Feature type identifier
 * @returns {Object} Configuration object with label and iconPath
 */
export function getFeatureTypeConfig(featureType) {
    const config = FEATURE_TYPE_CONFIG[featureType];
    const iconPath = getFeatureIcon(featureType);
    const label = config?.label || getFeatureDisplayName(featureType) || 'Feição';

    return {
        label,
        iconPath: iconPath || './images/icon_point_black.svg'
    };
}

/**
 * Creates the feature identification section.
 * @param {Object} options - Configuration options
 * @param {Object} options.feature - The selected feature
 * @param {string} options.featureType - Feature type identifier
 * @param {Array} options.selectedFeatures - All selected features
 * @param {Object} options.selectionManager - SelectionManager instance
 * @param {Object} options.uiManager - UIManager instance
 * @param {Function} [options.onNameChange] - Callback when name is changed
 * @returns {HTMLElement} The identification section element
 */
export async function createFeatureIdentification(options) {
    const { feature, featureType, selectedFeatures, selectionManager, uiManager, onNameChange } = options;
    const config = getFeatureTypeConfig(featureType);

    const container = document.createElement('div');
    container.className = 'feature-identification';

    // Icon container (using tool icons as images)
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon';

    const iconImg = document.createElement('img');
    iconImg.src = config.iconPath;
    iconImg.alt = config.label;
    iconImg.className = 'feature-identification-icon-img';
    iconContainer.appendChild(iconImg);

    // Info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-identification-info';

    // Feature name (editable)
    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-identification-name';
    nameDisplay.textContent = feature.properties?.nome || 'Sem nome';
    nameDisplay.title = 'Clique para editar';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-identification-name-input';
    nameInput.value = feature.properties?.nome || '';
    nameInput.style.display = 'none';

    // Edit functionality
    nameDisplay.addEventListener('click', () => {
        nameDisplay.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.select();
    });

    const saveEdit = () => {
        const newName = nameInput.value.trim() || 'Sem nome';
        nameDisplay.textContent = newName;
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';

        if (onNameChange && newName !== feature.properties?.nome) {
            onNameChange(newName);
        }
    };

    nameInput.addEventListener('blur', saveEdit);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            nameInput.value = feature.properties?.nome || '';
            nameDisplay.style.display = 'block';
            nameInput.style.display = 'none';
        }
    });

    nameContainer.appendChild(nameDisplay);
    nameContainer.appendChild(nameInput);

    // Feature type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'feature-identification-type';
    typeLabel.textContent = `Tipo: ${config.label}`;

    // Layer info
    const layerLabel = document.createElement('div');
    layerLabel.className = 'feature-identification-layer';

    const layerId = feature.properties?.layerId || 'default';
    try {
        const layers = await getLayers();
        const layer = layers.find(l => l.id === layerId);
        layerLabel.textContent = `Camada: ${layer?.name || 'Padrão'}`;
    } catch {
        layerLabel.textContent = 'Camada: Padrão';
    }

    infoContainer.appendChild(nameContainer);
    infoContainer.appendChild(typeLabel);
    infoContainer.appendChild(layerLabel);

    container.appendChild(iconContainer);
    container.appendChild(infoContainer);

    // Options button (three vertical dots)
    if (selectedFeatures && selectionManager && uiManager) {
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        container.appendChild(optionsButton);
    }

    return container;
}

/**
 * Creates a multi-selection header when multiple features are selected.
 * @param {Object} options - Configuration options
 * @param {Array} options.selectedFeatures - Array of selected features
 * @param {string} options.featureType - Common feature type (if all same type)
 * @param {Object} options.selectionManager - SelectionManager instance
 * @param {Object} options.uiManager - UIManager instance
 * @returns {HTMLElement} The multi-selection header element
 */
export function createMultiSelectionHeader(options) {
    const { selectedFeatures, featureType, selectionManager, uiManager } = options;

    const container = document.createElement('div');
    container.className = 'feature-identification feature-identification-multi';

    // Check if all features are same type
    const types = new Set(selectedFeatures.map(f => f.properties?.source));
    const isMixedTypes = types.size > 1;

    // Icon container (use type icon if all same, otherwise grid icon)
    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon';

    if (isMixedTypes) {
        // Multi-type selection icon (grid)
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
    } else {
        const config = getFeatureTypeConfig(featureType);
        const iconImg = document.createElement('img');
        iconImg.src = config.iconPath;
        iconImg.alt = config.label;
        iconImg.className = 'feature-identification-icon-img';
        iconContainer.appendChild(iconImg);
    }

    // Info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'feature-identification-info';

    const countLabel = document.createElement('div');
    countLabel.className = 'feature-identification-name';
    countLabel.textContent = `${selectedFeatures.length} feições selecionadas`;

    const typeLabel = document.createElement('div');
    typeLabel.className = 'feature-identification-type';

    if (isMixedTypes) {
        typeLabel.textContent = 'Tipos variados';
    } else {
        const config = getFeatureTypeConfig(featureType);
        typeLabel.textContent = `Tipo: ${config.label}`;
    }

    infoContainer.appendChild(countLabel);
    infoContainer.appendChild(typeLabel);

    container.appendChild(iconContainer);
    container.appendChild(infoContainer);

    // Options button (three vertical dots)
    if (selectedFeatures && selectionManager && uiManager) {
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        container.appendChild(optionsButton);
    }

    return container;
}
