// Path: js/military_tools/boundary_tool/boundary_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernSelect,
    createModernToggle,
    createModernTextarea,
    createModernButtons,
    createSectionDivider,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton
} from '@tools/helpers/index.js';

/**
 * Create and populate boundary attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected boundary features
 * @param {Object} boundaryControl - Boundary control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 */
export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager, options = {}) {
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
                    boundaryControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
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

            infoText.textContent = `${selectedFeatures.length} limites selecionados`;

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

    // Echelon select
    const echelonOptions = [
        { value: 'XXXXXX', label: 'XXXXXX' },
        { value: 'XXXXX', label: 'XXXXX' },
        { value: 'XXXX', label: 'XXXX' },
        { value: 'XXX', label: 'XXX' },
        { value: 'XX', label: 'XX' },
        { value: 'X', label: 'X' },
        { value: 'III', label: 'III' },
        { value: 'II', label: 'II' },
        { value: 'I', label: 'I' },
        { value: 'ooo', label: '•••' },
        { value: 'oo', label: '••' },
        { value: 'o', label: '•' }
    ];

    panel.appendChild(createModernSelect({
        label: 'Escalão',
        value: feature.properties.echelon,
        options: echelonOptions,
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'echelon', value);
        }
    }));

    // Symbol size (shared across the line, like echelon). Stored in km.
    panel.appendChild(createModernSlider({
        label: 'Tamanho do símbolo',
        min: 0.05,
        max: 20,
        step: 0.05,
        unit: 'km',
        value: feature.properties.symbol_size || 1,
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'symbol_size', value);
        }
    }));

    // Per-instance management (count + position list + labels) — single selection only,
    // since positions and label toggles are per-feature.
    if (selectedFeatures.length === 1) {
        addInstanceControls(panel, feature, selectedFeatures, boundaryControl);
        addLabelControls(panel, feature, selectedFeatures, boundaryControl);
    }

    // Color picker
    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.color,
        onChange: (color) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'color', color);
        }
    }));

    // Line width slider
    panel.appendChild(createModernSlider({
        label: 'Espessura',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || 4,
        unit: 'px',
        onChange: (value) => {
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
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
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        }
    }));

    // Action buttons
    panel.appendChild(createModernButtons({
        selectedFeatures,
        control: boundaryControl,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => boundaryControl.setDefaultProperties(feature.properties),
        hidden: options.hideButtons
    }));
}

/**
 * Add the echelon-instances section: a count control plus an editable list with
 * one row per instance (position + label toggle + remove). The shared echelon and
 * symbol size are kept elsewhere; this only manages position and label visibility.
 *
 * @param {HTMLElement} panel - Panel container
 * @param {Object} feature - The single selected boundary feature
 * @param {Array} selectedFeatures - Selected features (length 1 here)
 * @param {Object} boundaryControl - Boundary control instance
 */
function addInstanceControls(panel, feature, selectedFeatures, boundaryControl) {
    panel.appendChild(createSectionDivider('Escalões'));

    const section = document.createElement('div');
    section.className = 'boundary-instances-section';
    panel.appendChild(section);

    const readInstances = () => boundaryControl.geometry.getSymbolInstances(feature.properties);
    const applyInstances = (instances) =>
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'symbol_instances', instances);

    // Structural changes (count, remove) rebuild the section so the count control
    // and row count stay in sync. Position/label edits do NOT rebuild (would break
    // a slider mid-drag) — they only push the new instances array.
    // `instances` is passed explicitly on rebuild because updateFeaturesProperty is
    // async (it mutates feature.properties only after `await getData()`), so reading
    // feature.properties synchronously here would render the stale pre-change array.
    const render = (instances = readInstances()) => {
        section.replaceChildren();

        section.appendChild(createModernSlider({
            label: 'Repetições',
            min: 1,
            max: 6,
            step: 1,
            value: instances.length,
            onChange: (count) => {
                const current = readInstances();
                const next = [];
                for (let i = 0; i < count; i++) {
                    next.push({
                        ratio: (i + 1) / (count + 1),
                        showLabels: current[i] ? current[i].showLabels : true
                    });
                }
                applyInstances(next);
                render(next);
            }
        }));

        const list = document.createElement('div');
        list.className = 'boundary-instance-list';
        instances.forEach((inst, index) => {
            list.appendChild(buildInstanceRow(inst, index, instances.length, readInstances, applyInstances, render));
        });
        section.appendChild(list);
    };

    render();
}

