// Path: js/tool_manager/helpers/zoom-correction.helpers.js

/**
 * @fileoverview Shared zoom-correction utilities used by all tools that support
 * zoom-invariant sizing (military symbols, text, images, brushes, etc.).
 *
 * Two main entry points:
 *  - `applyZoomCorrections` — bulk transform for layer setup
 *  - `calculateZoomCorrectedValue` — single-feature recalculation for property updates
 */

/**
 * Calculate the zoom-corrected value for a single feature's properties.
 * Works for both `calculatedSize` and `calculatedLineWidth` use-cases.
 *
 * @param {Object}  properties          - Feature properties (must contain `createdAtZoom` and the source property)
 * @param {number}  currentZoom         - Current map zoom level
 * @param {Object}  config
 * @param {string}  config.sourceProperty     - Base property name (`'size'` or `'lineWidth'`)
 * @param {number}  [config.maxValue=Infinity] - Upper clamp for the result
 * @returns {number} The corrected value
 */
export function calculateZoomCorrectedValue(properties, currentZoom, config) {
    if (properties.zoomCorrectionEnabled === false) {
        return properties[config.sourceProperty];
    }

    const zoomDifference = currentZoom - properties.createdAtZoom;
    const scaleFactor = 2 ** zoomDifference;
    return Math.min(properties[config.sourceProperty] * scaleFactor, config.maxValue ?? Infinity);
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
 * @returns {Array} New feature array with corrected properties
 */
export function applyZoomCorrections(features, currentZoom, config) {
    if (!features || !Array.isArray(features)) {
        return [];
    }

    const { calculatedProperty } = config;

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
 */
export function syncZoomCorrectedProperty(sourceFeature, selectedFeature, property, value, currentZoom, config) {
    // Round createdAtZoom to 1 decimal
    if (property === 'createdAtZoom') {
        const roundedValue = Math.round(value * 10) / 10;
        sourceFeature.properties[property] = roundedValue;
        selectedFeature.properties[property] = roundedValue;
    }

    const corrected = calculateZoomCorrectedValue(sourceFeature.properties, currentZoom, config);

    sourceFeature.properties[config.calculatedProperty] = corrected;
    selectedFeature.properties[config.calculatedProperty] = corrected;
}
