// Path: js/military_tools/barrier_line_tool/barrier_line_attributes_panel.js

import {
    createModernSlider,
    createModernColorPicker,
    createModernToggle,
    createModernInfoBox,
    createSectionDivider,
    createInitialPropertiesMap,
    createPanelHeader,
    createActionButtons,
} from '@tools/helpers/index.js';
import {
    hasZoomReference,
    clampSpacingForSize,
    BARRIER_LINE_ZOOM_LIMITS,
    BARRIER_LINE_ZOOM_DEFAULTS,
} from './barrier-line-zoom.model.js';

/** BEM modifier that hides a slider (no inline styles, per the house rules). */
const HIDDEN_SLIDER_CLASS = 'attr-modern-slider--hidden';

/** Smallest diamond the sliders offer, in metres. */
const MIN_SIZE_M = 10;

/**
 * Convert a kilometre value to whole metres for display.
 * The two authored sizes are kilometres in storage, because that is what turf
 * takes, but a barrier's diamonds are tens or hundreds of metres across and a
 * slider reading "0.05 km" is unusable.
 * @param {number} km - Value in kilometres
 * @param {number} fallbackKm - Value to use when `km` is unusable
 * @returns {number} Value in metres, rounded
 */
function toMetres(km, fallbackKm) {
    const usable = Number.isFinite(km) && km > 0 ? km : fallbackKm;
    return Math.round(usable * 1000);
}

/**
 * Largest diamond that still makes sense on a given line.
 * A diamond longer than the line cannot be drawn whole, and the geometry falls
 * back to a plain line, so the slider stops before offering that.
 * @param {Object} control - Barrier line control instance
 * @param {Object} feature - Barrier line feature
 * @returns {number} Maximum size in metres
 */
function maxSizeMetres(control, feature) {
    const coordinates = control.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
    const lengthKm = control.geometry.measureLengthKm(coordinates);
    const byLine = Number.isFinite(lengthKm) && lengthKm > 0 ? (lengthKm / 2) * 1000 : Infinity;
    const byModel = BARRIER_LINE_ZOOM_LIMITS.MAX_SYMBOL_SIZE_KM * 1000;
    return Math.max(MIN_SIZE_M * 2, Math.round(Math.min(byLine, byModel)));
}

/**
 * Build the diamond spacing slider.
 *
 * Its floor is not a constant: the model refuses `size > MAX_GAP_FRACTION *
 * spacing`, because past that the gaps merge and the line disappears entirely
 * (measured on 2026-09-03: 94 diamonds left 2 stray segments on a 96 km line).
 * The slider helper freezes min and max at creation, so this control is REBUILT
 * whenever the size moves rather than updated in place.
 *
 * @param {Object} feature - Barrier line feature
 * @param {Array} selectedFeatures - Every selected feature
 * @param {Object} control - Barrier line control instance
 * @param {Function} onChanged - Called after the write lands
 * @returns {HTMLElement} Slider element
 */
function buildSpacingSlider(feature, selectedFeatures, control, onChanged) {
    const sizeM = toMetres(feature.properties.symbol_size, BARRIER_LINE_ZOOM_DEFAULTS.symbolSizeKm);
    const floorM = Math.ceil(sizeM / BARRIER_LINE_ZOOM_LIMITS.MAX_GAP_FRACTION);
    const currentM = toMetres(feature.properties.symbol_spacing, BARRIER_LINE_ZOOM_DEFAULTS.symbolSpacingKm);

    return createModernSlider({
        label: 'Distância entre losangos',
        min: floorM,
        max: Math.max(floorM * 10, currentM),
        step: 5,
        value: Math.max(floorM, currentM),
        unit: 'm',
        onChange: async (value) => {
            const spacingKm = clampSpacingForSize(feature.properties.symbol_size, value / 1000);
            await control.updateFeaturesProperty(selectedFeatures, 'symbol_spacing', spacingKm);
            onChanged();
        },
    });
}

/**
 * Build the read-only box that says how many diamonds the current settings draw.
 * It is the only place the user learns that the ceiling fired and widened their
 * spacing, which would otherwise look like the sliders ignoring them.
 * @param {Object} feature - Barrier line feature
 * @param {Object} control - Barrier line control instance
 * @returns {HTMLElement} Info box element
 */
function buildLayoutInfo(feature, control) {
    const { count, capped } = control.geometry.describeLayout(feature.properties, control.getCurrentZoom());

    const rows = [{ text: `${count} losango${count === 1 ? '' : 's'} nesta linha` }];

    if (count === 0) {
        rows.push({ text: 'A linha é curta demais para um losango inteiro, e sai sem símbolo.' });
    } else if (capped) {
        rows.push({
            text: `Teto de ${control.maxDiamonds} losangos atingido: a distância foi alargada para cobrir a linha inteira.`,
        });
    }

    return createModernInfoBox({ rows });
}

/**
 * Add barrier line attributes to the panel.
 * @param {HTMLElement} panel - Panel container element
 * @param {Array} selectedFeatures - Selected barrier line features
 * @param {Object} barrierLineControl - Barrier line control instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {Object} uiManager - UI manager instance
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.hideHeader=false] - Whether to hide the header section
 * @param {boolean} [options.hideButtons=false] - Whether to hide the action buttons
 */
