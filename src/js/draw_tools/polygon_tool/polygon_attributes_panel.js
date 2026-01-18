// Path: js/draw_tools/polygon_tool/polygon_attributes_panel.js

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
    getCommonConfig,
    openHatchConfigModal
} from '../../tool_manager';

/**
 * Add polygon attributes to the attributes panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected polygon features
 * @param {Object} polygonControl - Polygon control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addPolygonAttributesToPanel(panel, selectedFeatures, polygonControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                polygonControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} polígonos selecionados`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    const fillColorInput = createColorPicker(feature.properties.color, (e) => {
        polygonControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    });
    panel.appendChild(createAttributeRow('Cor de preenchimento:', fillColorInput));

    const outlineColorInput = createColorPicker(feature.properties.outlinecolor, (e) => {
        polygonControl.updateFeaturesProperty(selectedFeatures, 'outlinecolor', e.target.value);
    });
    panel.appendChild(createAttributeRow('Cor da borda:', outlineColorInput));

    const fillOpacitySlider = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity !== undefined ? feature.properties.opacity : 0.5) * 100),
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'opacity', newValue / 100);
        }
    });
    panel.appendChild(createAttributeRow('Opacidade preenchimento:', fillOpacitySlider));

    const borderSizeSlider = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.size || 3,
        onChange: (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'size', newValue);
        }
    });
    panel.appendChild(createAttributeRow('Largura da borda:', borderSizeSlider));

    const borderStyleSelect = createLineStyleSelect(
        feature.properties.lineStyle || 'solid',
        (newValue) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'lineStyle', newValue);
        }
    );
    panel.appendChild(createAttributeRow('Estilo da borda:', borderStyleSelect));

    const hatchContainer = document.createElement('div');
    hatchContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const hatchCheckbox = createCheckbox(
        feature.properties.hatchEnabled === true,
        (e) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'hatchEnabled', e.target.checked);
        }
    );

    const hatchConfigButton = document.createElement('button');
    hatchConfigButton.textContent = '⚙️ Configurar';
    hatchConfigButton.className = 'tool-button pure-material-tool-button-outlined';
    hatchConfigButton.style.cssText = 'padding: 4px 8px; font-size: 12px;';
    hatchConfigButton.onclick = () => {
        openHatchConfigModal(feature, selectedFeatures, polygonControl);
    };

    hatchContainer.appendChild(hatchCheckbox);
    hatchContainer.appendChild(hatchConfigButton);
    panel.appendChild(createAttributeRow('Hachura:', hatchContainer));

    const measureCheckbox = createCheckbox(
        feature.properties.measure === true,
        (e) => {
            polygonControl.updateFeaturesProperty(selectedFeatures, 'measure', e.target.checked);
        }
    );
    panel.appendChild(createAttributeRow('Medir:', measureCheckbox));

    const buttons = createStandardButtons({
        selectedFeatures,
        control: polygonControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => polygonControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}
