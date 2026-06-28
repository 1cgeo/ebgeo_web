// Path: js/military_tools/coordination_measure_tool/attributes/coordination_measure_attributes_panel.js

/**
 * @fileoverview Coordination measure attributes panel - main compositor.
 * Provides the main panel UI for configuring coordination measure properties.
 */

import {
    createModernSlider,
    createModernToggle,
    createModernButtons
} from '@tools';

import { openPointModal } from './point-selector.modal.js';

/**
 * Adds coordination measure attributes to the panel.
 *
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected coordination measure features
 * @param {Object} coordinationMeasureControl - Control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addCoordinationMeasureAttributesToPanel(
    panel,
    selectedFeatures,
    coordinationMeasureControl,
    selectionManager,
    uiManager,
    options = {}
) {
    if (!selectedFeatures || selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(
        selectedFeatures.map(f => [f.properties.id, { ...f.properties }])
    );

    if (selectedFeatures.length === 1) {
        const pointButtonContainer = document.createElement('div');
        pointButtonContainer.className = 'attr-modern-button-row';

        const pointButton = document.createElement('button');
        pointButton.className = 'attr-modern-btn attr-modern-btn-primary coord-point-btn';
        pointButton.textContent = 'Configurar Símbolo';
        pointButton.onclick = () => openPointModal({
            feature,
            selectedFeatures,
            coordinationMeasureControl,
            selectionManager,
            initialPropertiesMap
        });

        pointButtonContainer.appendChild(pointButton);
        panel.appendChild(pointButtonContainer);
    }

    panel.appendChild(createModernSlider({
        label: 'Tamanho',
        min: 0.5,
        max: 3,
        step: 0.1,
        value: feature.properties.size || 1.0,
        unit: '',
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'size', value);
        }
    }));

    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: (enabled) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.style.display = enabled ? '' : 'none';
        }
    }));

    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    });

    if (feature.properties.zoomCorrectionEnabled === false) {
        zoomSlider.style.display = 'none';
    }

    panel.appendChild(zoomSlider);

    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity || 1.0) * 100),
        unit: '%',
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    panel.appendChild(createModernSlider({
        label: 'Rotação',
        min: -180,
        max: 180,
        step: 15,
        value: feature.properties.rotation || 0,
        unit: '°',
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
        }
    }));

    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: coordinationMeasureControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => coordinationMeasureControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}
