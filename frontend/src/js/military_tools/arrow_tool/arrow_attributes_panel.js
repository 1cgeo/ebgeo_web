// Path: js/military_tools/arrow_tool/arrow_attributes_panel.js

import {
    createModernSlider,
    createModernNumericInput,
    createModernColorPicker,
    createModernToggle,
    createModernButtons,
    createSectionDivider,
    createInitialPropertiesMap
} from '@tools/helpers/index.js';
import { splitArrows } from './arrow-merge.js';

/**
 * Create and populate arrow attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected arrow features
 * @param {Object} arrowControl - Arrow control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addArrowAttributesToPanel(panel, selectedFeatures, arrowControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    // Merged arrow indicator
    const isMerged = feature.properties.isMerged && Array.isArray(feature.properties.branches);
    if (isMerged && selectedFeatures.length === 1) {
        _addMergedIndicator(panel, feature, arrowControl, selectionManager);
    }

    // Fill color picker
    panel.appendChild(createModernColorPicker({
        label: 'Preenchimento',
        value: feature.properties.fillColor,
        onChange: (color) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillColor', color);
        }
    }));

    // Line color picker
    panel.appendChild(createModernColorPicker({
        label: 'Borda',
        value: feature.properties.lineColor,
        onChange: (color) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineColor', color);
        }
    }));

    // Fill opacity slider
    panel.appendChild(createModernSlider({
        label: 'Opacidade do Preenchimento',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.fillOpacity ?? 0.8) * 100),
        unit: '%',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'fillOpacity', value / 100);
        }
    }));

    // Line width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura da Borda',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 3,
        unit: 'px',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        }
    }));

    // Geometry section — per-branch for merged, single for normal
    if (isMerged && selectedFeatures.length === 1) {
        _addBranchGeometryControls(panel, feature, arrowControl, selectedFeatures);
    } else {
        _addSingleGeometryControls(panel, feature, arrowControl, selectedFeatures);
    }

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: arrowControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1 && !isMerged,
        onSetDefault: () => arrowControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}

/**
 * Add merged arrow indicator with split button
 */
function _addMergedIndicator(panel, feature, arrowControl, selectionManager) {
    const branchCount = feature.properties.branches.length;

    const indicator = document.createElement('div');
    indicator.className = 'arrow-merged-indicator';

    const label = document.createElement('span');
    label.textContent = `Seta combinada (${branchCount} ramos)`;
    indicator.appendChild(label);

    const splitBtn = document.createElement('button');
    splitBtn.className = 'arrow-split-btn';
    splitBtn.textContent = 'Separar';
    splitBtn.addEventListener('click', async () => {
        await splitArrows(feature, arrowControl.map, selectionManager);
    });
    indicator.appendChild(splitBtn);

    panel.appendChild(indicator);
}

/**
 * Add geometry controls for a single (non-merged) arrow
 */
function _addSingleGeometryControls(panel, feature, arrowControl, selectedFeatures) {
    panel.appendChild(createSectionDivider('Geometria'));

    panel.appendChild(createModernNumericInput({
        label: 'Largura',
        min: 10,
        max: 10000,
        step: 1,
        value: Math.round(feature.properties.width || 500),
        unit: 'm',
        onChange: (value) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'width', value);
        }
    }));

    panel.appendChild(createSectionDivider('Opções'));

    panel.appendChild(createModernToggle({
        label: 'Aeromóvel / Aeroterrestre',
        checked: feature.properties.airmobile || false,
        onChange: (checked) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'airmobile', checked);
        }
    }));

    panel.appendChild(createModernToggle({
        label: 'Mostrar Seta',
        checked: feature.properties.showArrowHead !== false,
        onChange: (checked) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'showArrowHead', checked);
        }
    }));

    panel.appendChild(createModernToggle({
        label: 'Seta nas Duas Pontas',
        checked: feature.properties.doubleHeaded === true,
        onChange: (checked) => {
            arrowControl.updateFeaturesProperty(selectedFeatures, 'doubleHeaded', checked);
        }
    }));
}

/**
 * Add per-branch geometry controls for merged arrow
 */
function _addBranchGeometryControls(panel, feature, arrowControl, selectedFeatures) {
    const branches = feature.properties.branches;

    branches.forEach((branch, idx) => {
        panel.appendChild(createSectionDivider(`Ramo ${idx + 1}`));

        panel.appendChild(createModernNumericInput({
            label: 'Largura',
            min: 10,
            max: 10000,
            step: 1,
            value: Math.round(branch.width || feature.properties.width || 500),
            unit: 'm',
            onChange: (value) => {
                _updateBranchProperty(feature, arrowControl, selectedFeatures, idx, 'width', value);
            }
        }));

        panel.appendChild(createModernToggle({
            label: 'Aeromóvel / Aeroterrestre',
            checked: branch.airmobile || false,
            onChange: (checked) => {
                _updateBranchProperty(feature, arrowControl, selectedFeatures, idx, 'airmobile', checked);
            }
        }));

        panel.appendChild(createModernToggle({
            label: 'Mostrar Seta',
            checked: branch.showArrowHead !== false,
            onChange: (checked) => {
                _updateBranchProperty(feature, arrowControl, selectedFeatures, idx, 'showArrowHead', checked);
            }
        }));

        panel.appendChild(createModernToggle({
            label: 'Seta nas Duas Pontas',
            checked: branch.doubleHeaded === true,
            onChange: (checked) => {
                _updateBranchProperty(feature, arrowControl, selectedFeatures, idx, 'doubleHeaded', checked);
            }
        }));
    });
}

/**
 * Update a property on a specific branch and regenerate geometry
 */
function _updateBranchProperty(feature, arrowControl, selectedFeatures, branchIndex, property, value) {
    const branches = feature.properties.branches.map(b => ({ ...b }));
    branches[branchIndex][property] = value;

    // Update branches array, then regenerate geometry
    feature.properties.branches = branches;

    // Sync top-level compat props with first branch
    if (branchIndex === 0) {
        feature.properties[property] = value;
    }

    // Regenerate geometry via updateFeaturesProperty (triggers geometry regen for geometric props)
    arrowControl.updateFeaturesProperty(selectedFeatures, 'branches', branches);
}
