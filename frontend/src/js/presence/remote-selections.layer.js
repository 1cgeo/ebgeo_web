// Path: js/presence/remote-selections.layer.js

/**
 * @fileoverview Live remote-selection overlay for the 2D map (multiuser UX).
 *
 * Renders OTHER online users' feature selections as colored outline boxes on the
 * MapLibre map — the selection analogue of remote-cursors.layer.js. Only peers'
 * selections on the active map ('2d' surface, matching mapId) are shown, each tinted
 * with the peer's stable presence color (the SAME hue as their cursor/roster avatar).
 *
 * The peer frame carries only featureIds (+ optional per-feature type via
 * featureMeta) — not geometry. We resolve each id to its full feature from the LOCAL
 * map source via the SelectionManager (shared atlas → the geometry is already here)
 * and rebuild the box with the same per-tool `createSelectionBox` the local highlight
 * uses, so a remote box looks exactly like a local one but in the peer's color.
 *
 * Source of truth is the pure presenceStore (fed by ws-client selection frames). This
 * module is render-only: it subscribes to awareness events and rewrites the
 * `remote-selection-boxes` source — it never mutates presence or selection state.
 *
 * @dependencies
 *   @js/presence/presence-store.js (presenceStore.getSelections)
 *   @store/sync/session-context.js (sessionContext.clientId/userId — self exclusion)
 *   @store (getCurrentMapNameSync — active-map key, matching the bridge's frames)
 *   @store/services.js (getEventBus)
 *   @events/event_types.js (PRESENCE_SELECTIONS_CHANGED, PRESENCE_CHANGED, LAYERS_CHANGED)
 *   @js/presence/presence-colors.js (getPresenceColor)
 *   @utils/event-cleanup.js (subscribe/cleanup tracking)
 */

import { presenceStore } from '@js/presence/presence-store.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getCurrentMapNameSync } from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { getPresenceColor } from '@js/presence/presence-colors.js';
import { setupCleanup, subscribe, cleanup } from '@utils/event-cleanup.js';

const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

/** The MapLibre source/layer this overlay owns (created in auxiliary.layers.js). */
const REMOTE_SELECTION_SOURCE = 'remote-selection-boxes';

/**
 * Overlay that mirrors remote users' 2D selections as colored outline boxes.
 *
 * Lifecycle: construct with the map + the SelectionManager, call start() to begin
 * rendering and stop() to clear the source + listeners. Re-renders on
 * PRESENCE_SELECTIONS_CHANGED (a selection changed), PRESENCE_CHANGED (a peer left,
 * dropping their boxes), LAYERS_CHANGED (the selected feature's geometry changed —
 * e.g. a peer DRAGGED it — so the box follows), and map zoom (box pixel sizes change
 * with zoom). Rendering is async (source reads), guarded by a generation token.
 */
export class RemoteSelectionsLayer {
    /**
     * @param {import('maplibre-gl').Map} map - The active MapLibre map.
     * @param {Object} selectionManager - SelectionManager (getCompleteFeatureFromSource + per-tool controls).
     * @param {{ mapIdProvider?: () => (string|null) }} [options]
     *   mapIdProvider overrides active-map resolution (defaults to getCurrentMapNameSync); for testing.
     */
    constructor(map, selectionManager, options = {}) {
        /** @type {import('maplibre-gl').Map} */
        this._map = map;

        /** @type {Object} */
        this._selectionManager = selectionManager;

        /**
         * Resolver for the active-map key. Must match the key the presence-bridge
         * stamps on outbound selection frames (`getCurrentMapNameSync`, the map NAME).
         * @type {() => (string|null)}
         */
        this._getMapId = typeof options.mapIdProvider === 'function'
            ? options.mapIdProvider
            : getCurrentMapNameSync;

        /** @type {boolean} Whether the overlay is currently active. */
        this._active = false;

        /** @type {number} Monotonic render token: discards stale async renders. */
        this._generation = 0;

        /** @type {number|null} rAF id for the debounced zoom re-render. */
        this._rafId = null;

        setupCleanup(this);
    }

    /**
     * Begin rendering remote selections. Subscribes to awareness events + map zoom
     * and seeds from current store state. Idempotent.
     */
    start() {
        if (this._active) return;
        this._active = true;

        const eventBus = getEventBus();
        subscribe(this, eventBus, EventTypes.PRESENCE_SELECTIONS_CHANGED, () => this._render());
        // A peer leaving/away emits PRESENCE_CHANGED (not a selection event); re-render
        // so their boxes are dropped.
        subscribe(this, eventBus, EventTypes.PRESENCE_CHANGED, () => this._render());
        // The selected feature's GEOMETRY can change without the selection set changing — most
        // visibly when a peer DRAGS a selected feature. The moved geometry lands in our GeoJSON
        // sources via the remote-feature-render refresh, which emits LAYERS_CHANGED once the sources
        // are fresh. Re-read + rebuild the boxes then so a remote selection box FOLLOWS the feature
        // (debounced to one rAF — LAYERS_CHANGED can burst). FEATURE_MODIFIED alone would fire BEFORE
        // that refresh and rebuild from stale geometry.
        subscribe(this, eventBus, EventTypes.LAYERS_CHANGED, () => this._scheduleRender());

        if (this._map && typeof this._map.on === 'function') {
            this._map.on('zoom', this._onZoom);
        }

        this._render();
    }

    /**
     * Stop rendering: clear the source, drop subscriptions and the map listener.
     * Idempotent.
     */
    stop() {
        if (!this._active) return;
        this._active = false;

        // Invalidate any in-flight async render.
        this._generation++;

        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        if (this._map && typeof this._map.off === 'function') {
            this._map.off('zoom', this._onZoom);
        }

        cleanup(this);
        this._clearSource();
    }

