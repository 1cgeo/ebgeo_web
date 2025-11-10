// Path: js\controls_sig\rectangle_tool\rectangle_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addRectangleAttributesToPanel(panel, selectedFeatures, rectangleControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                rectangleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do retângulo');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do retângulo');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    const opacityControl = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 0.7) * 100),
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    const borderRadiusControl = createSliderWithInput({
        min: 0,
        max: 10,
        step: 1,
        value: feature.properties.borderRadius || 0,
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'borderRadius', value);
            
            selectedFeatures.forEach(f => {
                const corner1 = rectangleControl.geometry.normalizeCorner(f.properties.corner1);
                const corner2 = rectangleControl.geometry.normalizeCorner(f.properties.corner2);
                f.geometry = rectangleControl.geometry.generate(corner1, corner2, value);
            });
            
            rectangleControl.updateFeatures(selectedFeatures, false, false);
            uiManager.updateSelectionHighlight();
        }
    });

    $(panel).append(createAttributeRow('Arredondamento:', borderRadiusControl));

    const widthValue = document.createElement('span');
    widthValue.textContent = `${Math.round(feature.properties.width || 100)} m`;
    widthValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500; margin-right: 10px;';

    const heightValue = document.createElement('span');
    heightValue.textContent = `${Math.round(feature.properties.height || 100)} m`;
    heightValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500;';

    const dimensionsContainer = document.createElement('div');
    dimensionsContainer.appendChild(widthValue);
    dimensionsContainer.appendChild(heightValue);

    $(panel).append(createAttributeRow('Dimensões:', dimensionsContainer));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: rectangleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => rectangleControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}