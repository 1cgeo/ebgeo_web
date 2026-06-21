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
 *   - EventTypes.PRESENCE_CHANGED         { users }   (membership / away changes)
 *   - EventTypes.PRESENCE_CURSORS_CHANGED { mapId }   (cursor moved)
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
 * @property {{ lng: number, lat: number, mapId: string|null }|null} cursor
 * @property {{ featureIds: string[], mapId: string|null }|null} selection
 * @property {boolean} away
 * @property {string|null} currentMap - Id of the map the user is currently viewing.
 * @property {*} temporal - Peer's temporal viewing state (cursor/playing/ctx), or null.
 * @property {{ briefingId: string, userName: (string|null) }|null} briefingEdit -
 *   The briefing this user is editing, or null when not editing.
 */

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
 * @param {*} pos
 * @param {string|null} mapId
 * @returns {{ lng: number, lat: number, mapId: string|null }|null}
 */
function normalizeCursor(pos, mapId) {
    if (pos && typeof pos === 'object' && typeof pos.lng === 'number' && typeof pos.lat === 'number') {
        return { lng: pos.lng, lat: pos.lat, mapId: mapId ?? null };
    }
    return null;
}

/**
 * Normalizes a raw featureIds list + mapId into the stored selection shape, or
 * null when there is nothing selected.
 * @param {*} featureIds
 * @param {string|null} mapId
 * @returns {{ featureIds: string[], mapId: string|null }|null}
 */
function normalizeSelection(featureIds, mapId) {
    const ids = Array.isArray(featureIds) ? featureIds.map(String) : [];
    return ids.length > 0 ? { featureIds: ids, mapId: mapId ?? null } : null;
}

/**
 * Normalizes a raw user descriptor into a complete PresenceUser, preserving
 * any awareness state already held under the same key.
 *
 * Awareness fields (currentMap/cursor/selection/temporal/away) are seeded from
 * the raw descriptor only when it actually carries them — this lets the join
 * snapshot ingest `{ mapId, cursorPosition, temporalState, selectedFeatures,
 * status }` while a plain `user_joined`/`setCursor` re-key preserves existing
 * awareness instead of wiping it.
 * @param {Object} raw
 * @param {PresenceUser} [existing]
 * @returns {PresenceUser}
 */
function normalizeUser(raw, existing) {
    const key = resolveKey(raw);
    // userName accepts the `userName` field and the snapshot's `nome` alias.
    const rawName = raw.userName !== undefined && raw.userName !== null
        ? raw.userName
        : (raw.nome !== undefined && raw.nome !== null ? raw.nome : null);

    // currentMap: prefer an explicit mapId on the descriptor (snapshot or
    // presence frame), else keep what we already knew.
    const currentMap = raw.mapId !== undefined && raw.mapId !== null
        ? String(raw.mapId)
        : (existing?.currentMap ?? null);

    // Snapshot awareness (only present on the join snapshot). When absent we keep
    // the existing awareness state untouched.
    const hasCursor = raw.cursorPosition !== undefined;
    const hasSelection = raw.selectedFeatures !== undefined;
    const hasTemporal = raw.temporalState !== undefined;
    const hasStatus = raw.status !== undefined;

    return {
        userId: raw.userId !== undefined && raw.userId !== null
            ? String(raw.userId)
            : (raw.id !== undefined && raw.id !== null ? String(raw.id) : (existing?.userId ?? null)),
        clientId: key,
        userName: rawName !== null ? String(rawName) : (existing?.userName ?? null),
        cursor: hasCursor ? normalizeCursor(raw.cursorPosition, raw.mapId ?? null) : (existing?.cursor ?? null),
        selection: hasSelection
            ? normalizeSelection(raw.selectedFeatures, raw.mapId ?? null)
            : (existing?.selection ?? null),
        away: hasStatus ? raw.status === 'away' : (existing?.away ?? false),
        currentMap,
        temporal: hasTemporal ? (raw.temporalState ?? null) : (existing?.temporal ?? null),
        briefingEdit: existing?.briefingEdit ?? null,
    };
}

