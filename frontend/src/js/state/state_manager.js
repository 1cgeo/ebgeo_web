// Path: js/state/state_manager.js

/**
 * @fileoverview Centralized state manager for EBGeo UI state.
 * Single source of truth for volatile UI state.
 *
 * Architecture:
 * - Immutable state updates via deep clone
 * - Path-based subscriptions for reactive updates
 * - Batch updates for performance
 * - Throttled mouse updates to prevent UI thrashing
 *
 * @module state/state_manager
 */

import { EventTypes } from '../events';
import { deepClone, getByPath, setByPath, deepEqual, shallowClone } from '../utilities/deep-utils.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Throttle interval for mouse coordinate updates (~60fps) */
const MOUSE_THROTTLE_MS = 16;

/**
 * Default state structure.
 * Frozen to prevent accidental mutation.
 *
 * Note: States removed as unused (2024 audit):
 * - modals.activeModal, modals.modalData: Never consumed by any component
 * - panels.featurePanel.isDirty: Dirty tracking managed locally by components
 * - panels.profilePanel: Feature not implemented
 * - baseLayer.isChanging: Managed locally in BaseLayerControl
 * - ui.contextMenu: Ephemeral UI managed locally by SelectionManager
 */
const DEFAULT_STATE = Object.freeze({
    sidebar: {
        expanded: false,            // UI Redesign: starts collapsed
        activeTab: null,            // 'mapas' | 'camadas' | 'importar' | 'exportar' | null
        previousTab: null,          // Tab that was active before feature panel opened
        width: 320,
        collapsedLayers: [],        // Array<string> layer IDs that are collapsed
        collapsedGroups: [],        // Array<string> group IDs that are collapsed
    },
    activeTool: {
        type: null,                 // 'point' | 'line' | 'polygon' | 'vectorInfo' | etc.
        mode: 'idle',               // 'idle' | 'drawing' | 'editing'
        options: {},
    },
    selection: {
        features: [],               // Array<{type: string, id: string, feature: GeoJSON}>
        hoveredFeatureId: null,
        mode: 'single',             // 'single' | 'multiple' | 'rectangle'
    },
    panels: {
        featurePanel: {
            visible: false,
            featureType: null,
            featureId: null,
        },
    },
    baseLayer: {
        activeLayer: 'carta-topografica',
    },
    mouse: {
        coordinates: null,          // {lng: number, lat: number} | null
        isOverMap: false,
        format: 'latlong',          // 'latlong' | 'utm' | 'mgrs' | 'gars' | 'georef'
        elevation: null,            // number | null
        elevationEnabled: false,
    },
    map: {
        isLoading: false,
        currentMapName: null,
    },
    ui: {
        isDragging: false,
        isResizing: false,
        featurePanelOpen: false,                // UI Redesign: feature attributes panel state
        activeToolbarGroup: null,               // UI Redesign: 'draw' | 'military' | 'analysis' | null
        baseLayerSelectorOpen: false,           // UI Redesign: base layer selector expanded state
        snapping: {
            enabled: false,                     // Global snapping toggle
        },
    },
    clipboard: {
        features: [],               // Array<{type: string, feature: GeoJSON}>
        copiedAt: null,             // timestamp
        sourceMapName: null,
    },
});

// ============================================================================
// STATE MANAGER CLASS
// ============================================================================

/**
 * Centralized state manager implementing the single source of truth pattern.
 *
 * Features:
 * - Immutable state updates
 * - Path-based subscriptions
 * - Batch updates for performance
 * - Throttled high-frequency updates (mouse)
 * - Convenience methods for common operations
 */
