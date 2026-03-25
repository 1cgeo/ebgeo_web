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
    createActionButtons,
    buildShapeTabsWithLabel,
    createFillAreaButton,
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

    // Tabs (Símbolo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
        styleLabel: 'Símbolo',
        fillButton: selectedFeatures.length === 1 ? createFillAreaButton(() => {
            const r = feature.properties.radius;
            return (r > 0) ? Math.PI * r * r : null;
        }) : undefined,
        buildStyleContent: (container) => {
            let hatchControl = null;

            container.appendChild(createModernColorPicker({
                label: 'Preenchimento',
                value: feature.properties.fillColor,
                onChange: (color) => {
                    circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
                    if (hatchControl?.updatePreviewColor) {
                        hatchControl.updatePreviewColor(color);
                    }
                }
            }));

            container.appendChild(createModernColorPicker({
                label: 'Borda',
                value: feature.properties.lineColor,
                onChange: (color) => {
                    circleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
                }
            }));

            container.appendChild(createModernSlider({
                label: 'Opacidade do Preenchimento',
                min: 0, max: 100, step: 1,
                value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100),
                unit: '%',
                onChange: (v) => circleControl.updateFeaturesProperty(selectedFeatures, 'opacity', v / 100)
            }));

            container.appendChild(createModernSlider({
                label: 'Espessura da Borda',
                min: 1, max: 10, step: 1,
                value: feature.properties.lineWidth || 2,
                unit: 'px',
                onChange: (v) => circleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', v)
            }));

            container.appendChild(createModernLineStyleSelect({
                value: feature.properties.lineStyle || 'solid',
                onChange: (v) => circleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', v)
            }));

            container.appendChild(createSectionDivider('Geometria'));

            container.appendChild(createModernNumericInput({
                label: 'Raio',
                min: 10, max: 100000, step: 1,
                value: Math.round(feature.properties.radius || 1000),
                unit: 'm',
                onChange: (v) => circleControl.updateFeaturesProperty(selectedFeatures, 'radius', v)
            }));

            container.appendChild(createSectionDivider('Preenchimento'));

            hatchControl = createModernHatchControl({
                hatchType: feature.properties.hatchType || 'none',
                onTypeChange: (type) => circleControl.updateHatchType(selectedFeatures, type),
                fillColor: feature.properties.fillColor,
                hatchSpacing: feature.properties.hatchSpacing || 8,
                onSpacingChange: (s) => circleControl.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', s),
                hatchLineWidth: feature.properties.hatchLineWidth || 2,
                onLineWidthChange: (w) => circleControl.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', w)
            });
            container.appendChild(hatchControl);
        },
        selectedFeatures,
        feature,
        control: circleControl,
    }));

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

