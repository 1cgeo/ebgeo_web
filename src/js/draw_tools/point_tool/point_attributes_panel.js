// Path: js/draw_tools/point_tool/point_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add point attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected point features
 * @param {Object} pointControl - Point control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addPointAttributesToPanel(panel, selectedFeatures, pointControl, selectionManager, uiManager, options = {}) {
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
                    pointControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} pontos selecionados`;

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

    // Color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.fillColor,
        onChange: (color) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    }));

    // Size slider
    panel.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 6,
        max: 20,
        step: 1,
        value: feature.properties.size || 10,
        unit: 'px',
        onChange: (newValue) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 1) * 100),
        unit: '%',
        onChange: (value) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: pointControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => pointControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
