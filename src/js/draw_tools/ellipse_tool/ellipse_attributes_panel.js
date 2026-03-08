// Path: js/draw_tools/ellipse_tool/ellipse_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    buildShapeTabsWithLabel
} from '../../tool_manager/helpers/index.js';

/**
 * Add ellipse attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected ellipse features
 * @param {Object} ellipseControl - Ellipse control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addEllipseAttributesToPanel(panel, selectedFeatures, ellipseControl, selectionManager, uiManager, options = {}) {
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
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} elipses selecionadas`;

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

    panel.appendChild(buildShapeTabsWithLabel({
        buildStyleContent: (container) => {
            // Hatch control reference for color sync
            let hatchControl = null;

            // Fill color picker
            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
                    // Update hatch preview colors
                    if (hatchControl?.updatePreviewColor) {
                        hatchControl.updatePreviewColor(color);
                    }
                }
            }));

            // Line color picker
            container.appendChild(createModernColorPicker({
                label: 'Borda',
                value: feature.properties.lineColor,
                onChange: (color) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
                }
            }));

            // Opacity slider
            container.appendChild(createModernSlider({
                label: 'Opacidade do Preenchimento',
                min: 0,
                max: 100,
                step: 1,
                value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100),
                unit: '%',
                onChange: (newValue) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
                }
            }));

            // Border width slider
            container.appendChild(createModernSlider({
                label: 'Espessura da Borda',
                min: 1,
                max: 10,
                step: 1,
                value: feature.properties.lineWidth || 2,
                unit: 'px',
                onChange: (newValue) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
                }
            }));

            // Line style selector
            container.appendChild(createModernLineStyleSelect({
                value: feature.properties.lineStyle || 'solid',
                onChange: (newValue) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
                }
            }));

            // Fill section
            container.appendChild(createSectionDivider('Preenchimento'));

            // Hatch control (uses fillColor for hatch color)
            hatchControl = createModernHatchControl({
                hatchType: feature.properties.hatchType || 'none',
                onTypeChange: (type) => {
                    ellipseControl.updateHatchType(selectedFeatures, type);
                },
                fillColor: feature.properties.fillColor,
                hatchSpacing: feature.properties.hatchSpacing || 8,
                onSpacingChange: (spacing) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
                },
                hatchLineWidth: feature.properties.hatchLineWidth || 2,
                onLineWidthChange: (width) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
                }
            });
            container.appendChild(hatchControl);
        },
        selectedFeatures,
        feature,
        control: ellipseControl,
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: ellipseControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => ellipseControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