class StateManager {
    constructor() {
        /** @private */
        this._state = deepClone(DEFAULT_STATE);
        /** @private @type {Map<string, Set<Function>>} */
        this._subscribers = new Map();
        /** @private */
        this._batchDepth = 0;
        /** @private @type {Set<string>} */
        this._pendingNotifications = new Set();
        /** @private */
        this._mouseThrottleTimeout = null;
        /** @private */
        this._lastMouseUpdate = 0;

        // Pending mouse updates to avoid stale closure captures. Keyed BY PATH: a single
        // slot silently dropped the first of two different `mouse.*` writes made inside
        // the same throttle window (e.g. elevationEnabled followed by elevation).
        /** @private @type {Map<string, *>} */
        this._pendingMouse = new Map();

        /** @private @type {import('../events/event_bus.js').EventBus|null} */
        this._eventBus = null;

        /** @private Tracks whether feature panel was open before sidebar expanded */
        this._hadFeaturePanelBeforeSidebar = false;
    }

    /**
     * Set the EventBus reference for emitting UI events.
     * Called by services.js during initialization.
     * @param {import('../events/event_bus.js').EventBus} eventBus
     */
    setEventBus(eventBus) {
        this._eventBus = eventBus;
    }

    // ========================================================================
    // CORE STATE OPERATIONS
    // ========================================================================

    /**
     * Get state value at path.
     * Returns deep clone to prevent external mutation.
     * @param {string} [path] - Dot-notation path. If omitted, returns entire state.
     * @returns {*} Value at path (cloned)
     */
    get(path) {
        if (!path) return deepClone(this._state);
        return deepClone(getByPath(this._state, path));
    }

    /**
     * Get state value at path WITHOUT cloning.
     *
     * ⚠️ PERFORMANCE OPTIMIZATION - USE WITH CAUTION:
     * - Returns direct reference to internal state
     * - NEVER mutate the returned value
     * - Use only for read-only operations in hot paths
     * - Prefer get() for safety when performance is not critical
     *
     * @param {string} [path] - Dot-notation path. If omitted, returns entire state.
     * @returns {*} Value at path (direct reference - DO NOT MUTATE)
     */
    getUnsafe(path) {
        if (!path) return this._state;
        return getByPath(this._state, path);
    }

    /**
     * Get state value with shallow clone (1 level deep).
     *
     * ⚠️ PERFORMANCE OPTIMIZATION:
     * - Only clones the first level of properties
     * - Nested objects are still references - do not mutate them
     * - Use for read operations where you need a safe copy but deep clone is too expensive
     * - Ideal for arrays of primitives or simple objects
     *
     * @param {string} [path] - Dot-notation path. If omitted, returns entire state.
     * @returns {*} Value at path (shallow cloned)
     */
    getShallow(path) {
        const value = path ? getByPath(this._state, path) : this._state;
        return shallowClone(value);
    }

    /**
     * Set state value at path.
     * Skips update if value is deeply equal to current.
     * @param {string} path - Dot-notation path
     * @param {*} value - Value to set
     */
    set(path, value) {
        const oldValue = getByPath(this._state, path);

        // Skip if no change (prevents infinite loops and unnecessary renders)
        if (deepEqual(oldValue, value)) return;

        // Throttle mouse coordinate updates for performance
        if (path.startsWith('mouse.')) {
            this._throttledMouseUpdate(path, value);
            return;
        }

        this._state = setByPath(this._state, path, value);
        this._notifySubscribers(path);
    }

    /**
     * Throttled update for high-frequency state changes (mouse coordinates).
     * Stores pending value externally to avoid stale closure captures.
     * @private
     * @param {string} path - State path
     * @param {*} value - New value
     */
    _throttledMouseUpdate(path, value) {
        // Latest value wins PER PATH; Map preserves insertion order, so the writes are
        // applied in the order they were made.
        this._pendingMouse.set(path, value);

        const now = Date.now();

        if (now - this._lastMouseUpdate >= MOUSE_THROTTLE_MS) {
            // Immediate update
            this._applyPendingMouseUpdate();
        } else if (!this._mouseThrottleTimeout) {
            // Schedule deferred update
            this._mouseThrottleTimeout = setTimeout(() => {
                this._applyPendingMouseUpdate();
                this._mouseThrottleTimeout = null;
            }, MOUSE_THROTTLE_MS);
        }
        // If timeout already scheduled, pending value will be used when it fires
    }

