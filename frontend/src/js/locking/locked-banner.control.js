// Path: js/locking/locked-banner.control.js
import { mapLockController } from '@js/locking/map-lock.controller.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    setupCleanup,
    subscribe,
    cleanup,
    removeElement,
} from '@utils/event-cleanup.js';

/**
 * MapLibre IControl rendering a top banner that announces, in pt-BR, that the
 * active map is locked ("🔒 Mapa bloqueado"). It is purely informational: the
 * backend is the real guarantee (it rejects child mutations on a locked map and
 * gates the lock toggle to the owner). This banner only mirrors that state so
 * collaborators see, at a glance, why edits are being refused.
 *
 * Visibility is reactive. The banner re-reads mapLockController.isMapLocked()
 * whenever a map is modified (EventTypes.MAP_MODIFIED — emitted locally and by
 * the remote-operation handler for incoming lock changes), when the dedicated
 * lock event fires (EventTypes.MAP_LOCK_CHANGED), and when the active map
 * changes lifecycle (MAP_CREATED / MAP_DELETED). When locked it is shown; when
 * unlocked it is hidden via the boolean `hidden` attribute (no inline styles).
 *
 * IControl lifecycle mirrors the slice-1/2 controls (OnlineUsersControl) for
 * onAdd/onRemove/cleanup.
 */
export class LockedBannerControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLDivElement|null} */
        this._container = null;

        // Initialize cleanup tracking.
        setupCleanup(this);
    }

    /**
     * MapLibre asks controls for their default corner. Top-left keeps the
     * banner clear of the top-right presence roster and top-center chrome.
     * @returns {import('maplibre-gl').ControlPosition}
     */
    getDefaultPosition() {
        return 'top-left';
    }

    /**
     * @param {import('maplibre-gl').Map} map
     * @returns {HTMLDivElement}
     */
    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl locked-banner';
        this._container.setAttribute('data-testid', 'locked-banner');
        // role=status so assistive tech announces lock changes politely.
        this._container.setAttribute('role', 'status');
        // Static pt-BR label; safe literal text, no untrusted interpolation.
        this._container.textContent = '🔒 Mapa bloqueado';

        // React to local + remote lock changes and active-map lifecycle. Each
        // simply re-reads the controller, so a single handler covers them all.
        const bus = getEventBus();
        subscribe(this, bus, EventTypes.MAP_MODIFIED, () => this._render());
        subscribe(this, bus, EventTypes.MAP_LOCK_CHANGED, () => this._render());
        subscribe(this, bus, EventTypes.MAP_CREATED, () => this._render());
        subscribe(this, bus, EventTypes.MAP_DELETED, () => this._render());

        // Seed from current lock state before any event arrives.
        this._render();

        return this._container;
    }

    /**
     * Re-read the active map's lock state and toggle banner visibility.
     * Defaults to hidden if the controller cannot resolve a state (e.g. no
     * active map yet), so an unlocked/unknown map never shows the banner.
     * @private
     */
    _render() {
        if (!this._container) return;

        let locked = false;
        try {
            locked = mapLockController.isMapLocked() === true;
        } catch (_e) {
            // Controller unavailable / no active map: treat as unlocked.
            locked = false;
        }

        this._container.setAttribute('data-locked', locked ? 'true' : 'false');
        this._container.hidden = !locked;
    }

    onRemove() {
        // Removes EventBus subscriptions + any DOM/scoped listeners tracked above.
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._map = undefined;
    }
}

