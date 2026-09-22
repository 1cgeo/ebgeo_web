// Path: js/presence/presence-store.js

/**
 * @fileoverview Pure presence/awareness state module (no DOM).
 *
 * Holds the set of users currently online in a shared atlas session plus
 * their ephemeral awareness state (live cursor position, feature selection,
 * away flag). Fed by the WS presence/cursor/selection messages routed by
 * ws-client.js; consumed by presence UI overlays.
 *
 * State is keyed by clientId (a single user may have several browser tabs /
 * clients). When a message carries no clientId we fall back to userId so the
 * store still degrades gracefully against legacy payloads.
 *
 * Changes are broadcast on the application event bus:
 *   - EventTypes.PRESENCE_CHANGED            { users }   (membership / away changes)
 *   - EventTypes.PRESENCE_CURSORS_CHANGED    { mapId }   (cursor moved)
 *   - EventTypes.PRESENCE_SELECTIONS_CHANGED { surface } (selection changed: 2d/3d/360)
 *
 * @dependencies @store/services.js (getEventBus), @events/event_types.js
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';

/**
 * @typedef {Object} PresenceUser
 * @property {string|null} userId
 * @property {string} clientId
 * @property {string|null} userName
 * @property {{ surface: string, mapId: string|null, tilesetId: string|null, photoName: string|null,
 *   lng?: number, lat?: number, alt?: number, heading?: number, pitch?: number }|null} cursor -
 *   Live pointer, on the surface the peer is pointing at: `{lng,lat}` on the 2D map,
 *   `{heading,pitch}` inside a panorama, `{lng,lat,alt}` inside the 3D scene.
 * @property {{ surface: string, featureIds: string[],
 *   featureMeta: (Array<{id: string, type: string|null}>|null), mapId: string|null,
 *   tilesetId: string|null, photoName: string|null }|null} selection
 * @property {boolean} away
 * @property {string|null} currentMap - Id of the map the user is currently viewing.
 * @property {{ briefingId: string, userName: (string|null) }|null} briefingEdit -
 *   The briefing this user is editing, or null when not editing.
 * @property {{ surface: '3d'|'360'|'fp', recurso: ({ tipo: (string|null), id: (string|null),
 *   nome: string, foto: (string|null) }|null) }|null} viewer - The immersive viewer the user has
 *   open (owner, 2026-09-22), or null when on the map. `recurso` is null when the resource is not
 *   one THIS client may read: the server decided that per recipient, so the roster says "no
 *   visualizador 3D" without a name, and never learns which model it was.
 */

/**
 * How long a DEPARTED key refuses awareness frames, in milliseconds.
 *
 * THE GHOST THIS CLOSES (owner, 2026-09-22: "ainda diz que tem usuário presente mesmo que depois
 * de sair"). The server announces `user_left` at once and ships cursors in a per-room batch on the
 * next tick, so a frame queued before the peer closed its tab could arrive AFTER the departure.
 * `setCursor` creates the entry when the key is unknown, and the peer came back to the roster with
 * no name, for good: nothing would ever announce the departure again. The server now drops the
 * pending frame (`descartarCursorPendente`, backend/src/modules/collab/collab.rooms.js); this is
 * the client half, which also covers a server that predates that fix. A key leaves the tombstone
 * set on `user_joined`, on `setInitial` and on `clear`, so a peer that reloads comes back normally.
 */
const DEPARTED_TTL_MS = 30000;

/**
 * Normalizes the `viewer` value of a frame or snapshot entry. `2d` and anything malformed are
 * null (the person is on the map). A resource without a string name is dropped to null rather
 * than rendered half: the name is the only thing the roster shows of it.
 * @param {*} raw
 * @returns {PresenceUser['viewer']}
 */
