// Path: js\controls_sig\circle_tool\circle_attributes_panel.js

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

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
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
        $(panel).append(headerComponent);
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
        $(panel).append(multiSelectHeader);
    }

    // ===== PROPRIEDADES ESPECÍFICAS DO CÍRCULO =====

    // Line color
    const lineColorInput = createColorPicker(feature.properties.lineColor, (e) => {
        circleControl.updateFeaturesProperty(selectedFeatures, 'lineColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor da linha do círculo');

    $(panel).append(createAttributeRow('Linha:', lineColorInput));

    // Fill color
    const fillColorInput = createColorPicker(feature.properties.fillColor, (e) => {
        circleControl.updateFeaturesProperty(selectedFeatures, 'fillColor', e.target.value);
        uiManager.updateSelectionHighlight();
    }, 'Cor do preenchimento do círculo');

    $(panel).append(createAttributeRow('Preenchimento:', fillColorInput));

    // Opacity (0-100% with automatic conversion)
    const opacityControl = createSliderWithInput(getCommonConfig('complete_opacity',
        Math.round((feature.properties.opacity || 0.7) * 100), {
        onChange: (value) => {
            // Convert from 0-100 range to 0-1 range for internal storage
            circleControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Opacidade:', opacityControl));

    // Line width (pixels)
    const lineWidthControl = createSliderWithInput(getCommonConfig('lineWidth',
        feature.properties.lineWidth || 2, {
        onChange: (value) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(createAttributeRow('Largura (px):', lineWidthControl));

    // Estilo da linha
    const lineStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            circleControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    $(panel).append(createAttributeRow('Estilo da linha:', lineStyleSelect));

    // Hachura
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

    $(hatchContainer).append(hatchCheckbox);
    $(hatchContainer).append(hatchConfigButton);
    $(panel).append(createAttributeRow('Hachura:', hatchContainer));

    // Radius
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

    $(panel).append(createAttributeRow('Raio:', radiusInput));

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: circleControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => circleControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}