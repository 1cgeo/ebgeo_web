// Path: js/military_tools/occupied_front_tool/occupied_front_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernButtons
} from '@tools/helpers/index.js';

/**
 * Add occupied front attributes to the panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected occupied front features
 * @param {Object} occupiedFrontControl - Occupied front control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addOccupiedFrontAttributesToPanel(panel, selectedFeatures, occupiedFrontControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.color,
        onChange: (color) => {
            occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'color', color);
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
            occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
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
            occupiedFrontControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: occupiedFrontControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => occupiedFrontControl.setDefaultProperties({
            color: feature.properties.color,
            lineWidth: feature.properties.lineWidth,
            opacity: feature.properties.opacity
        }),
        hidden: options.hideButtons
    }));
}
