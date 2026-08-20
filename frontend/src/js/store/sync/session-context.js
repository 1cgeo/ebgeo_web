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
 * GLOBAL role vocabulary (backend `users.role`).
 *
 * IT IS NOT A LADDER. None of the four contains another and comparing them by order
 * is forbidden — they are four different jobs, not four levels of one:
 *   user        — the ordinary account.
 *   producer    — MAINTAINS every resource produced by ONE organization (the
 *                 `producerOrgId` below): catalog rows and 360 projects of that OM,
 *                 and nothing outside it.
 *   credenciado — READS every private resource in the system and writes nothing.
 *   admin       — system administration.
 * Display names (pt-BR): Usuário / Produtor / Credenciado / Administrador.
 *
 * `UserRole` below is a HOMONYM WITHOUT KINSHIP: it is the PER-ATLAS vocabulary
 * (owner/manager/editor/commenter/viewer, plus an 'admin' that matches this one only
 * by accident of history). Both predicates of this axis compare against THIS enum,
 * so the two axes no longer share a single word of source.
 * @readonly @enum {string}
 */
export const GlobalRole = Object.freeze({
    USER: 'user',
    PRODUCER: 'producer',
    CREDENCIADO: 'credenciado',
    ADMIN: 'admin'
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
    // Deleting a MAP is separate from deleting a feature/layer: it is a management
    // action (it takes every child entity with it), so an Editor has canDelete but
    // not canDeleteMap. Keeping both on the same flag made the client offer a button
    // the server refused, and the refused op used to freeze the whole outbound queue.
    // Server side of this contract: sync.service.js operationDenialReason().
    DELETE_MAP: 'canDeleteMap',
    COMMENT: 'canComment',
    MANAGE_USERS: 'canManageUsers',
    LOCK_MAPS: 'canLockMaps'
});