    /**
     * Apply every pending mouse update to state.
     * Separated from throttle logic to always use the latest pending value of each path.
     * @private
     */
    _applyPendingMouseUpdate() {
        if (this._pendingMouse.size === 0) return;

        for (const [path, value] of this._pendingMouse) {
            this._state = setByPath(this._state, path, value);
            this._notifySubscribers(path);
        }

        this._lastMouseUpdate = Date.now();
        this._pendingMouse.clear();
    }

    /**
     * Batch multiple updates into single notification cycle.
     * Useful for atomic multi-property updates.
     * @param {Function} fn - Function containing multiple set() calls
     */
    batchUpdate(fn) {
        this._batchDepth++;
        try {
            fn();
        } finally {
            this._batchDepth--;
            if (this._batchDepth === 0) {
                this._flushPendingNotifications();
            }
        }
    }

    // ========================================================================
    // SUBSCRIPTION SYSTEM
    // ========================================================================

    /**
     * Subscribe to state changes at path.
     * Callback is called when path or any child path changes.
     * @param {string} path - Path to watch
     * @param {Function} callback - Called with new value when path changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
        if (!this._subscribers.has(path)) {
            this._subscribers.set(path, new Set());
        }
        this._subscribers.get(path).add(callback);

        // Return unsubscribe function
        return () => {
            const subs = this._subscribers.get(path);
            if (subs) {
                subs.delete(callback);
                if (subs.size === 0) {
                    this._subscribers.delete(path);
                }
            }
        };
    }

    /**
     * Notify subscribers of state change.
     * @private
     * @param {string} changedPath - Path that changed
     */
    _notifySubscribers(changedPath) {
        if (this._batchDepth > 0) {
            this._pendingNotifications.add(changedPath);
            return;
        }

        this._subscribers.forEach((callbacks, subscribedPath) => {
            if (this._pathMatches(changedPath, subscribedPath)) {
                const value = this.getShallow(subscribedPath);
                callbacks.forEach(cb => {
                    try {
                        cb(value);
                    } catch (e) {
                        console.error('StateManager subscriber error:', e);
                    }
                });
            }
        });
    }

    /**
     * Flush pending notifications after batch update.
     * @private
     */
    _flushPendingNotifications() {
        const paths = Array.from(this._pendingNotifications);
        this._pendingNotifications.clear();

        // Deduplicate notifications by subscribed path
        const notifiedPaths = new Set();
        paths.forEach(path => {
            this._subscribers.forEach((callbacks, subscribedPath) => {
                if (this._pathMatches(path, subscribedPath) && !notifiedPaths.has(subscribedPath)) {
                    notifiedPaths.add(subscribedPath);
                    const value = this.getShallow(subscribedPath);
                    callbacks.forEach(cb => {
                        try {
                            cb(value);
                        } catch (e) {
                            console.error('StateManager subscriber error:', e);
                        }
                    });
                }
            });
        });
    }

    /**
     * Check if changed path should trigger subscribed path notification.
     *
     * Matching rules:
     * 1. Exact match: 'a.b' changed → 'a.b' subscriber notified
     * 2. Child changed: 'a.b.c' changed → 'a.b' subscriber notified
     *    (subscriber watching parent is notified when any child changes)
     * 3. Parent changed: 'a' changed → 'a.b' subscriber notified
     *    (subscriber watching child is notified when parent is replaced,
     *     because the child's value may have changed as a side effect)
     *
     * Rule 3 ensures that when a parent object is replaced entirely,
     * subscribers to child paths are still notified of the change.
     * Example: set('selection', newObj) notifies 'selection.features' subscribers.
     *
     * @private
     * @param {string} changedPath - Path that was modified
     * @param {string} subscribedPath - Path being watched by subscriber
     * @returns {boolean} True if subscriber should be notified
     */
    _pathMatches(changedPath, subscribedPath) {
        // Rule 1: Exact match
        if (changedPath === subscribedPath) return true;

        // Rule 2: Subscriber watching parent, child changed
        if (changedPath.startsWith(subscribedPath + '.')) return true;

        // Rule 3: Subscriber watching child, parent changed
        if (subscribedPath.startsWith(changedPath + '.')) return true;

        return false;
    }

