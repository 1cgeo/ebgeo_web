// Path: js/presence/remote-cursors.layer.js

/**
 * @fileoverview Live remote-cursor overlay (Slice 2 multiuser UX).
 *
 * Renders OTHER online users' cursors on the MapLibre map as lightweight DOM
 * markers (one maplibregl.Marker per remote clientId). Markers are upserted on
 * cursor moves and removed when a user leaves the session or stops sharing a
 * cursor. Only cursors belonging to the currently active map are shown.
 *
 * Source of truth is the pure presenceStore (fed by ws-client cursor/presence
 * messages). This module is DOM-only: it subscribes to the awareness events and
 * reconciles markers — it never mutates presence state.
 *
 * @dependencies
 *   @js/presence/presence-store.js (presenceStore.getCursors)
 *   @store/sync/session-context.js (sessionContext.clientId — self exclusion)
 *   @store (getCurrentMapNameSync — active-map key, matching the bridge's cursor frames)
 *   @store/services.js (getEventBus)
 *   @events/event_types.js (PRESENCE_CURSORS_CHANGED, PRESENCE_CHANGED)
 *   @utils/event-cleanup.js (subscribe/cleanup tracking)
 */

import { presenceStore } from '@js/presence/presence-store.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getCurrentMapNameSync } from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { getPresenceColor } from '@js/presence/presence-colors.js';
import { setupCleanup, subscribe, cleanup } from '@utils/event-cleanup.js';

/**
 * Resolves the display name for a remote cursor, falling back to the clientId so
 * the label always carries something identifiable.
 * @param {{ userName?: string|null, clientId?: string|null }} cursor
 * @returns {string}
 */
function cursorLabel(cursor) {
    return (cursor.userName || cursor.clientId || '') + '';
}

/**
 * Overlay that mirrors remote users' live cursors as MapLibre DOM markers.
 *
 * Lifecycle: construct with the map, call start() to begin rendering and stop()
 * to tear down all markers + listeners. Re-renders on PRESENCE_CURSORS_CHANGED
 * (a cursor moved) and PRESENCE_CHANGED (membership/away changes, which may drop
 * a user whose marker must be removed).
 */
export class RemoteCursorsLayer {
    /**
     * @param {import('maplibre-gl').Map} map - The active MapLibre map.
     * @param {{ mapIdProvider?: () => (string|null) }} [options]
     *   mapIdProvider overrides active-map resolution (defaults to
     *   getCurrentMapNameSync); supplied mainly for testing.
     */
    constructor(map, options = {}) {
        /** @type {import('maplibre-gl').Map} */
        this._map = map;

        /**
         * Resolver for the active-map key. Must match the key the presence-bridge
         * stamps on outbound cursor frames (`getCurrentMapNameSync`, the map NAME) —
         * otherwise the active-map filter never matches and NO remote cursor renders.
         * @type {() => (string|null)}
         */
        this._getMapId = typeof options.mapIdProvider === 'function'
            ? options.mapIdProvider
            : getCurrentMapNameSync;

        /** @type {Map<string, import('maplibre-gl').Marker>} Markers keyed by clientId. */
        this._markers = new Map();

        /** @type {boolean} Whether the overlay is currently active. */
        this._active = false;

        // Initialize cleanup tracking (event-bus subscriptions).
        setupCleanup(this);
    }

    /**
     * Begin rendering remote cursors. Subscribes to awareness events and seeds
     * markers from the current store state. Idempotent.
     */
    start() {
        if (this._active) return;
        this._active = true;

        const eventBus = getEventBus();
        subscribe(this, eventBus, EventTypes.PRESENCE_CURSORS_CHANGED, () => this._render());
        subscribe(this, eventBus, EventTypes.PRESENCE_CHANGED, () => this._render());

        // Seed from current store state before any event arrives.
        this._render();
    }

    /**
     * Stop rendering: remove every marker and drop all event subscriptions.
     * Idempotent.
     */
    stop() {
        if (!this._active) return;
        this._active = false;

        // Drop event-bus subscriptions tracked via subscribe().
        cleanup(this);
        this._removeAllMarkers();
    }

