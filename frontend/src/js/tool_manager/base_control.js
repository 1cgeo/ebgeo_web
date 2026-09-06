// Path: js/tool_manager/base_control.js

/**
 * @fileoverview Base Control class for all drawing and editing tools.
 * Provides a standardized interface for tool activation, selection,
 * movement, clipboard operations, and attribute panel management.
 *
 * @module tool_manager/base_control
 */

import { expandBboxWithPadding } from '../utilities/geometry-utils.js';
import { deepClone } from '../utilities/deep-utils.js';
import { getEventBus } from '../store/services.js';
import { EventTypes } from '../events/event_types.js';
import { registerImageRegenerator } from '../layers/image-regen-registry.js';

/**
 * Base Control class with expanded tool-centric interface.
 * Each tool should extend this and implement the methods they need.
 */
class BaseControl {
    /**
     * Feature type identifier for this tool.
     * Subclasses should override this property.
     * @type {string|null}
     */
    featureType = null;
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager?.selectionManager;
        this.isActive = false;
    }

    // ===== CORE INTERFACE =====

    /**
     * Activate the tool
     */
    activate() {
        this.isActive = true;
    }

    /**
     * Deactivate the tool
     */
    deactivate() {
        this.isActive = false;
    }

    /**
     * Handle map click events
     * @param {Object} e - MapLibre click event
     */
    handleMapClick(_e) {
    }

    // ===== SELECTION INTERFACE =====

    /**
     * Get the first selected feature of this tool's type.
     * Uses the featureType property set by subclasses.
     *
     * @param {string} [featureType=this.featureType] - Optional override for feature type
     * @returns {Object|null} Selected feature or null if none selected
     */
    getSelectedFeature(featureType = this.featureType) {
        if (!this.selectionManager || !featureType) {
            return null;
        }
        const selectedItems = this.selectionManager.getSelectedFeaturesByType(featureType);
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected features of this tool's type.
     * Uses the featureType property set by subclasses.
     *
     * @param {string} [featureType=this.featureType] - Optional override for feature type
     * @returns {Array<Object>} Array of selected features
     */
    getSelectedFeatures(featureType = this.featureType) {
        if (!this.selectionManager || !featureType) {
            return [];
        }
        return this.selectionManager.getSelectedFeaturesByType(featureType)
            .map(item => item.feature);
    }

    /**
     * Called when a feature of this type is selected
     * @param {Object} feature - Selected feature
     */
    onFeatureSelected(_feature) {
    }

    /**
     * Called when a feature of this type is deselected
     * @param {Object} feature - Deselected feature
     */
    onFeatureDeselected(_feature) {
    }

    /**
     * Called when all features are deselected
     */
    onGlobalDeselect() {
    }

    /**
     * Check if this tool is in editing mode
     * @returns {boolean}
     */
    isEditingMode() {
        return false;
    }

    /**
     * Check if feature has edit handles
     * @param {string} featureId - Feature ID
     * @returns {boolean}
     */
    hasEditHandle(_featureId) {
        return false;
    }

    /**
     * Sync edit handles after feature is moved
     * @param {Array} movedFeatures - Array of moved features
     */
    syncEditHandlesAfterDrag(_movedFeatures) {
    }

    // ===== MOVEMENT INTERFACE =====

    /**
     * Check if feature can be moved
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    /**
     * Calculate offset for drag operations
     * @param {Object} feature - Feature being moved
     * @param {Object} referencePoint - Reference point {lng, lat}
     * @returns {Array} [offsetX, offsetY]
     */
    calculateMoveOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
        if (feature.geometry.type === 'Point') {
            return [
                coords[0] - referencePoint.lng,
                coords[1] - referencePoint.lat
            ];
        }
        return [0, 0];
    }

    /**
     * Update feature geometry for move operation
     * @param {Object} feature - Feature to update
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @param {Object} newCoords - New coordinates {lng, lat}
     * @returns {Object} Updated feature
     */
    updateFeatureForMove(feature, dx, dy, newCoords) {
        if (feature.geometry.type === 'Point') {
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: [newCoords.lng, newCoords.lat]
                }
            };
        }
        return feature;
    }

    /**
     * Validate if move operation is allowed
     * @param {Object} feature - Feature being moved
     * @param {Object} newPosition - New position {lng, lat}
     * @returns {boolean}
     */
    validateMove(_feature, _newPosition) {
        return true;
    }

    // ===== SELECTION BOX INTERFACE =====

    /**
     * Create selection box for feature
     *
     * SINCRONO DE PROPOSITO, mesmo lendo Turf. Este metodo tem VINTE E QUATRO reimplementacoes
     * quase identicas nos controles (cada ferramenta de desenho reescreveu `turf.bbox` +
     * `turf.bboxPolygon` em vez de herdar esta), e ele so e chamado de dois lugares, os dois
     * ja garantindo o Turf um gesto antes:
     *
     *   - `tool_manager/managers/selection-highlight.manager.js:updateSelectionHighlight`, que
     *     sai e refaz a chamada se o Turf ainda nao chegou;
     *   - `presence/remote-selections.layer.js:_buildBox`, que e assincrono e chama
     *     `selection_manager.js:getCompleteFeatureFromSource` antes — e e la que o `await
     *     ensureTurf()` daquele caminho mora.
     *
     * Tornar isto assincrono obrigaria a mudar as vinte e quatro assinaturas e os dois
     * chamadores, por uma garantia que os dois chamadores ja dao. Ver `utilities/turf-loader.js`.
     *
     * @param {Object} feature - Feature to create selection box for
     * @returns {Object} GeoJSON Polygon feature or null
     */
    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding());
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating selection box:', error);
            return null;
        }
    }

    /**
     * Get selection box strategy for this feature type.
     * `'viewport'` marks a tool whose box is rebuilt from the rendered, screen-aligned
     * rectangle: the highlight manager keys its cache on bearing and pitch for those.
     * @returns {string} Strategy name ('bbox', 'preCalculated', 'custom', 'viewport')
     */
    getSelectionBoxStrategy() {
        return 'bbox';
    }

    /**
     * Get padding for selection box in pixels
     * @returns {number} Padding in pixels
     */
    getSelectionBoxPadding() {
        return 5;
    }

    /**
     * Expand bbox with padding.
     * Delegates to shared geometry utility function.
     *
     * @param {Array} bbox - Bounding box [minX, minY, maxX, maxY]
     * @param {number} paddingPixels - Padding in pixels
     * @param {Object} map - Map instance
     * @returns {Array} Expanded bbox
     */
    expandBboxWithPadding(bbox, paddingPixels, map) {
        return expandBboxWithPadding(bbox, paddingPixels, map);
    }

    // ===== CLIPBOARD INTERFACE =====

    /**
     * Check if feature can be copied
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canCopy(_feature) {
        return true;
    }

    /**
     * Check if feature can be pasted
     * @param {Object} feature - Feature to check
     * @returns {boolean}
     */
    canPaste(_feature) {
        return true;
    }

    /**
     * Prepare feature for copying
     * @param {Object} feature - Feature to prepare
     * @returns {Object} Cleaned feature
     */
    prepareForCopy(feature) {
        const cleaned = deepClone(feature);

        delete cleaned.properties.isSelected;
        delete cleaned.properties.isPreview;
        delete cleaned.properties.user_isEditingHandle;

        return cleaned;
    }

    /**
     * Prepare feature for pasting
     * @param {Object} feature - Feature to paste
     * @param {Object} offset - Offset {dx, dy} in geographic coordinates
     * @returns {Object} Updated feature with offset applied
     */
    prepareForPaste(feature, offset) {
        if (feature.geometry.type === 'Point') {
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: [
                        feature.geometry.coordinates[0] + offset.dx,
                        feature.geometry.coordinates[1] + offset.dy
                    ]
                }
            };
        }
        return feature;
    }

    // ===== ATTRIBUTE PANEL INTERFACE =====

    /**
     * Check if this tool has an attribute panel
     * @returns {boolean}
     */
    hasAttributePanel() {
        return false;
    }

    /**
     * Create attribute panel content for this tool
     * @param {HTMLElement} container - Container element to add content to
     * @param {Array} features - Selected features of this type
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} uiManager - UI manager instance
     */
    createAttributePanel(_container, _features, _selectionManager, _uiManager) {
    }

    // ===== DRAG AND HANDLE SOURCES INTERFACE =====

    /**
     * Get drag sources this tool handles
     * @returns {Array} Array of source names for drag operations
     */
    getDragSources() {
        return [];
    }

    /**
     * Get edit handle sources this tool uses
     * @returns {Array} Array of edit handle source names
     */
    getEditHandleSources() {
        return [];
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    /**
     * Update properties of multiple features
     * @param {Array} features - Features to update
     * @param {string} property - Property name
     * @param {*} value - Property value
     */
    updateFeaturesProperty(_features, _property, _value) {
    }

    /**
     * Save multiple features
     * @param {Array} features - Features to save
     * @param {Map} initialPropertiesMap - Initial properties for comparison
     */
    async saveFeatures(_features, _initialPropertiesMap) {
    }

    /**
     * Update multiple features
     * @param {Array} features - Features to update
     * @param {boolean} save - Whether to save to storage
     * @param {boolean} onlyUpdateProperties - Only update properties, not geometry
     */
    async updateFeatures(_features, _save = false, _onlyUpdateProperties = false) {
    }

    /**
     * Delete multiple features
     * @param {Array} features - Features to delete
     */
    async deleteFeatures(_features) {
    }

    /**
     * Discard changes to features
     * @param {Array} features - Features to revert
     * @param {Map} initialPropertiesMap - Initial properties
     */
    async discardChangeFeatures(_features, _initialPropertiesMap) {
    }

    /**
     * Set default properties for this tool
     * @param {Object} properties - Default properties
     */
    setDefaultProperties(_properties) {
    }

    /**
     * Check if feature has changed
     * @param {Object} feature - Current feature
     * @param {Object} initialProperties - Initial properties
     * @returns {boolean}
     */
    hasFeatureChanged(_feature, _initialProperties) {
        return true;
    }

    // ===== UTILITY METHODS =====

    /**
     * Get layer IDs this tool handles
     * @returns {Array} Array of layer IDs
     */
    getLayerIds() {
        return [];
    }

    /**
     * Get source names this tool handles
     * @returns {Array} Array of source names
     */
    getSourceNames() {
        return [];
    }

    /**
     * Get edit handle source name
     * @returns {string|null} Edit handle source name or null
     */
    getEditHandleSource() {
        return null;
    }

    // ===== REMOTE IMAGE REGENERATION =====

    /**
     * Subscribes to remote operations and regenerates the local-only PNG for any feature
     * of the given source that a peer applies, rebuilding it from the synced props.
     * The rasterized image is never uploaded, so a peer has no blob to fetch — but it is
     * deterministically reconstructible from the synced props, so it round-trips create AND
     * edit without shipping the raster. Stores the unsubscribe fn on `_remoteRegenUnsub`;
     * call `_unsubscribeRemoteImageRegen()` from the subclass `onRemove` to tear it down.
     * No-op when the service container isn't up (e.g. headless).
     * @param {string} source - The feature `properties.source` this tool owns
     * @param {(feature: Object) => Promise<void>} regenFn - Per-feature image regeneration fn
     * @private
     */
    _subscribeRemoteImageRegen(source, regenFn) {
        // Publish the regenerator so the LOAD path (setImages) can rebuild a missing
        // local blob from props on snapshot / map-switch — the incremental remote-op
        // subscription below only fires for live ops, not for a snapshot open/reconnect.
        registerImageRegenerator(source, regenFn);
        let bus;
        try {
            bus = getEventBus();
        } catch {
            return;
        }
        this._remoteRegenUnsub = bus.on(EventTypes.REMOTE_OPERATION_APPLIED, (payload) => {
            const op = payload && payload.operation;
            if (!this.map || !op || op.entityType !== 'feature') return;
            const feature = op.data;
            if (!feature || feature.properties?.source !== source) return;
            // A shallow copy: the regenerator stamps the bitmap keys onto the feature it is
            // handed (`military_tools/bitmap-stamp.js`), and `op.data` is the envelope other
            // listeners may still hold — it must keep describing what the peer actually sent.
            const copy = { ...feature, properties: { ...feature.properties } };
            regenFn(copy).catch((e) => console.warn(`Remote image regen failed for ${source}:`, e));
        });
    }

    /**
     * Tears down the remote-image-regen subscription set up by `_subscribeRemoteImageRegen`.
     * @private
     */
    _unsubscribeRemoteImageRegen() {
        if (this._remoteRegenUnsub) {
            this._remoteRegenUnsub();
            this._remoteRegenUnsub = null;
        }
    }

}

export default BaseControl;
