// Path: js/draw_tools/polygon_tool/polygon_attributes_panel.js

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
import { calculatePolygonMetrics } from '../../measurement_tool/measurement-geometry.js';

/**
 * Add polygon attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected polygon features
 * @param {Object} polygonControl - Polygon control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addPolygonAttributesToPanel(panel, selectedFeatures, polygonControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    // Tabs (Símbolo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
        styleLabel: 'Símbolo',
        fillButton: selectedFeatures.length === 1 ? createFillAreaButton(() => {
            const coords = feature.properties.baseCoordinates || feature.geometry?.coordinates?.[0];
            if (!coords || coords.length < 3) return null;
            const ring = feature.properties.baseCoordinates ? coords : coords.slice(0, -1);
            return calculatePolygonMetrics(ring).area;
        }) : undefined,
        buildStyleContent: (container) => {
            let hatchControl = null;

            // Fill color picker
            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
                    // Update hatch preview colors
                    if (hatchControl?.updatePreviewColor) {
                        hatchControl.updatePreviewColor(color);
                    }
                }
            }));

            // Outline color picker
            container.appendChild(createModernColorPicker({
                label: 'Borda',
                value: feature.properties.lineColor,
                onChange: (color) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
                }
            }));

            // Fill opacity slider
            container.appendChild(createModernSlider({
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
            container.appendChild(createModernSlider({
                label: 'Espessura da Borda',
                min: 1,
                max: 10,
                step: 1,
                value: feature.properties.lineWidth || 2,
                unit: 'px',
                onChange: (newValue) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
                }
            }));

            // Line style selector
            container.appendChild(createModernLineStyleSelect({
                value: feature.properties.lineStyle || 'solid',
                onChange: (newValue) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
                }
            }));

            // Fill section
            container.appendChild(createSectionDivider('Preenchimento'));

            // Hatch control (uses fillColor for hatch color)
            hatchControl = createModernHatchControl({
                hatchType: feature.properties.hatchType || 'none',
                onTypeChange: (type) => {
                    polygonControl.updateHatchType(selectedFeatures, type);
                },
                fillColor: feature.properties.fillColor,
                hatchSpacing: feature.properties.hatchSpacing || 8,
                onSpacingChange: (spacing) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
                },
                hatchLineWidth: feature.properties.hatchLineWidth || 2,
                onLineWidthChange: (width) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
                }
            });
            container.appendChild(hatchControl);
        },
        selectedFeatures,
        feature,
        control: polygonControl,
    }));

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: polygonControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