    /**
     * Debounced zoom handler: selection-box pixel sizes change with zoom, so the
     * geographic box geometry must be rebuilt (mirrors SelectionHighlightManager).
     * @private
     */
    _onZoom = () => this._scheduleRender();

    /**
     * Coalesce bursty re-render triggers (zoom, LAYERS_CHANGED during a peer drag) into a single
     * render on the next animation frame.
     * @private
     */
    _scheduleRender() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
        }
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._render();
        });
    }

    /**
     * Rebuild every remote box for the active map and write the source. Excludes self.
     * Async: feature geometry is read from the map source per id; a generation token
     * discards a render superseded while awaiting.
     * @private
     */
    async _render() {
        if (!this._active || !this._map) return;

        const mapId = this._getMapId();
        if (mapId === undefined || mapId === null) {
            this._clearSource();
            return;
        }

        const selfClientId = sessionContext.clientId;
        const selfUserId = sessionContext.userId;
        const selections = presenceStore
            .getSelections('2d', mapId)
            .filter((sel) => !this._isSelf(sel.clientId, selfClientId, selfUserId));

        const generation = ++this._generation;
        const boxes = [];

        for (const sel of selections) {
            const color = getPresenceColor(String(sel.userId || sel.clientId || ''));
            // Prefer featureMeta ({id,type}); fall back to bare ids (type probed).
            const metas = Array.isArray(sel.featureMeta) && sel.featureMeta.length
                ? sel.featureMeta
                : sel.featureIds.map((id) => ({ id, type: null }));

            for (const meta of metas) {
                const box = await this._buildBox(meta.type, meta.id, color, sel.clientId);
                // Bail out early if a newer render started or we were stopped.
                if (generation !== this._generation || !this._active) return;
                if (box) boxes.push(box);
            }
        }

        if (generation !== this._generation || !this._active) return;
        this._setData(boxes);
    }

    /**
     * Resolve a single peer-selected feature to a colored selection-box feature, or
     * null when it can't be built (unknown type, not on this map, no box strategy).
     * @param {string|null} type - Tool type from featureMeta (may be null → probe).
     * @param {string} featureId
     * @param {string} color - Peer presence color.
     * @param {string} clientId
     * @returns {Promise<Object|null>}
     * @private
     */
    async _buildBox(type, featureId, color, clientId) {
        try {
            const resolved = await this._resolveFeatureAndControl(type, featureId);
            if (!resolved) return null;
            const { feature, control } = resolved;
            if (!control || typeof control.createSelectionBox !== 'function') return null;

            // Recompute the box from the feature's CURRENT geometry — never reuse a stored, possibly
            // stale `properties.selectionBox`. A point keeps its home-position box until re-authored,
            // and a peer's move syncs the new geometry but not (always) the recomputed box; without
            // this the remote box freezes at the pre-drag position. Clone so the live source feature
            // is not mutated.
            const fresh = feature.properties && feature.properties.selectionBox != null
                ? { ...feature, properties: { ...feature.properties, selectionBox: null } }
                : feature;
            const boxGeometry = control.createSelectionBox(fresh);
            if (!boxGeometry) return null;

            return {
                type: 'Feature',
                geometry: boxGeometry.geometry || boxGeometry,
                properties: {
                    type: 'remote-selection-box',
                    color,
                    featureId: String(featureId),
                    clientId: String(clientId),
                },
            };
        } catch {
            // Feature not on this map yet, or tool can't build a box — skip silently.
            return null;
        }
    }

    /**
     * Fetch the full feature + its control. When `type` is known we go straight to
     * that control; otherwise we probe every registered control (legacy frames with
     * no featureMeta). Returns null when nothing matches.
     * @param {string|null} type
     * @param {string} featureId
     * @returns {Promise<{ feature: Object, control: Object }|null>}
     * @private
     */
    async _resolveFeatureAndControl(type, featureId) {
        const controls = this._selectionManager?.controls;
        if (!controls) return null;

        if (type && controls.has(type)) {
            const feature = await this._selectionManager.getCompleteFeatureFromSource(type, featureId);
            return feature ? { feature, control: controls.get(type) } : null;
        }

        // No (or unknown) type: probe each control until one source holds the id.
        for (const [t, control] of controls.entries()) {
            const feature = await this._selectionManager.getCompleteFeatureFromSource(t, featureId);
            if (feature) return { feature, control };
        }
        return null;
    }

    /**
     * Whether a selection's owner is the local user (matched by clientId OR userId,
     * since selection frames carry only userId and the store may key on either).
     * @param {string} ownerKey
     * @param {string|null} selfClientId
     * @param {string|null} selfUserId
     * @returns {boolean}
     * @private
     */
    _isSelf(ownerKey, selfClientId, selfUserId) {
        const key = ownerKey == null ? null : String(ownerKey);
        if (key === null) return false;
        return (selfClientId != null && key === String(selfClientId))
            || (selfUserId != null && key === String(selfUserId));
    }

    /**
     * @param {Object[]} boxes
     * @private
     */
    _setData(boxes) {
        const source = this._map.getSource(REMOTE_SELECTION_SOURCE);
        if (source) {
            source.setData({ type: 'FeatureCollection', features: boxes });
        }
    }

    /** @private */
    _clearSource() {
        const source = this._map?.getSource?.(REMOTE_SELECTION_SOURCE);
        if (source) {
            source.setData(EMPTY_FC);
        }
    }
}

export default RemoteSelectionsLayer;
