// Path: js/analysis_tools/visibility_tool/visibility_attributes_panel.js

import {
    createModernSlider,
    createModernButtons as _createModernButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Create visibility attributes panel for selected visibility features
 * @param {HTMLElement} panel - Container element for attributes
 * @param {Array} selectedFeatures - Array of selected visibility features
 * @param {Object} visibilityControl - Visibility control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addVisibilityAttributesToPanel(panel, selectedFeatures, visibilityControl, selectionManager, uiManager, options = {}) {
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
                    visibilityControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
            infoText.textContent = `${selectedFeatures.length} áreas de visibilidade selecionadas`;

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

    // Debounce timer for recalculation
    let observerHeightDebounceTimer = null;

    const debouncedRecalculate = () => {
        clearTimeout(observerHeightDebounceTimer);
        observerHeightDebounceTimer = setTimeout(() => {
            visibilityControl.updateFeatures(selectedFeatures, false, false, true);
        }, 500);
    };

    // Observer height slider
    panel.appendChild(createModernSlider({
        label: 'Altura do Observador',
        min: 1,
        max: 20,
        step: 0.5,
        value: feature.properties.observerHeight || 2,
        unit: 'm',
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'observerHeight', value);
            debouncedRecalculate();
        }
    }));

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            visibilityControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Custom buttons for visibility (with special save/discard behavior)
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'attr-modern-buttons';

    const buttonRow = document.createElement('div');
    buttonRow.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.className = 'attr-modern-btn attr-modern-btn-save';
    saveButton.textContent = 'Salvar';
    saveButton.onclick = () => {
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.className = 'attr-modern-btn attr-modern-btn-discard';
    discardButton.textContent = 'Descartar';
    discardButton.onclick = () => {
        clearTimeout(observerHeightDebounceTimer);
        visibilityControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(discardButton);
    buttonContainer.appendChild(buttonRow);
    panel.appendChild(buttonContainer);
}
