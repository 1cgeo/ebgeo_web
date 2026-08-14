// Path: js/account/sync-status.control.js
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { connectionState, ConnectionStates } from '@store/sync/connection-state.js';
import { sessionContext } from '@store/sync/session-context.js';
import { setupCleanup, subscribe, cleanup, removeElement } from '@utils/event-cleanup.js';

/**
 * Maps a connection state to the indicator presentation:
 * normalized `data-state` value plus the pt-BR label exposed via `title`
 * (tooltip on hover). Colors are driven purely by CSS via the `data-state`
 * attribute (green / yellow / red dot).
 * @param {string} state - One of ConnectionStates.
 * @returns {{ dataState: string, label: string }}
 */
function describeState(state) {
    switch (state) {
        case ConnectionStates.ONLINE:
            return { dataState: 'online', label: 'Conectado' };
        case ConnectionStates.CONNECTING:
        case ConnectionStates.RECONNECTING:
            return { dataState: 'connecting', label: 'Sincronizando…' };
        case ConnectionStates.OFFLINE:
        default:
            return { dataState: 'offline', label: 'Desconectado' };
    }
}

/**
 * A single sync-status light: a colored dot (green = Conectado, yellow =
 * Sincronizando…, red/grey = Desconectado) with NO visible text — the label is
 * shown on hover via the `title` attribute. It sits next to the account avatar
 * in the compact top-right collaboration bar.
 *
 * The light only makes sense for an authenticated session, so the whole control
 * is hidden while anonymous (SESSION_CHANGED drives show/hide). It used to be a
 * full pill that dumped the raw user UUID; this is now just the light.
 *
 * Bound to CONNECTION_STATE_CHANGED + SESSION_CHANGED. MapLibre IControl.
 */
export class SyncStatusControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLDivElement|null} */
        this._container = null;
        /** @type {HTMLSpanElement|null} The colored dot itself. */
        this._dot = null;

        // Initialize cleanup tracking.
        setupCleanup(this);
    }

    /**
     * @param {import('maplibre-gl').Map} map
     * @returns {HTMLDivElement}
     */
    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group sync-status-badge';
        this._container.setAttribute('data-testid', 'sync-status-badge');

        this._dot = document.createElement('span');
        this._dot.className = 'sync-status-badge__dot';
        this._container.appendChild(this._dot);

        // Seed from the current state so the light is correct before any event.
        this._renderState(connectionState.getState());
        this._renderVisibility();

        const eventBus = getEventBus();
        subscribe(this, eventBus, EventTypes.CONNECTION_STATE_CHANGED, (payload) => {
            this._renderState(payload && payload.currentState);
        });
        // Show only when authenticated; hide on logout / anonymous.
        subscribe(this, eventBus, EventTypes.SESSION_CHANGED, () => this._renderVisibility());

        return this._container;
    }

    /**
     * Apply the visual state (data-state attribute + title tooltip).
     * @param {string} state - One of ConnectionStates.
     * @private
     */
    _renderState(state) {
        if (!this._container) return;
        const { dataState, label } = describeState(state);
        this._container.setAttribute('data-state', dataState);
        // No visible text — the label is the hover tooltip.
        this._container.setAttribute('title', label);
    }

    /**
     * Show the light only for an authenticated session.
     * @private
     */
    _renderVisibility() {
        if (!this._container) return;
        this._container.hidden = !sessionContext.isAuthenticated();
    }

    onRemove() {
        // Removes EventBus subscriptions tracked via subscribe().
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._dot = null;
        this._map = undefined;
    }
}

