// Path: js\controls_sig\text_tool\text_attributes_panel.js

import {
    createSliderWithInput,
    createColorPicker,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    createCheckbox,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addTextAttributesToPanel(panel, selectedFeatures, textControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                textControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== ESTRUTURA DE ABAS =====
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tabs-container';
    tabsContainer.style.cssText = 'margin-top: 15px;';

    // Container das abas (navegação)
    const tabsNav = document.createElement('div');
    tabsNav.className = 'tabs-nav';
    tabsNav.style.cssText = `
        display: flex;
        border-bottom: 2px solid #ddd;
        margin-bottom: 15px;
    `;

    // Aba Texto
    const textTab = document.createElement('button');
    textTab.className = 'tab-button active';
    textTab.textContent = 'Texto';
    textTab.style.cssText = `
        flex: 1;
        padding: 10px 15px;
        border: none;
        background: #f8f9fa;
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        font-weight: bold;
        transition: all 0.2s;
    `;

    // Aba Caixa de Fundo
    const backgroundTab = document.createElement('button');
    backgroundTab.className = 'tab-button';
    backgroundTab.textContent = 'Caixa de Fundo';
    backgroundTab.style.cssText = `
        flex: 1;
        padding: 10px 15px;
        border: none;
        background: #e9ecef;
        cursor: pointer;
        border-radius: 4px 4px 0 0;
        transition: all 0.2s;
    `;

    tabsNav.appendChild(textTab);
    tabsNav.appendChild(backgroundTab);

    // Container do conteúdo das abas
    const tabsContent = document.createElement('div');
    tabsContent.className = 'tabs-content';

    // ===== ABA TEXTO (CONTEÚDO) =====
    const textTabContent = document.createElement('div');
    textTabContent.className = 'tab-content active';
    textTabContent.id = 'text-tab-content';

    // Textarea específica para texto (apenas seleção única)
    if (selectedFeatures.length === 1) {
        const textInput = document.createElement('textarea');
        textInput.id = 'text-area';
        textInput.value = feature.properties.text;
        textInput.rows = 3;
        textInput.oninput = (e) => {
            updateJustifyButtons(e.target.value);
            textControl.updateFeaturesProperty(selectedFeatures, 'text', e.target.value);
            uiManager.updateSelectionHighlight();
        };
        $(textTabContent).append(
            $("<div>", { class: "attr-container-column" })
                .append($("<div>", { class: "attr-input-full" }).append(textInput))
        );
    }

    // Tamanho
    const sizeControl = createSliderWithInput({
        min: 1,
        max: 72,
        step: 1,
        value: feature.properties.size,
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'size', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    });

    $(textTabContent).append(createAttributeRow('Tamanho (px):', sizeControl));

    const createdAtZoomControl = createSliderWithInput({
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            textControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    $(textTabContent).append(createAttributeRow('Zoom de referência:', createdAtZoomControl));

    // Cor do texto
    const colorInput = createColorPicker(feature.properties.color, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'color', e.target.value);
    }, 'Cor do texto');

    $(textTabContent).append(createAttributeRow('Cor:', colorInput));

    // Borda do texto (halo)
    const textHaloInput = createColorPicker(feature.properties.backgroundColor, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundColor', e.target.value);
    }, 'Borda do texto');

    $(textTabContent).append(createAttributeRow('Borda do texto:', textHaloInput));

    // Rotação
    const rotateControl = createSliderWithInput(getCommonConfig('rotation',
        feature.properties.rotation || 0, {
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'rotation', parseInt(value, 10));
            uiManager.updateSelectionHighlight();
        }
    }));

    $(textTabContent).append(createAttributeRow('Rotação:', rotateControl));

    // Justify buttons
    const justifyLabel = document.createElement('label');
    justifyLabel.textContent = 'Justificativa:';
    justifyLabel.className = 'justify-label';
    const justifyButtonsContainer = $("<div>", { class: "justify-buttons" });

    // Initialize button variables
    let justifyLeftButton, justifyCenterButton, justifyRightButton;
    const justifyOptions = ['left', 'center', 'right'];
    justifyOptions.forEach(option => {
        const button = document.createElement('button');
        button.innerHTML = option[0].toUpperCase();
        button.title = `Align ${option}`;
        button.onclick = () => {
            textControl.updateFeaturesProperty(selectedFeatures, 'justify', option);
        };
        justifyButtonsContainer.append(button);

        if (option === 'left') {
            justifyLeftButton = button;
        } else if (option === 'center') {
            justifyCenterButton = button;
        } else if (option === 'right') {
            justifyRightButton = button;
        }
    });

    $(textTabContent).append(
        $("<div>", { class: "justify-container" })
            .append(justifyLabel)
            .append(justifyButtonsContainer)
    );

    // Função específica updateJustifyButtons
    const updateJustifyButtons = (text) => {
        const lines = text.split('\n').length;
        const enabled = lines > 1;
        if (justifyLeftButton) justifyLeftButton.disabled = !enabled;
        if (justifyCenterButton) justifyCenterButton.disabled = !enabled;
        if (justifyRightButton) justifyRightButton.disabled = !enabled;
    };

    // Initialize justify buttons state
    updateJustifyButtons(feature.properties.text);

    // ===== ABA CAIXA DE FUNDO (CONTEÚDO) =====
    const backgroundTabContent = document.createElement('div');
    backgroundTabContent.className = 'tab-content';
    backgroundTabContent.id = 'background-tab-content';
    backgroundTabContent.style.display = 'none';

    // Checkbox principal
    const showBackgroundCheckbox = createCheckbox(feature.properties.showBackground, (e) => {
        const enabled = e.target.checked;
        textControl.updateFeaturesProperty(selectedFeatures, 'showBackground', enabled);
        toggleBackgroundControls(enabled);
    });

    $(backgroundTabContent).append(createAttributeRow('Mostrar caixa:', showBackgroundCheckbox));

    // Cor do preenchimento
    const backgroundFillColorInput = createColorPicker(feature.properties.backgroundFillColor, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundFillColor', e.target.value);
    }, 'Cor do preenchimento');

    $(backgroundTabContent).append(createAttributeRow('Preenchimento:', backgroundFillColorInput));

    // Opacidade do preenchimento  
    const backgroundFillOpacityControl = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(feature.properties.backgroundFillOpacity * 100),
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundFillOpacity', value / 100);
        }
    });

    $(backgroundTabContent).append(createAttributeRow('Opacidade preenchimento:', backgroundFillOpacityControl));

    // Cor da borda
    const backgroundBorderColorInput = createColorPicker(feature.properties.backgroundBorderColor, (e) => {
        textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderColor', e.target.value);
    }, 'Cor da borda');

    $(backgroundTabContent).append(createAttributeRow('Borda:', backgroundBorderColorInput));

    // Opacidade da borda
    const backgroundBorderOpacityControl = createSliderWithInput({
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(feature.properties.backgroundBorderOpacity * 100),
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderOpacity', value / 100);
        }
    });

    $(backgroundTabContent).append(createAttributeRow('Opacidade borda:', backgroundBorderOpacityControl));

    // Largura da borda
    const backgroundBorderWidthControl = createSliderWithInput({
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.backgroundBorderWidth,
        onChange: (value) => {
            textControl.updateFeaturesProperty(selectedFeatures, 'backgroundBorderWidth', parseInt(value, 10));
        }
    });

    $(backgroundTabContent).append(createAttributeRow('Largura borda:', backgroundBorderWidthControl));

    // Função para enable/disable controles de background
    const toggleBackgroundControls = (enabled) => {
        const controls = [
            backgroundFillColorInput,
            backgroundFillOpacityControl.querySelector('input[type="range"]'),
            backgroundFillOpacityControl.querySelector('input[type="number"]'),
            backgroundBorderColorInput,
            backgroundBorderOpacityControl.querySelector('input[type="range"]'),
            backgroundBorderOpacityControl.querySelector('input[type="number"]'),
            backgroundBorderWidthControl.querySelector('input[type="range"]'),
            backgroundBorderWidthControl.querySelector('input[type="number"]')
        ];

        controls.forEach(control => {
            if (control) {
                control.disabled = !enabled;
                control.style.opacity = enabled ? '1' : '0.5';
            }
        });
    };

    // Estado inicial dos controles de background
    toggleBackgroundControls(feature.properties.showBackground);

    // ===== LÓGICA DE ALTERNÂNCIA DAS ABAS =====
    const switchTab = (activeTabButton, activeTabContent, inactiveTabButton, inactiveTabContent) => {
        // Estilo da aba ativa
        activeTabButton.style.background = '#f8f9fa';
        activeTabButton.style.fontWeight = 'bold';
        activeTabButton.classList.add('active');

        // Estilo da aba inativa
        inactiveTabButton.style.background = '#e9ecef';
        inactiveTabButton.style.fontWeight = 'normal';
        inactiveTabButton.classList.remove('active');

        // Mostrar/ocultar conteúdo
        activeTabContent.style.display = 'block';
        activeTabContent.classList.add('active');
        inactiveTabContent.style.display = 'none';
        inactiveTabContent.classList.remove('active');
    };

    // Event listeners das abas
    textTab.onclick = () => {
        switchTab(textTab, textTabContent, backgroundTab, backgroundTabContent);
    };

    backgroundTab.onclick = () => {
        switchTab(backgroundTab, backgroundTabContent, textTab, textTabContent);
    };

    // Montar estrutura das abas
    tabsContent.appendChild(textTabContent);
    tabsContent.appendChild(backgroundTabContent);

    tabsContainer.appendChild(tabsNav);
    tabsContainer.appendChild(tabsContent);

    $(panel).append(tabsContainer);

    // ===== BOTÕES DE AÇÃO PADRONIZADOS (FORA DAS ABAS) =====
    const buttons = createStandardButtons({
        selectedFeatures,
        control: textControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => textControl.setDefaultProperties(feature.properties)
    });

    $(panel).append(buttons);
}