// Path: js/draw_tools/rectangle_tool/rectangle_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add rectangle attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected rectangle features
 * @param {Object} rectangleControl - Rectangle control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addRectangleAttributesToPanel(panel, selectedFeatures, rectangleControl, selectionManager, uiManager, options = {}) {
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
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} retângulos selecionados`;

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
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    }));

    // Line color picker
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor,
        onChange: (color) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
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
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
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
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
        }
    }));

    // Line style selector
    panel.appendChild(createModernLineStyleSelect({
        value: feature.properties.lineStyle || 'solid',
        onChange: (newValue) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    }));

    // Geometry section
    panel.appendChild(createSectionDivider('Geometria'));

    // Border radius slider
    panel.appendChild(createModernSlider({
        label: 'Arredondamento',
        min: 0,
        max: 10,
        step: 1,
        value: feature.properties.borderRadius || 0,
        unit: '',
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'borderRadius', value);

            selectedFeatures.forEach(f => {
                const corner1 = rectangleControl.geometry.normalizeCorner(f.properties.corner1);
                const corner2 = rectangleControl.geometry.normalizeCorner(f.properties.corner2);
                f.geometry = rectangleControl.geometry.generate(corner1, corner2, value);
            });

            rectangleControl.updateFeatures(selectedFeatures, false, false);
        }
    }));

    // Dimensions info
    const dimensionsContainer = document.createElement('div');
    dimensionsContainer.className = 'attr-modern-info';
    dimensionsContainer.innerHTML = `
        <div class="attr-modern-info-row">
            <span class="attr-modern-info-label">Largura:</span>
            <span class="attr-modern-info-value">${Math.round(feature.properties.width || 100)} m</span>
        </div>
        <div class="attr-modern-info-row">
            <span class="attr-modern-info-label">Altura:</span>
            <span class="attr-modern-info-value">${Math.round(feature.properties.height || 100)} m</span>
        </div>
    `;
    panel.appendChild(dimensionsContainer);

    // Fill section
    panel.appendChild(createSectionDivider('Preenchimento'));

    // Hatch control
    panel.appendChild(createModernHatchControl({
        enabled: feature.properties.hatchEnabled === true,
        onToggle: (enabled) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', enabled);
        },
        hatchType: feature.properties.hatchType || 'diagonal-right',
        onTypeChange: (type) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchType', type);
        },
        hatchColor: feature.properties.hatchColor || '#000000',
        onColorChange: (color) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchColor', color);
        },
        hatchSpacing: feature.properties.hatchSpacing || 8,
        onSpacingChange: (spacing) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
        },
        hatchLineWidth: feature.properties.hatchLineWidth || 2,
        onLineWidthChange: (width) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: rectangleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => rectangleControl.setDefaultProperties(feature.properties)
    }));
}
