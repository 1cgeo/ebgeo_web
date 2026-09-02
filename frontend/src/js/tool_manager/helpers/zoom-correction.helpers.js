// Path: js/tool_manager/helpers/zoom-correction.helpers.js

/**
 * @fileoverview Shared zoom-correction utilities used by all tools that support
 * zoom-invariant sizing (military symbols, text, images, brushes, etc.).
 *
 * Two main entry points:
 *  - `applyZoomCorrections` — bulk transform for layer setup
 *  - `calculateZoomCorrectedValue` — single-feature recalculation for property updates
 *
 * NOTHING NON-FINITE LEAVES THIS MODULE, and that is the contract, not a detail.
 * The derived value is read straight into MapLibre layout properties
 * (`icon-size`, `text-size`, `line-width`) and into selection-box geometry, and a
 * `NaN` there raises no exception anywhere: it travels into native placement code
 * and stops being observable as a value. Measured on 2026-09-01 with a legacy
 * `.ebgeo` whose images carry no `createdAtZoom` at all: selecting such an image
 * from the features tab (which zooms to it), pressing Esc and switching maps froze
 * the page's main thread in 6 runs out of 6, with the debugger unable to pause.
 *
 * The rule, mirroring what `boundary-zoom.model.js` does for boundaries:
 *
 *  - no usable `createdAtZoom` (missing, `null`, `NaN`, `Infinity`) means NO ZOOM
 *    REFERENCE, and no reference means a factor of 1: the base value comes out
 *    untouched, which is exactly the behaviour those legacy features had before
 *    zoom correction existed;
 *  - the same holds for a non-finite `currentZoom`, and for a scale factor that
 *    overflows or collapses to zero;
 *  - a base value that is not finite has nothing to correct, so the function
 *    returns `config.fallbackValue`. A caller whose consumer has no default of its
 *    own (the image layer reads a bare `['get', 'calculatedSize']`) MUST declare
 *    one; without it the result is `undefined`, which MapLibre reads as absent and
 *    answers with the layout property's own default.
 *
 * WHAT IS DELIBERATELY NOT COPIED from `boundary-zoom.model.js`: its
 * `hasZoomReference` also rejects `createdAtZoom === 0`, because zero is the
 * boundary control's "never anchored" sentinel. Several tools here stamp
 * `createdAtZoom: 0` in their DEFAULT_PROPERTIES and then overwrite it with the
 * real zoom, and a feature legitimately anchored at zoom 0 is indistinguishable
 * from those, so rejecting zero would silently change the size of every tool. The
 * defect being fixed is the non-finite one; zero keeps today's behaviour.
 */

/**
 * Scale factor for a feature anchored at `createdAtZoom`, seen at `currentZoom`.
 * Returns 1 (no correction) whenever the pair cannot produce a usable factor.
 *
 * @param {*} createdAtZoom - Reference zoom stamped on the feature
 * @param {*} currentZoom - Current map zoom
 * @returns {number} A finite factor above zero; 1 when there is no usable reference
 */
function zoomScaleFactor(createdAtZoom, currentZoom) {
    if (!Number.isFinite(createdAtZoom)) return 1;
    if (!Number.isFinite(currentZoom)) return 1;

    const factor = 2 ** (currentZoom - createdAtZoom);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Calculate the zoom-corrected value for a single feature's properties.
 * Works for both `calculatedSize` and `calculatedLineWidth` use-cases.
 *
 * @param {Object}  properties          - Feature properties (may lack `createdAtZoom`)
 * @param {number}  currentZoom         - Current map zoom level
 * @param {Object}  config
 * @param {string}  config.sourceProperty     - Base property name (`'size'` or `'lineWidth'`)
 * @param {number}  [config.maxValue=Infinity] - Upper clamp for the result
 * @param {*}       [config.fallbackValue]     - Returned when the base value is not a
 *   finite number. Omit it only when the consumer has a default of its own.
 * @returns {number|*} The corrected value, always finite when the base value is
 *   finite; `config.fallbackValue` otherwise
 */
export function calculateZoomCorrectedValue(properties, currentZoom, config) {
    const { sourceProperty, maxValue, fallbackValue } = config || {};
    const base = properties?.[sourceProperty];

    // Nothing to correct: a non-finite base cannot be scaled or clamped into a
    // usable number, so the caller's declared default is the only honest answer.
    if (!Number.isFinite(base)) {
        return fallbackValue;
    }

    // `?? Infinity` used to sit here and did NOT guard a NaN clamp: `Math.min(x, NaN)`
    // is NaN, so a poisoned clamp poisoned an otherwise valid result.
    const clamp = Number.isFinite(maxValue) ? maxValue : Infinity;

    if (properties.zoomCorrectionEnabled === false) {
        return base;
    }

    const scaled = base * zoomScaleFactor(properties.createdAtZoom, currentZoom);
    return Math.min(Number.isFinite(scaled) ? scaled : base, clamp);
}

/**
 * Apply zoom corrections to an array of features (used by layer setup functions).
 * Returns a new array with the calculated property set on each feature.
 *
 * @param {Array}   features            - GeoJSON features
 * @param {number}  currentZoom         - Current map zoom level
 * @param {Object}  config
 * @param {string}  config.sourceProperty      - Base property name (`'size'` or `'lineWidth'`)
 * @param {string}  config.calculatedProperty  - Target property name (`'calculatedSize'` or `'calculatedLineWidth'`)
 * @param {number}  [config.maxValue=Infinity]  - Upper clamp for the result
 * @param {*}       [config.fallbackValue]      - Value written when the base is not finite
 * @returns {Array} New feature array with corrected properties
 */
export function applyZoomCorrections(features, currentZoom, config) {
    if (!features || !Array.isArray(features)) {
        return [];
    }

    const { calculatedProperty } = config || {};

    return features.map(feature => ({
        ...feature,
        properties: {
            ...feature.properties,
            [calculatedProperty]: calculateZoomCorrectedValue(feature.properties, currentZoom, config),
        },
    }));
}

/**
 * Recalculate the zoom-corrected property on a pair of source/selected features
 * after a property has been updated. Handles `createdAtZoom` rounding automatically.
 *
 * Call this inside `updateFeaturesProperty` after setting the raw property.
 *
 * @param {Object}  sourceFeature       - Feature from the map source (mutated in place)
 * @param {Object}  selectedFeature     - Corresponding selected feature (mutated in place)
 * @param {string}  property            - The property that was just changed
 * @param {*}       value               - The new value of that property
 * @param {number}  currentZoom         - Current map zoom level
 * @param {Object}  config
 * @param {string}  config.sourceProperty      - Base property name
 * @param {string}  config.calculatedProperty  - Target property name
 * @param {number}  [config.maxValue=Infinity]  - Upper clamp
 * @param {*}       [config.fallbackValue]      - Value written when the base is not finite
 */
export function syncZoomCorrectedProperty(sourceFeature, selectedFeature, property, value, currentZoom, config) {
    // Round createdAtZoom to 1 decimal. `Math.round(NaN * 10) / 10` is NaN, which
    // would turn an unusable input into a stored anchor that looks like a number;
    // a non-finite value is stored verbatim and read as "no reference" downstream.
    if (property === 'createdAtZoom') {
        const roundedValue = Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
        sourceFeature.properties[property] = roundedValue;
        selectedFeature.properties[property] = roundedValue;
    }

    const corrected = calculateZoomCorrectedValue(sourceFeature.properties, currentZoom, config);

    sourceFeature.properties[config.calculatedProperty] = corrected;
    selectedFeature.properties[config.calculatedProperty] = corrected;
}
