// Path: js/store/sync/session-context.js

/**
 * @fileoverview Session context for user identity management.
 * Provides a unified abstraction for user identity that works in both
 * offline (anonymous) and online (authenticated) modes.
 *
 * Offline: mode='offline', userId=null, getUserId() returns clientId
 * Online: mode='online', userId from JWT, role and permissions from token
 *
 * @dependencies operation-factory.js (getClientId)
 */

import { getClientId } from './operation-factory.js';

/** @readonly @enum {string} */
export const SessionMode = Object.freeze({
    OFFLINE: 'offline',
    ONLINE: 'online'
});

/**
 * Frontend role vocabulary (mapped from the backend's per-atlas permission +
 * global role by `toFrontendRole`). Display names (pt-BR):
 *   admin → "Admin do sistema", owner/manager → "Gestor", editor → "Editor",
 *   commenter → "Comentarista", viewer → "Visualizador".
 * @readonly @enum {string}
 */
export const UserRole = Object.freeze({
    OWNER: 'owner',       // atlas owner (the supreme Gestor)
    ADMIN: 'admin',       // global system admin
    MANAGER: 'manager',   // promoted co-Gestor (atlas_shares 'manage')
    EDITOR: 'editor',
    COMMENTER: 'commenter', // may only act on spatial comments
    VIEWER: 'viewer'
});

/** @readonly @enum {string} */
export const PermissionAction = Object.freeze({
    EDIT: 'canEdit',
    DELETE: 'canDelete',
    COMMENT: 'canComment',
    MANAGE_USERS: 'canManageUsers',
    LOCK_MAPS: 'canLockMaps'
});

/** Full-control permissions shared by Owner, Manager, Admin, and offline mode. */
const FULL_PERMISSIONS = Object.freeze({
    canEdit: true,
    canDelete: true,
    canComment: true,
    canManageUsers: true,
    canLockMaps: true
});

/**
 * Default permissions for each role.
 * @type {Object.<string, Object>}
 */
const ROLE_PERMISSIONS = Object.freeze({
    [UserRole.OWNER]: FULL_PERMISSIONS,
    [UserRole.ADMIN]: FULL_PERMISSIONS,
    [UserRole.MANAGER]: FULL_PERMISSIONS,
    [UserRole.EDITOR]: Object.freeze({
        canEdit: true,
        canDelete: true,
        canComment: true,
        canManageUsers: false,
        canLockMaps: false
    }),
    [UserRole.COMMENTER]: Object.freeze({
        canEdit: false,
        canDelete: false,
        canComment: true,
        canManageUsers: false,
        canLockMaps: false
    }),
    [UserRole.VIEWER]: Object.freeze({
        canEdit: false,
        canDelete: false,
        canComment: false,
        canManageUsers: false,
        canLockMaps: false
    })
});

/**
 * Manages the current user session context.
 * In offline mode, acts as an anonymous user with full local control.
 * In online mode, holds authenticated user info and role-based permissions.
 */
class SessionContext {
    constructor() {
        /** @type {string} */
        this._mode = SessionMode.OFFLINE;

        /** @type {string|null} */
        this._userId = null;

        /** @type {string|null} */
        this._role = null;

        /** @type {string|null} Global system role ('user' | 'admin'), independent of per-atlas role. */
        this._globalRole = null;

        /** @type {Object} */
        this._permissions = { ...FULL_PERMISSIONS };

        /** @type {boolean} Whether this is an anonymous public "visitante" (read-only) session. */
        this._isVisitor = false;

        /** @type {Set<Function>} */
        this._listeners = new Set();
    }

    /**
     * Current session mode.
     * @returns {string} 'offline' or 'online'
     */
    get mode() {
        return this._mode;
    }

    /**
     * Authenticated user ID (null when offline).
     * @returns {string|null}
     */
    get userId() {
        return this._userId;
    }

    /**
     * Client ID for this browser instance (always available).
     * @returns {string}
     */
    get clientId() {
        return getClientId();
    }

    /**
     * Current user role (null when offline).
     * @returns {string|null}
     */
    get role() {
        return this._role;
    }

    /**
     * Global system role ('user' | 'admin'), independent of the per-atlas `role`. Null when offline
     * or for an anonymous visitor.
     * @returns {string|null}
     */
    get globalRole() {
        return this._globalRole;
    }

    /**
     * Whether the authenticated user is a GLOBAL system admin (backend `role === 'admin'`). Gates the
     * admin panel; distinct from per-atlas Gestor/owner permissions.
     * @returns {boolean}
     */
    isAdmin() {
        return this._globalRole === UserRole.ADMIN;
    }

    /**
     * Display name of the authenticated user (null when offline). Lets the account UI render
     * the avatar after a session is restored on reload, without the login modal.
     * @returns {string|null}
     */
    get username() {
        return this._username || null;
    }

    /**
     * Current permissions object.
     * @returns {Object}
     */
    get permissions() {
        return this._permissions;
    }

