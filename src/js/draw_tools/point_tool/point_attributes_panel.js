// Path: js/draw_tools/point_tool/point_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createCoordinateEditor,
    getCommonConfig
} from '../../tool_manager/helpers/index.js';

/**
 * Add point attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected point features
 * @param {Object} pointControl - Point control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addPointAttributesToPanel(panel, selectedFeatures, pointControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                pointControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} pontos selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const colorInput = createColorPicker(feature.properties.color, (e) => {
        pointControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    panel.appendChild(createAttributeRow('Cor:', colorInput));

    const sizeSlider = createSliderWithInput({
        min: 6,
        max: 20,
        step: 1,
        value: feature.properties.size || 10,
        onChange: (newValue) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    panel.appendChild(createAttributeRow('Tamanho:', sizeSlider));

    const opacitySlider = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity !== undefined ?
            feature.properties.opacity : 1) * 100), {
        onChange: (value) => {
            pointControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));
    panel.appendChild(createAttributeRow('Opacidade:', opacitySlider));

    if (selectedFeatures.length === 1) {
        const coordinateEditor = createCoordinateEditor(
            feature,
            uiManager,
            async (lat, lng) => {
                const updatedFeature = {
                    ...feature,
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                };

                await pointControl.updateFeatures([updatedFeature], true, false);

                uiManager.updateSelectionHighlight();

                if (coordinateEditor.updateCoordinates) {
                    coordinateEditor.updateCoordinates(lat, lng);
                }
            }
        );
        panel.appendChild(coordinateEditor);
    }

    const buttons = createStandardButtons({
        selectedFeatures,
        control: pointControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => pointControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}
