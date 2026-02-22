// Path: js/sidebar/handlers/feature-3d-handlers.js

/**
 * @fileoverview Handlers for 3D and 360 feature panel events.
 * Manages marker, measurement, and viewshed panel display for Cesium and 360 viewers.
 *
 * @module sidebar/handlers/feature-3d-handlers
 */

import { isCurrentMapLockedSync } from '../../store/index.js';

// ============================================================================
// LAZY-LOADED MODULES
// ============================================================================

// 3D panel modules (lazy imported)
let markerPanel3dModule = null;
let measurementPanel3dModule = null;
let viewshedPanel3dModule = null;

// 360 panel modules (lazy imported)
let markerPanel360Module = null;

// ============================================================================
// 3D MARKER HANDLERS
// ============================================================================

/**
 * Handles 3D marker click event.
 *
 * @param {Object} options - Options
 * @param {Object} options.marker - Marker data
 * @param {string} options.tilesetId - Tileset ID
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.cleanupPrevious - Cleanup function for previous content
 * @param {Function} options.onPanelClose - Callback when panel closes
 * @returns {Promise<{ element: HTMLElement, cleanup: Function, title: string }>}
 */
export async function handleMarker3dClick({
    marker,
    tilesetId,
    stateManager,
    cleanupPrevious,
    onPanelClose
}) {
    if (!marker) return null;

    // Use StateManager's openFeaturePanel to properly save previous sidebar state
    stateManager.openFeaturePanel(marker.id, 'marker3d');

    // Load marker panel module lazily
    if (!markerPanel3dModule) {
        markerPanel3dModule = await import('../../3d_models_viewer_tool/components/marker-panel-3d.js');
        markerPanel3dModule.injectMarkerPanelStyles();
    }

    // Cleanup previous content
    cleanupPrevious();

    // Create marker panel content
    const { element, cleanup } = markerPanel3dModule.createMarkerPanelContent(
        marker,
        tilesetId,
        onPanelClose
    );

    if (isCurrentMapLockedSync()) {
        element.classList.add('feature-panel--locked');
    }

    const markerName = marker.properties?.nome || 'Marcador 3D';

    return {
        element,
        cleanup,
        title: markerName
    };
}

/**
 * Handles 3D marker deselection.
 *
 * @param {Object} options - Options
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.hidePanel - Function to hide panel
 * @param {Function} options.cleanupContent - Function to cleanup content
 * @returns {boolean} True if deselection was handled
 */
export function handleMarker3dDeselect({ stateManager, hidePanel, cleanupContent }) {
    const featureType = stateManager.get('ui.currentFeatureType');
    const isPanelOpen = stateManager.get('ui.featurePanelOpen');

    if (featureType === 'marker3d' && isPanelOpen) {
        hidePanel(false);
        cleanupContent();
        stateManager.closeFeaturePanel();
        return true;
    }
    return false;
}

// ============================================================================
// 3D MEASUREMENT HANDLERS
// ============================================================================

/**
 * Handles 3D measurement click event.
 *
 * @param {Object} options - Options
 * @param {Object} options.measurement - Measurement data
 * @param {string} options.tilesetId - Tileset ID
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.cleanupPrevious - Cleanup function for previous content
 * @param {Function} options.onPanelClose - Callback when panel closes
 * @returns {Promise<{ element: HTMLElement, cleanup: Function, title: string }>}
 */
export async function handleMeasurement3dClick({
    measurement,
    tilesetId,
    stateManager,
    cleanupPrevious,
    onPanelClose
}) {
    if (!measurement) return null;

    // Use StateManager's openFeaturePanel to properly save previous sidebar state
    stateManager.openFeaturePanel(measurement.id, 'measurement3d');

    // Load measurement panel module lazily
    if (!measurementPanel3dModule) {
        measurementPanel3dModule = await import('../../3d_models_viewer_tool/components/measurement-panel-3d.js');
        measurementPanel3dModule.injectMeasurementPanelStyles();
    }

    // Cleanup previous content
    cleanupPrevious();

    // Create measurement panel content
    const { element, cleanup } = measurementPanel3dModule.createMeasurementPanelContent(
        measurement,
        tilesetId,
        onPanelClose
    );

    if (isCurrentMapLockedSync()) {
        element.classList.add('feature-panel--locked');
    }

    const measurementName = measurement.properties?.nome ||
        (measurement.type === 'area' ? 'Medição de Área' : 'Medição de Distância');

    return {
        element,
        cleanup,
        title: measurementName
    };
}