    // ========================================================================
    // SELECTION CONVENIENCE METHODS
    // ========================================================================

    /**
     * Select a feature (replaces current selection).
     * @param {string} type - Feature type (e.g., 'point', 'line')
     * @param {string} id - Feature ID
     * @param {Object} feature - GeoJSON feature
     */
    selectFeature(type, id, feature) {
        this.set('selection.features', [{ type, id, feature }]);
    }

    /**
     * Add feature to selection (multi-select).
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     * @param {Object} feature - GeoJSON feature
     */
    addToSelection(type, id, feature) {
        const current = this.getShallow('selection.features') || [];
        const exists = current.some(f => f.type === type && f.id === id);
        if (!exists) {
            this.set('selection.features', [...current, { type, id, feature }]);
        }
    }

    /**
     * Remove feature from selection.
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     */
    removeFromSelection(type, id) {
        const current = this.getShallow('selection.features') || [];
        this.set('selection.features', current.filter(f => !(f.type === type && f.id === id)));
    }

    /**
     * Clear all selected features.
     */
    clearSelection() {
        this.set('selection.features', []);
    }

    /**
     * Check if feature is selected.
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     * @returns {boolean} True if selected
     */
    isFeatureSelected(type, id) {
        const features = this.getUnsafe('selection.features') || [];
        return features.some(f => f.type === type && f.id === id);
    }

    /**
     * Get selected feature by type and id.
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     * @returns {Object|null} GeoJSON feature or null
     */
    getSelectedFeature(type, id) {
        const features = this.getUnsafe('selection.features') || [];
        const found = features.find(f => f.type === type && f.id === id);
        return found ? found.feature : null;
    }

    /**
     * Get all selected features.
     * @returns {Array<{type: string, id: string, feature: Object}>}
     */
    getSelectedFeatures() {
        return this.getShallow('selection.features') || [];
    }

    /**
     * Get count of selected features.
     * @returns {number}
     */
    getSelectionCount() {
        const features = this.getUnsafe('selection.features') || [];
        return features.length;
    }

    /**
     * Update a selected feature in place.
     * Used after geometry changes during drag.
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     * @param {Object} updatedFeature - Updated GeoJSON feature
     */
    updateSelectedFeature(type, id, updatedFeature) {
        const current = this.getShallow('selection.features') || [];
        const updated = current.map(f => {
            if (f.type === type && f.id === id) {
                return { type, id, feature: updatedFeature };
            }
            return f;
        });
        this.set('selection.features', updated);
    }

    // ========================================================================
    // TOOL CONVENIENCE METHODS
    // ========================================================================

    /**
     * Set active tool.
     * @param {string|null} type - Tool type or null to deactivate
     * @param {Object} [options={}] - Tool options
     */
    setActiveTool(type, options = {}) {
        this.batchUpdate(() => {
            this.set('activeTool.type', type);
            this.set('activeTool.mode', type ? 'drawing' : 'idle');
            this.set('activeTool.options', options);
        });
    }

    /**
     * Get active tool type.
     * @returns {string|null}
     */
    getActiveTool() {
        return this.getUnsafe('activeTool.type');
    }

    /**
     * Set tool mode.
     * @param {'idle'|'drawing'|'editing'} mode
     */
    setToolMode(mode) {
        this.set('activeTool.mode', mode);
    }

    // ========================================================================
    // SIDEBAR CONVENIENCE METHODS
    // ========================================================================

    /**
     * Toggle sidebar expanded state.
     */
    toggleSidebar() {
        const current = this.getUnsafe('sidebar.expanded');
        this.set('sidebar.expanded', !current);
    }

    /**
     * Set active sidebar tab.
     * @param {'maps'|'features'|'pdf'} tab
     */
    setActiveTab(tab) {
        this.set('sidebar.activeTab', tab);
    }