export function addBarrierLineAttributesToPanel(
    panel,
    selectedFeatures,
    barrierLineControl,
    selectionManager,
    uiManager,
    options = {},
) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0];
    const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);

    createPanelHeader({
        panel,
        features: selectedFeatures,
        featureType: 'barrier_line',
        control: barrierLineControl,
        selectionManager,
        uiManager,
        hideHeader: options.hideHeader,
    });

    // ===== APPEARANCE =====

    panel.appendChild(createModernColorPicker({
        label: 'Cor',
        value: feature.properties.color,
        onChange: (color) => {
            barrierLineControl.updateFeaturesProperty(selectedFeatures, 'color', color);
        },
    }));

    panel.appendChild(createModernSlider({
        label: 'Espessura',
        min: 1,
        max: 10,
        step: 1,
        value: feature.properties.lineWidth || BARRIER_LINE_ZOOM_DEFAULTS.lineWidth,
        unit: 'px',
        onChange: (value) => {
            barrierLineControl.updateFeaturesProperty(selectedFeatures, 'lineWidth', value);
        },
    }));

    panel.appendChild(createModernSlider({
        label: 'Opacidade',
        min: 0,
        max: 100,
        step: 1,
        value: Math.round((feature.properties.opacity ?? 1) * 100),
        unit: '%',
        onChange: (value) => {
            barrierLineControl.updateFeaturesProperty(selectedFeatures, 'opacity', value / 100);
        },
    }));

    // ===== THE DIAMOND PATTERN =====

    panel.appendChild(createSectionDivider('Losangos'));

    // Declared before the two sliders so their handlers can rebuild them. The
    // size drives the spacing's floor, and both drive the count, so a change to
    // either has to redraw the other two controls.
    let spacingSlider = null;
    let layoutInfo = null;

    const refreshLayoutInfo = () => {
        const fresh = buildLayoutInfo(feature, barrierLineControl);
        layoutInfo.replaceWith(fresh);
        layoutInfo = fresh;
    };

    const refreshSpacingSlider = () => {
        const fresh = buildSpacingSlider(feature, selectedFeatures, barrierLineControl, refreshLayoutInfo);
        spacingSlider.replaceWith(fresh);
        spacingSlider = fresh;
    };

    panel.appendChild(createModernSlider({
        label: 'Tamanho do losango',
        min: MIN_SIZE_M,
        max: maxSizeMetres(barrierLineControl, feature),
        step: 5,
        value: toMetres(feature.properties.symbol_size, BARRIER_LINE_ZOOM_DEFAULTS.symbolSizeKm),
        unit: 'm',
        onChange: async (value) => {
            const sizeKm = value / 1000;
            await barrierLineControl.updateFeaturesProperty(selectedFeatures, 'symbol_size', sizeKm);

            // Growing the diamond can push the spacing below its floor. Write the
            // corrected spacing back rather than letting the geometry silently
            // draw at a spacing the stored feature does not carry.
            const correctedSpacing = clampSpacingForSize(sizeKm, feature.properties.symbol_spacing);
            if (correctedSpacing !== feature.properties.symbol_spacing) {
                await barrierLineControl.updateFeaturesProperty(
                    selectedFeatures, 'symbol_spacing', correctedSpacing,
                );
            }

            refreshSpacingSlider();
            refreshLayoutInfo();
        },
    }));

    spacingSlider = buildSpacingSlider(feature, selectedFeatures, barrierLineControl, () => refreshLayoutInfo());
    panel.appendChild(spacingSlider);

    layoutInfo = buildLayoutInfo(feature, barrierLineControl);
    panel.appendChild(layoutInfo);

    // ===== ZOOM ANCHOR =====

    // A line with no reference zoom (legacy, or one whose anchor is still the
    // "never anchored" sentinel) has nothing meaningful to show here, and showing
    // the slider's own `min` would read as an anchor at zoom 1. Fall back to the
    // CURRENT zoom, which is also what the toggle stamps below.
    const anchorZoom = hasZoomReference(feature.properties)
        ? feature.properties.createdAtZoom
        : barrierLineControl.getCurrentZoom();
    const referenceZoom = Number.isFinite(anchorZoom) ? Math.round(anchorZoom * 10) / 10 : 1;

    // Built before the toggle so the toggle can hide it.
    const zoomSlider = createModernSlider({
        label: 'Zoom de Referência',
        min: 1,
        max: 21,
        step: 0.1,
        value: referenceZoom,
        unit: '',
        onChange: async (value) => {
            const roundedValue = Math.round(parseFloat(value) * 10) / 10;
            await barrierLineControl.updateFeaturesProperty(selectedFeatures, 'createdAtZoom', roundedValue);
            refreshLayoutInfo();
        },
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
                await barrierLineControl.updateFeaturesProperty(
                    selectedFeatures, 'createdAtZoom', referenceZoom,
                );
            }
            await barrierLineControl.updateFeaturesProperty(
                selectedFeatures, 'zoomCorrectionEnabled', enabled,
            );
            zoomSlider.classList.toggle(HIDDEN_SLIDER_CLASS, !enabled);
            refreshLayoutInfo();
        },
    }));

    panel.appendChild(zoomSlider);

    createActionButtons({
        panel,
        features: selectedFeatures,
        control: barrierLineControl,
        selectionManager,
        initialPropertiesMap,
        hideButtons: options.hideButtons,
    });
}
