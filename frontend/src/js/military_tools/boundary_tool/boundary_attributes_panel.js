// Path: js/military_tools/boundary_tool/boundary_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernSelect,
    createModernToggle,
    createModernTextarea,
    createModernButtons,
    createSectionDivider
} from '@tools/helpers/index.js';
import { hasZoomReference } from '@tools/helpers/boundary-zoom.model.js';

/** BEM modifier that hides a slider (no inline styles, per the house rules). */
const HIDDEN_SLIDER_CLASS = 'attr-modern-slider--hidden';

/**
 * Create and populate boundary attributes panel with controls
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected boundary features
 * @param {Object} boundaryControl - Boundary control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 */
export function addBoundaryAttributesToPanel(panel, selectedFeatures, boundaryControl, selectionManager, uiManager, options = {}) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];

    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.properties.id, { ...f.properties }]));

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

    // Assigned once the symbol size control exists (built right below). The echelon
    // select and the repetitions control call it, because both move the cap that
    // bounds that control.
    let refreshSymbolSizeSlider = () => {};

    panel.appendChild(createModernSelect({
        label: 'Escalão',
        value: feature.properties.echelon,
        options: echelonOptions,
        onChange: async (value) => {
            await boundaryControl.updateFeaturesProperty(selectedFeatures, 'echelon', value);
            refreshSymbolSizeSlider();
        }
    }));

    // Symbol size, shown as the size DRAWN NOW (km on the ground at the current
    // zoom) and bounded by the line: the top is the line-length cap, so the slider
    // never offers a size the geometry would refuse to draw. The slider helper
    // freezes min/max at creation, so the control is rebuilt whenever the cap moves.
    let symbolSizeSlider = buildSymbolSizeSlider(feature, selectedFeatures, boundaryControl);
    panel.appendChild(symbolSizeSlider);
    refreshSymbolSizeSlider = () => {
        const fresh = buildSymbolSizeSlider(feature, selectedFeatures, boundaryControl);
        symbolSizeSlider.replaceWith(fresh);
        symbolSizeSlider = fresh;
    };

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

    // A boundary with no reference zoom (legacy, or one whose anchor is still the
    // "never anchored" sentinel) has nothing meaningful to show here, and showing
    // the slider's own `min` would read as an anchor at zoom 1. Fall back to the
    // CURRENT zoom, which is also what the toggle stamps below.
    const anchorZoom = hasZoomReference(feature.properties)
        ? feature.properties.createdAtZoom
        : boundaryControl.getCurrentZoom();
    const referenceZoom = Number.isFinite(anchorZoom) ? Math.round(anchorZoom * 10) / 10 : 1;

    // Reference zoom slider (created before the toggle so the toggle can hide it).
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: referenceZoom,
        unit: '',
        onChange: (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            boundaryControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
        }
    });

    if (feature.properties.zoomCorrectionEnabled === false) {
        zoomSlider.classList.add(HIDDEN_SLIDER_CLASS);
    }

    panel.appendChild(createModernToggle({
        label: 'Correção de Zoom',
        checked: feature.properties.zoomCorrectionEnabled !== false,
        onChange: async (enabled) => {
            // Without an anchor BOTH factors are 1, so the switch would be inert:
            // stamp the current zoom first, and the feature starts scaling (or
            // freezing) from where it is now, with nothing jumping on the click.
            // Awaited in sequence because the two writes share one source read.
            if (!hasZoomReference(feature.properties)) {
                await boundaryControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', referenceZoom);
            }
            await boundaryControl.updateFeaturesProperty(selectedFeatures, 'zoomCorrectionEnabled', enabled);
            zoomSlider.classList.toggle(HIDDEN_SLIDER_CLASS, !enabled);
            // The ground factor just changed, and with it the size the symbol
            // slider is showing.
            refreshSymbolSizeSlider();
        }
    }));

    panel.appendChild(zoomSlider);

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

    // The whole-feature style block (colour, thickness, zoom anchor, opacity)
    // comes FIRST; the two per-feature sections below it are single-selection
    // only, since positions and label text are per-feature.
    if (selectedFeatures.length === 1) {
        addInstanceControls(panel, feature, selectedFeatures, boundaryControl, () => refreshSymbolSizeSlider());
        addLabelControls(panel, feature, selectedFeatures, boundaryControl);
    }

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
 * Picks a slider step that gives roughly a hundred positions across `max`,
 * from a short list of round values so the numeric input reads cleanly.
 * @param {number} max - Upper bound of the slider, in km
 * @returns {number} Step in km
 */