function normalizeViewer(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const surface = typeof raw.surface === 'string' ? raw.surface : null;
    if (surface !== '3d' && surface !== '360' && surface !== 'fp') {
        return null;
    }
    const r = raw.recurso;
    const recurso = r && typeof r === 'object' && typeof r.nome === 'string' && r.nome !== ''
        ? {
            tipo: r.tipo !== undefined && r.tipo !== null ? String(r.tipo) : null,
            id: r.id !== undefined && r.id !== null ? String(r.id) : null,
            nome: r.nome,
            foto: r.foto !== undefined && r.foto !== null && r.foto !== '' ? String(r.foto) : null,
        }
        : null;
    return { surface, recurso };
}

/**
 * Whether two normalized viewer values say the same thing.
 * @param {PresenceUser['viewer']} a
 * @param {PresenceUser['viewer']} b
 * @returns {boolean}
 */
function sameViewer(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.surface === b.surface
        && (a.recurso?.id ?? null) === (b.recurso?.id ?? null)
        && (a.recurso?.nome ?? null) === (b.recurso?.nome ?? null)
        && (a.recurso?.foto ?? null) === (b.recurso?.foto ?? null);
}

/**
 * Resolves the Map key for a presence entry, preferring clientId and falling
 * back to userId (or the snapshot's `id`). Returns null when none is usable.
 * @param {{ clientId?: *, userId?: *, id?: * }} [source]
 * @returns {string|null}
 */
function resolveKey(source) {
    if (!source || typeof source !== 'object') {
        return null;
    }
    const { clientId, userId, id } = source;
    if (clientId !== undefined && clientId !== null && clientId !== '') {
        return String(clientId);
    }
    if (userId !== undefined && userId !== null && userId !== '') {
        return String(userId);
    }
    // Join-snapshot items key on `id` (the backend's user id) when no clientId.
    if (id !== undefined && id !== null && id !== '') {
        return String(id);
    }
    return null;
}

/**
 * Normalizes a raw cursor/position payload into the stored cursor shape, or null
 * when malformed. Accepts the live `position` field and the snapshot's
 * `cursorPosition` alias.
 *
 * A POSICAO DEPENDE DA SUPERFICIE, e a validacao segue junto: o par no 360 aponta um lugar na
 * ESFERA (`heading`/`pitch`), nao um pixel e nao um ponto no mapa, porque cada um olha o panorama
 * de um yaw/pitch/FOV proprio. Aceitar a forma de outra superficie desenharia o colega num lugar
 * que nao e onde ele esta, entao o par errado devolve null, como sempre devolveu para o cursor 2D
 * sem `lng`/`lat`.
 * @param {*} pos
 * @param {string|null} mapId
 * @param {{ surface?: string, tilesetId?: *, photoName?: * }} [extra] - Live frame or the
 *   snapshot's `cursorContext`.
 * @returns {{ surface: string, mapId: string|null, tilesetId: string|null,
 *   photoName: string|null }|null}
 */
function normalizeCursor(pos, mapId, extra) {
    if (!pos || typeof pos !== 'object') {
        return null;
    }
    const src = extra && typeof extra === 'object' ? extra : {};
    const surface = src.surface ? String(src.surface) : '2d';
    const scope = {
        surface,
        mapId: mapId ?? null,
        tilesetId: src.tilesetId !== undefined && src.tilesetId !== null ? String(src.tilesetId) : null,
        photoName: src.photoName !== undefined && src.photoName !== null ? String(src.photoName) : null,
    };

    if (surface === 'fp') {
        if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return null;
        return { ...scope, x: pos.x, y: pos.y, z: pos.z };
    }
    if (surface === '360') {
        if (typeof pos.heading !== 'number' || typeof pos.pitch !== 'number') {
            return null;
        }
        return { ...scope, heading: pos.heading, pitch: pos.pitch };
    }
    if (surface === '3d') {
        if (typeof pos.lng !== 'number' || typeof pos.lat !== 'number' || typeof pos.alt !== 'number') {
            return null;
        }
        return { ...scope, lng: pos.lng, lat: pos.lat, alt: pos.alt };
    }
    if (typeof pos.lng !== 'number' || typeof pos.lat !== 'number') {
        return null;
    }
    return { ...scope, lng: pos.lng, lat: pos.lat };
}

