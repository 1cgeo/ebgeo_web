// Path: js/controls_sig/tool_manager/hatch_config_modal.js

import { createSliderWithInput, createColorPicker, createAttributeRow } from './attribute_panel_helpers.js';

export function openHatchConfigModal(feature, selectedFeatures, control) {
    const modal = document.createElement('div');
    modal.className = 'hatch-config-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        min-width: 320px;
        max-width: 400px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    const title = document.createElement('h3');
    title.textContent = 'Configurações de Hachura';
    title.style.cssText = 'margin: 0 0 20px 0; font-size: 16px;';
    content.appendChild(title);

    const typeSelect = createHatchTypeSelect(
        feature.properties.hatchType || 'diagonal-right',
        (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchType', newValue);
        }
    );
    const typeRow = createAttributeRow('Tipo:', typeSelect);
    content.appendChild(typeRow);

    const colorInput = createColorPicker(
        feature.properties.hatchColor || '#000000',
        (e) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchColor', e.target.value);
        }
    );
    const colorRow = createAttributeRow('Cor:', colorInput);
    content.appendChild(colorRow);

    const spacingSlider = createSliderWithInput({
        min: 4,
        max: 20,
        step: 2,
        value: feature.properties.hatchSpacing || 8,
        onChange: (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', newValue);
        }
    });
    const spacingRow = createAttributeRow('Espaçamento:', spacingSlider);
    content.appendChild(spacingRow);

    const widthSlider = createSliderWithInput({
        min: 1,
        max: 5,
        step: 1,
        value: feature.properties.hatchLineWidth || 2,
        onChange: (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', newValue);
        }
    });
    const widthRow = createAttributeRow('Espessura:', widthSlider);
    content.appendChild(widthRow);

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Fechar';
    closeButton.className = 'tool-button pure-material-tool-button-contained';
    closeButton.style.cssText = 'width: 100%; margin-top: 20px;';
    closeButton.onclick = () => {
        document.body.removeChild(modal);
    };
    content.appendChild(closeButton);

    modal.appendChild(content);

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };

    document.body.appendChild(modal);
}

function createHatchTypeSelect(value, onChange) {
    const select = document.createElement('select');
    select.className = 'tool-select';
    select.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;';

    const options = [
        { value: 'diagonal-right', label: 'Diagonal /' },
        { value: 'diagonal-left', label: 'Diagonal \\' },
        { value: 'horizontal', label: 'Horizontal —' },
        { value: 'vertical', label: 'Vertical |' },
        { value: 'cross', label: 'Cruz +' },
        { value: 'cross-diagonal', label: 'Cruz X' },
        { value: 'dots', label: 'Pontos' }
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === value) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    select.onchange = (e) => onChange(e.target.value);

    return select;
}
