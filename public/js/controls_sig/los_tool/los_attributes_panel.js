// Path: js/controls_sig/los_tool/los_attributes_panel.js

import {
    createSliderWithInput,
    createCheckbox,
    createStandardButtons,
    createEditableFeatureName,
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
        $(panel).append(headerComponent);
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
        $(panel).append(multiSelectHeader);
    }

    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round(feature.properties.opacity * 100), {
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Opacidade:')))
            .append($("<div>", { class: "attr-input" }).append(opacityControl))
    );
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

    $(panel).append(
        $("<div>", { class: "attr-container-row" })
            .append($("<div>", { class: "attr-name" }).append($("<label>").text('Largura:')))
            .append($("<div>", { class: "attr-input" }).append(widthControl))
    );

    const addAttributeRow = (labelText, inputElement) => {
        const container = $("<div>", { class: "attr-container-row" });
        const label = document.createElement('label');
        label.textContent = labelText;
        container.append($("<div>", { class: "attr-name" }).append(label));
        container.append($("<div>", { class: "attr-input" }).append(inputElement));
        $(panel).append(container);
    };
    const mostrarTamanhoCheckbox = createCheckbox(feature.properties.measure || false, (e) => {
        losControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
    });
    addAttributeRow('Mostrar tamanho:', mostrarTamanhoCheckbox);

    if (selectedFeatures.length === 1) {
        const mostrarPerfilCheckbox = createCheckbox(feature.properties.profile || false, (e) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'profile', e.target.checked);
            selectionManager.updateProfile();
        });
        addAttributeRow('Mostrar perfil:', mostrarPerfilCheckbox);
    }

    const buttons = createStandardButtons({
        selectedFeatures,
        control: losControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    });

    $(panel).append(buttons);
}