/**
 * Build a single instance row: title + remove button, position slider, label toggle.
 *
 * @param {{ratio: number, showLabels: boolean}} inst - Instance data
 * @param {number} index - Instance index
 * @param {number} total - Total instance count
 * @param {Function} readInstances - Returns the current normalized instances
 * @param {Function} applyInstances - Persists a new instances array
 * @param {Function} rerender - Rebuilds the instances section from a given array
 * @returns {HTMLElement} Row element
 */
function buildInstanceRow(inst, index, total, readInstances, applyInstances, rerender) {
    const row = document.createElement('div');
    row.className = 'boundary-instance-row';

    const header = document.createElement('div');
    header.className = 'boundary-instance-row__header';

    const title = document.createElement('span');
    title.className = 'boundary-instance-row__title';
    title.textContent = `Símbolo ${index + 1}`;
    header.appendChild(title);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'boundary-instance-row__remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remover este símbolo';
    removeBtn.setAttribute('aria-label', `Remover símbolo ${index + 1}`);
    removeBtn.disabled = total <= 1;
    removeBtn.addEventListener('click', () => {
        const current = readInstances();
        if (current.length <= 1) return;
        const next = current.filter((_, i) => i !== index);
        applyInstances(next);
        rerender(next);
    });
    header.appendChild(removeBtn);
    row.appendChild(header);

    // Patch only this instance's fields, guarding against a stale closure
    // firing after the array shrank (a remove that dropped this index).
    const patch = (changes) => {
        const current = readInstances();
        if (index >= current.length) return;
        applyInstances(current.map((c, i) => (i === index ? { ...c, ...changes } : c)));
    };

    // Throttle position updates to one per animation frame: the range slider fires
    // onChange on every input event, and each one runs a full geometry + dependent
    // (circles/texts) rebuild. Coalescing per frame caps that work without lag.
    let positionRaf = null;
    let pendingRatio = null;
    const onPositionChange = (percent) => {
        pendingRatio = percent / 100;
        if (positionRaf !== null) return;
        positionRaf = requestAnimationFrame(() => {
            positionRaf = null;
            patch({ ratio: pendingRatio });
        });
    };

    row.appendChild(createModernSlider({
        label: 'Posição',
        min: 1,
        max: 99,
        step: 1,
        unit: '%',
        value: Math.round(inst.ratio * 100),
        onChange: onPositionChange
    }));

    row.appendChild(createModernToggle({
        label: 'Mostrar rótulo',
        checked: inst.showLabels,
        onChange: (checked) => patch({ showLabels: checked })
    }));

    return row;
}

/**
 * Add the shared text label fields (rendered at each instance with showLabels on).
 *
 * @param {HTMLElement} panel - Panel container
 * @param {Object} feature - The single selected boundary feature
 * @param {Array} selectedFeatures - Selected features (length 1 here)
 * @param {Object} boundaryControl - Boundary control instance
 */
function addLabelControls(panel, feature, selectedFeatures, boundaryControl) {
    panel.appendChild(createSectionDivider('Rótulos'));

    panel.appendChild(createModernTextarea({
        label: 'Rótulo superior',
        value: feature.properties.text_top || '',
        rows: 1,
        placeholder: 'Texto acima da linha',
        onChange: (value) => boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_top', value)
    }));

    panel.appendChild(createModernTextarea({
        label: 'Rótulo inferior',
        value: feature.properties.text_bottom || '',
        rows: 1,
        placeholder: 'Texto abaixo da linha',
        onChange: (value) => boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_bottom', value)
    }));
}
