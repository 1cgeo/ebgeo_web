// Path: js/draw_tools/text_tool/text_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernTextarea,
    createModernTabs,
    createModernTextAlignment,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Create text attributes panel for selected text features
 * @param {HTMLElement} panel - Container element for attributes
 * @param {Array} selectedFeatures - Array of selected text features
 * @param {Object} textControl - Text control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addTextAttributesToPanel(panel, selectedFeatures, textControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Only show header if not hidden (for sidebar integration)
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    textControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} textos selecionados`;

            const optionsButton = createFeatureOptionsButton(
                selectedFeatures,
                selectionManager,
                uiManager
            );

            multiSelectHeader.appendChild(infoText);
            multiSelectHeader.appendChild(optionsButton);
            panel.appendChild(multiSelectHeader);
        }
    }

    // Track text content for justify buttons state
    let currentText = feature.properties.text;

    // Create tab content containers
    const textTabContent = document.createElement('div');
    const backgroundTabContent = document.createElement('div');

    // Build text tab content
    buildTextTabContent(textTabContent, feature, selectedFeatures, textControl, uiManager, (text) => {
        currentText = text;
    });

    // Build background tab content
    buildBackgroundTabContent(backgroundTabContent, feature, selectedFeatures, textControl);

    // Create tabs
    const tabs = createModernTabs({
        tabs: [
            { id: 'text', label: 'Texto', content: textTabContent },
            { id: 'background', label: 'Caixa de Fundo', content: backgroundTabContent }
        ],
        defaultTab: 'text'
    });

    panel.appendChild(tabs);

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: textControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => textControl.setDefaultProperties(feature.properties)
    }));
}

/**
 * Build the text tab content
 */
function buildTextTabContent(container, feature, selectedFeatures, textControl, uiManager, onTextChange) {
    // Text input (single selection only)
    if (selectedFeatures.length === 1) {
        container.appendChild(createModernTextarea({
            label: 'Conteúdo',
            value: feature.properties.text,
            rows: 3,
            onChange: (value) => {
                textControl.updateFeaturesProperty(selectedFeatures, 'text', value);
                onTextChange(value);
            }
        }));
    }

    // Font size slider
    container.appendChild(createModernSlider({
        label: 'Tamanho da Fonte',
        min: 1,
        max: 72,
        step: 1,
        value: feature.properties.size,
        unit: 'px',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        }
    }));

    // Reference zoom slider
    container.appendChild(createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            textControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    }));

    // Text color picker
    container.appendChild(createModernColorPicker({
        label: 'Cor do Texto',
        value: feature.properties.color,
        onChange: (color) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'color', color);
        }
    }));

    // Text halo section
    container.appendChild(createSectionDivider('Contorno do Texto'));

    // Halo width slider
    container.appendChild(createModernSlider({
        label: 'Espessura do Contorno',
        min: 0,
        max: 10,
        step: 1,
        value: feature.properties.textHaloWidth || 2,
        unit: 'px',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'textHaloWidth', value);
        }
    }));

    // Halo color picker
    container.appendChild(createModernColorPicker({
        label: 'Cor do Contorno',
        value: feature.properties.backgroundColor,
        onChange: (color) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', color);
        }
    }));

    // Layout section
    container.appendChild(createSectionDivider('Layout'));

    // Rotation slider
    container.appendChild(createModernSlider({
        label: 'Rotação',
        min: 0,
        max: 360,
        step: 1,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
        }
    }));

    // Text alignment
    const hasMultipleLines = feature.properties.text.split('\n').length > 1;
    container.appendChild(createModernTextAlignment({
        label: 'Alinhamento',
        value: feature.properties.justify || 'center',
        disabled: !hasMultipleLines,
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'justify', value);
        }
    }));
}

/**
 * Build the background tab content
 */
function buildBackgroundTabContent(container, feature, selectedFeatures, textControl) {
    // Show background toggle
    const toggleContainer = createModernToggle({
        label: 'Mostrar Caixa de Fundo',
        checked: feature.properties.showBackground === true,
        onChange: (checked) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'showBackground', checked);
            toggleBackgroundControls(checked);
        }
    });
    container.appendChild(toggleContainer);

    // Background fill color
    const fillColorPicker = createModernColorPicker({
        label: 'Cor do Preenchimento',
        value: feature.properties.backgroundFillColor,
        onChange: (color) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundFillColor', color);
        }
    });
    container.appendChild(fillColorPicker);

    // Background fill opacity
    const fillOpacitySlider = createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.backgroundFillOpacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundFillOpacity', value / 100);
        }
    });
    container.appendChild(fillOpacitySlider);

    // Background border section
    container.appendChild(createSectionDivider('Borda da Caixa'));

    // Background border color
    const borderColorPicker = createModernColorPicker({
        label: 'Cor da Borda',
        value: feature.properties.backgroundBorderColor,
        onChange: (color) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderColor', color);
        }
    });
    container.appendChild(borderColorPicker);

    // Background border opacity
    const borderOpacitySlider = createModernSlider({
        label: 'Opacidade da Borda',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.backgroundBorderOpacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderOpacity', value / 100);
        }
    });
    container.appendChild(borderOpacitySlider);

    // Background border width
    const borderWidthSlider = createModernSlider({
        label: 'Espessura da Borda',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.backgroundBorderWidth || 1,
        unit: 'px',
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderWidth', value);
        }
    });
    container.appendChild(borderWidthSlider);

    // Store references for toggling
    const controlElements = [fillColorPicker, fillOpacitySlider, borderColorPicker, borderOpacitySlider, borderWidthSlider];

    // Function to toggle background controls
    const toggleBackgroundControls = (enabled) => {
        controlElements.forEach(el => {
            const inputs = el.querySelectorAll('input, button');
            inputs.forEach(input => {
                input.disabled = !enabled;
            });
            el.style.opacity = enabled ? '1' : '0.5';
            el.style.pointerEvents = enabled ? 'auto' : 'none';
        });
    };

    // Initialize state
    toggleBackgroundControls(feature.properties.showBackground === true);
}
