// Path: js/comment_tool/comment-overlay.js

/**
 * @fileoverview Spatial-comment map overlay (Fase 3 — UI).
 *
 * Renders root comments as MapLibre DOM-marker PINS (a colored teardrop with the author's 2
 * initials), and drives the Google-Docs-style THREAD card (root + replies + reply box + resolve/
 * delete) and the COMPOSE card (new comment) via MapLibre popups anchored to the coordinate.
 *
 * Pure DOM + the store comment ops; it never logs sync ops itself (the store ops do). It reloads
 * from the per-map comment side-store on COMMENT_* events (local and remote are symmetric) and on
 * map switch, then reconciles markers.
 */

import {
    getCurrentMapNameSync,
    getComments,
    addComment,
    addReply,
    updateComment,
    resolveComment,
    removeComment,
} from '@store';
import { isRemoteStoreSync } from '@store/store-origin.js';
import { sessionContext } from '@store/sync/session-context.js';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';
import { getInitials, getPresenceColor } from '@js/presence/presence-colors.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { showWarning } from '@utils/toast_service.js';
import { setupCleanup, subscribe, trackTimer, cleanup } from '@utils/event-cleanup.js';
import { maplibregl } from '@js/map/maplibre.js';

/** Static speech-bubble glyph for the pin reply-count badge (static SVG — XSS-safe). */
const REPLY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>`;

/** Relative-time label in pt-BR (compact). */
function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'agora';
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return `há ${d} d`;
}

/** Identity stamp for a new comment/reply from the current session. */
function authorStamp() {
    const name = sessionContext.username || '';
    const id = sessionContext.userId || '';
    return {
        authorId: id || null,
        authorInitials: getInitials(name),
        authorColor: getPresenceColor(String(id || name)),
    };
}

/**
 * Comment overlay: pins + thread/compose cards. Construct with the map, call start()/stop().
 */
export class CommentOverlay {
    /** @param {import('maplibre-gl').Map} map @param {Object} [toolManager] */
    constructor(map, toolManager = null) {
        this._map = map;
        this._toolManager = toolManager;
        /** @type {string} Tool type — drives the active-tool chip + tool-manager mutual exclusivity. */
        this.type = 'comment';
        /** @type {Map<string, import('maplibre-gl').Marker>} commentId → pin marker (roots only). */
        this._markers = new Map();
        /** @type {Object} id → comment for the active map. */
        this._comments = {};
        /** @type {import('maplibre-gl').Popup|null} The open thread/compose card. */
        this._popup = null;
        /** @type {boolean} Placement mode (next map click creates a comment). */
        this._placement = false;
        /** @type {string|null} Root id currently being dragged — suppresses the post-drag click. */
        this._draggingId = null;
        /** @type {boolean} Whether comment pins are shown on the map. */
        this._visible = true;
        this._active = false;
        this._onMapClick = (e) => this._handleMapClick(e);
        setupCleanup(this);
    }

    /** Begin rendering + listening. Idempotent. */
    start() {
        if (this._active) return;
        this._active = true;
        const bus = getEventBus();
        subscribe(this, bus, EventTypes.COMMENT_CREATED, () => this._reload());
        subscribe(this, bus, EventTypes.COMMENT_UPDATED, () => this._reload());
        subscribe(this, bus, EventTypes.COMMENT_DELETED, () => this._reload());
        // Map switch rebuilds layers + emits LAYERS_CHANGED — reload comments for the new map.
        subscribe(this, bus, EventTypes.LAYERS_CHANGED, () => this._reload());
        // Login/logout flips who can modify a comment — refresh the open thread's gated controls.
        subscribe(this, bus, EventTypes.SESSION_CHANGED, () => this._reload());
        // "Limpar Tudo" / logout wipe the store — drop the now-stale pins + open card.
        subscribe(this, bus, EventTypes.ALL_DATA_CLEARED, () => this._reload());
        this._map.on('click', this._onMapClick);
        this._reload();
    }

    /** Tear down all markers, the open card, and listeners. Idempotent. */
    stop() {
        if (!this._active) return;
        this._active = false;
        cleanup(this);
        this._map.off('click', this._onMapClick);
        this._setPlacement(false);
        this._closeCard();
        for (const m of this._markers.values()) m.remove();
        this._markers.clear();
    }

    /** Requests/leaves placement as a TOOL: entering routes through the tool manager so the
     * active-tool chip shows and any other active tool deactivates (and vice-versa). Refuses to
     * enter without comment permission (avoids a click+type the store then silently rejects). */
    togglePlacement(on) {
        const next = on === undefined ? !this._placement : !!on;
        if (next === this._placement) return this._placement;
        if (next) {
            if (!this._canComment()) {
                // A frase nomeia o motivo REAL, e sao QUATRO diferentes: um "faca login" dito a
                // quem esta num atlas local manda a pessoa fazer algo que nao resolve nada.
                //
                // O DESDOBRAMENTO DO CASO LOCAL, em 2026-08-24, e do mesmo feitio do erro que a
                // divisao original consertou, so que um degrau adiante: "Envie este atlas ao
                // servidor" nomeia uma acao que a interface NAO oferece a quem nao entrou. O
                // comando `save-server` nao esta na linha `local-anon` de `ACTIONS_BY_STATE`
                // (`sidebar/tabs/atlas-actions.js`) e `AccountControl` o esconde sem sessao, entao
                // o anonimo saia procurando um botao que nao existe. O ramo que manda ENTRAR na
                // conta so era alcancado por quem JA estava num atlas de servidor.
                //
                // O primeiro periodo e o mesmo nos dois: o motivo continua sendo a natureza do
                // atlas, e so o proximo passo muda.
                let motivo;
                if (!isRemoteStoreSync()) {
                    motivo = sessionContext.isAuthenticated()
                        ? 'Comentários existem só em atlas do servidor. Envie este atlas ao servidor para comentar.'
                        : 'Comentários existem só em atlas do servidor. Entre na sua conta para enviar este atlas ao servidor.';
                } else if (!sessionContext.isAuthenticated()) {
                    motivo = 'Entre na sua conta para adicionar comentários.';
                } else {
                    motivo = 'Você não tem permissão para comentar neste atlas.';
                }
                showWarning(motivo);
                return false;
            }
            if (this._toolManager) this._toolManager.setActiveTool(this);
            else this._setPlacement(true);
        } else {
            this._endPlacement();
        }
        return this._placement;
    }

    /** Tool-manager hook: enter placement mode (this tool became active). */
    activate() {
        this._setPlacement(true);
    }

    /** Tool-manager hook: leave placement mode (another tool activated, ESC, or the chip close). */
    deactivate() {
        this._setPlacement(false);
    }

    /** @private Sets the placement flag + the map cursor. */
    _setPlacement(on) {
        this._placement = !!on;
        const canvas = this._map.getCanvas?.();
        if (canvas) canvas.style.cursor = this._placement ? 'crosshair' : '';
    }

    /** @private Ends placement via the tool manager (so the active-tool chip clears) when this is
     * the active tool; otherwise just clears the flag/cursor. */
    _endPlacement() {
        if (this._toolManager && this._toolManager.activeTool === this) {
            this._toolManager.deactivateCurrentTool();
        } else {
            this._setPlacement(false);
        }
    }

    /**
     * @private Se a sessao pode criar comentario.
     *
     * TRES CONDICOES, e a primeira entrou em 2026-08-16 por decisao do dono: comentario e uma
     * conversa, e num atlas LOCAL nao ha com quem conversar. Ele ficava disponivel ali, deslogado
     * inclusive, e produzia uma anotacao que ninguem jamais leria e que nem sequer sobe ao servidor
     * quando o atlas e enviado. As outras duas seguem: comentario tem autor (exige login) e o papel
     * precisa alcancar Comentarista.
     */
    _canComment() {
        return isRemoteStoreSync()
            && sessionContext.isAuthenticated()
            && checkPermission(GuardAction.CREATE_COMMENT).allowed;
    }

    /** @private Whether the session may edit/resolve/delete THIS comment: an Editor+ may act on any,
     * a Comentarista only on their own. Always true on the local store (P1). */
    _canModify(comment) {
        if (!this._canComment()) return false;
        if (sessionContext.canPerformAction('canEdit')) return true;
        return !!comment.authorId && comment.authorId === sessionContext.userId;
    }

    /** @returns {boolean} */
    isPlacing() {
        return this._placement;
    }

    /**
     * Shows or hides ALL comment pins on the map (the "ocultar comentários" toggle). Hiding also
     * closes any open thread/compose card.
     * @param {boolean} visible
     */
    setVisible(visible) {
        this._visible = !!visible;
        if (!this._visible) {
            this._closeCard();
            for (const m of this._markers.values()) m.remove();
            this._markers.clear();
        } else {
            this._render();
        }
    }

    /** @returns {boolean} Whether comment pins are currently shown. */
    isVisible() {
        return this._visible !== false;
    }

    /**
     * Flies to a comment's pin and opens its thread (used by the Comentários list in the Maps panel).
     * Ensures comments are visible first. When the comment isn't in the loaded set yet (e.g. the
     * caller just switched to its map), reloads once before giving up.
     * @param {string} rootId
     */
    async focusComment(rootId) {
        let root = this._comments[rootId];
        if (!root) {
            await this._reload();
            root = this._comments[rootId];
        }
        if (!root || !Number.isFinite(root.lng) || !Number.isFinite(root.lat)) return;
        if (!this._visible) this.setVisible(true);
        this._map.flyTo({ center: [root.lng, root.lat], zoom: Math.max(this._map.getZoom(), 15) });
        this._openThread(rootId);
    }

    // ===== DATA =====

    /** @private Reloads the active map's comments and reconciles markers. */
    async _reload() {
        if (!this._active) return;
        const mapName = getCurrentMapNameSync();
        this._comments = (mapName ? await getComments(mapName) : {}) || {};
        if (!this._active) return;
        this._render();
        // Keep an open thread card fresh (new replies / resolve).
        if (this._popup?._ebgeoRootId) {
            const root = this._comments[this._popup._ebgeoRootId];
            if (root) this._openThread(root.id, true);
            else this._closeCard();
        }
    }

    // ===== PINS =====

    /** @private Reconcile pin markers against the root comments. */
    _render() {
        if (this._visible === false) {
            for (const m of this._markers.values()) m.remove();
            this._markers.clear();
            return;
        }
        // Resolved comments are NOT shown on the map — they live only in the Comentários panel
        // (a focusComment from the panel still opens the resolved thread card by coordinate).
        const roots = Object.values(this._comments).filter(
            (c) => c && !c.parentId && c.status !== 'resolved' && Number.isFinite(c.lng) && Number.isFinite(c.lat),
        );
        const seen = new Set();
        for (const root of roots) {
            seen.add(root.id);
            this._upsertMarker(root);
        }
        for (const id of [...this._markers.keys()]) {
            if (!seen.has(id)) {
                this._markers.get(id).remove();
                this._markers.delete(id);
            }
        }
    }

    /** @private */
    _upsertMarker(root) {
        const color = root.authorColor || getPresenceColor(String(root.authorId || ''));
        const replies = this._replyCount(root.id);
        const canModify = this._canModify(root);
        let marker = this._markers.get(root.id);
        if (!marker) {
            const el = this._createPin(root, color, replies, canModify);
            // Owner/Editor+ may reposition the pin; MapLibre owns the drag + the positioning
            // transform on this root element (visuals live on the inner shape — see _createPin).
            marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: canModify })
                .setLngLat([root.lng, root.lat])
                .addTo(this._map);
            marker.on('dragstart', () => { this._draggingId = root.id; });
            marker.on('dragend', () => this._handleMarkerDragEnd(root.id, marker));
            this._markers.set(root.id, marker);
            return;
        }
        const el = marker.getElement();
        el.dataset.resolved = root.status === 'resolved' ? 'true' : 'false';
        el.classList.toggle('comment-pin--draggable', canModify);
        el.style.setProperty('--comment-color', color);
        const initials = el.querySelector('.comment-pin__initials');
        if (initials) initials.textContent = root.authorInitials || '?';
        this._updatePinCount(el, replies);
        if (marker.isDraggable() !== canModify) marker.setDraggable(canModify);
        marker.setLngLat([root.lng, root.lat]);
    }

    /** @private Number of replies to a root comment (excludes the root itself). */
    _replyCount(rootId) {
        let n = 0;
        for (const c of Object.values(this._comments)) {
            if (c && c.parentId === rootId) n++;
        }
        return n;
    }

    /** @private Builds the teardrop pin: an inner shape (author color + 2 initials) plus a
     * reply-count badge. The transform/hover-scale live on the inner shape, NOT the root —
     * MapLibre writes the positioning `transform: translate(...)` onto the root every frame, so a
     * transition/transform there would lag on pan and the hover scale would be overridden. */
    _createPin(root, color, replies, canModify) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'comment-pin';
        el.dataset.testid = 'comment-pin';
        el.dataset.commentId = root.id;
        el.dataset.resolved = root.status === 'resolved' ? 'true' : 'false';
        el.classList.toggle('comment-pin--draggable', canModify);
        el.style.setProperty('--comment-color', color);
        el.setAttribute('aria-label', 'Comentário');

        const shape = document.createElement('span');
        shape.className = 'comment-pin__shape';
        const initials = document.createElement('span');
        initials.className = 'comment-pin__initials';
        initials.textContent = root.authorInitials || '?';
        shape.appendChild(initials);
        el.appendChild(shape);

        const count = document.createElement('span');
        count.className = 'comment-pin__count';
        count.dataset.testid = 'comment-pin-count';
        count.innerHTML = REPLY_ICON; // static SVG
        const num = document.createElement('span');
        num.className = 'comment-pin__count-num';
        count.appendChild(num);
        el.appendChild(count);
        this._updatePinCount(el, replies);

        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // A finished drag emits a synthetic click — don't open the thread then (the flag is
            // cleared on the next tick by _handleMarkerDragEnd).
            if (this._draggingId === root.id) return;
            this._openThread(root.id);
        });
        return el;
    }

    /** @private Sets the pin's reply-count badge text + visibility (hidden when there are none). */
    _updatePinCount(el, replies) {
        const badge = el.querySelector('.comment-pin__count');
        const num = el.querySelector('.comment-pin__count-num');
        if (!badge || !num) return;
        num.textContent = replies > 0 ? String(replies) : '';
        badge.hidden = replies <= 0;
        if (replies > 0) {
            const label = `${replies} ${replies > 1 ? 'respostas' : 'resposta'}`;
            badge.title = label;
            badge.setAttribute('aria-label', label);
        } else {
            badge.removeAttribute('title');
            badge.removeAttribute('aria-label');
        }
    }

    /** @private Persists a moved comment pin (owner/Editor+ drag). Snaps back if the session lost
     * the right to modify it mid-drag; the COMMENT_UPDATED reload reconciles the final position. */
    async _handleMarkerDragEnd(rootId, marker) {
        // Clear the click-suppress flag after the synthetic post-drag click has fired.
        trackTimer(this, setTimeout(() => { if (this._draggingId === rootId) this._draggingId = null; }, 0));
        const root = this._comments[rootId];
        const ll = marker.getLngLat?.();
        if (!root || !ll) return;
        if (!this._canModify(root)) {
            marker.setLngLat([root.lng, root.lat]);
            return;
        }
        if (ll.lng === root.lng && ll.lat === root.lat) return;
        await updateComment({ ...root, lng: ll.lng, lat: ll.lat });
    }

    // ===== MAP CLICK (placement) =====

    /** @private A map click either places a new comment (placement mode) or — when a thread/compose
     * card is open — dismisses it. Pin clicks stopPropagation, so this never fires from a pin. Same
     * behaviour online and offline (the overlay is connection-agnostic). */
    _handleMapClick(e) {
        if (this._placement) {
            this._endPlacement();
            this._openCompose(e.lngLat);
            return;
        }
        if (this._popup) this._closeCard();
    }

    // ===== CARDS (compose + thread) =====

    /** @private Closes the open popup card. */
    _closeCard() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
    }

    /** @private Opens the compose card to create a new root comment at a coordinate. */
    _openCompose(lngLat) {
        this._closeCard();
        const card = document.createElement('div');
        card.className = 'comment-card comment-card--compose';
        card.dataset.testid = 'comment-compose';

        card.appendChild(this._buildComposer({
            placeholder: 'Escreva um comentário…',
            submitLabel: 'Comentar',
            testid: 'comment-compose',
            onCancel: () => this._closeCard(),
            onSubmit: async (text) => {
                this._closeCard();
                await addComment({ lng: lngLat.lng, lat: lngLat.lat, text, ...authorStamp() });
            },
        }));

        this._popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '320px', className: 'comment-popup', anchor: 'bottom', offset: 38 })
            .setLngLat([lngLat.lng, lngLat.lat])
            .setDOMContent(card)
            .addTo(this._map);
    }

    /**
     * @private Opens (or refreshes) the thread card for a root comment.
     * @param {string} rootId
     * @param {boolean} [keepOpen] - true when re-rendering an already-open card after a reload.
     */
    _openThread(rootId, keepOpen = false) {
        const root = this._comments[rootId];
        if (!root) return;
        if (!keepOpen) this._closeCard();
        else if (this._popup) this._popup.remove();

        const replies = Object.values(this._comments)
            .filter((c) => c && c.parentId === rootId)
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        const card = document.createElement('div');
        card.className = 'comment-card comment-card--thread';
        card.dataset.testid = 'comment-thread';
        card.dataset.resolved = root.status === 'resolved' ? 'true' : 'false';

        card.appendChild(this._buildThreadHeader(root));
        card.appendChild(this._buildEntry(root, true));
        if (replies.length) {
            const list = document.createElement('div');
            list.className = 'comment-card__replies';
            for (const r of replies) list.appendChild(this._buildEntry(r, false));
            card.appendChild(list);
        }
        // A resolved comment is read-only: no replies until it is reopened (matches "resolvido sai
        // do mapa" — the thread is only reachable from the Comentários panel).
        if (root.status === 'resolved') {
            const note = document.createElement('p');
            note.className = 'comment-card__note';
            note.dataset.testid = 'comment-resolved-note';
            note.textContent = this._canModify(root)
                ? 'Comentário resolvido. Reabra para responder.'
                : 'Comentário resolvido.';
            card.appendChild(note);
        } else if (this._canComment()) {
            card.appendChild(this._buildComposer({
                placeholder: 'Responder…',
                submitLabel: 'Responder',
                testid: 'comment-reply',
                compact: true,
                onSubmit: async (text) => {
                    await addReply(rootId, { text, ...authorStamp() });
                },
            }));
        }

        this._popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '340px', className: 'comment-popup', anchor: 'bottom', offset: 38 })
            .setLngLat([root.lng, root.lat])
            .setDOMContent(card)
            .addTo(this._map);
        this._popup._ebgeoRootId = rootId;
    }

    /** @private Thread header: title + actions (resolve/reopen, delete, close). */
    _buildThreadHeader(root) {
        const header = document.createElement('div');
        header.className = 'comment-card__header';

        const title = document.createElement('span');
        title.className = 'comment-card__title';
        title.textContent = root.status === 'resolved' ? 'Comentário resolvido' : 'Comentário';
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'comment-card__actions';

        // Resolve/Delete only for who may modify this comment (author, or Editor+); everyone else
        // gets a read-only thread (matches the server-side author gate).
        if (this._canModify(root)) {
            const resolveBtn = document.createElement('button');
            resolveBtn.type = 'button';
            resolveBtn.className = 'comment-card__action';
            resolveBtn.dataset.testid = 'comment-resolve';
            resolveBtn.textContent = root.status === 'resolved' ? 'Reabrir' : 'Resolver';
            resolveBtn.addEventListener('click', () => resolveComment(root.id, root.status !== 'resolved'));
            actions.appendChild(resolveBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'comment-card__action comment-card__action--danger';
            delBtn.dataset.testid = 'comment-delete';
            delBtn.textContent = 'Excluir';
            delBtn.addEventListener('click', async () => { this._closeCard(); await removeComment(root.id); });
            actions.appendChild(delBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'comment-card__close';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this._closeCard());
        actions.appendChild(closeBtn);

        header.appendChild(actions);
        return header;
    }

    /** @private One comment/reply row: avatar + name + time + text. */
    _buildEntry(entry, isRoot) {
        const row = document.createElement('div');
        row.className = isRoot ? 'comment-entry comment-entry--root' : 'comment-entry';

        const avatar = document.createElement('span');
        avatar.className = 'comment-entry__avatar';
        avatar.textContent = entry.authorInitials || '?';
        avatar.style.backgroundColor = entry.authorColor || getPresenceColor(String(entry.authorId || ''));
        row.appendChild(avatar);

        const body = document.createElement('div');
        body.className = 'comment-entry__body';

        const meta = document.createElement('div');
        meta.className = 'comment-entry__meta';
        const time = document.createElement('span');
        time.className = 'comment-entry__time';
        time.textContent = timeAgo(entry.createdAt);
        meta.appendChild(time);
        body.appendChild(meta);

        const text = document.createElement('p');
        text.className = 'comment-entry__text';
        text.textContent = entry.text || '';
        body.appendChild(text);

        row.appendChild(body);
        return row;
    }

    /**
     * @private Builds a composer (textarea + submit/cancel). XSS-safe (textarea value only).
     * @param {{ placeholder:string, submitLabel:string, testid:string, compact?:boolean,
     *           onSubmit:(text:string)=>any, onCancel?:()=>void }} opts
     */
    _buildComposer(opts) {
        const wrap = document.createElement('div');
        wrap.className = opts.compact ? 'comment-composer comment-composer--compact' : 'comment-composer';

        const textarea = document.createElement('textarea');
        textarea.className = 'comment-composer__input';
        textarea.placeholder = opts.placeholder;
        textarea.rows = opts.compact ? 1 : 2;
        textarea.dataset.testid = `${opts.testid}-input`;
        wrap.appendChild(textarea);

        const actions = document.createElement('div');
        actions.className = 'comment-composer__actions';

        if (opts.onCancel) {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'comment-composer__btn comment-composer__btn--ghost';
            cancel.textContent = 'Cancelar';
            cancel.addEventListener('click', () => opts.onCancel());
            actions.appendChild(cancel);
        }

        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'comment-composer__btn comment-composer__btn--primary';
        submit.dataset.testid = `${opts.testid}-submit`;
        submit.textContent = opts.submitLabel;
        submit.disabled = true;
        textarea.addEventListener('input', () => { submit.disabled = textarea.value.trim().length === 0; });
        submit.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) return;
            textarea.value = '';
            submit.disabled = true;
            await opts.onSubmit(text);
        });
        actions.appendChild(submit);

        wrap.appendChild(actions);
        return wrap;
    }
}