    /**
     * Toggle an item in a collapsed-IDs array at the given state path.
     * @private
     * @param {string} path - State path to the collapsed array
     * @param {string} itemId - ID to toggle
     */
    _toggleCollapsed(path, itemId) {
        const collapsed = this.getUnsafe(path) || [];
        if (collapsed.includes(itemId)) {
            this.set(path, collapsed.filter(id => id !== itemId));
        } else {
            this.set(path, [...collapsed, itemId]);
        }
    }

    /**
     * Check if an item is in a collapsed-IDs array at the given state path.
     * @private
     * @param {string} path - State path to the collapsed array
     * @param {string} itemId - ID to check
     * @returns {boolean}
     */
    _isCollapsed(path, itemId) {
        const collapsed = this.getUnsafe(path) || [];
        return collapsed.includes(itemId);
    }

    /**
     * Toggle layer collapsed state in FeaturesTab.
     * @param {string} layerId - Layer ID
     */
    toggleLayerCollapsed(layerId) {
        this._toggleCollapsed('sidebar.collapsedLayers', layerId);
    }

    /**
     * Check if layer is collapsed.
     * @param {string} layerId - Layer ID
     * @returns {boolean}
     */
    isLayerCollapsed(layerId) {
        return this._isCollapsed('sidebar.collapsedLayers', layerId);
    }

    /**
     * Toggle group collapsed state in FeaturesTab.
     * @param {string} groupId - Group ID
     */
    toggleGroupCollapsed(groupId) {
        this._toggleCollapsed('sidebar.collapsedGroups', groupId);
    }

    /**
     * Check if group is collapsed.
     * @param {string} groupId - Group ID
     * @returns {boolean}
     */
    isGroupCollapsed(groupId) {
        return this._isCollapsed('sidebar.collapsedGroups', groupId);
    }

    // ========================================================================
    // CLIPBOARD CONVENIENCE METHODS
    // ========================================================================

    /**
     * Set clipboard data.
     * @param {Array} features - Features to copy
     * @param {string} sourceMapName - Source map name
     */
    setClipboard(features, sourceMapName) {
        this.batchUpdate(() => {
            this.set('clipboard.features', features);
            this.set('clipboard.copiedAt', Date.now());
            this.set('clipboard.sourceMapName', sourceMapName);
        });
    }

    /**
     * Get clipboard data.
     * @returns {Object} Clipboard state
     */
    getClipboard() {
        return this.get('clipboard');
    }

    /**
     * Check if clipboard has data.
     * @returns {boolean}
     */
    hasClipboardData() {
        const features = this.getUnsafe('clipboard.features') || [];
        return features.length > 0;
    }

    /**
     * Clear clipboard.
     */
    clearClipboard() {
        this.batchUpdate(() => {
            this.set('clipboard.features', []);
            this.set('clipboard.copiedAt', null);
            this.set('clipboard.sourceMapName', null);
        });
    }

    // ========================================================================
    // UI STATE CONVENIENCE METHODS
    // ========================================================================

    /**
     * Set dragging state.
     * @param {boolean} isDragging
     */
    setDragging(isDragging) {
        this.set('ui.isDragging', isDragging);
    }

    /**
     * Check if currently dragging.
     * @returns {boolean}
     */
    isDragging() {
        return this.getUnsafe('ui.isDragging') || false;
    }

    // ========================================================================
    // BASE LAYER CONVENIENCE METHODS
    // ========================================================================

    /**
     * Set active base layer.
     * @param {string} layerId - Base layer ID
     */
    setBaseLayer(layerId) {
        this.set('baseLayer.activeLayer', layerId);
    }

    /**
     * Get active base layer.
     * @returns {string}
     */
    getBaseLayer() {
        return this.getUnsafe('baseLayer.activeLayer') || 'carta-topografica';
    }

    // ========================================================================
    // COORDINATES CONVENIENCE METHODS
    // ========================================================================