/**
 * Normalizes a raw featureIds list + mapId (+ optional surface/scope context) into
 * the stored selection shape, or null when there is nothing selected. The `extra`
 * source (the live frame or the snapshot's selectionContext) carries the surface
 * ('2d'|'3d'|'360'), per-feature `featureMeta` (id+type, used by the 2D overlay),
 * and the 3D/360 scope keys (tilesetId/photoName).
 * @param {*} featureIds
 * @param {string|null} mapId
 * @param {{ surface?: string, featureMeta?: Array, tilesetId?: *, photoName?: * }} [extra]
 * @returns {{ surface: string, featureIds: string[], featureMeta: (Array|null),
 *   mapId: string|null, tilesetId: string|null, photoName: string|null }|null}
 */
function normalizeSelection(featureIds, mapId, extra) {
    const ids = Array.isArray(featureIds) ? featureIds.map(String) : [];
    if (ids.length === 0) {
        return null;
    }
    const src = extra && typeof extra === 'object' ? extra : {};
    const featureMeta = Array.isArray(src.featureMeta)
        ? src.featureMeta
            .filter((m) => m && m.id !== undefined && m.id !== null)
            .map((m) => ({
                id: String(m.id),
                type: m.type !== undefined && m.type !== null ? String(m.type) : null,
            }))
        : null;
    return {
        surface: src.surface ? String(src.surface) : '2d',
        featureIds: ids,
        featureMeta,
        mapId: mapId ?? null,
        tilesetId: src.tilesetId !== undefined && src.tilesetId !== null ? String(src.tilesetId) : null,
        photoName: src.photoName !== undefined && src.photoName !== null ? String(src.photoName) : null,
    };
}

/**
 * Normalizes a raw user descriptor into a complete PresenceUser, preserving
 * any awareness state already held under the same key.
 *
 * Awareness fields (currentMap/cursor/selection/away) are seeded from
 * the raw descriptor only when it actually carries them — this lets the join
 * snapshot ingest `{ mapId, cursorPosition, selectedFeatures, status }` while a
 * plain `user_joined`/`setCursor` re-key preserves existing awareness instead of
 * wiping it.
 *
 * O INSTANTE DA LINHA DO TEMPO NÃO ESTÁ NESTA LISTA, e a ausência é decisão do dono
 * (2026-09-21): o retrato de entrada já trouxe o instante de cada par, e o roster guardava um
 * campo por pessoa para desenhá-lo. Os dois saíram junto com o quadro de presença que os
 * alimentava, nos dois pacotes.
 * @param {Object} raw
 * @param {PresenceUser} [existing]
 * @returns {PresenceUser}
 */
function normalizeUser(raw, existing) {
    const key = resolveKey(raw);
    // userName accepts the `userName` field and the snapshot's `nome` alias.
    const rawName = raw.nome_guerra?.trim() || (raw.userName !== undefined && raw.userName !== null
        ? raw.userName
        : (raw.nome !== undefined && raw.nome !== null ? raw.nome : null));

    // currentMap: prefer an explicit mapId on the descriptor (snapshot or
    // presence frame), else keep what we already knew.
    const currentMap = raw.mapId !== undefined && raw.mapId !== null
        ? String(raw.mapId)
        : (existing?.currentMap ?? null);

    // Snapshot awareness (only present on the join snapshot). When absent we keep
    // the existing awareness state untouched.
    const hasCursor = raw.cursorPosition !== undefined;
    const hasSelection = raw.selectedFeatures !== undefined || raw.selectionContext !== undefined;
    const hasStatus = raw.status !== undefined;

    return {
        userId: raw.userId !== undefined && raw.userId !== null
            ? String(raw.userId)
            : (raw.id !== undefined && raw.id !== null ? String(raw.id) : (existing?.userId ?? null)),
        clientId: key,
        userName: rawName !== null ? String(rawName) : (existing?.userName ?? null),
        rank: raw.posto_graduacao !== undefined ? (raw.posto_graduacao || null) : (existing?.rank ?? null),
        cursor: hasCursor
            ? normalizeCursor(
                raw.cursorPosition,
                raw.cursorContext?.mapId ?? raw.mapId ?? null,
                raw.cursorContext,
            )
            : (existing?.cursor ?? null),
        selection: hasSelection
            ? normalizeSelection(
                raw.selectionContext?.featureIds ?? raw.selectedFeatures,
                raw.selectionContext?.mapId ?? raw.mapId ?? null,
                raw.selectionContext,
            )
            : (existing?.selection ?? null),
        away: hasStatus ? raw.status === 'away' : (existing?.away ?? false),
        currentMap,
        briefingEdit: existing?.briefingEdit ?? null,
        // Only the join snapshot and the `viewer_context` frame carry it; a plain re-join keeps what we knew.
        viewer: raw.viewer !== undefined ? normalizeViewer(raw.viewer) : (existing?.viewer ?? null),
    };
}