function symbolSizeStep(max) {
    const candidates = [1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001];
    const target = max / 100;
    return candidates.find((step) => step <= target) ?? 0.001;
}

/**
 * Builds the "Tamanho do símbolo" slider from the feature's CURRENT bounds
 * (`symbolSizeBounds`). The value is the size drawn on the ground right now
 * and the top is the line-length cap; each selected feature stores its own
 * authored base, derived from the drawn size through its own ground factor,
 * which is what a screen-pinned boundary needs. Rebuilt (not updated) when the
 * cap moves, because the slider helper freezes its range at creation.
 * @param {Object} feature - The feature the panel is showing
 * @param {Array} selectedFeatures - Every selected feature (the change applies to all)
 * @param {Object} boundaryControl - Boundary control instance
 * @returns {HTMLElement} Slider container
 */
function buildSymbolSizeSlider(feature, selectedFeatures, boundaryControl) {
    const zoom = boundaryControl.map?.getZoom?.();
    const bounds = boundaryControl.geometry.symbolSizeBounds(feature.properties, zoom);
    const step = symbolSizeStep(bounds.max);
    const decimals = String(step).split('.')[1]?.length ?? 0;
    const round = (value) => Number(value.toFixed(decimals));
    const max = round(Math.ceil(bounds.max / step) * step);
    const min = Math.min(max, Math.max(step, round(Math.floor(bounds.min / step) * step)));
    const value = round(Math.min(max, Math.max(min, bounds.effective)));
    const minBaseKm = boundaryControl.geometry.constructor.GEOMETRY_CONSTANTS.MIN_SIZE_KM;

    return createModernSlider({
        label: 'Tamanho do símbolo',
        min,
        max,
        step,
        unit: 'km',
        value,
        onChange: (effectiveKm) => {
            // Read the zoom at change time, not at build time: the panel may have
            // outlived a zoom gesture, and the ground factor moves with it.
            const zoomNow = boundaryControl.map?.getZoom?.();
            for (const selected of selectedFeatures) {
                const own = boundaryControl.geometry.symbolSizeBounds(selected.properties, zoomNow);
                const base = Math.max(minBaseKm, effectiveKm / own.groundFactor);
                boundaryControl.updateFeaturesProperty([selected], 'symbol_size', base);
            }
        }
    });
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
 * @param {Function} [onStructureChange] - Called after a count change lands (the cap moved)
 */
function addInstanceControls(panel, feature, selectedFeatures, boundaryControl, onStructureChange) {
    panel.appendChild(createSectionDivider('Escalões'));

    const section = document.createElement('div');
    section.className = 'boundary-instances-section';
    panel.appendChild(section);

    const readInstances = () => boundaryControl.geometry.getSymbolInstances(feature.properties);
    // `structural` marks a change in the instance COUNT, which moves the symbol
    // size cap; position and label edits leave it alone.
    const applyInstances = (instances, structural = false) =>
        boundaryControl.updateFeaturesProperty(selectedFeatures, 'symbol_instances', instances)
            .then(() => { if (structural) onStructureChange?.(); });

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
                applyInstances(next, true);
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
        applyInstances(next, true);
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

    panel.appendChild(createModernSlider({
        label: 'Tamanho do texto',
        min: 8,
        max: 80,
        step: 1,
        unit: 'px',
        value: feature.properties.text_size || 35,
        onChange: (value) => boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_size', value)
    }));

    panel.appendChild(createModernToggle({
        label: 'Texto sempre para o norte',
        checked: feature.properties.text_north_facing === true,
        onChange: (checked) => boundaryControl.updateFeaturesProperty(selectedFeatures, 'text_north_facing', checked)
    }));
}
