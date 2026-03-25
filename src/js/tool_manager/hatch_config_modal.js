// Path: js/tool_manager/hatch_config_modal.js

import { createModernSlider, createModernColorPicker } from './helpers/index.js';

export function openHatchConfigModal(feature, selectedFeatures, control) {
    const modal = document.createElement('div');
    modal.className = 'hatch-config-modal';

    const content = document.createElement('div');
    content.className = 'hatch-config-modal__content';

    const title = document.createElement('h3');
    title.textContent = 'Configurações de Hachura';
    title.className = 'hatch-config-modal__title';
    content.appendChild(title);

    const typeSelect = createHatchTypeSelect(
        feature.properties.hatchType || 'diagonal-right',
        (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchType', newValue);
        }
    );
    const typeRow = createAttributeRowSimple('Tipo:', typeSelect);
    content.appendChild(typeRow);

    const colorPicker = createModernColorPicker({
        label: 'Cor',
        value: feature.properties.hatchColor || '#000000',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchColor', color);
        }
    });
    content.appendChild(colorPicker);

    const spacingSlider = createModernSlider({
        label: 'Espaçamento',
        min: 4,
        max: 20,
        step: 2,
        value: feature.properties.hatchSpacing || 8,
        onChange: (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchSpacing', newValue);
        }
    });
    content.appendChild(spacingSlider);

    const widthSlider = createModernSlider({
        label: 'Espessura',
        min: 1,
        max: 5,
        step: 1,
        value: feature.properties.hatchLineWidth || 2,
        onChange: (newValue) => {
            control.updateFeaturesProperty(selectedFeatures, 'hatchLineWidth', newValue);
        }
    });
    content.appendChild(widthSlider);

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Fechar';
    closeButton.className = 'tool-button pure-material-tool-button-contained hatch-config-modal__close-btn';
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

function createAttributeRowSimple(labelText, inputElement) {
    const container = document.createElement('div');
    container.className = 'hatch-config-modal__type-row';

    const label = document.createElement('label');
    label.textContent = labelText;
    label.className = 'hatch-config-modal__type-label';

    container.appendChild(label);
    container.appendChild(inputElement);

    return container;
}

function createHatchTypeSelect(value, onChange) {
    const select = document.createElement('select');
    select.className = 'tool-select hatch-config-modal__select';

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