    /**
     * Set coordinate display format.
     * @param {'latlong'|'utm'|'mgrs'|'gars'|'georef'} format - Coordinate format
     */
    setCoordinateFormat(format) {
        this.set('mouse.format', format);
    }

    /**
     * Get current coordinate format.
     * @returns {string} Current format (defaults to 'latlong')
     */
    getCoordinateFormat() {
        return this.getUnsafe('mouse.format') || 'latlong';
    }

    /**
     * Toggle or set elevation display.
     * @param {boolean} [enabled] - If omitted, toggles current state
     */
    setElevationEnabled(enabled) {
        if (typeof enabled === 'undefined') {
            enabled = !this.getUnsafe('mouse.elevationEnabled');
        }
        this.set('mouse.elevationEnabled', enabled);
    }

    /**
     * Check if elevation display is enabled.
     * @returns {boolean}
     */
    isElevationEnabled() {
        return this.getUnsafe('mouse.elevationEnabled') || false;
    }

    /**
     * Set current elevation value.
     * @param {number|null} elevation - Elevation in meters or null
     */
    setElevation(elevation) {
        this.set('mouse.elevation', elevation);
    }

    /**
     * Get current elevation value.
     * @returns {number|null}
     */
    getElevation() {
        return this.getUnsafe('mouse.elevation');
    }

    // ========================================================================
    // UI COORDINATION METHODS (Mutual Exclusivity)
    // ========================================================================

    /**
     * Expand sidebar and collapse feature panel (mutual exclusivity).
     * @param {string} tab - Tab to activate: 'mapas' | 'camadas' | 'importar' | 'exportar'
     */
    expandSidebar(tab) {
        const previousTab = this.getUnsafe('sidebar.activeTab');

        this.batchUpdate(() => {
            // Close feature panel first (mutual exclusivity)
            // Track that we came from the feature panel so collapseSidebar can restore it
            if (this.getUnsafe('ui.featurePanelOpen')) {
                this.set('ui.featurePanelOpen', false);
                this._hadFeaturePanelBeforeSidebar = true;
            }

            // Close toolbar popups
            if (this.getUnsafe('ui.activeToolbarGroup')) {
                this.set('ui.activeToolbarGroup', null);
            }

            // Expand sidebar
            this.set('sidebar.expanded', true);
            this.set('sidebar.activeTab', tab);
        });

        this._emitEvent(EventTypes.SIDEBAR_EXPANDED, { tab });
        this._emitEvent(EventTypes.SIDEBAR_TAB_CHANGED, {
            previousTab,
            currentTab: tab
        });
        this._emitLayoutChanged();
    }

    /**
     * Collapse sidebar.
     */
    collapseSidebar() {
        const previousTab = this.getUnsafe('sidebar.activeTab');
        const hadFeaturePanel = this._hadFeaturePanelBeforeSidebar;
        const hasSelection = (this.getUnsafe('selection.features') || []).length > 0;

        // If we came from a feature panel and features are still selected,
        // restore the feature panel instead of just collapsing
        if (hadFeaturePanel && hasSelection) {
            this._hadFeaturePanelBeforeSidebar = false;
            const selected = this.getUnsafe('selection.features');
            const first = selected[0];
            this.openFeaturePanel(first.id, first.type);
            return;
        }

        this._hadFeaturePanelBeforeSidebar = false;

        this.batchUpdate(() => {
            this.set('sidebar.expanded', false);
            this.set('sidebar.activeTab', null);
        });

        this._emitEvent(EventTypes.SIDEBAR_COLLAPSED, {});
        if (previousTab) {
            this._emitEvent(EventTypes.SIDEBAR_TAB_CHANGED, {
                previousTab,
                currentTab: null
            });
        }
        this._emitLayoutChanged();
    }

    /**
     * Toggle sidebar tab - if clicking same tab while expanded, collapse.
     * @param {string} tab - Tab to toggle
     */
    toggleSidebarTab(tab) {
        const isExpanded = this.getUnsafe('sidebar.expanded');
        const activeTab = this.getUnsafe('sidebar.activeTab');

        if (isExpanded && activeTab === tab) {
            this.collapseSidebar();
        } else {
            this.expandSidebar(tab);
        }
    }