/**
 * Pure, framework-agnostic store of online-user presence and awareness.
 */
export class PresenceStore {
    constructor() {
        /** @type {Map<string, PresenceUser>} */
        this._users = new Map();
        /** @type {Map<string, number>} Keys that left recently -> until when they stay refused. */
        this._departed = new Map();
    }

    /**
     * @private Whether an awareness frame for this key is a LATE frame of someone who already left.
     * Only an UNKNOWN key can be one: a known key is by definition still in the room.
     * @param {string} key
     * @returns {boolean}
     */
    _isLateForDeparted(key) {
        if (this._users.has(key)) {
            return false;
        }
        const until = this._departed.get(key);
        if (until === undefined) {
            return false;
        }
        if (until <= Date.now()) {
            this._departed.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Replaces the full membership set (e.g. from the WS `connected` payload's
     * usersOnline array). Existing awareness state is discarded.
     * @param {Array<Object>} usersOnline
     */
    setInitial(usersOnline) {
        const cursorSurfaces = this._surfacesOf('cursor');
        const selectionSurfaces = this._surfacesOf('selection');
        this._users.clear();
        // The server's roster is the truth now, departures included.
        this._departed.clear();
        if (Array.isArray(usersOnline)) {
            for (const raw of usersOnline) {
                const key = resolveKey(raw);
                if (!key) {
                    continue;
                }
                this._users.set(key, normalizeUser(raw));
            }
        }
        this._emitUsers();
        // The 3D and 360 scenes redraw their peers only on the cursor/selection events, never on
        // PRESENCE_CHANGED: a roster replaced without these would leave the previous peers drawn.
        this._emitSurfaces(cursorSurfaces, this._surfacesOf('cursor'), (s) => this._emitCursors(null, s));
        this._emitSurfaces(selectionSurfaces, this._surfacesOf('selection'), (s) => this._emitSelections(s));
    }

    /**
     * Adds (or refreshes) a user. Idempotent: re-joining an existing key merges
     * the descriptor and keeps awareness state.
     * @param {Object} user
     */
    userJoined(user) {
        const key = resolveKey(user);
        if (!key) {
            return;
        }
        // A key that comes back (a reload, a reconnect) is not a ghost anymore.
        this._departed.delete(key);
        const existing = this._users.get(key);
        this._users.set(key, normalizeUser(user, existing));
        this._emitUsers();
    }

    /**
     * Removes a user by clientId (or userId fallback).
     *
     * The key is TOMBSTONED for {@link DEPARTED_TTL_MS}, so a late awareness frame of the same
     * client does not recreate it (see the constant). And the scenes that draw the peer's cursor
     * or selection are told too: the 3D and 360 overlays listen only to their own events, so a
     * departure announced on PRESENCE_CHANGED alone left the colleague's pointer hanging inside
     * the model or the panorama until somebody else moved.
     * @param {{ clientId?: string, userId?: string }} ref
     */
    userLeft(ref) {
        const key = resolveKey(ref);
        if (!key) {
            return;
        }
        const user = this._users.get(key);
        this._departed.set(key, Date.now() + DEPARTED_TTL_MS);
        if (!user) {
            return;
        }
        this._users.delete(key);
        this._emitUsers();
        if (user.cursor) {
            this._emitCursors(user.cursor.mapId ?? null, user.cursor.surface ?? '2d');
        }
        if (user.selection) {
            this._emitSelections(user.selection.surface ?? '2d');
        }
    }

    /**
     * Marks a user as away.
     * @param {{ clientId?: string, userId?: string }} ref
     */
    userAway(ref) {
        this._setAway(ref, true);
    }

    /**
     * Marks a user as back (no longer away).
     * @param {{ clientId?: string, userId?: string }} ref
     */
    userBack(ref) {
        this._setAway(ref, false);
    }

    /**
     * Updates a user's live cursor position, on the surface the frame declares.
     * @param {{ userId?: string, clientId?: string, position?: Object, mapId?: string,
     *   surface?: '2d'|'3d'|'360', tilesetId?: string, photoName?: string }} msg
     */
    setCursor(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key || this._isLateForDeparted(key)) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        user.cursor = normalizeCursor(msg.position, msg.mapId ?? null, msg);
        // Active-map awareness piggybacks on cursor frames (the only outbound
        // carrier the backend has): every cursor's mapId updates currentMap.
        const mapChanged = this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        // A superficie do quadro, capturada mesmo quando a posicao veio nula (troca de mapa, saida
        // do ponteiro): a cena que acabou de perder o cursor do par tambem precisa repintar.
        this._emitCursors(msg.mapId ?? null, msg.surface ? String(msg.surface) : (user.cursor?.surface ?? '2d'));
        // currentMap is read by the roster (PRESENCE_CHANGED), not the cursor
        // overlay, so emit a membership change too when it moved.
        if (mapChanged) {
            this._emitUsers();
        }
    }

    /**
     * Updates a user's feature/marker selection (2D map, 3D or 360 surface).
     * @param {{ userId?: string, clientId?: string, featureIds?: string[],
     *   mapId?: string, surface?: string, featureMeta?: Array, tilesetId?: string,
     *   photoName?: string }} msg
     */
    setSelection(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key || this._isLateForDeparted(key)) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        // The surface this frame is about — captured up front so a deselect (empty
        // featureIds → null selection) still notifies the surface that just cleared,
        // letting its overlay drop the peer's highlight.
        const surface = msg.surface
            ? String(msg.surface)
            : (user.selection?.surface ?? '2d');
        user.selection = normalizeSelection(msg.featureIds, msg.mapId ?? null, msg);
        // Selection frames also carry the active map → keep currentMap fresh.
        this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        // The roster (PRESENCE_CHANGED) shows the selection count; the on-surface
        // overlay listens to the lighter PRESENCE_SELECTIONS_CHANGED.
        this._emitUsers();
        this._emitSelections(surface);
    }

