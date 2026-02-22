// Path: js/military_tools/boundary_tool/boundary_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernSelect,
    createModernButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Create and populate boundary attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected boundary features
 * @param {Object} boundaryControl - Boundary control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager, options = {}) {
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
                    boundaryControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} limites selecionados`;

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

    // Echelon select
    const echelonOptions = [
        { value: 'XXXXXX', label: 'XXXXXX' },
        { value: 'XXXXX', label: 'XXXXX' },
        { value: 'XXXX', label: 'XXXX' },
        { value: 'XXX', label: 'XXX' },
        { value: 'XX', label: 'XX' },
        { value: 'X', label: 'X' },
        { value: 'III', label: 'III' },
        { value: 'II', label: 'II' },
        { value: 'I', label: 'I' },
        { value: 'ooo', label: '•••' },
        { value: 'oo', label: '••' },
        { value: 'o', label: '•' }
    ];

    panel.appendChild(createModernSelect({
        label: 'Escalão',
        value: feature.properties.echelon,
        options: echelonOptions,
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'echelon', value);
        }
    }));

    // Color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.color,
        onChange: (color) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'color', color);
        }
    }));

    // Line width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 4,
        unit: 'px',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: boundaryControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => boundaryControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
