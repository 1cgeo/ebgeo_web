// Path: js/draw_tools/sector_tool/sector_attributes_panel.js

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
 * Add sector attributes to the attributes panel.
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected sector features
 * @param {Object} sectorControl - Sector control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addSectorAttributesToPanel(panel, selectedFeatures, sectorControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Header
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    sectorControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} setores selecionados`;

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

    // Hatch control reference for color sync
    let hatchControl = null;

    // Fill color picker
    panel.appendChild(createModernColorPicker({
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
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor,
        onChange: (color) => {
            sectorControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100),
        unit: '%',
        onChange: (newValue) => {
            sectorControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
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
            sectorControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', newValue);
        }
    }));

    // Line style selector
    panel.appendChild(createModernLineStyleSelect({
        value: feature.properties.lineStyle || 'solid',
        onChange: (newValue) => {
            sectorControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    }));

    // Geometry section
    panel.appendChild(createSectionDivider('Geometria'));

    // Radius slider
    panel.appendChild(createModernSlider({
        label: 'Raio',
        min: 10,
        max: 100000,
        step: 1,
        value: Math.round(feature.properties.radius || 1000),
        unit: 'm',
        onChange: (value) => {
            sectorControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
        }
    }));

    // Aperture slider
    panel.appendChild(createModernSlider({
        label: 'Ângulo de Abertura',
        min: 1,
        max: 359,
        step: 1,
        value: Math.round(feature.properties.aperture || 60),
        unit: '°',
        onChange: (value) => {
            sectorControl.updateFeaturesProperty(selectedFeatures, 'aperture', value);
        }
    }));

    // Fill section
    panel.appendChild(createSectionDivider('Preenchimento'));

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
    panel.appendChild(hatchControl);

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: sectorControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => sectorControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
