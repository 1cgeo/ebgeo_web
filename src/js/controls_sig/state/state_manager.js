// Path: js/controls_sig/state/state_manager.js

/**
 * @fileoverview Centralized state manager for EBGeo UI state.
 * Single source of truth for volatile UI state.
 *
 * Architecture:
 * - Immutable state updates via deep clone
 * - Path-based subscriptions for reactive updates
 * - Batch updates for performance
 * - Throttled mouse updates to prevent UI thrashing
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deep clone an object to ensure immutability.
 * Handles primitives, Date, Array, and plain Objects.
 * @param {*} obj - Object to clone
 * @returns {*} Deep cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (obj instanceof Object) {
        const copy = {};
        Object.keys(obj).forEach(key => {
            copy[key] = deepClone(obj[key]);
        });
        return copy;
    }
    return obj;
}

/**
 * Get value at dot-notation path.
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path (e.g., 'sidebar.expanded')
 * @returns {*} Value at path or undefined
 */
function getByPath(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
        if (current === null || current === undefined) return undefined;
        current = current[key];
    }
    return current;
}

/**
 * Set value at dot-notation path, returning new object (immutable).
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path
 * @param {*} value - Value to set
 * @returns {Object} New object with updated value
 */
function setByPath(obj, path, value) {
    const keys = path.split('.');
    const result = deepClone(obj);
    let current = result;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined) {
            current[key] = {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = value;
    return result;
}

/**
 * Deep equality check for objects, arrays, and Dates.
 * Used to prevent unnecessary notifications.
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if deeply equal
 */
function deepEqual(a, b) {
    // Identical references or primitives
    if (a === b) return true;

    // Null checks
    if (a === null || b === null) return false;

    // Type mismatch
    if (typeof a !== typeof b) return false;

    // Non-objects (primitives already handled by ===)
    if (typeof a !== 'object') return false;

    // Array-specific comparison
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);

    // One is array, other is not
    if (aIsArray !== bIsArray) return false;

    // Both are arrays
    if (aIsArray) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    // Date vs non-Date
    if (a instanceof Date || b instanceof Date) return false;

    // Plain objects
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }

    return true;
}

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
        expanded: true,
        activeTab: 'maps',          // 'maps' | 'features' | 'pdf'
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

        // Pending mouse update storage to avoid stale closure captures
        /** @private @type {string|null} */
        this._pendingMousePath = null;
        /** @private @type {*} */
        this._pendingMouseValue = null;
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
        if (path === 'mouse.coordinates' || path.startsWith('mouse.')) {
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
        // Always update pending value (latest wins)
        this._pendingMousePath = path;
        this._pendingMouseValue = value;

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
     * Apply pending mouse update to state.
     * Separated from throttle logic to always use latest pending value.
     * @private
     */
    _applyPendingMouseUpdate() {
        if (this._pendingMousePath === null) return;

        this._state = setByPath(this._state, this._pendingMousePath, this._pendingMouseValue);
        this._lastMouseUpdate = Date.now();
        this._notifySubscribers(this._pendingMousePath);

        // Clear pending
        this._pendingMousePath = null;
        this._pendingMouseValue = null;
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
                const value = this.get(subscribedPath);
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
                    const value = this.get(subscribedPath);
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
        const current = this.get('selection.features') || [];
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
        const current = this.get('selection.features') || [];
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
        const features = this.get('selection.features') || [];
        return features.some(f => f.type === type && f.id === id);
    }

    /**
     * Get selected feature by type and id.
     * @param {string} type - Feature type
     * @param {string} id - Feature ID
     * @returns {Object|null} GeoJSON feature or null
     */
    getSelectedFeature(type, id) {
        const features = this.get('selection.features') || [];
        const found = features.find(f => f.type === type && f.id === id);
        return found ? found.feature : null;
    }

    /**
     * Get all selected features.
     * @returns {Array<{type: string, id: string, feature: Object}>}
     */
    getSelectedFeatures() {
        return this.get('selection.features') || [];
    }

    /**
     * Get count of selected features.
     * @returns {number}
     */
    getSelectionCount() {
        const features = this.get('selection.features') || [];
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
        const current = this.get('selection.features') || [];
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
        return this.get('activeTool.type');
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
        const current = this.get('sidebar.expanded');
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
     * Toggle layer collapsed state in FeaturesTab.
     * @param {string} layerId - Layer ID
     */
    toggleLayerCollapsed(layerId) {
        const collapsed = this.get('sidebar.collapsedLayers') || [];
        const index = collapsed.indexOf(layerId);
        if (index === -1) {
            this.set('sidebar.collapsedLayers', [...collapsed, layerId]);
        } else {
            this.set('sidebar.collapsedLayers', collapsed.filter(id => id !== layerId));
        }
    }

    /**
     * Check if layer is collapsed.
     * @param {string} layerId - Layer ID
     * @returns {boolean}
     */
    isLayerCollapsed(layerId) {
        const collapsed = this.get('sidebar.collapsedLayers') || [];
        return collapsed.includes(layerId);
    }

    /**
     * Toggle group collapsed state in FeaturesTab.
     * @param {string} groupId - Group ID
     */
    toggleGroupCollapsed(groupId) {
        const collapsed = this.get('sidebar.collapsedGroups') || [];
        const index = collapsed.indexOf(groupId);
        if (index === -1) {
            this.set('sidebar.collapsedGroups', [...collapsed, groupId]);
        } else {
            this.set('sidebar.collapsedGroups', collapsed.filter(id => id !== groupId));
        }
    }

    /**
     * Check if group is collapsed.
     * @param {string} groupId - Group ID
     * @returns {boolean}
     */
    isGroupCollapsed(groupId) {
        const collapsed = this.get('sidebar.collapsedGroups') || [];
        return collapsed.includes(groupId);
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
        const features = this.get('clipboard.features') || [];
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
        return this.get('ui.isDragging') || false;
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
        return this.get('baseLayer.activeLayer') || 'carta-topografica';
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
        return this.get('mouse.format') || 'latlong';
    }

    /**
     * Toggle or set elevation display.
     * @param {boolean} [enabled] - If omitted, toggles current state
     */
    setElevationEnabled(enabled) {
        if (typeof enabled === 'undefined') {
            enabled = !this.get('mouse.elevationEnabled');
        }
        this.set('mouse.elevationEnabled', enabled);
    }

    /**
     * Check if elevation display is enabled.
     * @returns {boolean}
     */
    isElevationEnabled() {
        return this.get('mouse.elevationEnabled') || false;
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
        return this.get('mouse.elevation');
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