    /**
     * Open feature panel and collapse sidebar (mutual exclusivity).
     * @param {string} featureId - ID of the feature being edited
     * @param {string} featureType - Type of the feature
     */
    openFeaturePanel(featureId, featureType) {
        // If the panel is already open, just update the feature reference
        // and emit the content-change event. Skip layout events since nothing moved.
        const alreadyOpen = this.getUnsafe('ui.featurePanelOpen');

        this.batchUpdate(() => {
            // Save the current active tab before collapsing
            const activeTab = this.getUnsafe('sidebar.activeTab');
            if (this.getUnsafe('sidebar.expanded') && activeTab) {
                this.set('sidebar.previousTab', activeTab);
            }

            // Collapse sidebar first (mutual exclusivity) - inline to avoid redundant events
            if (this.getUnsafe('sidebar.expanded')) {
                this.set('sidebar.expanded', false);
                this.set('sidebar.activeTab', null);
            }

            // Close toolbar popups
            const group = this.getUnsafe('ui.activeToolbarGroup');
            if (group) {
                this.set('ui.activeToolbarGroup', null);
            }

            // Open feature panel
            this.set('ui.featurePanelOpen', true);
            this.set('ui.currentFeatureType', featureType);
        });

        // Events emitted AFTER batch flush so subscribers see consistent state
        this._emitEvent(EventTypes.FEATURE_PANEL_OPENED, { featureId, featureType });

        // Only emit layout change when the panel wasn't already open.
        // Switching features while panel is open doesn't change layout position.
        if (!alreadyOpen) {
            this._emitLayoutChanged();
        }
    }

    /**
     * Close feature panel.
     * Restores the previously active sidebar tab if one existed.
     */
    closeFeaturePanel() {
        if (!this.getUnsafe('ui.featurePanelOpen')) return;

        const previousTab = this.getUnsafe('sidebar.previousTab');

        this.batchUpdate(() => {
            this.set('ui.featurePanelOpen', false);
            this.set('ui.currentFeatureType', null);
            if (previousTab) {
                this.set('sidebar.previousTab', null);
            }
        });

        this._emitEvent(EventTypes.FEATURE_PANEL_CLOSED, {});

        // Restore previous sidebar tab if one was saved
        if (previousTab) {
            this.expandSidebar(previousTab);
        } else {
            this._emitLayoutChanged();
        }
    }

    /**
     * Open toolbar group popup.
     * @param {string} group - Group name: 'draw' | 'military' | 'analysis'
     */
    openToolbarGroup(group) {
        const previousGroup = this.getUnsafe('ui.activeToolbarGroup');

        if (previousGroup && previousGroup !== group) {
            this._emitEvent(EventTypes.TOOLBAR_GROUP_CLOSED, { group: previousGroup });
        }

        this.set('ui.activeToolbarGroup', group);
        this._emitEvent(EventTypes.TOOLBAR_GROUP_OPENED, { group });
    }

    /**
     * Close toolbar group popup.
     */
    closeToolbarGroup() {
        const group = this.getUnsafe('ui.activeToolbarGroup');
        if (group) {
            this.set('ui.activeToolbarGroup', null);
            this._emitEvent(EventTypes.TOOLBAR_GROUP_CLOSED, { group });
        }
    }

    /**
     * Toggle toolbar group - if clicking same group while open, close it.
     * @param {string} group - Group name
     */
    toggleToolbarGroup(group) {
        const activeGroup = this.getUnsafe('ui.activeToolbarGroup');
        if (activeGroup === group) {
            this.closeToolbarGroup();
        } else {
            this.openToolbarGroup(group);
        }
    }

    /**
     * Open base layer selector.
     */
    openBaseLayerSelector() {
        this.set('ui.baseLayerSelectorOpen', true);
        this._emitEvent(EventTypes.BASE_LAYER_SELECTOR_OPENED, {});
    }