/**
 * Handles 3D measurement deselection.
 *
 * @param {Object} options - Options
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.hidePanel - Function to hide panel
 * @param {Function} options.cleanupContent - Function to cleanup content
 * @returns {boolean} True if deselection was handled
 */
export function handleMeasurement3dDeselect({ stateManager, hidePanel, cleanupContent }) {
    const featureType = stateManager.get('ui.currentFeatureType');
    const isPanelOpen = stateManager.get('ui.featurePanelOpen');

    if (featureType === 'measurement3d' && isPanelOpen) {
        hidePanel(false);
        cleanupContent();
        stateManager.closeFeaturePanel();
        return true;
    }
    return false;
}

// ============================================================================
// 3D VIEWSHED HANDLERS
// ============================================================================

/**
 * Handles 3D viewshed click event.
 *
 * @param {Object} options - Options
 * @param {Object} options.viewshed - Viewshed data
 * @param {string} options.tilesetId - Tileset ID
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.cleanupPrevious - Cleanup function for previous content
 * @param {Function} options.onPanelClose - Callback when panel closes
 * @returns {Promise<{ element: HTMLElement, cleanup: Function, title: string }>}
 */
export async function handleViewshed3dClick({
    viewshed,
    tilesetId,
    stateManager,
    cleanupPrevious,
    onPanelClose
}) {
    if (!viewshed) return null;

    // Use StateManager's openFeaturePanel to properly save previous sidebar state
    stateManager.openFeaturePanel(viewshed.id, 'viewshed3d');

    // Load viewshed panel module lazily
    if (!viewshedPanel3dModule) {
        viewshedPanel3dModule = await import('../../3d_models_viewer_tool/components/viewshed-panel-3d.js');
        viewshedPanel3dModule.injectViewshedPanelStyles();
    }

    // Cleanup previous content
    cleanupPrevious();

    // Create viewshed panel content
    const { element, cleanup } = viewshedPanel3dModule.createViewshedPanelContent(
        viewshed,
        tilesetId,
        onPanelClose
    );

    if (isCurrentMapLockedSync()) {
        element.classList.add('feature-panel--locked');
    }

    const viewshedName = viewshed.properties?.nome || 'Análise de Visibilidade';

    return {
        element,
        cleanup,
        title: viewshedName
    };
}

/**
 * Handles 3D viewshed deselection.
 *
 * @param {Object} options - Options
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.hidePanel - Function to hide panel
 * @param {Function} options.cleanupContent - Function to cleanup content
 * @returns {boolean} True if deselection was handled
 */
export function handleViewshed3dDeselect({ stateManager, hidePanel, cleanupContent }) {
    const featureType = stateManager.get('ui.currentFeatureType');
    const isPanelOpen = stateManager.get('ui.featurePanelOpen');

    if (featureType === 'viewshed3d' && isPanelOpen) {
        hidePanel(false);
        cleanupContent();
        stateManager.closeFeaturePanel();
        return true;
    }
    return false;
}

// ============================================================================
// 360 MARKER HANDLERS
// ============================================================================

/**
 * Handles 360 marker click event.
 *
 * @param {Object} options - Options
 * @param {Object} options.marker - Marker data
 * @param {string} options.photoName - Photo name
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.cleanupPrevious - Cleanup function for previous content
 * @param {Function} options.onPanelClose - Callback when panel closes
 * @returns {Promise<{ element: HTMLElement, cleanup: Function, title: string }>}
 */
