// Path: js/military_tools/coordination_measure_tool/attributes/coordination_measure_attributes_panel.js

/**
 * @fileoverview Coordination measure attributes panel - main compositor.
 * Provides the main panel UI for configuring coordination measure properties.
 */

import {
    createSliderWithInput,
    createAttributeRow,
    createStandardButtons,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    createCoordinateEditor,
    getCommonConfig
} from '../../../tool_manager';

import { openPointModal } from './point-selector.modal.js';

/**
 * Adds coordination measure attributes to the panel.
 *
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Array of selected coordination measure features
 * @param {Object} coordinationMeasureControl - Control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 */
export function addCoordinationMeasureAttributesToPanel(
    panel,
    selectedFeatures,
    coordinationMeasureControl,
    selectionManager,
    uiManager
) {
    if (!selectedFeatures || selectedFeatures.length === 0) return;

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(
        selectedFeatures.map(f => [f.properties.id, { ...f.properties }])
    );

    if (selectedFeatures.length === 1) {
        const headerComponent = createFeatureHeaderWithOptions(
            feature.properties.nome,
            (newName) => {
                coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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
        infoText.textContent = `${selectedFeatures.length} medidas selecionadas`;

        const optionsButton = createFeatureOptionsButton(
            selectedFeatures,
            selectionManager,
            uiManager
        );

        multiSelectHeader.appendChild(infoText);
        multiSelectHeader.appendChild(optionsButton);
        panel.appendChild(multiSelectHeader);
    }

    if (selectedFeatures.length === 1) {
        const pointButton = document.createElement('button');
        pointButton.classList.add('tool-button', 'pure-material-button-contained');
        pointButton.textContent = 'Configurar';
        pointButton.style.cssText = 'width: 100%; margin-bottom: 15px; padding: 10px;';
        pointButton.onclick = () => openPointModal({
            feature,
            selectedFeatures,
            coordinationMeasureControl,
            selectionManager,
            initialPropertiesMap
        });

        panel.appendChild(createAttributeRow('Simbolo:', pointButton));
    }

    const sizeControl = createSliderWithInput(getCommonConfig('size',
        feature.properties.size || 1.0, {
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'size', value);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Tamanho:', sizeControl));

    const createdAtZoomControl = createSliderWithInput({
        min: 1,
        max: 21,
        step: 0.1,
        value: Math.round(feature.properties.createdAtZoom * 10) / 10,
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Zoom de referencia:', createdAtZoomControl));

    const opacityControl = createSliderWithInput(getCommonConfig('opacity',
        Math.round((feature.properties.opacity || 1.0) * 100), {
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
            uiManager.updateSelectionHighlight();
        }
    }));

    panel.appendChild(createAttributeRow('Opacidade:', opacityControl));

    const rotationControl = createSliderWithInput({
        min: -180,
        max: 180,
        step: 15,
        value: feature.properties.rotation || 0,
        onChange: (value) => {
            coordinationMeasureControl.updateFeaturesProperty(selectedFeatures, 'rotation', value);
            uiManager.updateSelectionHighlight();
        }
    });

    panel.appendChild(createAttributeRow('Rotacao (°):', rotationControl));

    if (selectedFeatures.length === 1) {
        const coordEditor = createCoordinateEditor(
            feature,
            uiManager,
            async (lat, lng) => {
                const updatedFeature = {
                    ...feature,
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    }
                };

                await coordinationMeasureControl.updateFeatures([updatedFeature], true, false);

                uiManager.updateSelectionHighlight();

                if (coordEditor.updateCoordinates) {
                    coordEditor.updateCoordinates(lat, lng);
                }

                setTimeout(() => uiManager.updatePanels(), 100);
            },
            false
        );
        panel.appendChild(coordEditor);
    }

    const buttons = createStandardButtons({
        selectedFeatures,
        control: coordinationMeasureControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => coordinationMeasureControl.setDefaultProperties(feature.properties)
    });

    panel.appendChild(buttons);
}
