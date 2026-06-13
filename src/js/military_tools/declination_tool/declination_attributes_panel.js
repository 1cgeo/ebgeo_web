// Path: js/military_tools/declination_tool/declination_attributes_panel.js

/**
 * @fileoverview Attributes panel for magnetic declination diagram features.
 */

import {
    createModernSlider,
    createModernToggle,
    createModernButtons,
    createModernInfoBox,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
} from '@tools';
import { formatSignedDegrees } from '@utils/angle-format.js';

/**
 * Adds declination diagram attributes to the panel.
 *
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected declination features
 * @param {Object} declinationControl - Declination control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addDeclinationAttributesToPanel(panel, selectedFeatures, declinationControl, selectionManager, uiManager, options = {}) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

    // Header
    if (!options.hideHeader) {
        if (selectedFeatures.length === 1) {
            const headerComponent = createFeatureHeaderWithOptions(
                feature.properties.nome,
                (newName) => {
                    declinationControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    uiManager.updateSelectionHighlight();
                },
                selectedFeatures,
                selectionManager,
                uiManager
            );
            panel.appendChild(headerComponent);
        } else {
            const multiSelectHeader = document.createElement('div');
            multiSelectHeader.className = 'feature-header-with-options';

            const infoText = document.createElement('div');
            infoText.className = 'feature-name-wrapper';
            infoText.textContent = `${selectedFeatures.length} diagramas de declinação selecionados`;

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

    // Three-norths values (read-only)
    if (selectedFeatures.length === 1) {
        const decl = feature.properties.declination ?? 0;
        const conv = feature.properties.convergence ?? 0;
        const grid = decl - conv; // grid angle (NQ→NM)
        const fmt = (v) => formatSignedDegrees(v, { long: true });

        panel.appendChild(createModernInfoBox({
            title: 'Diagrama de Nortes',
            rows: [
                { text: `Declinação magnética (NV-NM): ${fmt(decl)}` },
                { text: `Convergência meridiana (NV-NQ): ${fmt(conv)}` },
                { text: `Ângulo de quadrícula (NQ-NM): ${fmt(grid)}` },
                { text: `WMM2025 · ${feature.properties.calculationDate || ''}` },
            ],
        }));
    }

    // Size slider
    panel.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 0.1,
        max: 5,
        step: 0.1,
        value: feature.properties.size || 1.0,
        unit: '',
        onChange: (value) => {
            declinationControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        },
    }));

    // Zoom correction toggle
    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            declinationControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        },
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
            declinationControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        },
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
            declinationControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        },
    }));

    // Action buttons (save/reset/delete)
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: declinationControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: false,
        hidden: options.hideButtons,
    }));
}
