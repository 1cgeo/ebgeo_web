// Path: js/draw_tools/brush_tool/brush_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons
} from '../../tool_manager/helpers/index.js';

/**
 * Create and populate brush attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected brush features
 * @param {Object} brushControl - Brush control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addBrushAttributesToPanel(panel, selectedFeatures, brushControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'brush',
        control: brushControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader
    });

    // Color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.lineColor,
        onChange: (color) => {
            brushControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Line width slider
    panel.appendChild(createModernSlider({
        label: 'Largura',
        min: 1,
        max: 50,
        step: 1,
        value: feature.properties.lineWidth || 10,
        unit: 'px',
        onChange: (value) => {
            brushControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    }));

    // Reference zoom slider (created first so toggle can reference it)
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            brushControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    });

    if (feature.properties.zoomCorrectionEnabled === false) {
        zoomSlider.style.display = 'none';
    }

    // Zoom correction toggle (added to panel first)
    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            brushControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        }
    }));

    // Now add the zoom slider after the toggle
    panel.appendChild(zoomSlider);

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: brushControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
