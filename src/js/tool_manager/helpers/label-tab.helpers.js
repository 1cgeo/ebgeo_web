// Path: js/tool_manager/helpers/label-tab.helpers.js

/**
 * @fileoverview Shared label (Etiqueta) tab builder for shape attribute panels.
 * Reuses the same label pattern established by the point tool.
 */

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createSectionDivider,
} from './index.js';

export const LABEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;

export const STYLE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;

/**
 * Default label properties shared by all shape tools.
 */
export const LABEL_DEFAULT_PROPERTIES = {
    showLabel: false,
    labelText: '',
    labelColor: '#ffffff',
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2,
};

/**
 * Check if any label property changed between current feature and initial state.
 * @param {Object} feature - Current feature
 * @param {Object} initialProperties - Snapshot of initial properties
 * @returns {boolean} True if any label property differs
 */
export function hasLabelChanged(feature, initialProperties) {
    const props = feature.properties;
    return Object.keys(LABEL_DEFAULT_PROPERTIES).some(
        key => props[key] !== initialProperties[key]
    );
}

/**
 * Wraps existing panel content in a two-tab layout (Estilo + Etiqueta).
 * Returns the tabs container to be appended to the panel.
 * @param {Object} params
 * @param {Function} params.buildStyleContent - Callback that receives a container and populates style controls
 * @param {Array} params.selectedFeatures - Selected features
 * @param {Object} params.feature - First selected feature
 * @param {Object} params.control - Tool control instance
 * @returns {HTMLElement} Tabs container element
 */
export function buildShapeTabsWithLabel({ buildStyleContent, selectedFeatures, feature, control }) {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'feature-tabs-container';

    // Tab buttons
    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'feature-tabs-buttons';

    const styleTabBtn = document.createElement('button');
    styleTabBtn.type = 'button';
    styleTabBtn.className = 'feature-tab-btn active';
    styleTabBtn.innerHTML = `${STYLE_ICON}<span>Estilo</span>`;
    styleTabBtn.dataset.tabId = 'style';

    const labelTabBtn = document.createElement('button');
    labelTabBtn.type = 'button';
    labelTabBtn.className = 'feature-tab-btn';
    labelTabBtn.innerHTML = `${LABEL_ICON}<span>Etiqueta</span>`;
    labelTabBtn.dataset.tabId = 'label';

    tabButtonsContainer.appendChild(styleTabBtn);
    tabButtonsContainer.appendChild(labelTabBtn);
    tabsContainer.appendChild(tabButtonsContainer);

    // Tab contents
    const styleTabContent = document.createElement('div');
    styleTabContent.className = 'feature-tab-content active';
    styleTabContent.dataset.tabId = 'style';

    const labelTabContent = document.createElement('div');
    labelTabContent.className = 'feature-tab-content';
    labelTabContent.dataset.tabId = 'label';

    // Build style tab via callback
    buildStyleContent(styleTabContent);

    // Build label tab
    _buildLabelTab(labelTabContent, selectedFeatures, feature, control);

    tabsContainer.appendChild(styleTabContent);
    tabsContainer.appendChild(labelTabContent);

    // Tab switching (uses direct refs instead of querySelectorAll)
    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (!btn) return;

        const tabId = btn.dataset.tabId;
        styleTabBtn.classList.toggle('active', tabId === 'style');
        labelTabBtn.classList.toggle('active', tabId === 'label');
        styleTabContent.classList.toggle('active', tabId === 'style');
        labelTabContent.classList.toggle('active', tabId === 'label');
    });

    return tabsContainer;
}

/**
 * Builds the label tab content for shapes.
 * Similar to point label tab but without coordinate fill button and zoom correction.
 */
function _buildLabelTab(container, selectedFeatures, feature, control) {
    // Show label toggle
    const showLabelToggle = createModernToggle({
        label: 'Mostrar Etiqueta',
        checked: feature.properties.showLabel === true,
        onChange: (checked) => {
            control.updateFeaturesProperty(selectedFeatures, 'showLabel', checked);
            toggleLabelControls(checked);
        }
    });
    container.appendChild(showLabelToggle);

    // Label text
    const textField = createModernTextarea({
        label: 'Texto da Etiqueta',
        value: feature.properties.labelText || '',
        rows: 1,
        placeholder: 'Texto visível no mapa',
        onChange: (text) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelText', text);
        }
    });
    const textarea = textField.getTextarea();
    textarea.classList.add('attr-modern-textarea-input--single-line');
    container.appendChild(textField);

    container.appendChild(createSectionDivider('Estilo do Texto'));

    // Label color
    const labelColorPicker = createModernColorPicker({
        label: 'Cor do Texto',
        value: feature.properties.labelColor || '#ffffff',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelColor', color);
        }
    });
    container.appendChild(labelColorPicker);

    // Label size
    const labelSizeSlider = createModernSlider({
        label: 'Tamanho da Fonte',
        min: 8,
        max: 32,
        step: 1,
        value: feature.properties.labelSize || 14,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelSize', value);
        }
    });
    container.appendChild(labelSizeSlider);

    container.appendChild(createSectionDivider('Contorno do Texto'));

    // Outline color
    const outlineColorPicker = createModernColorPicker({
        label: 'Cor do Contorno',
        value: feature.properties.labelOutlineColor || '#000000',
        onChange: (color) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelOutlineColor', color);
        }
    });
    container.appendChild(outlineColorPicker);

    // Outline width
    const outlineWidthSlider = createModernSlider({
        label: 'Espessura do Contorno',
        min: 0,
        max: 5,
        step: 1,
        value: feature.properties.labelOutlineWidth ?? 2,
        unit: 'px',
        onChange: (value) => {
            control.updateFeaturesProperty(selectedFeatures, 'labelOutlineWidth', value);
        }
    });
    container.appendChild(outlineWidthSlider);

    // Toggle controls on/off based on showLabel
    const controlElements = [textField, labelColorPicker, labelSizeSlider, outlineColorPicker, outlineWidthSlider];

    function toggleLabelControls(enabled) {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button, textarea');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.classList.toggle('feature-tab-control--disabled', !enabled);
        });
    }

    // Initialize state
    toggleLabelControls(feature.properties.showLabel === true);
}
