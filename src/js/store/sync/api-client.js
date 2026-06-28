// Path: js/store/sync/api-client.js

/**
 * @fileoverview HTTP transport for the EBGeo backend (REST half of the sync layer).
 *
 * Talks to the `ebgeo_backend` API (`/api/v1`): auth (login/refresh/register/logout),
 * runtime config (`GET /api/config`), atlas CRUD, and the sync push/pull + snapshot
 * endpoints. The WebSocket half lives in `ws-client.js` and reuses this client's
 * access token + the `wsUrl()` helper.
 *
 * Contract notes (frozen):
 * - Standard responses are wrapped in `{ data: ... }`; `_request()` unwraps it.
 * - Frozen bare contracts (config object, `GET /nomes/busca` array) have NO `data`
 *   key and are returned as-is.
 * - Errors use the global envelope `{ error: { code, message } }` → `ApiError`.
 *
 * The `fetch` implementation and `baseUrl` are injectable for tests; in the browser
 * they default to the global `fetch` and a same-origin `/api/v1` base.
 */

const DEFAULT_BASE_URL = '/api/v1';

/**
 * Error thrown for a non-2xx backend response, carrying the backend error code.
 */
export class ApiError extends Error {
    /**
     * @param {string} message - Human-readable message (from the backend envelope).
     * @param {Object} [opts]
     * @param {number} [opts.status] - HTTP status code.
     * @param {string} [opts.code] - Backend error code (e.g. 'UNAUTHORIZED').
     */
    constructor(message, { status, code } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

/** localStorage key holding the persisted auth tokens (survives F5 until the JWT expires). */
const TOKEN_STORAGE_KEY = 'ebgeo_auth';

/**
 * Timeout (ms) for boot-critical requests (config + session restore) so a hung backend can't
 * block boot. Other requests (snapshot pull / op push) are intentionally UNBOUNDED so a large
 * transfer on a slow/degrading network is never aborted mid-flight (P6 — resiliência a redes ruins).
 */
const BOOT_TIMEOUT_MS = 8000;

/**
 * HTTP client for the EBGeo backend.
 */
export class ApiClient {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.baseUrl] - API base, e.g. 'http://localhost:3001/api/v1' or '/api/v1'.
     * @param {typeof fetch} [opts.fetch] - Fetch implementation (defaults to global fetch).
     */
    constructor({ baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl, bootTimeoutMs = BOOT_TIMEOUT_MS } = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this._fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
        /** @type {number} Timeout (ms) applied to boot-critical requests only (getConfig/getMe). */
        this._bootTimeoutMs = bootTimeoutMs;
        /** @type {string|null} */
        this._accessToken = null;
        /** @type {string|null} */
        this._refreshToken = null;
        /** Guards against infinite refresh recursion. @type {Promise<void>|null} */
        this._refreshing = null;
        /** Called once when a refresh terminally fails mid-session (auth lost). @type {Function|null} */
        this._onAuthLost = null;
        /** Debounce so a burst of failing requests fires the auth-lost handler only once. */
        this._authLostFired = false;
    }

    /**
     * Registers a handler invoked when a token refresh TERMINALLY fails mid-session (the refresh
     * token is gone/expired) — i.e. the session is lost. Fires at most once until the next successful
     * `setTokens`. Wired after boot so a boot-time expiry falls to anonymous silently instead.
     * @param {Function|null} handler
     */
    setAuthLostHandler(handler) {
        this._onAuthLost = handler;
    }

    /** @private Fires the auth-lost handler at most once per session. */
    _notifyAuthLost() {
        if (this._authLostFired) return;
        this._authLostFired = true;
        try {
            this._onAuthLost?.();
        } catch (error) {
            console.warn('[ApiClient] auth-lost handler error:', error);
        }
    }

    // ===== TOKEN STATE =====

    /**
     * Stores the access (and optionally refresh) token for subsequent requests.
     * @param {{ accessToken: string, refreshToken?: string }} tokens
     */
    setTokens({ accessToken, refreshToken }) {
        this._accessToken = accessToken || null;
        if (refreshToken !== undefined) this._refreshToken = refreshToken;
        this._authLostFired = false; // a fresh, valid session — re-arm the auth-lost notification
        this._persistTokens();
    }

    /**
     * Sets an EPHEMERAL access token (in-memory only, NOT persisted). Used by the public
     * "viewer link" flow: the short-lived public token must not survive a reload (the link in the
     * URL is re-resolved on boot instead).
     * @param {string} token
     */
    setEphemeralToken(token) {
        this._accessToken = token || null;
        this._refreshToken = null;
    }

    /** @returns {string|null} The current access token. */
    getAccessToken() {
        return this._accessToken;
    }

    /** Clears all tokens (logout). */
    clearTokens() {
        this._accessToken = null;
        this._refreshToken = null;
        this._persistTokens();
    }

    /** @returns {boolean} Whether an access token is present. */
    isAuthenticated() {
        return this._accessToken !== null;
    }

    /**
     * @private Persists the current tokens to localStorage so the session survives a reload.
     * Degrades silently to in-memory only when localStorage is unavailable.
     */
    _persistTokens() {
        try {
            if (typeof localStorage === 'undefined') return;
            if (this._accessToken || this._refreshToken) {
                localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
                    accessToken: this._accessToken,
                    refreshToken: this._refreshToken,
                }));
            } else {
                localStorage.removeItem(TOKEN_STORAGE_KEY);
            }
        } catch {
            // localStorage unavailable/full — keep working with in-memory tokens only.
        }
    }

    /**
     * Loads persisted tokens (if any) into memory. Call once on boot before validating the
     * session via {@link getMe}; cross-reload login persistence relies on this.
     * @returns {boolean} Whether a token was found.
     */
    loadStoredTokens() {
        try {
            if (typeof localStorage === 'undefined') return false;
            const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw) || {};
            this._accessToken = parsed.accessToken || null;
            this._refreshToken = parsed.refreshToken || null;
            return !!(this._accessToken || this._refreshToken);
        } catch {
            return false;
        }
    }

    // ===== CORE REQUEST =====

    /**
     * Performs an authenticated JSON request and unwraps the `{ data }` envelope.
     * On a 401 with a refresh token available, transparently refreshes once and retries.
     *
     * @param {string} method - HTTP method.
     * @param {string} path - Path relative to baseUrl (e.g. '/atlas').
     * @param {Object} [opts]
     * @param {Object} [opts.body] - JSON body.
     * @param {boolean} [opts.auth=true] - Send the Authorization header.
     * @param {boolean} [opts._retry=true] - Internal: allow one 401 refresh+retry.
     * @returns {Promise<*>} The parsed response (envelope unwrapped).
     * @throws {ApiError}
     */
    async _request(method, path, { body, auth = true, _retry = true, timeoutMs } = {}) {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth && this._accessToken) headers['Authorization'] = `Bearer ${this._accessToken}`;

        // Boot-critical requests (config + session restore) pass a `timeoutMs` so a hung backend
        // can't block boot (P1); the abort surfaces as a rejected fetch handled by the caller's
        // offline/anonymous fallback. All other requests (snapshot pull / op push) are left
        // UNBOUNDED so a large transfer on a slow/degrading network is never aborted (P6).
        let res;
        if (timeoutMs) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                res = await this._fetch(`${this.baseUrl}${path}`, {
                    method,
                    headers,
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
        } else {
            res = await this._fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        }

        // 204 No Content (logout) — nothing to parse.
        if (res.status === 204) return null;

        const parsed = await this._parseBody(res);

        if (!res.ok) {
            // Transparent refresh+retry on an expired access token.
            if (res.status === 401 && _retry && auth && this._refreshToken) {
                await this.refresh();
                return this._request(method, path, { body, auth, _retry: false, timeoutMs });
            }
            const err = parsed && typeof parsed === 'object' ? parsed.error : null;
            throw new ApiError(err?.message || `HTTP ${res.status}`, {
                status: res.status,
                code: err?.code,
            });
        }

        return this._unwrap(parsed);
    }

    /** @private Parses a response body as JSON, tolerating empty bodies. */
    async _parseBody(res) {
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    /**
     * @private Unwraps the `{ data }` envelope. Bare frozen contracts (config object,
     * arrays) have no `data` key and pass through unchanged.
     */
    _unwrap(parsed) {
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed) {
            return parsed.data;
        }
        return parsed;
    }

    // ===== AUTH =====

    /**
     * Logs in and stores the returned tokens.
     * @param {string} username
     * @param {string} password
     * @returns {Promise<Object>} The authenticated user.
     */
    async login(username, password) {
        const data = await this._request('POST', '/auth/login', {
            body: { username, password },
            auth: false,
        });
        this.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return data.user;
    }

    /**
     * Rotates tokens using the stored refresh token. Concurrent calls share one
     * in-flight refresh.
     * @returns {Promise<void>}
     */
    async refresh() {
        if (this._refreshing) return this._refreshing;
        if (!this._refreshToken) throw new ApiError('No refresh token', { code: 'NO_REFRESH_TOKEN' });

        this._refreshing = (async () => {
            try {
                const data = await this._request('POST', '/auth/refresh', {
                    body: { refreshToken: this._refreshToken },
                    auth: false,
                    _retry: false,
                });
                this.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
            } catch (error) {
                // The refresh token is gone/expired: the session is terminally lost. Drop the dead
                // tokens and notify (handler wired post-boot — at boot this falls to anonymous).
                this.clearTokens();
                this._notifyAuthLost();
                throw error;
            } finally {
                this._refreshing = null;
            }
        })();
        return this._refreshing;
    }

    /**
     * Registers a new user (self-registration; gated server-side).
     * @param {{ username: string, password: string, nome: string, [k: string]: * }} payload
     * @returns {Promise<Object>} The created user.
     */
    async register(payload) {
        return this._request('POST', '/auth/register', { body: payload, auth: false });
    }

    /**
     * Confirms an account via the verification token from the e-mail link. Anonymous.
     * @param {string} token
     * @returns {Promise<Object>} { success: true }
     */
    async verifyEmail(token) {
        return this._request('POST', '/auth/verify-email', { body: { token }, auth: false });
    }

    /**
     * Re-sends the verification e-mail for an address. Anonymous; always resolves success
     * (the backend never leaks whether the e-mail exists).
     * @param {string} email
     * @returns {Promise<Object>} { success: true }
     */
    async resendVerification(email) {
        return this._request('POST', '/auth/resend-verification', { body: { email }, auth: false });
    }

    /**
     * Logs out (revokes the refresh token) and clears local tokens. The backend's
     * `/auth/logout` route is auth-strict: it needs the Bearer access token AND the
     * refreshToken in the body. Network errors are swallowed so the local tokens are
     * always cleared.
     */
    async logout() {
        try {
            if (this._refreshToken && this._accessToken) {
                await this._request('POST', '/auth/logout', {
                    body: { refreshToken: this._refreshToken },
                    _retry: false,
                });
            }
        } catch {
            // Best-effort revoke: clear locally even if the server call fails.
        } finally {
            this.clearTokens();
        }
    }

    /**
     * Returns the authenticated user (validates the access token; transparently refreshes on
     * a 401 when a refresh token is available). Used on boot to restore a persisted session.
     * @returns {Promise<Object>} The current user.
     */
    async getMe() {
        return this._request('GET', '/auth/me', { timeoutMs: this._bootTimeoutMs });
    }

    // ===== CONFIG =====

    /**
     * Fetches the runtime config (frozen `GET /api/config` contract — bare object).
     * @returns {Promise<Object>} The config object.
     */
    async getConfig() {
        return this._request('GET', '/config', { auth: false, timeoutMs: this._bootTimeoutMs });
    }

    /**
     * Admin: reads the effective config + the current override document (prefills the editor).
     * @returns {Promise<{ effective: Object, overrides: Object }>}
     */
    async getConfigAdmin() {
        return this._request('GET', '/config/admin');
    }

    /**
     * Admin: persists a partial config override (deep-merged server-side over STATIC/ENV).
     * @param {Object} overrides - Partial { app?, features?, map2d?, map3d?, services?, search? }.
     * @returns {Promise<{ overrides: Object }>}
     */
    async updateConfigOverrides(overrides) {
        return this._request('PUT', '/config/admin', { body: overrides });
    }

    /**
     * Admin: clears ALL config overrides (revert to the deploy STATIC/ENV defaults).
     * @returns {Promise<{ overrides: Object }>}
     */
    async clearConfigOverrides() {
        return this._request('DELETE', '/config/admin');
    }

    // ===== CATALOG — RESOURCES (admin metadata CRUD; requireAdmin server-side) =====
    // These manage the catalog METADATA only (the `config` JSONB: name/url/thumbnail/style/…);
    // the actual files (3D model bytes, 360 bundles, media) are populated out-of-band.

    /**
     * Lists catalog resources, optionally filtered by category.
     * @param {string} [category] - 'basemap'|'data_layer'|'analysis_layer'|'tileset'|'streetview_marker'
     * @returns {Promise<Array<Object>>}
     */
    async listResources(category) {
        const qs = category ? `?category=${encodeURIComponent(category)}` : '';
        return this._request('GET', `/resources${qs}`);
    }

    /**
     * Creates a catalog resource (metadata).
     * @param {{ id: string, category: string, name: string, description?: string, config?: Object, sort_order?: number }} payload
     * @returns {Promise<Object>}
     */
    async createResource(payload) {
        return this._request('POST', '/resources', { body: payload });
    }

    /**
     * Updates a catalog resource (partial metadata).
     * @param {string} id
     * @param {{ name?: string, description?: string, config?: Object, sort_order?: number }} payload
     * @returns {Promise<Object>}
     */
    async updateResource(id, payload) {
        return this._request('PUT', `/resources/${encodeURIComponent(id)}`, { body: payload });
    }

    /**
     * Soft-deletes a catalog resource.
     * @param {string} id
     * @returns {Promise<null>}
     */
    async deleteResource(id) {
        return this._request('DELETE', `/resources/${encodeURIComponent(id)}`);
    }

    // ===== PERSONNEL DOMAINS — ranks (postos) + organizations (OMs) =====
    // Controlled lists consumed by the signup/account forms (FK ids). Admin-managed.

    /** @returns {Promise<Array<{id,nome,nome_abrev,sort_order,is_active}>>} */
    async listRanks() {
        return this._request('GET', '/ranks');
    }

    /** @param {{nome:string, nome_abrev?:string, sort_order?:number}} payload */
    async createRank(payload) {
        return this._request('POST', '/ranks', { body: payload });
    }

    /** @param {string} id @param {{nome?:string, nome_abrev?:string, sort_order?:number, is_active?:boolean}} payload */
    async updateRank(id, payload) {
        return this._request('PUT', `/ranks/${encodeURIComponent(id)}`, { body: payload });
    }

    /** @param {string} id Soft-deactivates the rank. */
    async deleteRank(id) {
        return this._request('DELETE', `/ranks/${encodeURIComponent(id)}`);
    }

    /** @returns {Promise<Array<{id,nome,slug,sigla,is_active}>>} */
    async listOrganizations() {
        return this._request('GET', '/organizations');
    }

    /** @param {{nome:string, slug:string, sigla?:string}} payload */
    async createOrganization(payload) {
        return this._request('POST', '/organizations', { body: payload });
    }

    /** @param {string} id @param {{nome?:string, sigla?:string, is_active?:boolean}} payload */
    async updateOrganization(id, payload) {
        return this._request('PUT', `/organizations/${encodeURIComponent(id)}`, { body: payload });
    }

    /** @param {string} id Soft-deactivates the organization. */
    async deleteOrganization(id) {
        return this._request('DELETE', `/organizations/${encodeURIComponent(id)}`);
    }

    // ===== CATALOG — 360 PROJECTS (admin metadata; the bundle upload is out-of-band) =====

    /** Lists 360 projects (incl. disabled). Bare array contract. @returns {Promise<Array<Object>>} */
    async listSv360Projects() {
        return this._request('GET', '/sv360/admin/projects');
    }

    /**
     * Enables/disables a 360 project (metadata only).
     * @param {string} slug
     * @param {'enabled'|'disabled'} status
     * @returns {Promise<Object>}
     */
    async setSv360ProjectStatus(slug, status) {
        return this._request('PATCH', `/sv360/admin/projects/${encodeURIComponent(slug)}/status`, { body: { status } });
    }

    /**
     * Deletes a 360 project.
     * @param {string} slug
     * @returns {Promise<null>}
     */
    async deleteSv360Project(slug) {
        return this._request('DELETE', `/sv360/admin/projects/${encodeURIComponent(slug)}`);
    }

    // ===== ATLAS =====

    /** @returns {Promise<Object[]>} Atlases visible to the current user. */
    async listAtlas() {
        return this._request('GET', '/atlas');
    }

    /**
     * Creates an atlas.
     * @param {Object} payload - Per the backend createAtlasSchema (e.g. { name }).
     * @returns {Promise<Object>} The created atlas.
     */
    async createAtlas(payload) {
        return this._request('POST', '/atlas', { body: payload });
    }

    /**
     * @param {string} atlasId
     * @returns {Promise<Object>} The atlas metadata.
     */
    async getAtlas(atlasId) {
        return this._request('GET', `/atlas/${atlasId}`);
    }

    /**
     * Deletes an atlas (owner-only — backend enforces). Soft-deletes it and broadcasts
     * `atlas_deleted` to the collab room so connected clients disconnect + return to the picker.
     * @param {string} atlasId
     * @returns {Promise<null>}
     */
    async deleteAtlas(atlasId) {
        return this._request('DELETE', `/atlas/${atlasId}`);
    }

    /**
     * Updates atlas metadata (e.g. rename). Requires write permission (backend-enforced).
     * @param {string} atlasId
     * @param {Object} payload - Per updateAtlasSchema (e.g. { name }).
     * @returns {Promise<Object>} The updated atlas.
     */
    async updateAtlas(atlasId, payload) {
        return this._request('PUT', `/atlas/${atlasId}`, { body: payload });
    }

    /**
     * Clones an atlas into a new project the caller owns ("fazer uma cópia"). Requires read
     * permission on the source (backend-enforced).
     * @param {string} atlasId - Source atlas id.
     * @param {Object} [payload] - Per cloneAtlasSchema (e.g. { name }).
     * @returns {Promise<Object>} The created clone.
     */
    async cloneAtlas(atlasId, payload = {}) {
        return this._request('POST', `/atlas/${atlasId}/clone`, { body: payload });
    }

    /**
     * Lists the caller's own trashed (soft-deleted) atlases.
     * @returns {Promise<Array<Object>>}
     */
    async listTrashedAtlas() {
        return this._request('GET', '/atlas/trash');
    }

    /**
     * Restores a trashed atlas the caller owns.
     * @param {string} atlasId
     * @returns {Promise<Object>} The restored atlas.
     */
    async restoreAtlas(atlasId) {
        return this._request('POST', `/atlas/${atlasId}/restore`);
    }

    /**
     * Creates a new atlas from a bulk-import payload (the local store serialized to the backend
     * import shape). Preserves client-provided entity UUIDs; the atlas itself gets a fresh server
     * id. Used by "Salvar atlas local no servidor".
     * @param {Object} payload - Per the backend importSchema ({ atlas, maps, briefings }).
     * @returns {Promise<Object>} The created atlas ({ id, name, ..., summary }).
     */
    async importAtlas(payload) {
        return this._request('POST', '/atlas/import', { body: payload });
    }

    /**
     * Opens a public (anonymous) atlas by its share link. No auth required. Returns the atlas
     * metadata plus a short-lived read-only `publicToken` for the WebSocket — used by the public
     * "viewer link" flow (logged-out visitor).
     * @param {string} link - The public link token.
     * @returns {Promise<Object>} The atlas ({ id, name, ..., publicToken }).
     */
    async getPublicAtlas(link) {
        return this._request('GET', `/atlas/public/${encodeURIComponent(link)}`, { auth: false });
    }

    /**
     * Patches the atlas settings (which features/basemaps are available). Manager-level
     * server-side; broadcasts `atlas_settings_updated` to the room.
     * @param {string} atlasId
     * @param {Object} settings - Partial settings (deep-merged server-side).
     * @returns {Promise<Object>} The updated atlas.
     */
    async updateAtlasSettings(atlasId, settings) {
        return this._request('PATCH', `/atlas/${atlasId}/settings`, { body: settings });
    }

    /**
     * Reads the atlas settings (which features/basemaps are available). Read-level server-side.
     * @param {string} atlasId
     * @returns {Promise<Object>} The atlas.settings object.
     */
    async getAtlasSettings(atlasId) {
        return this._request('GET', `/atlas/${atlasId}/settings`);
    }

    /**
     * Transfers atlas ownership to another member (owner-only — backend enforces). The previous
     * owner is demoted to a co-Gestor ('manage'). Broadcasts `atlas_owner_changed` to the room.
     * @param {string} atlasId
     * @param {string} newOwnerId - A current member of the atlas.
     * @returns {Promise<Object>} The updated atlas.
     */
    async transferOwnership(atlasId, newOwnerId) {
        return this._request('POST', `/atlas/${atlasId}/transfer`, { body: { newOwnerId } });
    }

    // ===== SHARING (Gestor-level / 'manage'; backend enforces) =====

    /**
     * Reads the sharing configuration for an atlas (public link + per-user shares).
     * Owner-only server-side.
     * @param {string} atlasId
     * @returns {Promise<{ isPublic: boolean, publicLink: string|null, shares: Array<{ userId: string, username: string, nome: string, permission: 'read'|'write', addedAt: string }> }>}
     */
    async getSharing(atlasId) {
        return this._request('GET', `/atlas/${atlasId}/sharing`);
    }

    /**
     * Enables public sharing, returning the generated public link.
     * @param {string} atlasId
     * @returns {Promise<{ publicLink: string }>}
     */
    async enablePublicSharing(atlasId) {
        return this._request('POST', `/atlas/${atlasId}/sharing/public`);
    }

    /**
     * Disables public sharing (revokes the public link).
     * @param {string} atlasId
     * @returns {Promise<null>}
     */
    async disablePublicSharing(atlasId) {
        return this._request('DELETE', `/atlas/${atlasId}/sharing/public`);
    }

    /**
     * Grants a user access to the atlas at the given permission.
     * @param {string} atlasId
     * @param {string} userId
     * @param {'read'|'comment'|'write'|'manage'} permission
     * @returns {Promise<Object>} The created share record.
     */
    async addShare(atlasId, userId, permission) {
        return this._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId, permission },
        });
    }

    /**
     * Updates an existing user's permission on the atlas.
     * @param {string} atlasId
     * @param {string} userId
     * @param {'read'|'comment'|'write'|'manage'} permission
     * @returns {Promise<Object>} The updated share record.
     */
    async updateShare(atlasId, userId, permission) {
        return this._request('PUT', `/atlas/${atlasId}/sharing/users/${userId}`, {
            body: { permission },
        });
    }

    /**
     * Revokes a user's access to the atlas.
     * @param {string} atlasId
     * @param {string} userId
     * @returns {Promise<null>}
     */
    async removeShare(atlasId, userId) {
        return this._request('DELETE', `/atlas/${atlasId}/sharing/users/${userId}`);
    }

    // ===== USERS =====

    /**
     * Searches users by name/username (min 2 chars; backend caps at 20 results).
     * Frozen bare-array contract — returned as-is.
     * @param {string} q - Search term.
     * @returns {Promise<Array<{ id: string, username: string, nome: string, posto_graduacao: string, organizacao_militar: string }>>}
     */
    async searchUsers(q) {
        return this._request('GET', `/users/search?q=${encodeURIComponent(q)}`);
    }

    // ===== USERS — ADMIN (requireAdmin server-side; global role 'admin') =====

    /**
     * Lists all users (admin-only).
     * @param {{ includeInactive?: boolean }} [opts]
     * @returns {Promise<Array<Object>>} The users.
     */
    async listUsers({ includeInactive = false } = {}) {
        const qs = includeInactive ? '?includeInactive=true' : '';
        return this._request('GET', `/users${qs}`);
    }

    /**
     * Fetches a single user by id (admin-only).
     * @param {string} userId
     * @returns {Promise<Object>}
     */
    async getUser(userId) {
        return this._request('GET', `/users/${userId}`);
    }

    /**
     * Creates a user (admin-only). Payload per the backend createUserAdminSchema.
     * @param {{ username: string, password: string, nome: string, posto_graduacao?: string,
     *   organizacao_militar?: string, role?: 'user'|'admin' }} payload
     * @returns {Promise<Object>} The created user.
     */
    async createUser(payload) {
        return this._request('POST', '/users', { body: payload });
    }

    /**
     * Updates a user (admin-only). Partial payload per the backend updateUserAdminSchema.
     * @param {string} userId
     * @param {{ username?: string, nome?: string, posto_graduacao?: string,
     *   organizacao_militar?: string, role?: 'user'|'admin', is_active?: boolean }} payload
     * @returns {Promise<Object>} The updated user.
     */
    async updateUser(userId, payload) {
        return this._request('PUT', `/users/${userId}`, { body: payload });
    }

    /**
     * Resets a user's password (admin-only).
     * @param {string} userId
     * @param {string} newPassword
     * @returns {Promise<Object>}
     */
    async resetUserPassword(userId, newPassword) {
        return this._request('POST', `/users/${userId}/reset-password`, { body: { newPassword } });
    }

    /**
     * Deactivates (soft-deletes) a user (admin-only). When the user owns atlases, `transferTo`
     * (a user id) is required so ownership is reassigned; otherwise the backend returns a conflict.
     * @param {string} userId
     * @param {{ transferTo?: string }} [opts]
     * @returns {Promise<Object>}
     */
    async deactivateUser(userId, { transferTo } = {}) {
        const qs = transferTo ? `?transferTo=${encodeURIComponent(transferTo)}` : '';
        return this._request('DELETE', `/users/${userId}${qs}`);
    }

    /**
     * Reactivates a previously deactivated user (admin-only).
     * @param {string} userId
     * @returns {Promise<Object>}
     */
    async reactivateUser(userId) {
        return this._request('POST', `/users/${userId}/reactivate`);
    }

    /**
     * Rotates another user's M2M API key (admin-only).
     * @param {string} userId
     * @returns {Promise<Object>}
     */
    async rotateUserApiKey(userId) {
        return this._request('POST', `/users/${userId}/api-key/rotate`);
    }

    // ===== SYNC =====

    /**
     * Pulls operations (or a full snapshot) since a given version.
     * @param {string} atlasId
     * @param {number} [sinceVersion=0] - 0 (or below min) returns a snapshot.
     * @returns {Promise<{ snapshot?: Object, operations?: Object[], currentVersion: number, isSnapshot: boolean }>}
     */
    async pullSync(atlasId, sinceVersion = 0) {
        return this._request('GET', `/atlas/${atlasId}/sync/${sinceVersion}`);
    }

    /**
     * Pushes a batch of operations to the server.
     * @param {string} atlasId
     * @param {Object[]} operations - Operations from the operation factory.
     * @returns {Promise<{ results: Object[], acks: Object[], serverVersion: number }>}
     */
    async pushOperations(atlasId, operations) {
        return this._request('POST', `/atlas/${atlasId}/sync`, { body: { operations } });
    }

    // ===== IMAGES (feature photos §17.14 / custom marker icons §17.19) =====

    /**
     * Uploads an image (feature photo or custom marker icon) via multipart. The
     * backend allowlist is png/jpeg/webp (no SVG). The returned id is referenced on
     * the feature (e.g. `properties.photoId` / `properties.markerSymbol`) and that
     * reference round-trips through sync.
     * @param {string} atlasId
     * @param {Blob} blob - Image bytes.
     * @param {string} [filename='image.png']
     * @returns {Promise<Object>} The created image record ({ id, ... }).
     */
    async uploadImage(atlasId, blob, filename = 'image.png') {
        const form = new FormData();
        form.append('image', blob, filename);
        // No Content-Type header — fetch derives the multipart boundary from FormData.
        const headers = this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {};
        const res = await this._fetch(`${this.baseUrl}/atlas/${atlasId}/images`, {
            method: 'POST',
            headers,
            body: form,
        });
        const parsed = await this._parseBody(res);
        if (!res.ok) {
            const err = parsed && typeof parsed === 'object' ? parsed.error : null;
            throw new ApiError(err?.message || `HTTP ${res.status}`, { status: res.status, code: err?.code });
        }
        return this._unwrap(parsed);
    }

    /**
     * Bulk-uploads images (base64) to an atlas in one request — used to migrate the local image
     * blobs of an atlas saved to the server. Each item: `{ localId, filename, mimeType, data }`
     * where `data` is base64. Returns `{ uploaded, failed, mapping }` where `mapping` is
     * `{ localId: serverId }` (the server assigns new ids; callers rewrite feature refs). The
     * backend caps the batch at 50 items, so callers must chunk.
     * @param {string} atlasId
     * @param {Array<{ localId: string, filename: string, mimeType: string, data: string }>} images
     * @returns {Promise<{ uploaded: Array, failed: Array, mapping: Record<string,string> }>}
     */
    async bulkUploadImages(atlasId, images) {
        return this._request('POST', `/atlas/${atlasId}/images/bulk`, { body: { images } });
    }

    /**
     * Builds the URL to fetch an uploaded image (served as an attachment, auth-gated).
     * @param {string} atlasId
     * @param {string} imageId
     * @returns {string}
     */
    imageUrl(atlasId, imageId) {
        return `${this.baseUrl}/atlas/${atlasId}/images/${imageId}`;
    }

    /**
     * Deletes an uploaded image (hard-delete).
     * @param {string} atlasId
     * @param {string} imageId
     * @returns {Promise<null>}
     */
    async deleteImage(atlasId, imageId) {
        return this._request('DELETE', `/atlas/${atlasId}/images/${imageId}`);
    }

    /**
     * Fetches an uploaded image as a Blob (auth-gated). Used by the renderer to show
     * an image/icon a collaborator referenced but doesn't have cached locally.
     * @param {string} atlasId
     * @param {string} imageId
     * @returns {Promise<Blob>}
     */
    async fetchImageBlob(atlasId, imageId) {
        const headers = this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {};
        const res = await this._fetch(this.imageUrl(atlasId, imageId), { method: 'GET', headers });
        if (!res.ok) {
            throw new ApiError(`HTTP ${res.status}`, { status: res.status });
        }
        return res.blob();
    }

    // ===== WEBSOCKET URL =====

    /**
     * Builds the collab WebSocket URL (token + clientId as query params), matching
     * the backend handshake `…/collab?atlasId=&token=&clientId=`.
     * @param {string} atlasId
     * @param {Object} [opts]
     * @param {string} [opts.clientId] - Stable client id (presence/idempotency).
     * @returns {string} The `ws(s)://…` URL.
     */
    wsUrl(atlasId, { clientId } = {}) {
        const wsBase = this._absoluteBase().replace(/^http/, 'ws');
        const params = new URLSearchParams({ atlasId, token: this._accessToken || '' });
        if (clientId) params.set('clientId', clientId);
        return `${wsBase}/collab?${params.toString()}`;
    }

    /** @private Resolves baseUrl to an absolute origin (browser) or returns it as-is. */
    _absoluteBase() {
        if (/^https?:\/\//.test(this.baseUrl)) return this.baseUrl;
        const origin = globalThis.location?.origin || '';
        return `${origin}${this.baseUrl}`;
    }
}

/** Shared singleton, configured at boot via `configure()`. */
export const apiClient = new ApiClient();

/**
 * Reconfigures the shared client (e.g. to point at a specific backend in tests/E2E).
 * @param {ConstructorParameters<typeof ApiClient>[0]} opts
 * @returns {ApiClient}
 */
export function configureApiClient(opts) {
    if (opts?.baseUrl !== undefined) apiClient.baseUrl = opts.baseUrl.replace(/\/$/, '');
    if (opts?.fetch) apiClient._fetch = opts.fetch;
    return apiClient;
}
