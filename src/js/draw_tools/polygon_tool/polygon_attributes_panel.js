// Path: js/draw_tools/polygon_tool/polygon_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernLineStyleSelect,
    createModernHatchControl,
    createSectionDivider,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons,
    buildShapeTabsWithLabel,
    createObservationsSection,
} from '../../tool_manager/helpers/index.js';
import {
    calculatePolygonMetrics,
    formatAreaAuto,
    formatDistanceAuto,
} from '../../measurement_tool/measurement-geometry.js';

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
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'polygon',
        control: polygonControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader
    });

    // Tabs (Estilo / Etiqueta)
    panel.appendChild(buildShapeTabsWithLabel({
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

            // Measure toggle (view-only: allowed in locked mode, not persisted)
            container.appendChild(createModernToggle({
                label: 'Mostrar medição',
                className: 'attr-toggle--view-only',
                checked: feature.properties.measure === true,
                onChange: (checked) => {
                    polygonControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
                }
            }));

            // Area and perimeter display (read-only)
            if (selectedFeatures.length === 1) {
                const coords = feature.properties.baseCoordinates || feature.geometry?.coordinates?.[0];
                if (coords && coords.length >= 3) {
                    // Use baseCoordinates (unclosed ring) or strip closing point from geometry
                    const ring = feature.properties.baseCoordinates
                        ? coords
                        : coords.slice(0, -1);
                    const { area, perimeter } = calculatePolygonMetrics(ring);

                    container.appendChild(createSectionDivider('Medidas'));

                    const measuresContainer = document.createElement('div');
                    measuresContainer.className = 'polygon-measures';

                    const areaRow = document.createElement('div');
                    areaRow.className = 'polygon-measures__row';
                    areaRow.innerHTML = `<span class="polygon-measures__label">Área</span><span class="polygon-measures__value">${formatAreaAuto(area)}</span>`;
                    measuresContainer.appendChild(areaRow);

                    const perimeterRow = document.createElement('div');
                    perimeterRow.className = 'polygon-measures__row';
                    perimeterRow.innerHTML = `<span class="polygon-measures__label">Perímetro</span><span class="polygon-measures__value">${formatDistanceAuto(perimeter)}</span>`;
                    measuresContainer.appendChild(perimeterRow);

                    container.appendChild(measuresContainer);
                }
            }
        },
        selectedFeatures,
        feature,
        control: polygonControl,
    }));

    // Per-segment observations + QAN export
    if (selectedFeatures.length === 1) {
        panel.appendChild(createObservationsSection({
            feature,
            selectedFeatures,
            control: polygonControl,
        }));
    }

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