/**
 * Pure, framework-agnostic store of online-user presence and awareness.
 */
export class PresenceStore {
    constructor() {
        /** @type {Map<string, PresenceUser>} */
        this._users = new Map();
    }

    /**
     * Replaces the full membership set (e.g. from the WS `connected` payload's
     * usersOnline array). Existing awareness state is discarded.
     * @param {Array<Object>} usersOnline
     */
    setInitial(usersOnline) {
        this._users.clear();
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
        const existing = this._users.get(key);
        this._users.set(key, normalizeUser(user, existing));
        this._emitUsers();
    }

    /**
     * Removes a user by clientId (or userId fallback).
     * @param {{ clientId?: string, userId?: string }} ref
     */
    userLeft(ref) {
        const key = resolveKey(ref);
        if (!key) {
            return;
        }
        if (this._users.delete(key)) {
            this._emitUsers();
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
     * Updates a user's live cursor position.
     * @param {{ userId?: string, clientId?: string, position?: { lng: number, lat: number }, mapId?: string }} msg
     */
    setCursor(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        user.cursor = normalizeCursor(msg.position, msg.mapId ?? null);
        // Active-map awareness piggybacks on cursor frames (the only outbound
        // carrier the backend has): every cursor's mapId updates currentMap.
        const mapChanged = this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        this._emitCursors(msg.mapId ?? null);
        // currentMap is read by the roster (PRESENCE_CHANGED), not the cursor
        // overlay, so emit a membership change too when it moved.
        if (mapChanged) {
            this._emitUsers();
        }
    }

    /**
     * Updates a user's feature selection.
     * @param {{ userId?: string, clientId?: string, featureIds?: string[], mapId?: string }} msg
     */
    setSelection(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        user.selection = normalizeSelection(msg.featureIds, msg.mapId ?? null);
        // Selection frames also carry the active map → keep currentMap fresh.
        this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        this._emitUsers();
    }

    /**
     * Updates a user's active-map indicator (case C). Normally piggybacked on
     * cursor/selection/temporal frames, but exposed as a mutation so the bridge
     * can route an explicit map-switch frame.
     * @param {{ userId?: string, clientId?: string, mapId?: string }} msg
     */
    setCurrentMap(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key) {
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
     * Updates a user's temporal viewing state (case E). The timeline is local
     * per user (cursor/playback), so this is pure awareness — the `state` blob is
     * stored opaquely and rendered by the roster.
     * @param {{ userId?: string, clientId?: string, state?: *, mapId?: string }} msg
     */
    setTemporal(msg) {
        if (!msg || typeof msg !== 'object') {
            return;
        }
        const key = resolveKey(msg);
        if (!key) {
            return;
        }
        const user = this._users.get(key) ?? normalizeUser(msg);
        user.temporal = msg.state ?? null;
        // Temporal frames carry the active map too.
        this._applyCurrentMap(user, msg.mapId);
        this._users.set(key, user);
        this._emitUsers();
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
        if (!key) {
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
        if (this._users.size === 0) {
            return;
        }
        this._users.clear();
        this._emitUsers();
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
     * Returns active cursors, optionally filtered to a single map.
     * @param {string} [mapId]
     * @returns {Array<{ clientId: string, userName: string|null, position: { lng: number, lat: number, mapId: string|null } }>}
     */
    getCursors(mapId) {
        const out = [];
        for (const user of this._users.values()) {
            if (!user.cursor) {
                continue;
            }
            if (mapId !== undefined && mapId !== null && user.cursor.mapId !== mapId) {
                continue;
            }
            out.push({
                clientId: user.clientId,
                userName: user.userName,
                position: { ...user.cursor },
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
    _emitCursors(mapId) {
        try {
            getEventBus().emit(EventTypes.PRESENCE_CURSORS_CHANGED, { mapId });
        } catch {
            // Event bus not initialized — degrade silently.
        }
    }
}

/** Shared singleton presence store. */
export const presenceStore = new PresenceStore();
