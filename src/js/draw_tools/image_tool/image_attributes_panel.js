// Path: js/draw_tools/image_tool/image_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add image attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected image features
 * @param {Object} imageControl - Image control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addImageAttributesToPanel(panel, selectedFeatures, imageControl, selectionManager, uiManager, options = {}) {
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
                    imageControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} imagens selecionadas`;

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

    // Size slider
    panel.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 10,
        max: 300,
        step: 1,
        value: feature.properties.size || 100,
        unit: 'px',
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        }
    }));

    // Zoom correction toggle
    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        }
    }));

    // Reference zoom slider
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            imageControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    });

    if (feature.properties.zoomCorrectionEnabled === false) {
        zoomSlider.style.display = 'none';
    }

    panel.appendChild(zoomSlider);

    // Rotation slider
    panel.appendChild(createModernSlider({
        label: 'Rotação',
        min: 0,
        max: 360,
        step: 1,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 1) * 100),
        unit: '%',
        onChange: (value) => {
            imageControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons (no set default for images)
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: imageControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    }));
}
