// Path: js/controls_sig/los_tool/los_attributes_panel.js

import {
    createSliderWithInput,
    createCheckbox,
    createStandardButtons,
    createAttributeRow,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));
    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                losControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} linhas de visada selecionados`;
        
        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );
        
        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));
    const widthControl = createSliderWithInput({
        min: 1,
        max: 30,
        step: 1,
        value: feature.properties.width,
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'width', value);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Largura:', widthControl));
    const mostrarTamanhoCheckbox = createCheckbox(feature.properties.measure || false, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
    });
    panel.appendChild(createAttributeRow('Mostrar tamanho:', mostrarTamanhoCheckbox));

    if (selectedFeatures.length === 1) {
        const mostrarPerfilCheckbox = createCheckbox(feature.properties.profile || false, (e) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
            selectionManager.updateProfile();
        });
        panel.appendChild(createAttributeRow('Mostrar perfil:', mostrarPerfilCheckbox));
    }

    const buttons = createStandardButtons({
        selectedFeatures,
        control: losControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    });

    panel.appendChild(buttons);
}