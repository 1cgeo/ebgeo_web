// Path: js/analysis_tools/los_tool/los_attributes_panel.js

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '../../tool_manager/helpers/index.js';

/**
 * Add LOS attributes to the panel
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected LOS features
 * @param {Object} losControl - LOS control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addLOSAttributesToPanel(panel, selectedFeatures, losControl, selectionManager, uiManager, options = {}) {
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
            infoText.textContent = `${selectedFeatures.length} linhas de visada selecionadas`;

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

    // Opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1) * 100),
        unit: '%',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Width slider
    panel.appendChild(createModernSlider({
        label: 'Largura',
        min: 1,
        max: 30,
        step: 1,
        value: feature.properties.width || 3,
        unit: 'px',
        onChange: (value) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        }
    }));

    // Options section
    panel.appendChild(createSectionDivider('Opções'));

    // Show measure toggle
    panel.appendChild(createModernToggle({
        label: 'Mostrar Medição',
        checked: feature.properties.measure || false,
        onChange: (checked) => {
            losControl.updateFeaturesProperty(selectedFeatures, 'measure', checked);
        }
    }));

    // Show profile toggle (single selection only)
    if (selectedFeatures.length === 1) {
        panel.appendChild(createModernToggle({
            id: 'profile-toggle',
            label: 'Mostrar Perfil',
            checked: feature.properties.profile || false,
            onChange: (checked) => {
                losControl.updateFeaturesProperty(selectedFeatures, 'profile', checked);
                selectionManager.updateProfile();
            }
        }));
    }

    // Action buttons (no set default for LOS)
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: losControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        onSetDefault: null
    }));
}