    /**
     * Close base layer selector.
     */
    closeBaseLayerSelector() {
        if (this.getUnsafe('ui.baseLayerSelectorOpen')) {
            this.set('ui.baseLayerSelectorOpen', false);
            this._emitEvent(EventTypes.BASE_LAYER_SELECTOR_CLOSED, {});
        }
    }

    /**
     * Toggle base layer selector.
     */
    toggleBaseLayerSelector() {
        if (this.getUnsafe('ui.baseLayerSelectorOpen')) {
            this.closeBaseLayerSelector();
        } else {
            this.openBaseLayerSelector();
        }
    }

    /**
     * Close all popups and panels.
     */
    closeAllPopups() {
        this.batchUpdate(() => {
            if (this.getUnsafe('sidebar.expanded')) {
                this.collapseSidebar();
            }
            this.closeFeaturePanel();
            this.closeToolbarGroup();
            this.closeBaseLayerSelector();
        });
        this._emitEvent(EventTypes.UI_CLOSE_ALL_POPUPS, {});
    }

    /**
     * Calculate content left offset based on current sidebar/panel state.
     * Values mirror SIDEBAR_DIMENSIONS in sidebar.constants.js:
     * - COLLAPSED_WIDTH = 56
     * - TOTAL_EXPANDED_WIDTH = 376 (56 + 320)
     * Cannot import directly to avoid circular dependency (sidebar -> state -> sidebar).
     * @returns {number} Pixels from left edge
     */
    getContentLeftOffset() {
        const sidebarExpanded = this.getUnsafe('sidebar.expanded');
        const featurePanelOpen = this.getUnsafe('ui.featurePanelOpen');
        return (sidebarExpanded || featurePanelOpen) ? 376 : 56;
    }

    /**
     * Calculate and emit current layout state.
     * @private
     */
    _emitLayoutChanged() {
        this._emitEvent(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: this.getUnsafe('sidebar.expanded'),
            featurePanelOpen: this.getUnsafe('ui.featurePanelOpen'),
            contentLeftOffset: this.getContentLeftOffset()
        });
    }

    /**
     * Emit event via EventBus if available.
     * @private
     * @param {string} eventType - Event type constant
     * @param {Object} payload - Event payload
     */
    _emitEvent(eventType, payload) {
        if (this._eventBus) {
            this._eventBus.emit(eventType, payload);
        }
    }

    // ========================================================================
    // RESET / DEBUG
    // ========================================================================

    /**
     * Reset state to defaults.
     * Notifies all subscribers.
     */
    reset() {
        this._state = deepClone(DEFAULT_STATE);
        // Notify all subscribers with their new (default) values
        this._subscribers.forEach((callbacks, path) => {
            const value = this.get(path);
            callbacks.forEach(cb => {
                try {
                    cb(value);
                } catch (e) {
                    console.error('StateManager subscriber error during reset:', e);
                }
            });
        });
    }

    /**
     * Get debug info about current state and subscriptions.
     * @returns {Object} Debug information
     */
    getDebugInfo() {
        return {
            state: this.get(),
            subscriberCount: this._subscribers.size,
            subscribedPaths: Array.from(this._subscribers.keys()),
            batchDepth: this._batchDepth,
            pendingNotifications: Array.from(this._pendingNotifications),
        };
    }
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

/** @type {StateManager|null} */
let instance = null;

/**
 * Create StateManager singleton.
 * Should be called once during service initialization.
 * @returns {StateManager}
 * @throws {Error} If already created
 */
export function createStateManager() {
    if (instance) {
        throw new Error('StateManager already created. Use getStateManagerInstance() instead.');
    }
    instance = new StateManager();
    return instance;
}

/**
 * Get StateManager instance.
 * For internal use by services.js.
 * @returns {StateManager|null}
 */
export function getStateManagerInstance() {
    return instance;
}

/**
 * Reset singleton for testing purposes only.
 * @private
 */
export function _resetForTesting() {
    instance = null;
}
