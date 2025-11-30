// Path: js/controls_sig/ellipse_tool/ellipse_attributes_panel.js

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

export function addEllipseAttributesToPanel(panel, selectedFeatures, ellipseControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                ellipseControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            },
            selectedFeatures,
            selectionManager,
            uiManager
        );
        $(panel).append(headerComponent);
    } else if (selectedFeatures.length > 1) {
        const multiSelectHeader = document.createElement('div');
        multiSelectHeader.className = 'feature-header-with-options';

        const infoText = document.createElement('div');
        infoText.className = 'feature-name-wrapper';
        infoText.style.cssText = 'font-size: 14px; color: #666; padding: 6px;';
        infoText.textContent = `${selectedFeatures.length} elipses selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        $(panel).append(multiSelectHeader);
    }

    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha da elipse');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        ellipseControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento da elipse');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    const opacityControl = createSliderWithInput(getCommonConfig('complete_opacity',
        Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.7) * 100), {
        onChange: (value) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    const lineStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    $(panel).append(createAttributeRow('Estilo da linha:', lineStyleSelect));

    const hatchContainer = document.createElement('div');
    hatchContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const hatchCheckbox = createCheckbox(
        feature.properties.hatchEnabled === true,
        (e) => {
            ellipseControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', e.target.checked);
        }
    );

    const hatchConfigButton = document.createElement('button');
    hatchConfigButton.textContent = '⚙️ Configurar';
    hatchConfigButton.className = 'tool-button pure-material-tool-button-outlined';
    hatchConfigButton.style.cssText = 'padding: 4px 8px; font-size: 12px;';
    hatchConfigButton.onclick = () => {
        openHatchConfigModal(feature, selectedFeatures, ellipseControl);
    };

    $(hatchContainer).append(hatchCheckbox);
    $(hatchContainer).append(hatchConfigButton);
    $(panel).append(createAttributeRow('Hachura:', hatchContainer));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: ellipseControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => ellipseControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}