    /**
     * Returns the effective user identifier.
     * Online: returns userId. Offline: returns clientId as fallback.
     * @returns {string}
     */
    getUserId() {
        return this._userId || getClientId();
    }

    /**
     * Whether the user is authenticated.
     * @returns {boolean}
     */
    isAuthenticated() {
        return this._mode === SessionMode.ONLINE && this._userId !== null && !this._isVisitor;
    }

    /**
     * Whether this is an anonymous public "visitante" session (online, read-only, no account).
     * @returns {boolean}
     */
    isVisitor() {
        return this._isVisitor === true;
    }

    /**
     * Whether the session is in offline mode.
     * @returns {boolean}
     */
    isOffline() {
        return this._mode === SessionMode.OFFLINE;
    }

    /**
     * Checks if the current user can perform a given action.
     * Offline users always have full permissions.
     * @param {string} action - Permission action name (from PermissionAction)
     * @returns {boolean}
     */
    canPerformAction(action) {
        if (this._mode === SessionMode.OFFLINE) {
            return true;
        }
        return this._permissions[action] === true;
    }

    /**
     * Sets an authenticated session.
     * Transitions from offline to online mode.
     * @param {{ userId: string, role: string, globalRole?: string, username?: string, permissions?: Object }} userInfo
     *   `globalRole` is the system role ('user'|'admin'); when omitted it is PRESERVED, so per-atlas
     *   role re-sets (e.g. `connect`) do not wipe the admin bit established at login.
     */
    setSession(userInfo) {
        if (!userInfo || !userInfo.userId) {
            throw new Error('userId is required for setSession');
        }

        const role = userInfo.role || UserRole.VIEWER;
        const defaultPerms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[UserRole.VIEWER];

        this._mode = SessionMode.ONLINE;
        this._userId = userInfo.userId;
        this._role = role;
        if (userInfo.globalRole !== undefined) {
            this._globalRole = userInfo.globalRole;
        }
        this._username = userInfo.username || null;
        this._permissions = userInfo.permissions
            ? { ...defaultPerms, ...userInfo.permissions }
            : { ...defaultPerms };
        this._isVisitor = false;

        this._notifyListeners();
    }

    /**
     * Sets an anonymous public "visitante" session: ONLINE + read-only (VIEWER) with NO account
     * identity. Used by the public viewer-link flow so the permission guard blocks editing of the
     * connected remote atlas while `isAuthenticated()` stays false (no account menu shown).
     */
    setVisitorSession() {
        this._mode = SessionMode.ONLINE;
        this._userId = null;
        this._role = UserRole.VIEWER;
        this._globalRole = null;
        this._username = null;
        this._isVisitor = true;
        this._permissions = { ...ROLE_PERMISSIONS[UserRole.VIEWER] };
        this._notifyListeners();
    }

    /**
     * Clears the session, returning to offline mode.
     * Restores full local permissions.
     */
    clearSession() {
        this._mode = SessionMode.OFFLINE;
        this._userId = null;
        this._role = null;
        this._globalRole = null;
        this._username = null;
        this._isVisitor = false;
        this._permissions = { ...FULL_PERMISSIONS };

        this._notifyListeners();
    }

    /**
     * Updates ONLY the role (and its derived permissions), preserving identity. Used when a
     * connected atlas's ownership changes live (`atlas_owner_changed`) so the UI re-gates without
     * a reconnect — and without nulling userId/username the way setSession would.
     * @param {string} role - A UserRole value.
     */
    updateRole(role) {
        this._role = role;
        const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[UserRole.VIEWER];
        this._permissions = { ...perms };
        this._notifyListeners();
    }

    /**
     * Subscribes to session changes (login/logout).
     * @param {Function} callback - Called with { mode, userId, role, permissions }
     * @returns {Function} Unsubscribe function
     */
    onSessionChanged(callback) {
        if (typeof callback !== 'function') {
            throw new Error('callback must be a function');
        }
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * Returns a snapshot of the current session state.
     * @returns {{ mode: string, userId: string|null, clientId: string, role: string|null, permissions: Object }}
     */
    getSnapshot() {
        return {
            mode: this._mode,
            userId: this._userId,
            clientId: this.clientId,
            role: this._role,
            globalRole: this._globalRole,
            permissions: { ...this._permissions }
        };
    }

    /** @private */
    _notifyListeners() {
        const snapshot = this.getSnapshot();
        for (const listener of this._listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                console.warn('SessionContext listener error:', error);
            }
        }
    }

    /**
     * Resets to initial state (for testing).
     */
    _reset() {
        this._mode = SessionMode.OFFLINE;
        this._userId = null;
        this._role = null;
        this._globalRole = null;
        this._username = null;
        this._isVisitor = false;
        this._permissions = { ...FULL_PERMISSIONS };
        this._listeners.clear();
    }
}

/** @type {SessionContext} */
export const sessionContext = new SessionContext();

export { SessionContext };
