// Path: js/military_tools/military_symbol_tool/attributes/military_symbol_attributes_panel.js

/**
 * @fileoverview Military symbol attributes panel - main compositor.
 * Provides the main panel UI for configuring military symbol properties.
 */

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../../tool_manager/helpers/index.js';

import { openSymbolModal } from './symbol-selector.modal.js';

/**
 * Adds military symbol attributes to the panel.
 *
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected military symbol features
 * @param {Object} militarySymbolControl - Military symbol control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addMilitarySymbolAttributesToPanel(panel, selectedFeatures, militarySymbolControl, selectionManager, uiManager, options = {}) {
    if (!selectedFeatures || selectedFeatures.length === 0) {
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
                    militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} símbolos militares selecionados`;

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

    // Configure symbol button (single selection only)
    if (selectedFeatures.length === 1) {
        const symbolButtonContainer = document.createElement('div');
        symbolButtonContainer.className = 'attr-modern-button-row';

        const symbolButton = document.createElement('button');
        symbolButton.className = 'attr-modern-btn attr-modern-btn-primary';
        symbolButton.style.flex = '1';
        symbolButton.textContent = 'Configurar Símbolo';
        symbolButton.onclick = () => openSymbolModal({
            feature,
            selectedFeatures,
            militarySymbolControl,
            selectionManager,
            initialPropertiesMap
        });

        symbolButtonContainer.appendChild(symbolButton);
        panel.appendChild(symbolButtonContainer);
    }

    // Size slider
    panel.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 0.5,
        max: 3,
        step: 0.1,
        value: feature.properties.size || 1.0,
        unit: '',
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        }
    }));

    // Zoom correction toggle
    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        }
    }));

    // Reference zoom slider
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    });

    if (feature.properties.zoomCorrectionEnabled === false) {
        zoomSlider.style.display = 'none';
    }

    panel.appendChild(zoomSlider);

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1.0) * 100),
        unit: '%',
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Rotation slider
    panel.appendChild(createModernSlider({
        label: 'Rotação',
        min: -180,
        max: 180,
        step: 15,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            militarySymbolControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: militarySymbolControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => militarySymbolControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
