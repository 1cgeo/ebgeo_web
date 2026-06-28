// Path: js/tool_manager/helpers/base-attributes-panel.js

/**
 * @fileoverview Base utilities for attribute panel creation.
 * Provides shared functions for panel headers, initial properties tracking,
 * and common panel patterns used across all tool attribute panels.
 *
 * @module tool_manager/helpers/base-attributes-panel
 */

import { createModernButtons } from './buttons.helpers.js';
import { deepClone } from '@utils/deep-utils.js';

// ============================================================================
// INITIAL PROPERTIES TRACKING
// ============================================================================

/**
 * Create a map of initial properties for change tracking.
 * Uses deep clone to safely snapshot nested properties (arrays, objects).
 *
 * @param {Array<Object>} features - Array of features to track
 * @returns {Map<string, Object>} Map of feature ID to cloned properties
 *
 * @example
 * const initialPropertiesMap = createInitialPropertiesMap(selectedFeatures);
 * // Later: check if feature.properties differs from initialPropertiesMap.get(feature.properties.id)
 */
export function createInitialPropertiesMap(features) {
    return new Map(
        features.map(f => [f.properties.id, deepClone(f.properties)])
    );
}

// ============================================================================
// ACTION BUTTONS
// ============================================================================

/**
 * Create and append action buttons (Save, Discard, Delete, Set Default).
 *
 * @param {Object} options - Button options
 * @param {HTMLElement} options.panel - Panel container to append buttons to
 * @param {Array<Object>} options.features - Selected features
 * @param {Object} options.control - Tool control instance
 * @param {Object} options.selectionManager - Selection manager instance
 * @param {Map<string, Object>} options.initialPropertiesMap - Initial properties for change detection
 * @param {boolean} [options.hideButtons=false] - Whether to hide buttons
 * @returns {void}
 */
export function createActionButtons({
    panel,
    features,
    control,
    selectionManager,
    initialPropertiesMap,
    hideButtons = false
}) {
    if (hideButtons) {
        return;
    }

    const feature = features[0];

    panel.appendChild(createModernButtons({
        selectedFeatures: features,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault: features.length === 1,
        onSetDefault: () => control.setDefaultProperties(feature.properties)
    }));
}

