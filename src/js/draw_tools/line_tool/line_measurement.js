// Path: js/draw_tools/line_tool/line_measurement.js

/**
 * @fileoverview Measurement display system for line features.
 * Handles creation, update, and removal of measurement labels on lines.
 *
 * @module draw_tools/line_tool/line_measurement
 */

// ============================================================================
// MEASUREMENT LABEL CREATION
// ============================================================================

/**
 * Create a measurement label DOM element.
 *
 * @param {string} measurement - Formatted measurement text (e.g., "1.5 km")
 * @param {string} featureId - Feature ID for data attribute
 * @param {string} [layerId='default'] - Layer ID for visibility tracking
 * @returns {HTMLElement} Styled measurement label element
 */
export function createMeasurementLabel(measurement, featureId, layerId) {
    const label = document.createElement('div');
    label.className = 'measurement-label';
    label.innerText = measurement;
    label.dataset.featureId = featureId;
    label.dataset.layerId = layerId || 'default';

    return label;
}

// ============================================================================
// MEASUREMENT DISPLAY
// ============================================================================

/**
 * Display a measurement label at specified coordinates.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Array<number>} coordinates - [lng, lat] for label position
 * @param {string} measurement - Formatted measurement text
 * @param {string} featureId - Feature ID for tracking
 * @param {string} [layerId] - Layer ID for visibility tracking
 */
export function displayMeasurement(map, coordinates, measurement, featureId, layerId) {
    const markerElement = createMeasurementLabel(measurement, featureId, layerId);
    new maplibregl.Marker({ element: markerElement })
        .setLngLat(coordinates)
        .addTo(map);
}

/**
 * Remove measurement label for a feature.
 *
 * @param {string} featureId - Feature ID to remove measurement for
 */
export function removeMeasurement(featureId) {
    const measurementLabel = document.querySelector(
        `.measurement-label[data-feature-id="${featureId}"]`
    );
    if (measurementLabel) {
        measurementLabel.remove();
    }
}

/**
 * Set selection state on measurement label.
 *
 * @param {string} featureId - Feature ID
 * @param {boolean} isSelected - Whether feature is selected
 */
export function setMeasurementLabelSelected(featureId, isSelected) {
    const measurementLabel = document.querySelector(
        `.measurement-label[data-feature-id="${featureId}"]`
    );
    if (measurementLabel) {
        if (isSelected) {
            measurementLabel.classList.add('selected');
        } else {
            measurementLabel.classList.remove('selected');
        }
    }
}

// ============================================================================
// MEASUREMENT UPDATE
// ============================================================================

/**
 * Update measurement display for a line feature.
 * Removes existing measurement and creates new one if measure is enabled.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} feature - Line feature with geometry and properties
 */
export function updateFeatureMeasurement(map, feature) {
    // Always remove existing measurement first
    removeMeasurement(feature.properties.id);

    // Only display if measure is enabled
    if (feature.properties.measure) {
        const line = turf.lineString(feature.geometry.coordinates);
        const lengthInMeters = turf.length(line, { units: 'meters' });

        // Format length with appropriate unit
        const lengthFormatted = lengthInMeters >= 1000
            ? `${(lengthInMeters / 1000).toFixed(2)} km`
            : `${lengthInMeters.toFixed(2)} m`;

        // Position at midpoint of line
        const midpoint = turf.along(line, lengthInMeters / 2, { units: 'meters' });

        displayMeasurement(map, midpoint.geometry.coordinates, lengthFormatted, feature.properties.id, feature.properties.layerId);
    }
}

/**
 * Format length value with appropriate unit.
 *
 * @param {number} lengthInMeters - Length in meters
 * @returns {string} Formatted length string
 */
export function formatLength(lengthInMeters) {
    if (lengthInMeters >= 1000) {
        return `${(lengthInMeters / 1000).toFixed(2)} km`;
    }
    return `${lengthInMeters.toFixed(2)} m`;
}

/**
 * Calculate line length in meters.
 *
 * @param {Array} coordinates - Line coordinates
 * @returns {number} Length in meters
 */
export function calculateLineLength(coordinates) {
    const line = turf.lineString(coordinates);
    return turf.length(line, { units: 'meters' });
}
