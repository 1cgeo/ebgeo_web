// Path: js/presence/online-users.control.js
import { presenceStore } from '@js/presence/presence-store.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    clearScopedListeners,
    cleanup,
    removeElement,
} from '@utils/event-cleanup.js';

/** Max overlapping avatars rendered in the toggle before collapsing to "+N". */
const MAX_STACK_AVATARS = 3;

/**
 * Resolves the display name for a presence user, falling back through the
 * available identifiers so the roster always shows something meaningful.
 * @param {{ userName?: string|null, userId?: string|null, clientId?: string|null }} user
 * @returns {string}
 */
function displayName(user) {
    return (user.userName || user.userId || user.clientId || '') + '';
}

/**
 * Builds the short awareness label suffix for a roster row, in pt-BR:
 *   - active map ("Mapa Y") — case C
 *   - briefing edit ("editando briefing") — case D
 *   - temporal instant ("em D+3") — case E
 *   - away ("ausente") — case G
 * Returns a list of { text, testid } parts so the renderer can tag each with a
 * data-testid for assertions, without injecting untrusted text as HTML.
 * @param {import('@js/presence/presence-store.js').PresenceUser} user
 * @returns {Array<{ text: string, testid: string }>}
 */
function awarenessParts(user) {
    const parts = [];

    if (user.away) {
        parts.push({ text: 'ausente', testid: 'online-user-away' });
    }
    if (user.currentMap) {
        // currentMap already carries the map's full NAME (e.g. "Mapa Tático"), so do NOT
        // prefix "Mapa " — that produced "Mapa Mapa Tático". Show the name as-is.
        parts.push({ text: String(user.currentMap), testid: 'online-user-map' });
    }
    if (user.briefingEdit && user.briefingEdit.briefingId) {
        parts.push({ text: 'editando briefing', testid: 'online-user-briefing' });
    }
    const temporalLabel = temporalInstantLabel(user.temporal);
    if (temporalLabel) {
        parts.push({ text: `em ${temporalLabel}`, testid: 'online-user-temporal' });
    }
    const selCount = user.selection && Array.isArray(user.selection.featureIds)
        ? user.selection.featureIds.length
        : 0;
    if (selCount > 0) {
        parts.push({ text: `selecionou ${selCount}`, testid: 'online-user-selection' });
    }

    return parts;
}

/**
 * Derives a short temporal label from a peer's temporal state. Prefers the
 * precomputed `label` shipped by the sender (e.g. "D+3"); falls back to the raw
 * cursor when no label is present. Returns null when there is nothing to show.
 * @param {*} temporal
 * @returns {string|null}
 */
function temporalInstantLabel(temporal) {
    if (!temporal || typeof temporal !== 'object') {
        return null;
    }
    if (typeof temporal.label === 'string' && temporal.label) {
        return temporal.label;
    }
    if (Number.isFinite(temporal.cursor)) {
        return String(temporal.cursor);
    }
    return null;
}

/**
 * MapLibre IControl (top-right) showing a compact cluster of OVERLAPPING
 * avatars (initials only — names live in each circle's `title` tooltip) plus the
 * total count of OTHER online users. Clicking the cluster opens a dropdown with
 * the detailed named list (and per-user awareness meta). No "Online" word, no
 * inline names — the bar stays tiny next to the sync light and account avatar.
 *
 * Reactive: re-renders on EventTypes.PRESENCE_CHANGED from
 * presenceStore.getOthers(sessionContext.clientId) (self is excluded by the
 * store). The whole control is hidden when no other users are online.
 *
 * IControl lifecycle mirrors SyncStatusControl for onAdd/onRemove/cleanup.
 */
