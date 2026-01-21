// Path: js/draw_tools/polygon_tool/polygon_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernLineStyleSelect,
    createModernHatchControl,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add polygon attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected polygon features
 * @param {Object} polygonControl - Polygon control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addPolygonAttributesToPanel(panel, selectedFeatures, polygonControl, selectionManager, uiManager, options = {}) {
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
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} polígonos selecionados`;

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
        value: feature.properties.color,
        onChange: (color) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'color', color);
        }
    }));

    // Outline color picker
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.outlinecolor,
        onChange: (color) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'outlinecolor', color);
        }
    }));

    // Fill opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100),
        unit: '%',
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    }));

    // Border width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura da Borda',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.size || 3,
        unit: 'px',
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    }));

    // Line style selector
    panel.appendChild(createModernLineStyleSelect({
        value: feature.properties.lineStyle || 'solid',
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    }));

    // Fill section
    panel.appendChild(createSectionDivider('Preenchimento'));

    // Hatch control
    panel.appendChild(createModernHatchControl({
        enabled: feature.properties.hatchEnabled === true,
        onToggle: (enabled) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', enabled);
        },
        hatchType: feature.properties.hatchType || 'diagonal-right',
        onTypeChange: (type) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchType', type);
        },
        hatchColor: feature.properties.hatchColor || '#000000',
        onColorChange: (color) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchColor', color);
        },
        hatchSpacing: feature.properties.hatchSpacing || 8,
        onSpacingChange: (spacing) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
        },
        hatchLineWidth: feature.properties.hatchLineWidth || 2,
        onLineWidthChange: (width) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
        }
    }));

    // Measure toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar medição',
        checked: feature.properties.measure === true,
        onChange: (checked) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: polygonControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => polygonControl.setDefaultProperties(feature.properties)
    }));
}
