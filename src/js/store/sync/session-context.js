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

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Session modes.
 * @readonly
 * @enum {string}
 */
export const SessionMode = Object.freeze({
    OFFLINE: 'offline',
    ONLINE: 'online'
});

/**
 * User roles for permission checking.
 * @readonly
 * @enum {string}
 */
export const UserRole = Object.freeze({
    OWNER: 'owner',
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer'
});

/**
 * Permission action names used by PermissionGuard.
 * @readonly
 * @enum {string}
 */
export const PermissionAction = Object.freeze({
    EDIT: 'canEdit',
    DELETE: 'canDelete',
    MANAGE_USERS: 'canManageUsers',
    LOCK_MAPS: 'canLockMaps'
});

/**
 * Default permissions for each role.
 * @type {Object.<string, Object>}
 */
const ROLE_PERMISSIONS = Object.freeze({
    [UserRole.OWNER]: Object.freeze({
        canEdit: true,
        canDelete: true,
        canManageUsers: true,
        canLockMaps: true
    }),
    [UserRole.ADMIN]: Object.freeze({
        canEdit: true,
        canDelete: true,
        canManageUsers: true,
        canLockMaps: true
    }),
    [UserRole.EDITOR]: Object.freeze({
        canEdit: true,
        canDelete: true,
        canManageUsers: false,
        canLockMaps: false
    }),
    [UserRole.VIEWER]: Object.freeze({
        canEdit: false,
        canDelete: false,
        canManageUsers: false,
        canLockMaps: false
    })
});

/**
 * Offline permissions — full control.
 * @type {Object}
 */
const OFFLINE_PERMISSIONS = Object.freeze({
    canEdit: true,
    canDelete: true,
    canManageUsers: true,
    canLockMaps: true
});

// ============================================================================
// SESSION CONTEXT CLASS
// ============================================================================

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

        /** @type {Object} */
        this._permissions = { ...OFFLINE_PERMISSIONS };

        /** @type {Set<Function>} */
        this._listeners = new Set();
    }

    // ===== GETTERS =====

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
     * Current permissions object.
     * @returns {Object}
     */
    get permissions() {
        return this._permissions;
    }

    // ===== IDENTITY =====

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
        return this._mode === SessionMode.ONLINE && this._userId !== null;
    }

    /**
     * Whether the session is in offline mode.
     * @returns {boolean}
     */
    isOffline() {
        return this._mode === SessionMode.OFFLINE;
    }

    // ===== PERMISSIONS =====

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

    // ===== SESSION MANAGEMENT =====

    /**
     * Sets an authenticated session.
     * Transitions from offline to online mode.
     * @param {{ userId: string, role: string, permissions?: Object }} userInfo
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
        this._permissions = userInfo.permissions
            ? { ...defaultPerms, ...userInfo.permissions }
            : { ...defaultPerms };

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
        this._permissions = { ...OFFLINE_PERMISSIONS };

        this._notifyListeners();
    }

    // ===== OBSERVER PATTERN =====

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
            permissions: { ...this._permissions }
        };
    }

    // ===== INTERNAL =====

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
        this._permissions = { ...OFFLINE_PERMISSIONS };
        this._listeners.clear();
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

/**
 * Singleton SessionContext instance.
 * @type {SessionContext}
 */
export const sessionContext = new SessionContext();

// Export class for testing
export { SessionContext };