    /**
     * Updates a user's active-map indicator (case C). Normally piggybacked on
     * cursor/selection frames, but exposed as a mutation so the bridge
     * can route an explicit map-switch frame.
     * @param {{ userId?: string, clientId?: string, mapId?: string }} msg
     */
    setCurrentMap(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key || this._isLateForDeparted(key)) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        const changed = this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        if (changed) {
            this._emitUsers();
        }
    }

    /**
     * Updates a user's briefing-edit indicator (case D). Fed by the inbound
     * `briefing_edit_started`/`briefing_edit_ended` frames.
     * @param {{ userId?: string, clientId?: string, briefingId?: string,
     *   userName?: string, editing?: boolean }} msg
     */
    setBriefingEdit(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key || this._isLateForDeparted(key)) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        if (msg.editing && msg.briefingId !== undefined && msg.briefingId !== null) {
            user.briefingEdit = {
                briefingId: String(msg.briefingId),
                userName: msg.userName !== undefined && msg.userName !== null ? String(msg.userName) : null,
            };
        } else {
            user.briefingEdit = null;
        }
        this._users.set(key, user);
        this._emitUsers();
    }

    /**
     * Updates the immersive viewer a user has open (owner, 2026-09-22), from the `viewer_context` frame.
     *
     * The name inside it was resolved by the SERVER, for THIS recipient: a private resource this
     * client may not read arrives as `recurso: null`, and the roster says only which kind of viewer
     * it is. Nothing here second-guesses that, and nothing here looks the name up locally.
     * @param {{ userId?: string, clientId?: string, viewer?: Object|null }} msg
     */
    setViewer(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key || this._isLateForDeparted(key)) {
            return;
        }
        const known = this._users.get(key);
        const user = known ?? normalizeUser(msg);
        const next = normalizeViewer(msg.viewer);
        // A transient entry is a membership change by itself, whatever the viewer says.
        const changed = !known || !sameViewer(user.viewer ?? null, next);
        user.viewer = next;
        this._users.set(key, user);
        if (changed) {
            this._emitUsers();
        }
    }

    /**
     * @private Applies a new active-map id to a user entry.
     * @param {PresenceUser} user
     * @param {*} mapId
     * @returns {boolean} Whether currentMap actually changed.
     */
    _applyCurrentMap(user, mapId) {
        if (mapId === undefined || mapId === null) {
            return false;
        }
        const next = String(mapId);
        if (user.currentMap === next) {
            return false;
        }
        user.currentMap = next;
        return true;
    }

    /**
     * Clears all presence state (e.g. on disconnect).
     */
    clear() {
        // A new context (another atlas, a logout, our own socket down): the old departures mean
        // nothing in it.
        this._departed.clear();
        if (this._users.size === 0) {
            return;
        }
        const cursorSurfaces = this._surfacesOf('cursor');
        const selectionSurfaces = this._surfacesOf('selection');
        this._users.clear();
        this._emitUsers();
        // Same reason as in setInitial: the 3D and 360 scenes do not listen to PRESENCE_CHANGED.
        this._emitSurfaces(cursorSurfaces, new Set(), (surface) => this._emitCursors(null, surface));
        this._emitSurfaces(selectionSurfaces, new Set(), (surface) => this._emitSelections(surface));
    }

    /**
     * @private The surfaces on which some user currently has a cursor (or a selection).
     * @param {'cursor'|'selection'} kind
     * @returns {Set<string>}
     */
    _surfacesOf(kind) {
        const out = new Set();
        for (const user of this._users.values()) {
            const value = user[kind];
            if (value) out.add(value.surface ?? '2d');
        }
        return out;
    }

    /**
     * @private Emits once per surface in the union of two sets.
     * @param {Set<string>} before
     * @param {Set<string>} after
     * @param {(surface: string) => void} emit
     */
    _emitSurfaces(before, after, emit) {
        for (const surface of new Set([...before, ...after])) emit(surface);
    }

    /**
     * Returns all known users as a fresh array.
     * @returns {PresenceUser[]}
     */
    getUsers() {
        return Array.from(this._users.values()).map((u) => ({ ...u }));
    }

    /**
     * Returns all users except the one identified by `selfClientId`
     * (matched against clientId or userId).
     * @param {string} selfClientId
     * @returns {PresenceUser[]}
     */
    getOthers(selfClientId) {
        const self = selfClientId !== undefined && selfClientId !== null ? String(selfClientId) : null;
        const out = [];
        for (const user of this._users.values()) {
            if (self !== null && (user.clientId === self || user.userId === self)) {
                continue;
            }
            out.push({ ...user });
        }
        return out;
    }

    /**
     * Returns active cursors for a surface, scoped to that surface's key: mapId for '2d',
     * tilesetId for '3d', photoName for '360'. Mirrors `getSelections` on purpose: same two
     * arguments, same fail-closed filter, so the three surfaces read presence the same way.
     *
     * Self is NOT excluded here — the overlay filters self by clientId/userId, as it does for
     * selections.
     * @param {'2d'|'3d'|'360'} [surface]
     * @param {string} [scopeKey]
     * @returns {Array<{ clientId: string, userId: string|null, userName: string|null,
     *   surface: string, position: Object }>}
     */
    getCursors(surface, scopeKey) {
        const out = [];
        for (const user of this._users.values()) {
            const cursor = user.cursor;
            if (!cursor) {
                continue;
            }
            if (surface !== undefined && surface !== null && cursor.surface !== surface) {
                continue;
            }
            if (scopeKey !== undefined && scopeKey !== null) {
                const key = (cursor.surface === '3d' || cursor.surface === 'fp')
                    ? cursor.tilesetId
                    : (cursor.surface === '360' ? cursor.photoName : cursor.mapId);
                if (key !== scopeKey) {
                    continue;
                }
            }
            out.push({
                clientId: user.clientId,
                userId: user.userId,
                userName: [user.rank, user.userName].filter(Boolean).join(' ') || null,
                surface: cursor.surface,
                position: { ...cursor },
            });
        }
        return out;
    }

    /**
     * Returns active selections for a surface, scoped to that surface's key: mapId
     * for '2d', tilesetId for '3d', photoName for '360'. Empty selections are
     * skipped. Self is NOT excluded here — the overlay filters self by clientId/userId.
     * @param {'2d'|'3d'|'360'} [surface]
     * @param {string} [scopeKey]
     * @returns {Array<{ clientId: string, userId: string|null, userName: string|null,
     *   surface: string, featureIds: string[],
     *   featureMeta: (Array<{id: string, type: string|null}>|null),
     *   mapId: string|null, tilesetId: string|null, photoName: string|null }>}
     */
    getSelections(surface, scopeKey) {
        const out = [];
        for (const user of this._users.values()) {
            const sel = user.selection;
            if (!sel || !Array.isArray(sel.featureIds) || sel.featureIds.length === 0) {
                continue;
            }
            if (surface !== undefined && surface !== null && sel.surface !== surface) {
                continue;
            }
            if (scopeKey !== undefined && scopeKey !== null) {
                const key = sel.surface === '3d'
                    ? sel.tilesetId
                    : (sel.surface === '360' ? sel.photoName : sel.mapId);
                if (key !== scopeKey) {
                    continue;
                }
            }
            out.push({
                clientId: user.clientId,
                userId: user.userId,
                userName: user.userName,
                surface: sel.surface,
                featureIds: [...sel.featureIds],
                featureMeta: sel.featureMeta ? sel.featureMeta.map((m) => ({ ...m })) : null,
                mapId: sel.mapId,
                tilesetId: sel.tilesetId,
                photoName: sel.photoName,
            });
        }
        return out;
    }

    /**
     * Number of users currently tracked.
     * @returns {number}
     */
    count() {
        return this._users.size;
    }

    /**
     * @private
     * @param {{ clientId?: string, userId?: string }} ref
     * @param {boolean} away
     */
    _setAway(ref, away) {
        const key = resolveKey(ref);
        if (!key) {
            return;
        }
        const user = this._users.get(key);
        if (!user || user.away === away) {
            return;
        }
        user.away = away;
        this._emitUsers();
    }

    /** @private */
    _emitUsers() {
        try {
            getEventBus().emit(EventTypes.PRESENCE_CHANGED, { users: this.getUsers() });
        } catch {
            // Event bus not initialized (e.g. before initServices()) — degrade silently.
        }
    }

    /**
     * @private
     * @param {string|null} mapId
     */
    _emitCursors(mapId, surface) {
        try {
            // A superficie viaja junto desde 2026-09-16: o overlay do mapa filtra por `mapId`, mas
            // a cena 3D e o panorama precisam saber que o quadro e DELES antes de repintar, e um
            // cursor movendo-se no panorama nao deve custar um quadro ao 3D do vizinho.
            getEventBus().emit(EventTypes.PRESENCE_CURSORS_CHANGED, { mapId, surface: surface ?? '2d' });
        } catch {
            // Event bus not initialized — degrade silently.
        }
    }

    /**
     * @private
     * @param {string|null} surface
     */
    _emitSelections(surface) {
        try {
            getEventBus().emit(EventTypes.PRESENCE_SELECTIONS_CHANGED, { surface: surface ?? null });
        } catch {
            // Event bus not initialized — degrade silently.
        }
    }
}

/** Shared singleton presence store. */
export const presenceStore = new PresenceStore();