    /**
     * Reconcile markers against the active map's cursors, excluding self.
     * Upserts a marker per remote clientId at {lng,lat} and removes markers for
     * clients no longer present (or that moved to another map).
     * @private
     */
    _render() {
        if (!this._active || !this._map) return;

        const mapId = this._getMapId();
        const selfClientId = sessionContext.clientId;
        // Cursor frames carry only userId (no clientId), so the store keys them by
        // userId — exclude self by BOTH ids, else the user sees their OWN cursor
        // (e.g. another tab of the same user, whom the backend does broadcast to).
        const selfUserId = sessionContext.userId;
        // getCursors(undefined/null) would return cursors across all maps; we
        // only render the active map, so an absent mapId yields no cursors.
        const cursors = mapId === undefined || mapId === null
            ? []
            : presenceStore.getCursors(mapId);

        /** @type {Set<string>} clientIds present in this render pass. */
        const seen = new Set();

        for (const cursor of cursors) {
            const clientId = cursor.clientId;
            if (!clientId) continue;
            // Exclude self by clientId OR userId (the cursor's key may be either).
            const key = String(clientId);
            if ((selfClientId !== undefined && selfClientId !== null && key === String(selfClientId))
                || (selfUserId !== undefined && selfUserId !== null && key === String(selfUserId))) {
                continue;
            }

            const position = cursor.position;
            if (!position
                || typeof position.lng !== 'number'
                || typeof position.lat !== 'number') {
                continue;
            }

            seen.add(clientId);
            this._upsertMarker(clientId, cursor, position);
        }

        // Remove markers for clients no longer rendered.
        for (const clientId of this._markers.keys()) {
            if (!seen.has(clientId)) {
                this._removeMarker(clientId);
            }
        }
    }

    /**
     * Create or update the marker for a single remote cursor.
     * @param {string} clientId
     * @param {{ userName?: string|null, clientId?: string|null }} cursor
     * @param {{ lng: number, lat: number }} position
     * @private
     */
    _upsertMarker(clientId, cursor, position) {
        let marker = this._markers.get(clientId);

        if (!marker) {
            const el = this._createElement(clientId, cursor);
            marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([position.lng, position.lat])
                .addTo(this._map);
            this._markers.set(clientId, marker);
            return;
        }

        // Existing marker: refresh position and label (name may have arrived).
        marker.setLngLat([position.lng, position.lat]);
        const label = marker.getElement()?.querySelector('.remote-cursor__label');
        if (label) {
            // textContent keeps the (untrusted) name XSS-safe.
            label.textContent = cursorLabel(cursor);
        }
    }

    /**
     * Build the marker DOM: a colored pointer (arrow) plus a name label, both
     * tinted with the user's stable presence color — the SAME hue the roster
     * shows for this collaborator. Position is applied at runtime by the marker.
     * @param {string} clientId
     * @param {{ userName?: string|null, clientId?: string|null }} cursor
     * @returns {HTMLDivElement}
     * @private
     */
    _createElement(clientId, cursor) {
        const el = document.createElement('div');
        el.className = 'remote-cursor';
        el.setAttribute('data-testid', 'remote-cursor');
        el.setAttribute('data-client-id', String(clientId));
        // Stable per-user color drives both the pointer and the label via CSS.
        // The marker key (clientId, or userId when frames carry no clientId) is
        // the same key the roster avatar uses, so colors match across surfaces.
        // Guard `style` for the node test stub, which omits it.
        if (el.style) {
            el.style.setProperty('--presence-color', getPresenceColor(String(clientId)));
        }

        // Pointer/arrow (decorative); the label carries the readable identity.
        const pointer = document.createElement('div');
        pointer.className = 'remote-cursor__pointer';
        pointer.setAttribute('aria-hidden', 'true');
        el.appendChild(pointer);

        const label = document.createElement('span');
        label.className = 'remote-cursor__label';
        // textContent renders the (untrusted) name as inert text — XSS-safe.
        label.textContent = cursorLabel(cursor);
        el.appendChild(label);

        return el;
    }

    /**
     * Remove a single marker by clientId.
     * @param {string} clientId
     * @private
     */
    _removeMarker(clientId) {
        const marker = this._markers.get(clientId);
        if (marker) {
            marker.remove();
            this._markers.delete(clientId);
        }
    }

    /**
     * Remove every tracked marker.
     * @private
     */
    _removeAllMarkers() {
        for (const marker of this._markers.values()) {
            marker.remove();
        }
        this._markers.clear();
    }
}

export default RemoteCursorsLayer;
