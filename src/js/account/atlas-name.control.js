// Path: js/account/atlas-name.control.js
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { setupCleanup, subscribe, cleanup, removeElement } from '@utils/event-cleanup.js';

/** Small atlas/map glyph shown before the name. */
const ICON_ATLAS = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;

/**
 * A compact label showing the CURRENT remote atlas name, sitting between the
 * sync-status light and the account avatar in the top-right collaboration bar.
 *
 * Only meaningful for a connected remote atlas, so the whole control is hidden
 * while anonymous or on the local store. The name is resolved from the project
 * list (no synchronous source) and cached by atlasId. Bound to
 * CONNECTION_STATE_CHANGED + SESSION_CHANGED. MapLibre IControl.
 */
export class AtlasNameControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLDivElement|null} */
        this._container = null;
        /** @type {HTMLSpanElement|null} */
        this._nameEl = null;
        /** @type {{ id: string|null, name: string|null }} Name cache keyed by atlasId. */
        this._cache = { id: null, name: null };

        setupCleanup(this);
    }

    /**
     * @param {import('maplibre-gl').Map} map
     * @returns {HTMLDivElement}
     */
    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group atlas-name-badge';
        this._container.setAttribute('data-testid', 'atlas-name-badge');
        this._container.hidden = true;

        const icon = document.createElement('span');
        icon.className = 'atlas-name-badge__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = ICON_ATLAS;
        this._container.appendChild(icon);

        this._nameEl = document.createElement('span');
        this._nameEl.className = 'atlas-name-badge__name';
        this._container.appendChild(this._nameEl);

        const eventBus = getEventBus();
        subscribe(this, eventBus, EventTypes.CONNECTION_STATE_CHANGED, () => this._render());
        subscribe(this, eventBus, EventTypes.SESSION_CHANGED, () => this._render());

        this._render();
        return this._container;
    }

    /**
     * Resolves and shows the connected atlas name (hidden when anonymous / local).
     * @private
     */
    async _render() {
        if (!this._container) return;
        const atlasId = syncEngine.atlasId;
        if (!atlasId || !sessionContext.isAuthenticated()) {
            this._apply(null);
            return;
        }
        if (this._cache.id === atlasId && this._cache.name) {
            this._apply(this._cache.name);
            return;
        }
        try {
            const projects = await apiClient.listAtlas();
            const name = Array.isArray(projects)
                ? (projects.find((p) => p && p.id === atlasId)?.name ?? null)
                : null;
            this._cache = { id: atlasId, name };
            // Guard against a disconnect/identity change while the fetch was in flight.
            if (syncEngine.atlasId === atlasId) this._apply(name);
        } catch {
            this._apply(null);
        }
    }

    /**
     * @param {string|null} name
     * @private
     */
    _apply(name) {
        if (!this._container || !this._nameEl) return;
        if (name) {
            this._nameEl.textContent = name;
            this._container.setAttribute('title', `Atlas: ${name}`);
            this._container.hidden = false;
        } else {
            this._nameEl.textContent = '';
            this._container.hidden = true;
        }
    }

    onRemove() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._nameEl = null;
        this._map = undefined;
    }
}

export default AtlasNameControl;
