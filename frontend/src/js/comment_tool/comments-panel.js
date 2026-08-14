// Path: js/comment_tool/comments-panel.js

/**
 * @fileoverview "Comentários" section for the Maps sidebar tab.
 *
 * Lists spatial comments from ALL maps in two COLLAPSIBLE groups — "Abertos (N)" and
 * "Resolvidos (N)" — inside a dedicated scroll area (so many comments stay usable). Each item shows
 * which map it belongs to. The section title shows the total count. A header toggle hides/shows ALL
 * pins on the map, and a "+" starts a new comment. Clicking an item switches to its map (if needed),
 * flies to its pin and opens the thread. Aggregates the per-map comment store and drives the
 * CommentOverlay (via the control registry); reloads on COMMENT_* events and on map switch.
 */

import { getComments, getCurrentMapNameSync, getAllMapNamesStore, setCurrentMap } from '@store';
import { getControl } from '@store/control.registry.js';
import { sessionContext } from '@store/sync/session-context.js';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';
import { getPresenceColor } from '@js/presence/presence-colors.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    setupCleanup,
    subscribe,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
    removeElement,
} from '@utils/event-cleanup.js';

const ICONS = {
    eye: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    chevron: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
};

/**
 * Comments section component (rendered inside the Maps tab).
 */
export class CommentsPanel {
    constructor() {
        this._container = null;
        this._scrollEl = null;
        this._titleEl = null;
        this._toggleBtn = null;
        this._newBtn = null;
        /** @type {Object} id → comment for the active map. */
        this._comments = {};
        /** Per-group collapse state (Resolvidos starts collapsed — less actionable). */
        this._collapsed = { open: false, resolved: true };
        setupCleanup(this);
    }

    /** @returns {HTMLElement} */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'comments-panel';
        this._container.setAttribute('data-testid', 'comments-panel');

        const header = document.createElement('div');
        header.className = 'sidebar-section-header sidebar-section-header-with-action';

        this._titleEl = document.createElement('span');
        this._titleEl.textContent = 'Comentários';
        header.appendChild(this._titleEl);

        const actions = document.createElement('div');
        actions.className = 'comments-panel__header-actions';

        this._toggleBtn = document.createElement('button');
        this._toggleBtn.className = 'sidebar-section-header-btn';
        this._toggleBtn.setAttribute('data-testid', 'comments-toggle-visibility');
        this._toggleBtn.title = 'Ocultar comentários';
        this._toggleBtn.innerHTML = ICONS.eye;
        addScopedDomListener(this, 'panel', this._toggleBtn, 'click', () => this._handleToggleVisibility());
        actions.appendChild(this._toggleBtn);

        this._newBtn = document.createElement('button');
        this._newBtn.className = 'sidebar-section-header-btn';
        this._newBtn.setAttribute('data-testid', 'comments-new');
        this._newBtn.title = 'Novo comentário (Shift+C)';
        this._newBtn.innerHTML = ICONS.plus;
        addScopedDomListener(this, 'panel', this._newBtn, 'click', () => this._handleNew());
        actions.appendChild(this._newBtn);

        header.appendChild(actions);
        this._container.appendChild(header);

        this._scrollEl = document.createElement('div');
        this._scrollEl.className = 'comments-panel__scroll';
        this._container.appendChild(this._scrollEl);

        const bus = getEventBus();
        subscribe(this, bus, EventTypes.COMMENT_CREATED, () => this._reload());
        subscribe(this, bus, EventTypes.COMMENT_UPDATED, () => this._reload());
        subscribe(this, bus, EventTypes.COMMENT_DELETED, () => this._reload());
        subscribe(this, bus, EventTypes.LAYERS_CHANGED, () => this._reload());
        // Login/logout changes whether the section shows at all (and the "+").
        subscribe(this, bus, EventTypes.SESSION_CHANGED, () => this._reload());
        // "Limpar Tudo" / logout wipe the store — re-evaluate (the section should empty/hide).
        subscribe(this, bus, EventTypes.ALL_DATA_CLEARED, () => this._reload());

