// Path: js/controls_sig/rectangle_tool/rectangle_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createLineStyleSelect,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';
import { openHatchConfigModal } from '../tool_manager/hatch_config_modal.js';

export function addRectangleAttributesToPanel(panel, selectedFeatures, rectangleControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                rectangleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} retângulos selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do retângulo');

    panel.appendChild(createAttributeRow('Linha:', lineColorInput));

    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        rectangleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do retângulo');

    panel.appendChild(createAttributeRow('Preenchimento:', fillColorInput));

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

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));

    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Largura (px):', lineWidthControl));

    const lineStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    panel.appendChild(createAttributeRow('Estilo da linha:', lineStyleSelect));

    const hatchContainer = document.createElement('div');
    hatchContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const hatchCheckbox = createCheckbox(
        feature.properties.hatchEnabled === true,
        (e) => {
            rectangleControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', e.target.checked);
        }
    );

    const hatchConfigButton = document.createElement('button');
    hatchConfigButton.textContent = '⚙️ Configurar';
    hatchConfigButton.className = 'tool-button pure-material-tool-button-outlined';
    hatchConfigButton.style.cssText = 'padding: 4px 8px; font-size: 12px;';
    hatchConfigButton.onclick = () => {
        openHatchConfigModal(feature, selectedFeatures, rectangleControl);
    };

    hatchContainer.appendChild(hatchCheckbox);
    hatchContainer.appendChild(hatchConfigButton);
    panel.appendChild(createAttributeRow('Hachura:', hatchContainer));

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

    panel.appendChild(createAttributeRow('Arredondamento:', borderRadiusControl));

    const widthValue = document.createElement('span');
    widthValue.textContent = `${Math.round(feature.properties.width || 100)} m`;
    widthValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500; margin-right: 10px;';

    const heightValue = document.createElement('span');
    heightValue.textContent = `${Math.round(feature.properties.height || 100)} m`;
    heightValue.style.cssText = 'font-size: 13px; color: #666; font-weight: 500;';

    const dimensionsContainer = document.createElement('div');
    dimensionsContainer.appendChild(widthValue);
    dimensionsContainer.appendChild(heightValue);

    panel.appendChild(createAttributeRow('Dimensões:', dimensionsContainer));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: rectangleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => rectangleControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}