// Path: js/draw_tools/circle_tool/circle_attributes_panel.js

import {
    createModernSlider,
    createModernNumericInput,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createSectionDivider,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons
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
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'circle',
        control: circleControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader
    });

    // Hatch control reference for color sync
    let hatchControl = null;

    // Fill color picker
    panel.appendChild(createModernColorPicker({
        label: 'Preenchimento',
        value: feature.properties.fillColor,
        onChange: (color) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
            // Update hatch preview colors
            if (hatchControl?.updatePreviewColor) {
                hatchControl.updatePreviewColor(color);
            }
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

    // Hatch control (uses fillColor for hatch color)
    hatchControl = createModernHatchControl({
        hatchType: feature.properties.hatchType || 'none',
        onTypeChange: (type) => {
            circleControl.updateHatchType(selectedFeatures, type);
        },
        fillColor: feature.properties.fillColor,
        hatchSpacing: feature.properties.hatchSpacing || 8,
        onSpacingChange: (spacing) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
        },
        hatchLineWidth: feature.properties.hatchLineWidth || 2,
        onLineWidthChange: (width) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
        }
    });
    panel.appendChild(hatchControl);

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: circleControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