        this._reload();
        return this._container;
    }

    /** @private @returns {Object|null} The shared comment overlay. */
    _overlay() {
        return getControl('commentOverlay');
    }

    /** @private Whether the current session may create comments (logged-in user + comment permission). */
    _canComment() {
        return sessionContext.isAuthenticated() && checkPermission(GuardAction.CREATE_COMMENT).allowed;
    }

    /** @private Reloads comments across ALL maps (each tagged with its map), then re-renders. */
    async _reload() {
        if (!this._scrollEl) return;
        this._currentMapName = getCurrentMapNameSync();

        // Aggregate every map's comments into one id→comment map, tagging each with the
        // source map name (`_mapName`) so the list can show it and a click can switch maps.
        let mapNames = [];
        try {
            mapNames = await getAllMapNamesStore();
        } catch {
            mapNames = [];
        }
        if (!Array.isArray(mapNames) || mapNames.length === 0) {
            mapNames = this._currentMapName ? [this._currentMapName] : [];
        }

        const aggregated = {};
        for (const name of mapNames) {
            const byId = (await getComments(name)) || {};
            for (const [id, comment] of Object.entries(byId)) {
                if (comment) aggregated[id] = { ...comment, _mapName: name };
            }
        }
        this._comments = aggregated;
        if (!this._scrollEl) return;

        const hasComments = Object.values(this._comments).some((c) => c && !c.parentId);
        const canComment = this._canComment();
        // Logged out with NO comments → hide the whole section. With comments (e.g. from an imported
        // .ebgeo) → show it READ-ONLY (no "+"). Logged in → show it with the "+" to add.
        const shouldShow = canComment || hasComments;
        this._container.hidden = !shouldShow;
        if (!shouldShow) return;
        if (this._newBtn) this._newBtn.hidden = !canComment;

        this._render();
        this._syncToggle();
    }

    /** @private Renders the title count + the two collapsible groups from `this._comments`. */
    _render() {
        clearScopedListeners(this, 'rows');
        this._scrollEl.innerHTML = '';

        const roots = Object.values(this._comments).filter((c) => c && !c.parentId);
        const replyCount = (id) => Object.values(this._comments).filter((c) => c && c.parentId === id).length;
        const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
        const open = roots.filter((c) => c.status !== 'resolved').sort(byNewest);
        const resolved = roots.filter((c) => c.status === 'resolved').sort(byNewest);

        if (this._titleEl) {
            this._titleEl.textContent = roots.length ? `Comentários (${roots.length})` : 'Comentários';
        }

        if (roots.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'comments-panel__empty';
            empty.textContent = 'Nenhum comentário.';
            this._scrollEl.appendChild(empty);
            return;
        }

        if (open.length) this._scrollEl.appendChild(this._group('open', 'Abertos', open, replyCount));
        if (resolved.length) this._scrollEl.appendChild(this._group('resolved', 'Resolvidos', resolved, replyCount));
    }

    /**
     * @private Builds a collapsible group: a header (label + count + chevron) and the item list.
     * @param {string} key - 'open' | 'resolved' (collapse-state key).
     * @param {string} label
     * @param {Object[]} items
     * @param {(id:string)=>number} replyCount
     */
    _group(key, label, items, replyCount) {
        const collapsed = this._collapsed[key] === true;
        const group = document.createElement('div');
        group.className = 'comments-group';

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'comments-group__header';
        header.setAttribute('aria-expanded', (!collapsed).toString());
        header.setAttribute('data-testid', `comments-group-${key}`);
        header.innerHTML = `<span class="comments-group__chevron">${ICONS.chevron}</span>`;
        const labelEl = document.createElement('span');
        labelEl.className = 'comments-group__label';
        labelEl.textContent = `${label} (${items.length})`;
        header.appendChild(labelEl);
        addScopedDomListener(this, 'rows', header, 'click', () => {
            this._collapsed[key] = !this._collapsed[key];
            this._render();
        });
        group.appendChild(header);

        if (!collapsed) {
            const list = document.createElement('div');
            list.className = 'comments-group__list';
            for (const c of items) list.appendChild(this._item(c, replyCount(c.id)));
            group.appendChild(list);
        }
        return group;
    }

    /** @private One comment row (avatar + snippet + reply count + resolved badge). */
    _item(comment, replies) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'comment-list-item';
        item.dataset.resolved = comment.status === 'resolved' ? 'true' : 'false';
        item.dataset.commentId = comment.id;
        item.setAttribute('data-testid', 'comment-list-item');

        const avatar = document.createElement('span');
        avatar.className = 'comment-list-item__avatar';
        avatar.textContent = comment.authorInitials || '?';
        avatar.style.backgroundColor = comment.authorColor || getPresenceColor(String(comment.authorId || ''));
        item.appendChild(avatar);

        const body = document.createElement('div');
        body.className = 'comment-list-item__body';
        // Which map this comment belongs to (the list spans all maps).
        if (comment._mapName) {
            const mapTag = document.createElement('div');
            mapTag.className = 'comment-list-item__map';
            mapTag.textContent = comment._mapName;
            body.appendChild(mapTag);
        }
        const text = document.createElement('div');
        text.className = 'comment-list-item__text';
        text.textContent = comment.text || '';
        body.appendChild(text);
        const meta = document.createElement('div');
        meta.className = 'comment-list-item__meta';
        meta.textContent = replies > 0 ? `${replies} ${replies > 1 ? 'respostas' : 'resposta'}` : '';
        body.appendChild(meta);
        item.appendChild(body);

        if (comment.status === 'resolved') {
            const badge = document.createElement('span');
            badge.className = 'comment-list-item__badge';
            badge.textContent = '✓';
            item.appendChild(badge);
        }

        addScopedDomListener(this, 'rows', item, 'click', () => this._focusComment(comment));
        return item;
    }

    /**
     * @private Focuses a comment, switching to its map first when it belongs to a
     * different map than the active one (the list spans all maps).
     * @param {Object} comment - The aggregated comment (carries `_mapName`).
     */
    async _focusComment(comment) {
        const target = comment._mapName;
        if (target && target !== getCurrentMapNameSync()) {
            try {
                await setCurrentMap(target);
                const baseLayer = getControl('BaseLayerControl');
                if (baseLayer?.switchMap) await baseLayer.switchMap();
                getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } catch {
                return;
            }
        }
        await this._overlay()?.focusComment(comment.id);
    }

    /** @private Hide/show all comment pins. */
    _handleToggleVisibility() {
        const ov = this._overlay();
        if (!ov) return;
        ov.setVisible(!ov.isVisible());
        this._syncToggle();
    }

    /** @private Reflects the overlay's visibility on the toggle button. */
    _syncToggle() {
        const ov = this._overlay();
        const visible = ov ? ov.isVisible() : true;
        if (this._toggleBtn) {
            this._toggleBtn.innerHTML = visible ? ICONS.eye : ICONS.eyeOff;
            this._toggleBtn.title = visible ? 'Ocultar comentários' : 'Mostrar comentários';
            // Greyed-out when comments are hidden (the "off" state is visually obvious).
            this._toggleBtn.classList.toggle('comments-toggle--off', !visible);
        }
    }

    /** @private Starts a new comment (placement mode). */
    _handleNew() {
        this._overlay()?.togglePlacement(true);
    }

    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._scrollEl = null;
        this._titleEl = null;
        this._toggleBtn = null;
        this._newBtn = null;
    }
}

