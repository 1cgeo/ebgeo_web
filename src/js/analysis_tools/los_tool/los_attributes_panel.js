// Path: js/analysis_tools/los_tool/los_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Format distance for display
 * @param {number} distanceMeters - Distance in meters
 * @returns {string} Formatted distance string
 */
function formatDistance(distanceMeters) {
    if (distanceMeters === undefined || distanceMeters === null) {
        return '-';
    }
    return distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(2)} km`
        : `${distanceMeters.toFixed(1)} m`;
}

/**
 * Create LOS length info section (to be displayed before tabs)
 * @param {Object} feature - LOS feature
 * @returns {HTMLElement} Info section element
 */
export function createLOSInfoSection(feature) {
    const section = document.createElement('div');
    section.className = 'los-info-section';

    // Section divider
    const divider = createSectionDivider('Informações');
    section.appendChild(divider);

    // Info container
    const container = document.createElement('div');
    container.className = 'los-length-info';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        background: #f8f9fa;
        border-radius: 6px;
        margin-bottom: 12px;
    `;

    const totalLength = feature.properties.totalLength;
    const visibleLength = feature.properties.visibleLength;
    const obstructedLength = feature.properties.obstructedLength;

    // Total length
    const totalRow = document.createElement('div');
    totalRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    totalRow.innerHTML = `
        <span style="font-size: 12px; color: #666;">Comprimento Total</span>
        <span style="font-size: 13px; font-weight: 600; color: #333;">${formatDistance(totalLength)}</span>
    `;
    container.appendChild(totalRow);

    // Visible length (green)
    const visibleRow = document.createElement('div');
    visibleRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    visibleRow.innerHTML = `
        <span style="font-size: 12px; color: #666; display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; background: #00FF00; border-radius: 2px;"></span>
            Visível
        </span>
        <span style="font-size: 13px; font-weight: 600; color: #00AA00;">${formatDistance(visibleLength)}</span>
    `;
    container.appendChild(visibleRow);

    // Obstructed length (red)
    const obstructedRow = document.createElement('div');
    obstructedRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
    obstructedRow.innerHTML = `
        <span style="font-size: 12px; color: #666; display: flex; align-items: center; gap: 6px;">
            <span style="width: 10px; height: 10px; background: #FF0000; border-radius: 2px;"></span>
            Obstruído
        </span>
        <span style="font-size: 13px; font-weight: 600; color: #CC0000;">${formatDistance(obstructedLength)}</span>
    `;
    container.appendChild(obstructedRow);

    section.appendChild(container);
    return section;
}

/**
 * Create LOS parameters panel content (for Parameters tab)
 * @param {HTMLElement} container - Container to add parameters to
 * @param {Array} selectedFeatures - Selected LOS features
 * @param {Object} losControl - LOS control instance
 */
export function addLOSParametersToPanel(container, selectedFeatures, losControl) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    // Observer height slider
    container.appendChild(createModernSlider({
        label: 'Altura do Observador',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.observerHeight ?? 1.5,
        unit: 'm',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
        }
    }));

    // Target height slider
    container.appendChild(createModernSlider({
        label: 'Altura do Alvo',
        min: 0,
        max: 50,
        step: 0.1,
        value: feature.properties.targetHeight ?? 0,
        unit: 'm',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'targetHeight', value);
        }
    }));

    // Sample points slider
    container.appendChild(createModernSlider({
        label: 'Pontos de Amostragem',
        min: 10,
        max: 500,
        step: 10,
        value: feature.properties.samplePoints ?? 100,
        unit: '',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'samplePoints', value);
        }
    }));
}

/**
 * Add LOS style attributes to the panel (for Style tab)
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected LOS features
 * @param {Object} losControl - LOS control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Only show header if not hidden (for sidebar integration)
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    losControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    uiManager.updateSelectionHighlight();
                },
                selectedFeatures,
                selectionManager,
                uiManager
            );
            panel.appendChild(headerComponent);
        } else if (selectedFeatures.length > 1) {
            const multiSelectHeader = document.createElement('div');
            multiSelectHeader.className = 'feature-header-with-options';

            const infoText = document.createElement('div');
            infoText.className = 'feature-name-wrapper';
            infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
            infoText.textContent = `${selectedFeatures.length} linhas de visada selecionadas`;

            const optionsButton = createFeatureOptionsButton(
                selectedFeatures,
                selectionManager,
                uiManager
            );

            multiSelectHeader.appendChild(infoText);
            multiSelectHeader.appendChild(optionsButton);
            panel.appendChild(multiSelectHeader);
        }
    }

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Width slider
    panel.appendChild(createModernSlider({
        label: 'Largura',
        min: 1,
        max: 30,
        step: 1,
        value: feature.properties.width || 3,
        unit: 'px',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        }
    }));

    // Options section
    panel.appendChild(createSectionDivider('Opções'));

    // Show measure toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar Medição',
        checked: feature.properties.measure || false,
        onChange: (checked) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Show profile toggle (single selection only)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Mostrar Perfil',
            checked: feature.properties.profile || false,
            onChange: async (checked) => {
                await losControl.updateFeaturesProperty(selectedFeatures, 'profile', checked);
                selectionManager.updateProfile();
            }
        }));
    }

    // Action buttons (no set default for LOS)
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: losControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null,
        hidden: options.hideButtons
    }));
}
