// Path: js/draw_tools/circle_tool/circle_attributes_panel.js

import {
    createModernSlider,
    createModernNumericInput,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add circle attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected circle features
 * @param {Object} circleControl - Circle control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addCircleAttributesToPanel(panel, selectedFeatures, circleControl, selectionManager, uiManager, options = {}) {
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
                    circleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} círculos selecionados`;

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
            circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    }));

    // Line color picker
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor,
        onChange: (color) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100),
        unit: '%',
        onChange: (newValue) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));

    // Border width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura da Borda',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 2,
        unit: 'px',
        onChange: (newValue) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
        }
    }));

    // Line style selector
    panel.appendChild(createModernLineStyleSelect({
        value: feature.properties.lineStyle || 'solid',
        onChange: (newValue) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    }));

    // Geometry section
    panel.appendChild(createSectionDivider('Geometria'));

    // Radius input
    panel.appendChild(createModernNumericInput({
        label: 'Raio',
        min: 10,
        max: 100000,
        step: 1,
        value: Math.round(feature.properties.radius || 1000),
        unit: 'm',
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
        }
    }));

    // Fill section
    panel.appendChild(createSectionDivider('Preenchimento'));

    // Hatch control
    panel.appendChild(createModernHatchControl({
        enabled: feature.properties.hatchEnabled === true,
        onToggle: (enabled) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', enabled);
        },
        hatchType: feature.properties.hatchType || 'diagonal-right',
        onTypeChange: (type) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchType', type);
        },
        hatchColor: feature.properties.hatchColor || '#000000',
        onColorChange: (color) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchColor', color);
        },
        hatchSpacing: feature.properties.hatchSpacing || 8,
        onSpacingChange: (spacing) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
        },
        hatchLineWidth: feature.properties.hatchLineWidth || 2,
        onLineWidthChange: (width) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: circleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => circleControl.setDefaultProperties(feature.properties)
    }));
}
