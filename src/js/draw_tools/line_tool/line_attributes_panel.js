// Path: js/draw_tools/line_tool/line_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernLineStyleSelect,
    createSectionDivider,
    createInitialPropertiesMap,
    createActionButtons,
} from '../../tool_manager/helpers/index.js';

/**
 * Add line attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected line features
 * @param {Object} lineControl - Line control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addLineAttributesToPanel(panel, selectedFeatures, lineControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

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

    // Measure toggle (view-only: allowed in locked mode, not persisted)
    panel.appendChild(createModernToggle({
        label: 'Mostrar medição',
        className: 'attr-toggle--view-only',
        checked: feature.properties.measure === true,
        onChange: (checked) => {
            lineControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Profile toggle (view-only: allowed in locked mode, not persisted)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Perfil do terreno',
            className: 'attr-toggle--view-only',
            checked: feature.properties.profile === true,
            onChange: async (checked) => {
                await lineControl.updateFeaturesProperty(selectedFeatures, 'profile', checked);
                selectionManager.updateProfile();
            }
        }));
    }

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: lineControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
