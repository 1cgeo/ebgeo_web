// Path: js/controls_sig/circle_tool/circle_attributes_panel.js

import {
    createSliderWithInput,
    createNumericInput,
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

export function addCircleAttributesToPanel(panel, selectedFeatures, circleControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== EDITABLE FEATURE NAME (SINGLE SELECTION ONLY) =====
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                circleControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} circles selected`;
        
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
        circleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do círculo');

    panel.appendChild(createAttributeRow('Linha:', lineColorInput));
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do círculo');

    panel.appendChild(createAttributeRow('Preenchimento:', fillColorInput));
    const opacityControl = createSliderWithInput(getCommonConfig('complete_opacity',
        Math.round((feature.properties.opacity || 0.7) * 100), {
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Largura (px):', lineWidthControl));
    const lineStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    panel.appendChild(createAttributeRow('Estilo da linha:', lineStyleSelect));
    const hatchContainer = document.createElement('div');
    hatchContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const hatchCheckbox = createCheckbox(
        feature.properties.hatchEnabled === true,
        (e) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', e.target.checked);
        }
    );

    const hatchConfigButton = document.createElement('button');
    hatchConfigButton.textContent = '⚙️ Configurar';
    hatchConfigButton.className = 'tool-button pure-material-tool-button-outlined';
    hatchConfigButton.style.cssText = 'padding: 4px 8px; font-size: 12px;';
    hatchConfigButton.onclick = () => {
        openHatchConfigModal(feature, selectedFeatures, circleControl);
    };

    hatchContainer.appendChild(hatchCheckbox);
    hatchContainer.appendChild(hatchConfigButton);
    panel.appendChild(createAttributeRow('Hachura:', hatchContainer));
    const radiusInput = createNumericInput({
        min: 10,
        max: 100000,
        step: 1,
        value: Math.round(feature.properties.radius || 1000),
        suffix: ' m',
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'radius', value);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Raio:', radiusInput));
    const buttons = createStandardButtons({
        selectedFeatures,
        control: circleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => circleControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}