export class OnlineUsersControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLDivElement|null} */
        this._container = null;
        /** @type {HTMLButtonElement|null} The avatars+count cluster (opens the list). */
        this._toggle = null;
        /** @type {HTMLSpanElement|null} Overlapping avatar stack inside the toggle. */
        this._stack = null;
        /** @type {HTMLSpanElement|null} Accessible live count text inside the toggle. */
        this._count = null;
        /** @type {HTMLUListElement|null} */
        this._list = null;
        /** @type {boolean} Whether the names list is expanded. */
        this._expanded = false;
        /** @type {((event: Event) => void)|null} Document-level dismiss handler. */
        this._onDocPointerDown = null;
        /** @type {((event: KeyboardEvent) => void)|null} Esc-to-close handler. */
        this._onKeyDown = null;

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
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group online-users';
        this._container.setAttribute('data-testid', 'online-users');

        // Toggle = the overlapping avatar stack + the total count. Clicking it
        // opens/closes the detailed named dropdown.
        this._toggle = document.createElement('button');
        this._toggle.type = 'button';
        this._toggle.className = 'online-users__toggle';
        this._toggle.setAttribute('data-testid', 'online-users-toggle');
        this._toggle.setAttribute('aria-haspopup', 'menu');
        this._toggle.setAttribute('aria-expanded', 'false');
        this._toggle.setAttribute('aria-label', 'Usuários online');

        // Overlapping avatar stack (initials only, name in each circle's title).
        this._stack = document.createElement('span');
        this._stack.className = 'online-users__stack';
        this._stack.setAttribute('aria-hidden', 'true');
        this._toggle.appendChild(this._stack);

        // Visible total count next to the stack.
        this._count = document.createElement('span');
        this._count.className = 'online-users__count';
        this._count.setAttribute('data-testid', 'online-users-count');
        this._count.textContent = '0';
        this._toggle.appendChild(this._count);

        this._container.appendChild(this._toggle);

        this._list = document.createElement('ul');
        this._list.className = 'online-users__list';
        this._list.setAttribute('data-testid', 'online-users-list');
        this._list.setAttribute('role', 'menu');
        this._list.hidden = true;
        this._container.appendChild(this._list);

        addDomListener(this, this._toggle, 'click', () => this._toggleExpanded());

        // Dismiss the dropdown on outside-click / Esc (tracked for cleanup).
        this._onDocPointerDown = (event) => {
            if (this._expanded && this._container && !this._container.contains(event.target)) {
                this._collapse();
            }
        };
        this._onKeyDown = (event) => {
            if (this._expanded && event.key === 'Escape') {
                this._collapse();
                this._toggle?.focus();
            }
        };
        addDomListener(this, document, 'pointerdown', this._onDocPointerDown);
        addDomListener(this, document, 'keydown', this._onKeyDown);

        // React to membership / away changes; the store excludes self.
        subscribe(this, getEventBus(), EventTypes.PRESENCE_CHANGED, () => this._render());

        // Seed from current store state before any event arrives.
        this._render();

        return this._container;
    }

    /**
     * Expand / collapse the names dropdown.
     * @private
     */
    _toggleExpanded() {
        if (this._expanded) {
            this._collapse();
        } else {
            this._expand();
        }
    }

    /** @private */
    _expand() {
        this._expanded = true;
        if (this._list) this._list.hidden = false;
        if (this._toggle) this._toggle.setAttribute('aria-expanded', 'true');
    }

    /** @private */
    _collapse() {
        this._expanded = false;
        if (this._list) this._list.hidden = true;
        if (this._toggle) this._toggle.setAttribute('aria-expanded', 'false');
    }

    /**
     * Re-render the avatar stack + count and the named dropdown from the
     * presence store. Hides the whole control when no other users are online.
     * @private
     */
    _render() {
        if (!this._container || !this._toggle || !this._list) return;

        // Exclude SELF by userId — presence entries carry the user's userId, while
        // sessionContext.clientId is a separate persistent id that does NOT match the
        // stored key, so excluding by clientId left the current user in their own roster.
        const others = presenceStore.getOthers(sessionContext.userId);
        const count = others.length;

        this._container.setAttribute('data-count', String(count));
        this._toggle.setAttribute('data-count', String(count));
        // Visible total count.
        if (this._count) {
            this._count.textContent = String(count);
        }
        this._container.hidden = count === 0;

        if (count === 0) {
            // Collapse so it reopens closed next time someone joins.
            this._collapse();
        }

        this._renderStack(others);
        this._renderList(others);

        if (this._list) {
            this._list.hidden = !this._expanded || count === 0;
        }
    }

    /**
     * Rebuild the overlapping avatar stack shown in the toggle: up to
     * MAX_STACK_AVATARS circles, then a "+N" overflow chip. Each circle carries
     * the peer's name as a `title` tooltip (no visible name).
     * @param {Array} others
     * @private
     */
    _renderStack(others) {
        if (!this._stack) return;
        this._stack.replaceChildren();

        const shown = others.slice(0, MAX_STACK_AVATARS);
        for (const user of shown) {
            const userId = user.userId || user.clientId || '';
            const name = displayName(user);

            const dot = document.createElement('span');
            dot.className = 'online-users__chip';
            dot.setAttribute('title', name);
            dot.textContent = getInitials(name);
            if (dot.style) {
                dot.style.backgroundColor = getPresenceColor(String(userId));
            }
            if (user.away) {
                dot.classList.add('online-users__chip--away');
            }
            this._stack.appendChild(dot);
        }

        const overflow = others.length - shown.length;
        if (overflow > 0) {
            const more = document.createElement('span');
            more.className = 'online-users__chip online-users__chip--more';
            more.setAttribute('data-testid', 'online-users-overflow');
            more.setAttribute('title', `mais ${overflow}`);
            more.textContent = `+${overflow}`;
            this._stack.appendChild(more);
        }
    }

    /**
     * Rebuild the detailed named dropdown rows (name + awareness meta).
     * @param {Array} others
     * @private
     */
    _renderList(others) {
        if (!this._list) return;

        // Rebuild rows; clear previous row listeners to avoid leaks.
        clearScopedListeners(this, 'rows');
        this._list.replaceChildren();

        for (const user of others) {
            const item = document.createElement('li');
            item.className = 'online-users__item';
            item.setAttribute('data-testid', 'online-user-item');
            item.setAttribute('role', 'menuitem');
            const userId = user.userId || user.clientId || '';
            item.setAttribute('data-user-id', String(userId));
            // Dim away users (case G); also expose via attribute for assertions/CSS.
            if (user.away) {
                item.classList.add('online-users__item--away');
                item.setAttribute('data-away', 'true');
            }

            const name = displayName(user);

            // Circular avatar with the peer's initials on a stable per-user color.
            // The color is the SAME hue used by this user's live cursor on the map,
            // so a collaborator is recognizable across roster and overlay.
            const avatarEl = document.createElement('span');
            avatarEl.className = 'online-users__avatar';
            avatarEl.setAttribute('aria-hidden', 'true');
            avatarEl.textContent = getInitials(name);
            // Inline background = the only place a non-token color is allowed (it
            // comes from the deterministic palette helper, not hardcoded CSS).
            if (avatarEl.style) {
                avatarEl.style.backgroundColor = getPresenceColor(String(userId));
            }

            // Status indicator (ring/dot): green when active, grey when away.
            const statusEl = document.createElement('span');
            statusEl.className = 'online-users__status';
            avatarEl.appendChild(statusEl);
            item.appendChild(avatarEl);

            // Text column: name on top, awareness meta as discreet subtext below.
            const bodyEl = document.createElement('span');
            bodyEl.className = 'online-users__body';

            // Name (untrusted → textContent keeps it XSS-safe).
            const nameEl = document.createElement('span');
            nameEl.className = 'online-users__name';
            nameEl.setAttribute('data-testid', 'online-user-name');
            nameEl.textContent = name;
            bodyEl.appendChild(nameEl);

            // Awareness suffixes: active map / briefing-edit / temporal / away /
            // selection. Each is a separate tagged span, grouped as subtext.
            const parts = awarenessParts(user);
            if (parts.length > 0) {
                const metaRow = document.createElement('span');
                metaRow.className = 'online-users__meta-row';
                for (const part of parts) {
                    const partEl = document.createElement('span');
                    partEl.className = 'online-users__meta';
                    partEl.setAttribute('data-testid', part.testid);
                    partEl.textContent = part.text;
                    metaRow.appendChild(partEl);
                }
                bodyEl.appendChild(metaRow);
            }

            item.appendChild(bodyEl);
            this._list.appendChild(item);
        }
    }

    onRemove() {
        // Removes EventBus subscription + DOM/scoped listeners tracked above.
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._toggle = null;
        this._stack = null;
        this._count = null;
        this._list = null;
        this._onDocPointerDown = null;
        this._onKeyDown = null;
        this._map = undefined;
    }
}

