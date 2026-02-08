// Path: js/draw_tools/line_tool/line_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernLineStyleSelect,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add line attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected line features
 * @param {Object} lineControl - Line control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addLineAttributesToPanel(panel, selectedFeatures, lineControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    lineControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} linhas selecionadas`;

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

    // Line color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.lineColor,
        onChange: (color) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura',
        min: 1,
        max: 15,
        step: 1,
        value: feature.properties.lineWidth || 2,
        unit: 'px',
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
        }
    }));

    // Line style selector
    panel.appendChild(createModernLineStyleSelect({
        value: feature.properties.lineStyle || 'solid',
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100),
        unit: '%',
        onChange: (newValue) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));

    // Options section
    panel.appendChild(createSectionDivider('Opções'));

    // Measure toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar medição',
        checked: feature.properties.measure === true,
        onChange: (checked) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Profile toggle (single selection only)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Perfil do terreno',
            checked: feature.properties.profile === true,
            onChange: async (checked) => {
                await lineControl.updateFeaturesProperty(selectedFeatures, 'profile', checked);
                selectionManager.updateProfile();
            }
        }));
    }

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: lineControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => lineControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