export async function handleMarker360Click({
    marker,
    photoName,
    stateManager,
    cleanupPrevious,
    onPanelClose
}) {
    if (!marker) return null;

    // Use StateManager's openFeaturePanel to properly save previous sidebar state
    stateManager.openFeaturePanel(marker.id, 'marker360');

    // Load marker panel module lazily
    if (!markerPanel360Module) {
        markerPanel360Module = await import('../../street_view_tool/components/marker-panel-360.js');
        markerPanel360Module.injectMarkerPanel360Styles();
    }

    // Cleanup previous content
    cleanupPrevious();

    // Create marker panel content
    const { element, cleanup } = markerPanel360Module.createMarkerPanel360Content(
        marker,
        photoName,
        onPanelClose
    );

    if (isCurrentMapLockedSync()) {
        element.classList.add('feature-panel--locked');
    }

    const markerName = marker.properties?.nome || 'Marcador 360';

    return {
        element,
        cleanup,
        title: markerName
    };
}

/**
 * Handles 360 marker deselection.
 *
 * @param {Object} options - Options
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.hidePanel - Function to hide panel
 * @param {Function} options.cleanupContent - Function to cleanup content
 * @returns {boolean} True if deselection was handled
 */
export function handleMarker360Deselect({ stateManager, hidePanel, cleanupContent }) {
    const featureType = stateManager.get('ui.currentFeatureType');
    const isPanelOpen = stateManager.get('ui.featurePanelOpen');

    if (featureType === 'marker360' && isPanelOpen) {
        hidePanel(false);
        cleanupContent();
        stateManager.closeFeaturePanel();
        return true;
    }
    return false;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Closes any 3D or 360 panel when viewer or base layer changes.
 *
 * @param {Object} options - Options
 * @param {Object} options.stateManager - State manager instance
 * @param {Function} options.hidePanel - Function to hide panel
 * @param {Function} options.cleanupContent - Function to cleanup content
 * @param {Object} options.eventBus - Event bus instance
 * @param {Object} options.EventTypes - Event types enum
 * @returns {boolean} True if a panel was closed
 */
export function closeAny3dPanel({ stateManager, hidePanel, cleanupContent, eventBus, EventTypes }) {
    const featureType = stateManager.get('ui.currentFeatureType');

    // Check if a 3D or 360 panel is open
    const is3dPanel = ['marker3d', 'measurement3d', 'viewshed3d', 'marker360'].includes(featureType);

    if (is3dPanel && stateManager.get('ui.featurePanelOpen')) {
        // Close the panel and cleanup
        hidePanel(false);
        cleanupContent();

        stateManager.set('ui.featurePanelOpen', false);
        stateManager.set('ui.currentFeatureType', null);
        stateManager.set('sidebar.previousTab', null);

        eventBus.emit(EventTypes.FEATURE_PANEL_CLOSED, {});
        eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: false,
            featurePanelOpen: false,
            contentLeftOffset: 56
        });

        return true;
    }
    return false;
}

/**
 * Deselects a 3D feature when its panel is closed.
 *
 * @param {string} featureType - Type of feature being closed
 */
export async function deselect3dFeature(featureType) {
    try {
        if (featureType === 'marker3d') {
            const { deselectCurrentMarker } = await import('../../3d_models_viewer_tool/tools/marker_tool_3d.js');
            deselectCurrentMarker();
        } else if (featureType === 'measurement3d') {
            const { deselectCurrentMeasurement } = await import('../../3d_models_viewer_tool/tools/measurement_tool_3d.js');
            deselectCurrentMeasurement();
        } else if (featureType === 'viewshed3d') {
            const { deselectCurrentViewshed } = await import('../../3d_models_viewer_tool/tools/viewshed_tool_3d.js');
            deselectCurrentViewshed();
        }
    } catch (error) {
        console.warn(`Could not deselect ${featureType}:`, error);
    }
}