/** Full-control permissions shared by Owner, Manager, Admin, and offline mode. */
const FULL_PERMISSIONS = Object.freeze({
    canEdit: true,
    canDelete: true,
    canDeleteMap: true,
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
        canDeleteMap: false,
        canComment: true,
        canManageUsers: false,
        canLockMaps: false
    }),
    [UserRole.COMMENTER]: Object.freeze({
        canEdit: false,
        canDelete: false,
        canDeleteMap: false,
        canComment: true,
        canManageUsers: false,
        canLockMaps: false
    }),
    [UserRole.VIEWER]: Object.freeze({
        canEdit: false,
        canDelete: false,
        canDeleteMap: false,
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

        /** @type {string|null} Global system role (a `GlobalRole` value), independent of per-atlas role. */
        this._globalRole = null;

        /**
         * @type {string|null} The organization this user PRODUCES for (backend
         * `users.producer_org_id`). Non-null only for `GlobalRole.PRODUCER` — the backend
         * CHECK is bidirectional, so badge-without-scope and scope-without-badge are both
         * impossible states there, and mirroring that here keeps a half-hydrated session from
         * degrading into "producer of everything".
         */
        this._producerOrgId = null;

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
     * Global system role (a `GlobalRole` value: 'user' | 'producer' | 'credenciado' | 'admin'),
     * independent of the per-atlas `role`. Null when offline or for an anonymous visitor.
     * @returns {string|null}
     */
    get globalRole() {
        return this._globalRole;
    }

    /**
     * The organization this user produces for, or null. Only a `producer` has one.
     * @returns {string|null}
     */
    get producerOrgId() {
        return this._producerOrgId;
    }

    /**
     * Whether the authenticated user is a GLOBAL system admin (backend `role === 'admin'`). Gates the
     * admin panel; distinct from per-atlas Gestor/owner permissions.
     * @returns {boolean}
     */
    isAdmin() {
        return this._globalRole === GlobalRole.ADMIN;
    }

    /**
     * Se este usuário MANTÉM os recursos de uma OM (papel global `producer`).
     *
     * O `producerOrgId` faz parte do predicado, e não é zelo: no banco o par é um
     * bicondicional (crachá sem escopo e escopo sem crachá são estados impossíveis),
     * e um cliente que aceitasse o crachá sozinho leria "produtor de tudo" — a
     * degradação exatamente ao contrário da que se quer.
     * @returns {boolean}
     */
    isProducer() {
        return this._globalRole === GlobalRole.PRODUCER && this._producerOrgId != null;
    }

    /**
     * Se este usuário mantém os recursos DESTA OM.
     *
     * É a única pergunta que a interface precisa fazer sobre o eixo de produção, e
     * nenhuma tela deve reimplementar a comparação: administrador mantém qualquer
     * uma, produtor mantém a dele, e o resto não mantém nenhuma. OM ausente (recurso
     * institucional, `owner_org_id` nulo) é de administrador e de mais ninguém.
     *
     * @param {string|null|undefined} orgId - A OM dona do recurso.
     * @returns {boolean}
     */
    canProduceFor(orgId) {
        if (this.isAdmin()) return true;
        if (orgId == null || orgId === '') return false;
        return this.isProducer() && String(orgId) === String(this._producerOrgId);
    }

    /**
     * Se este usuário enxerga TODO recurso privado do catálogo por PAPEL GLOBAL
     * (administrador ou credenciado).
     *
     * EIXO SEPARADO DE `isAdmin()`, e a separação é o ponto da fase inteira: o
     * credenciado LÊ todo dado privado e não administra o sistema. Ele não vira dono
     * de atlas e não marca recurso como privado. Juntar os dois numa função só é
     * exatamente a promoção silenciosa que o censo do backend existe para impedir.
     *
     * A ÚNICA COISA QUE ELE ADMINISTRA É GRUPO DE ACESSO, por decisão do dono tomada
     * em 2026-08-19: ele entra em `admin.html` e vê a aba Grupos e mais nada (esta
     * linha dizia, por extenso, que ele "não abre o painel do admin", e deixou de
     * valer). Quem monta esse recorte é `mountAdminPage`; as outras abas continuam
     * `requireAdmin` no servidor, então oferecê-las a ele seria um 403 na montagem.
     *
     * O PRODUTOR FICA DE FORA daqui de propósito: ele não lê o privado de todo
     * mundo, lê o da OM dele, e isso chega pelo payload aditivo de
     * `/resource-access/visible`, não por papel de leitura global.
     *
     * `UserRole` e `ROLE_PERMISSIONS` NÃO são tocados de propósito: aquele é o
     * vocabulário POR ATLAS (owner/admin/manager/editor/commenter/viewer) e este
     * eixo é global. São homônimos sem parentesco.
     *
     * Isto é só para a UI decidir o que MOSTRAR. Quem decide o que ENTREGAR é o
     * servidor, e ele resolve o papel no banco em vez de aceitar o do token.
     * @returns {boolean}
     */
    hasGlobalDataAccess() {
        return this._globalRole === GlobalRole.ADMIN || this._globalRole === GlobalRole.CREDENCIADO;
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
     * @param {{ userId: string, role: string, globalRole?: string, producerOrgId?: string|null,
     *   username?: string, permissions?: Object }} userInfo
     *   `globalRole` is the system role (a `GlobalRole` value) and `producerOrgId` its production
     *   scope; when omitted BOTH are PRESERVED, so per-atlas role re-sets (e.g. `connect`) do not
     *   wipe the global bits established at login. The scope follows the same rule as the role
     *   because it is half of the same fact: preserving one and clearing the other would leave the
     *   impossible state the backend CHECK forbids.
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
        if (userInfo.producerOrgId !== undefined) {
            this._producerOrgId = userInfo.producerOrgId ?? null;
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
        this._producerOrgId = null;
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
        this._producerOrgId = null;
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
            producerOrgId: this._producerOrgId,
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
        this._producerOrgId = null;
        this._username = null;
        this._isVisitor = false;
        this._permissions = { ...FULL_PERMISSIONS };
        this._listeners.clear();
    }
}

/**
 * Shapes a backend user record (`GET /users/me`, `POST /auth/login`) into the argument
 * `setSession` expects.
 *
 * THE FIVE HYDRATION SITES SHARE THIS ONE FUNCTION on purpose. The shape was copied
 * five times (map boot, atlas chooser, admin page, calibration page, sync engine) and had
 * already drifted between the copies; the production scope is the field where drift is
 * expensive, because a missing `producerOrgId` makes `isProducer()` silently false and the
 * screen simply disappears for a producer, with no error anywhere.
 *
 * `producer_org_id` may be absent (legacy token, older backend): it degrades to null,
 * which reads as "produces for nobody" — the closed direction.
 *
 * @param {Object} user - The backend user record.
 * @param {string} [fallbackUsername] - Used when the record carries no display name (the
 *   login form knows what was typed even if the response omits it).
 * @returns {{ userId: string, role: string, globalRole: string, producerOrgId: string|null,
 *   username: string }}
 */
export function sessionUserInfoFromMe(user, fallbackUsername) {
    return {
        userId: user.id,
        role: user.org_role || UserRole.VIEWER,
        globalRole: user.role || GlobalRole.USER,
        producerOrgId: user.producer_org_id ?? null,
        username: user.username || user.nome || fallbackUsername
    };
}

/** @type {SessionContext} */
export const sessionContext = new SessionContext();

export { SessionContext };
