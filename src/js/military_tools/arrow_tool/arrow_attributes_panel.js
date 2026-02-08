// Path: js/military_tools/arrow_tool/arrow_attributes_panel.js

import {
    createModernSlider,
    createModernNumericInput,
    createModernColorPicker,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Create and populate arrow attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected arrow features
 * @param {Object} arrowControl - Arrow control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager, options = {}) {
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
                    arrowControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} setas selecionadas`;

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

    // Fill color picker
    panel.appendChild(createModernColorPicker({
        label: 'Preenchimento',
        value: feature.properties.fillColor,
        onChange: (color) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    }));

    // Line color picker
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor,
        onChange: (color) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Helper function for default values
    const setDefaultIfMissing = (value, defaultValue) => {
        return (value !== null && value !== undefined) ? value : defaultValue;
    };

    // Fill opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(setDefaultIfMissing(feature.properties.fillOpacity, 0.8) * 100),
        unit: '%',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value / 100);
        }
    }));

    // Line width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura da Borda',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 3,
        unit: 'px',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    }));

    // Geometry section
    panel.appendChild(createSectionDivider('Geometria'));

    // Width input
    panel.appendChild(createModernNumericInput({
        label: 'Largura',
        min: 10,
        max: 10000,
        step: 1,
        value: Math.round(feature.properties.width || 500),
        unit: 'm',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        }
    }));

    // Options section
    panel.appendChild(createSectionDivider('Opções'));

    // Airmobile toggle
    panel.appendChild(createModernToggle({
        label: 'Aeromóvel / Aeroterrestre',
        checked: feature.properties.airmobile || false,
        onChange: (checked) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', checked);
        }
    }));

    // Show arrow head toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar Seta',
        checked: feature.properties.showArrowHead !== false,
        onChange: (checked) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'showArrowHead', checked);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: arrowControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => arrowControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
