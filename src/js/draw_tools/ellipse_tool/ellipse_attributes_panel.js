// Path: js/draw_tools/ellipse_tool/ellipse_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createSectionDivider,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons,
    buildShapeTabsWithLabel,
    createFillAreaButton,
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
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'ellipse',
        control: ellipseControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader
    });

    // Tabs (Símbolo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
        styleLabel: 'Símbolo',
        fillButton: selectedFeatures.length === 1 ? createFillAreaButton(() => {
            const a = feature.properties.majorRadius;
            const b = feature.properties.minorRadius;
            return (a > 0 && b > 0) ? Math.PI * a * b : null;
        }) : undefined,
        buildStyleContent: (container) => {
            let hatchControl = null;

            // Fill color picker
            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
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
                min: 0, max: 100, step: 1,
                value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100),
                unit: '%',
                onChange: (newValue) => {
                    ellipseControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
                }
            }));

            // Border width slider
            container.appendChild(createModernSlider({
                label: 'Espessura da Borda',
                min: 1, max: 10, step: 1,
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

            // Hatch control
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
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: ellipseControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
