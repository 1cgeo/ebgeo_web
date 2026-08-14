// Path: js/draw_tools/rectangle_tool/rectangle_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernLineStyleSelect,
    createModernHatchControl,
    createSectionDivider,
    createInitialPropertiesMap,
    createActionButtons,
    buildShapeTabsWithLabel,
    createFillAreaButton,
} from '../../tool_manager/helpers/index.js';

/**
 * Add rectangle attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected rectangle features
 * @param {Object} rectangleControl - Rectangle control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addRectangleAttributesToPanel(panel, selectedFeatures, rectangleControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    // Tabs (Símbolo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
        styleLabel: 'Símbolo',
        fillButton: selectedFeatures.length === 1 ? createFillAreaButton(() => {
            const w = feature.properties.width;
            const h = feature.properties.height;
            return (w > 0 && h > 0) ? w * h : null;
        }) : undefined,
        buildStyleContent: (container) => {
            let hatchControl = null;

            // Fill color picker
            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
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
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
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
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
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
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
                }
            }));

            // Line style selector
            container.appendChild(createModernLineStyleSelect({
                value: feature.properties.lineStyle || 'solid',
                onChange: (newValue) => {
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
                }
            }));

            // Geometry section
            container.appendChild(createSectionDivider('Geometria'));

            // Border radius slider
            container.appendChild(createModernSlider({
                label: 'Arredondamento',
                min: 0,
                max: 10,
                step: 1,
                value: feature.properties.borderRadius || 0,
                unit: '',
                onChange: (value) => {
                    // `updateFeaturesProperty` already regenerates the geometry with
                    // bearing/width/height and pushes it to the source. Regenerating here
                    // (3-arg call = bearing 0) only produced an axis-aligned geometry that a
                    // second, concurrent read-modify-write cycle then had to repair.
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'borderRadius', value);
                }
            }));

            // Fill section
            container.appendChild(createSectionDivider('Preenchimento'));

            // Hatch control (uses fillColor for hatch color)
            hatchControl = createModernHatchControl({
                hatchType: feature.properties.hatchType || 'none',
                onTypeChange: (type) => {
                    rectangleControl.updateHatchType(selectedFeatures, type);
                },
                fillColor: feature.properties.fillColor,
                hatchSpacing: feature.properties.hatchSpacing || 8,
                onSpacingChange: (spacing) => {
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
                },
                hatchLineWidth: feature.properties.hatchLineWidth || 2,
                onLineWidthChange: (width) => {
                    rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
                }
            });
            container.appendChild(hatchControl);
        },
        selectedFeatures,
        feature,
        control: rectangleControl,
    }));

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: rectangleControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}

