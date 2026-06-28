// Path: js/draw_tools/sector_tool/sector_attributes_panel.js

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
 * Add sector attributes to the attributes panel.
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected sector features
 * @param {Object} sectorControl - Sector control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addSectorAttributesToPanel(panel, selectedFeatures, sectorControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    // Tabs (Símbolo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
        styleLabel: 'Símbolo',
        fillButton: selectedFeatures.length === 1 ? createFillAreaButton(() => {
            const radius = feature.properties.radius;
            const aperture = feature.properties.aperture || 60;
            if (!radius || radius <= 0) return null;
            return 0.5 * radius * radius * (aperture * Math.PI / 180);
        }) : undefined,
        buildStyleContent: (container) => {
            let hatchControl = null;

            // Fill color picker
            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
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
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
                }
            }));

            // Opacity slider
            container.appendChild(createModernSlider({
                label: 'Opacidade do Preenchimento',
                min: 0, max: 100, step: 1,
                value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100),
                unit: '%',
                onChange: (newValue) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
                }
            }));

            // Border width slider
            container.appendChild(createModernSlider({
                label: 'Espessura da Borda',
                min: 1, max: 10, step: 1,
                value: feature.properties.lineWidth || 2,
                unit: 'px',
                onChange: (newValue) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
                }
            }));

            // Line style selector
            container.appendChild(createModernLineStyleSelect({
                value: feature.properties.lineStyle || 'solid',
                onChange: (newValue) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
                }
            }));

            // Geometry section
            container.appendChild(createSectionDivider('Geometria'));

            // Radius slider
            container.appendChild(createModernSlider({
                label: 'Raio',
                min: 10, max: 100000, step: 1,
                value: Math.round(feature.properties.radius || 1000),
                unit: 'm',
                onChange: (value) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
                }
            }));

            // Bearing (azimuth of central axis) — numeric, 0=North clockwise
            container.appendChild(createModernSlider({
                label: 'Azimute',
                min: 0, max: 360, step: 1,
                value: Math.round(feature.properties.bearing ?? 0),
                unit: '°',
                onChange: (value) => {
                    // 360 wraps to 0 to keep a single canonical value in [0, 360)
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'bearing', value % 360);
                }
            }));

            // Aperture slider
            container.appendChild(createModernSlider({
                label: 'Ângulo de Abertura',
                min: 1, max: 359, step: 1,
                value: Math.round(feature.properties.aperture || 60),
                unit: '°',
                onChange: (value) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'aperture', value);
                }
            }));

            // Fill section
            container.appendChild(createSectionDivider('Preenchimento'));

            // Hatch control
            hatchControl = createModernHatchControl({
                hatchType: feature.properties.hatchType || 'none',
                onTypeChange: (type) => {
                    sectorControl.updateHatchType(selectedFeatures, type);
                },
                fillColor: feature.properties.fillColor,
                hatchSpacing: feature.properties.hatchSpacing || 8,
                onSpacingChange: (spacing) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', spacing);
                },
                hatchLineWidth: feature.properties.hatchLineWidth || 2,
                onLineWidthChange: (width) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', width);
                }
            });
            container.appendChild(hatchControl);
        },
        selectedFeatures,
        feature,
        control: sectorControl,
    }));

    // Action buttons
    createActionButtons({
        panel,
        features: selectedFeatures,
        control: sectorControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons
    });
}
