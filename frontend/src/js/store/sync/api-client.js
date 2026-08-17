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
     * @param {Array<{field: string, message: string}>} [opts.details] - Per-field detail of a
     *   422 `VALIDATION_ERROR` (the only envelope that carries it).
     */
    constructor(message, { status, code, details } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        /** @type {Array<{field: string, message: string}>|null} */
        this.details = Array.isArray(details) ? details : null;
    }
}

/**
 * @private Renders the `details` array of a 422 into one human-readable line.
 * @param {*} details - Expected `[{ field, message }]`; anything else yields ''.
 * @returns {string}
 */
function formatValidationDetails(details) {
    if (!Array.isArray(details)) return '';
    return details.map((d) => {
        const message = typeof d?.message === 'string' ? d.message.trim() : '';
        const field = typeof d?.field === 'string' ? d.field.trim() : '';
        // The message is shown AS IS, never prefixed with the field. Since 2026-08-16 the
        // server renders each detail as a complete pt-BR sentence that already names the
        // field in Portuguese (`backend/src/utils/validation-messages.js`), so prefixing put
        // the English wire name in front of a finished sentence: `password: Senha deve ter ao
        // menos 6 caracteres.` The wire name survives on `error.details[].field` for anything
        // that needs the key. Only a detail with no message at all falls back to it.
        return message || field;
    }).filter(Boolean).join('; ');
}

/**
 * Builds the message carried by an {@link ApiError} from the backend error envelope.
 *
 * For a 422 the top-level message is the constant `'Falha na validação'`
 * (`backend/src/middleware/error-handler.js`) and the offending FIELD is named only inside
 * `details`. Every form in the app shows `error.message`, so without composing it here the
 * naming work the server already did never reaches the user.
 *
 * Exported for the unit test (`tests/unit/api-client-error-contract.test.js`).
 * @param {{code?: string, message?: string, details?: *}|null} err - The `error` envelope.
 * @param {number} status - HTTP status, used for the last-resort message.
 * @returns {string}
 */
export function buildApiErrorMessage(err, status) {
    const composed = err?.code === 'VALIDATION_ERROR' ? formatValidationDetails(err.details) : '';
    return composed || err?.message || `HTTP ${status}`;
}

/**
 * Decides whether a FAILED token refresh means the session is terminally lost (drop the
 * tokens and notify) or is a transient failure (keep the tokens and let the next call retry).
 *
 * Only a credential rejection is terminal: 401 `UNAUTHORIZED` (dead/reused refresh token,
 * `backend/src/modules/auth/auth.service.js`) and 403 `FORBIDDEN` (deactivated organization,
 * same file) — neither improves by trying again. Everything else is transient, and the one
 * that matters most in this deployment is **429**: `refreshLimiter` is keyed by IP
 * (`backend/src/middleware/rate-limit.js`) and the documented deployment is a military network
 * behind NAT, so a shared egress address makes 429 an expected outcome, not a remote
 * hypothesis. Treating it as terminal reaches `account.control#handleSessionLost` →
 * `clearAllDataStore()`, i.e. a traffic spike erases unsynced local work.
 *
 * The status line wins over `code` when present: it is what the server's own error handler
 * derives the code from, and a body from a proxy or gateway can carry anything. Absent a
 * status (network failure, `AbortError`) the failure is transient by definition.
 *
 * Exported for the unit test (`tests/unit/api-client-error-contract.test.js`).
 * @param {*} error - The error thrown by the refresh request.
 * @returns {boolean} True when the session must be dropped.
 */
export function isTerminalRefreshFailure(error) {
    const status = error?.status;
    if (status === 401 || status === 403) return true;
    if (Number.isFinite(status)) return false;
    return error?.code === 'UNAUTHORIZED' || error?.code === 'FORBIDDEN';
}

/** localStorage key holding the persisted auth tokens (survives F5 until the JWT expires). */
const TOKEN_STORAGE_KEY = 'ebgeo_auth';

/**
 * How long a TRANSIENT refresh failure suppresses further refresh attempts.
 *
 * Preserving the tokens on a 429/5xx (instead of ending the session) means the caller comes
 * back: `sync-flush` alone retries every 1.5 s, so an unthrottled client would spend ~600
 * failed refreshes inside one 15-minute limiter window — and `refreshLimiter` charges exactly
 * those (`skipSuccessfulRequests: true`), for every user sharing the NAT address. 30 s caps it
 * at ~30 attempts per window while staying far below the access token's lifetime, so an outage
 * that ends is noticed within one cooldown.
 */
const REFRESH_COOLDOWN_MS = 30000;

/**
 * Timeout (ms) for boot-critical requests (config + session restore) so a hung backend can't
 * block boot. Other requests (snapshot pull / op push) are intentionally UNBOUNDED so a large
 * transfer on a slow/degrading network is never aborted mid-flight (P6 — resiliência a redes ruins).
 */
const BOOT_TIMEOUT_MS = 8000;

/**
 * Headroom (ms) before `exp` at which the access token is renewed BEFORE being used,
 * instead of waiting for the 401 that reactively triggers a refresh.
 *
 * The reactive path is not enough for two requests, and both are uploads. `uploadImage`
 * builds its own multipart request and has no 401 retry at all. `POST /images/bulk` does
 * retry, but never gets the chance: the backend picks the enlarged 50 MB body parser only
 * when `flexibleAuth` has already attached a verified principal (`backend/src/app.js`), so
 * an expired token makes a >10 MB batch fall to the global 10 MB cap and answer **413**.
 * Nothing in this client reacts to 413, so that upload failed and every retry failed the
 * same way, until some unrelated call happened to renew the session.
 *
 * Fixing it on the server does not work: answering 401 before reading the body leaves
 * megabytes in flight and Node destroys the socket, so the client reads ECONNRESET instead
 * of the status (measured — the anonymous small-body case answers 401 in 2 ms, every
 * 12 MB case resets). Draining the body first would let an unauthenticated caller push the
 * full 50 MB, which is the amplification that guard exists to prevent. Renewing here costs
 * one request and no trade-off.
 *
 * 30 s covers ordinary clock skew and the flight time of a large upload.
 */
const TOKEN_RENEWAL_SKEW_MS = 30000;

/**
 * Name of the Web Lock that serializes token rotation across every tab of this origin.
 *
 * The refresh token is single-use: two tabs presenting the same one is what the server reads
 * as theft (`REFRESH_RACE_GRACE_MS`, `backend/src/modules/auth/auth.service.js`), and outside
 * its 10 s grace window it revokes the whole family, logging BOTH tabs out. The in-flight
 * sharing of `refresh()` is per instance, and there is one instance per document, so it never
 * covered this. See `docs/wiki/refresh-token-rotacao.md`, "Contrato para o cliente", item 2.
 */
const REFRESH_LOCK_NAME = 'ebgeo_auth_refresh';

/**
 * How long a tab waits for {@link REFRESH_LOCK_NAME} before rotating WITHOUT it.
 *
 * A rotation is one small request, so a healthy holder releases in well under a second; a wait
 * this long means the holder is wedged (a hung socket holds the lock for as long as the request
 * lives, and refresh requests are deliberately unbounded). Waiting forever would turn a wedged
 * tab into "every other tab stops renewing", which surfaces as spontaneous logouts, i.e. exactly
 * the failure this lock exists to prevent. Bounding the WAIT (never the hold) degrades to the
 * lock-less path instead, which is the behaviour this client had before the lock existed.
 */
const REFRESH_LOCK_WAIT_MS = 5000;

/**
 * Decodes a JWT payload WITHOUT verifying it. Signature validation is the server's job; the
 * client only reads claims to decide when to ask for a new token and whose token it is holding.
 * @param {*} token - Access token.
 * @returns {Object|null} The decoded payload, or null when unreadable.
 */
function jwtPayload(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}

/**
 * Reads the `exp` claim of a JWT WITHOUT verifying it. A forged `exp` can at worst make this
 * client refresh early (or not at all, which is exactly the behaviour before this existed).
 * @param {string} token - Access token.
 * @returns {number|null} Expiry in epoch ms, or null when unreadable.
 */
function jwtExpiryMs(token) {
    const payload = jwtPayload(token);
    // Not a readable JWT: treat as "unknown expiry" and leave the 401 path in charge.
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

/**
 * Reads the `sub` claim (the user id, `issueAccessToken` in
 * `backend/src/modules/auth/auth.service.js`) WITHOUT verifying it. Used only to REFUSE a token
 * from another subject, never to grant anything.
 * @param {string} token - Access token.
 * @returns {string|null}
 */
function jwtSubject(token) {
    const sub = jwtPayload(token)?.sub;
    return typeof sub === 'string' && sub ? sub : null;
}

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
        /** Set once a renewal proves the local clock is unusable; see `_ensureFreshAccessToken`. */
        this._renewalStoodDown = false;
        /** Epoch ms until which a TRANSIENT refresh failure suppresses new attempts. */
        this._refreshCooldownUntil = 0;
        /** The transient failure that opened the cooldown, replayed while it lasts. @type {Error|null} */
        this._lastTransientRefreshError = null;
        /** `storage` listener that adopts a pair another tab rotated. @type {Function|null} */
        this._storageListener = null;
        this._installCrossTabTokenSync();
    }

    // ===== CROSS-TAB TOKEN SYNC =====

    /**
     * @private Subscribes to the `storage` event so an IDLE tab learns about a rotation done by
     * another tab instead of waking up with a refresh token the server already revoked.
     *
     * The event fires in every document of the origin EXCEPT the one that wrote, which is exactly
     * the wanted semantics, and `_persistTokens` is the only writer. Wired in the constructor so
     * it covers the FOUR pages (the map, projetos, admin and calibração all boot on this singleton),
     * not just the map. Absent `addEventListener` (Node test runner, worker) it degrades to
     * in-memory only, like every other environment guard in this file.
     */
    _installCrossTabTokenSync() {
        if (this._storageListener) return;
        if (typeof globalThis.addEventListener !== 'function') return;
        this._storageListener = (event) => this._onTokenStorageEvent(event);
        globalThis.addEventListener('storage', this._storageListener);
    }

    /**
     * Removes the cross-tab listener. The singleton lives as long as the document, so this exists
     * for tests and for any client built ad hoc.
     */
    dispose() {
        if (this._storageListener && typeof globalThis.removeEventListener === 'function') {
            globalThis.removeEventListener('storage', this._storageListener);
        }
        this._storageListener = null;
    }

    /**
     * @private Handles a `storage` event on the token item.
     *
     * A REMOVAL (`newValue` null) is deliberately NOT followed. `clearTokens()` is written both by
     * a real logout and by the "any restore failure clears" branch of projetos/admin/calibração,
     * so a backend blip in a second tab would otherwise log this one out on the spot. The session
     * that was really revoked still ends here, one step later and for the right reason: the next
     * rotation presents a token the server already killed and takes a terminal 401.
     * @param {StorageEvent} event
     */
    _onTokenStorageEvent(event) {
        // `key` is null for `localStorage.clear()`, which this also ignores.
        if (event?.key !== TOKEN_STORAGE_KEY) return;
        if (!event.newValue) return;
        let parsed = null;
        try {
            parsed = JSON.parse(event.newValue);
        } catch {
            return;
        }
        this._adoptStoredTokens(parsed);
    }

    /**
     * @private Reads the persisted pair without touching in-memory state.
     * @returns {{accessToken?: string, refreshToken?: string}|null}
     */
    _readStoredTokens() {
        try {
            if (typeof localStorage === 'undefined') return null;
            const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }

    /**
     * @private Takes over a token pair written by ANOTHER tab, when it is strictly newer than the
     * one in memory. Does not persist: the disk already holds what is being adopted.
     *
     * Four refusals, each one a way this could do damage:
     * - no refresh token in memory. One guard covering three states that must never be overwritten:
     *   the EPHEMERAL public-link token (access without refresh, and the disk deliberately still
     *   holds the signed-in user's pair — `setEphemeralToken`), an anonymous tab, and a tab whose
     *   session was already terminally lost (adopting would resurrect it);
     * - unreadable incoming token;
     * - a different `sub`. Another tab logging out and back in as someone else must not silently
     *   re-identify this one, which keeps showing (and writing as) the first user;
     * - a pair identical to the one in memory (nothing to do), or one whose access token expires
     *   STRICTLY EARLIER (a stale read, a late event). Together these make adoption idempotent and
     *   order-independent: it never rolls back to a previous pair.
     *
     * What makes "different means newer" safe is that this class is the only writer and every
     * in-memory change goes to disk in the same call (`setTokens`), with the single deliberate
     * exception excluded above. So memory is never AHEAD of disk, and a disk pair that differs was
     * written after this tab's last write. Equality of `exp` alone cannot decide it: JWT `exp` has
     * one-SECOND resolution, so two rotations inside the same second read as the same instant.
     * @param {{accessToken?: string, refreshToken?: string}|null} stored
     * @returns {boolean} Whether the in-memory pair was replaced.
     */
    _adoptStoredTokens(stored) {
        if (!stored || !this._refreshToken) return false;
        const incoming = stored.accessToken;
        const theirExpiry = jwtExpiryMs(incoming);
        if (theirExpiry === null) return false;

        const mySubject = jwtSubject(this._accessToken);
        const theirSubject = jwtSubject(incoming);
        if (mySubject && theirSubject && mySubject !== theirSubject) return false;

        const sameRefresh = !stored.refreshToken || stored.refreshToken === this._refreshToken;
        if (incoming === this._accessToken && sameRefresh) return false;
        const myExpiry = jwtExpiryMs(this._accessToken);
        if (myExpiry !== null && theirExpiry < myExpiry) return false;

        this._accessToken = incoming;
        if (stored.refreshToken) this._refreshToken = stored.refreshToken;
        // Another tab was just answered by the server: this one is a live session again.
        this._authLostFired = false;
        this._clearRefreshCooldown();
        return true;
    }

    /**
     * @private Whether the access token in memory survives long enough to be worth using, i.e. a
     * rotation would be pointless. Same headroom the proactive renewal uses.
     * @returns {boolean}
     */
    _accessTokenOutlivesSkew() {
        const expiresAt = jwtExpiryMs(this._accessToken);
        return expiresAt !== null && expiresAt - Date.now() > TOKEN_RENEWAL_SKEW_MS;
    }

    /**
     * @private Runs the rotation's critical section holding a CROSS-TAB lock, so two tabs never
     * present the same single-use refresh token.
     *
     * DEGRADED PATH, explicit on purpose: `navigator.locks` needs a secure context (https or
     * localhost) and does not exist in older browsers, so on a plain-HTTP deployment it is simply
     * `undefined`. There the critical section runs unlocked, which is what this client did before
     * this method existed — never worse than that, and still better in practice, because the
     * section re-reads the disk before presenting anything and recovers from a lost race
     * (see `_rotateOrAdopt`).
     * @param {() => Promise<void>} critical
     * @returns {Promise<void>}
     */
    async _withRefreshLock(critical) {
        const locks = globalThis.navigator?.locks;
        if (!locks || typeof locks.request !== 'function') return critical();

        // Whether the critical section already started. Everything below hangs on it: a rejection
        // from a section that RAN carries the server's answer and must reach the caller untouched,
        // while one from a section that never ran is a lock failure and nothing more.
        let entered = false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REFRESH_LOCK_WAIT_MS);
        try {
            // The lock is released when this promise settles, rejection included.
            return await locks.request(REFRESH_LOCK_NAME, { signal: controller.signal }, () => {
                entered = true;
                return critical();
            });
        } catch (error) {
            // `entered` is what separates the two rejections that look alike. Not entered means
            // the LOCK failed and the critical section never ran, so nothing was presented to the
            // server and the session is intact — a transient client-side failure. Entered means
            // `_rotateOrAdopt` itself rejected, and it has already classified that failure (kept
            // or dropped the tokens, opened the cooldown); re-labelling it here would hide the
            // server's own answer, and an aborted fetch INSIDE the section would come out as
            // "gave up waiting", which it is not.
            if (!entered) {
                // GAVE UP WAITING, AND THAT IS NOT PERMISSION TO ROTATE ANYWAY. Running the
                // critical section unlocked here was a real hazard: the holder is still mid-flight
                // (the refresh request has no timeout), so the disk does not have its new pair yet,
                // and this tab would present the SAME refresh token. Two presentations more than
                // REFRESH_RACE_GRACE_MS apart are read as theft and revoke the whole family, taking
                // BOTH tabs down — the exact outcome this lock exists to prevent.
                //
                // So: adopt whatever landed while waiting, and otherwise fail TRANSIENTLY. Not
                // renewing is cheap (the access token usually still has headroom, and the next call
                // tries again); presenting a token twice is not.
                if (this._adoptStoredTokens(this._readStoredTokens())) return;
                if (error?.name === 'AbortError') {
                    throw new ApiError('Refresh lock busy', { code: 'REFRESH_LOCK_BUSY' });
                }
                // The lock manager refused outright (a `SecurityError` from a context it does not
                // consider secure, a `NotSupportedError`): the same "nothing happened" outcome,
                // and it must reach the caller as such. Raw, it escaped every classification in
                // this file — `isTerminalRefreshFailure` never sees it — so the REACTIVE path
                // (`_request`, on a 401) rejected with a DOM exception in place of the server's
                // own error, while the proactive path swallowed it. The original is kept as
                // `cause` because nothing else in the client records why the lock failed.
                const failed = new ApiError('Refresh lock unavailable', { code: 'REFRESH_LOCK_FAILED' });
                failed.cause = error;
                throw failed;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
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
        // A login or a successful rotation proves the server is answering: whatever transient
        // failure was holding refreshes back is over.
        this._clearRefreshCooldown();
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
     * Renews the access token if it is about to expire and returns the `Authorization` header
     * for a request this client will NOT be issuing itself.
     *
     * Exists for the 360 calibration READS (`js/calibration/api.js`), which need `AbortSignal`
     * and `cache: 'no-cache'` and therefore build their own `fetch`. Those routes are
     * `flexibleAuth`: an expired token there does NOT answer 401 — it is silently treated as
     * ANONYMOUS, and an anonymous caller cannot see a DISABLED project. So the failure mode is
     * a project that vanishes from the operator's list rather than an error, which is exactly
     * the kind of silent demotion `_ensureFreshAccessToken` was written for.
     *
     * Empty object when there is no session, so the caller stays anonymous-capable.
     * @returns {Promise<Object>} Headers to spread into a fetch init.
     */
    async authHeader() {
        await this._ensureFreshAccessToken();
        return this._accessToken ? { Authorization: `Bearer ${this._accessToken}` } : {};
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
        const stored = this._readStoredTokens();
        if (!stored) return false;
        this._accessToken = stored.accessToken || null;
        this._refreshToken = stored.refreshToken || null;
        return !!(this._accessToken || this._refreshToken);
    }

    /**
     * Whether a persisted session EXISTS, without loading it or contacting the server.
     *
     * For boot-time page routing only (`index.js#shouldRouteToProjects`): a signed-in visitor is
     * sent to the chooser page before any map is built, and that decision cannot wait on a round
     * trip. It answers "was someone signed in here", NOT "is the token still valid" — the
     * destination page validates and clears a dead token, which is what stops a redirect loop.
     * @returns {boolean}
     */
    hasStoredTokens() {
        const stored = this._readStoredTokens();
        return !!(stored?.accessToken || stored?.refreshToken);
    }

    // ===== CORE REQUEST =====

    /**
     * @private Renews the access token when it is expired or about to expire, so a request
     * is never SENT with a token the server will refuse. See {@link TOKEN_RENEWAL_SKEW_MS}
     * for why the reactive 401 path is not sufficient on its own.
     *
     * Never throws, in either outcome of a failed renewal. Terminal (401/403): `refresh()` has
     * already cleared the tokens and notified, and the request proceeds anonymous, which the
     * route answers with its own 401. Transient (429/5xx/network): the tokens are KEPT and the
     * request goes out with the current access token — which is only near expiry, not
     * necessarily expired, so it often still succeeds. Turning either into a throw here would
     * replace every caller's server error with a client-side one.
     * Concurrency is handled by `refresh()`, which is single-flight.
     * @returns {Promise<void>}
     */
    async _ensureFreshAccessToken() {
        if (this._renewalStoodDown) return;
        if (!this._accessToken || !this._refreshToken) return;
        const expiresAt = jwtExpiryMs(this._accessToken);
        // Unreadable expiry: do nothing rather than refresh on every request.
        if (expiresAt === null) return;
        if (expiresAt - Date.now() > TOKEN_RENEWAL_SKEW_MS) return;
        try {
            await this.refresh();
        } catch {
            // Either the session was terminally lost (refresh() cleared and notified) or the
            // failure was transient and the tokens were deliberately kept. Both proceed.
            return;
        }

        // A token JUST issued that still reads as expiring means this device's clock
        // disagrees with the server's by more than a token lifetime — the comparison
        // above is the only part of this client that trusts the local clock. Left
        // alone it would rotate the refresh family once per REQUEST, forever, and
        // never be throttled (`refreshLimiter` charges only failures). Standing down
        // returns the client to the reactive 401 path, which is exactly the behaviour
        // it had before this method existed, and the server is the one judging `exp`
        // either way. Not re-armed: a wrong clock does not fix itself mid-session.
        const renewed = jwtExpiryMs(this._accessToken);
        if (renewed !== null && renewed - Date.now() <= TOKEN_RENEWAL_SKEW_MS) {
            this._renewalStoodDown = true;
            console.warn('[ApiClient] relógio local diverge do servidor; renovação proativa desligada');
        }
    }

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
        // Renew BEFORE the header is built, or the request carries the stale token.
        // Guarded by `auth`, which is also what keeps this out of the recursion:
        // `refresh()` issues its own request with `auth: false`.
        if (auth) await this._ensureFreshAccessToken();

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
            // Two error envelopes reach this client. The atlas API sends
            // `{ error: { code, message } }`; sv360 sends a FLAT `{ error: '...' }`
            // (a deliberate divergence, see the sv360 contract). Three admin 360
            // routes go through this generic client, and reading `.message` off a
            // string yields undefined — which surfaced as "HTTP 404" in the admin
            // catalog tab instead of the server's actual message.
            const raw = parsed && typeof parsed === 'object' ? parsed.error : null;
            const err = typeof raw === 'string' ? { message: raw, code: undefined } : raw;
            // `details` (422) is kept on the error AND folded into the message: the top-level
            // message of a validation failure is the constant 'Validation failed', so the field
            // the server named lives nowhere else. See `buildApiErrorMessage`.
            throw new ApiError(buildApiErrorMessage(err, res.status), {
                status: res.status,
                code: err?.code,
                details: err?.details,
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
     * @private Unwraps the `{ data }` envelope. Bare frozen contracts (the `/nomes/busca`
     * array, the `/sv360/**` objects and arrays) have no `data` key and pass through
     * unchanged.
     *
     * `GET /api/config` is NOT one of them: the controller answers `res.json({ data })`
     * (`backend/src/modules/config/config.controller.js:10`), so the config arrives
     * enveloped and is unwrapped here like any standard route. This comment listed it as
     * a bare object until 2026-07-25. The mistake only shows OUTSIDE this class: a
     * consumer that fetches the route raw (a deploy health check, a script) reads
     * `cfg.basemaps` and gets `undefined`, with a 200 and no error anywhere.
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
     * Rotates tokens using the stored refresh token. Concurrent calls share one in-flight refresh
     * WITHIN this tab, and the critical section is serialized ACROSS tabs of the origin by
     * {@link REFRESH_LOCK_NAME} — the refresh token is single-use, so two tabs presenting the same
     * one is what the server reads as theft.
     *
     * A failure destroys the session ONLY when the server rejected the credential
     * (see {@link isTerminalRefreshFailure}). A 429, a 5xx or a dead network keeps the tokens
     * and merely rejects, so the next call tries again — a shared NAT egress hitting the
     * IP-keyed `refreshLimiter` must not log everyone out (and, down the chain, wipe their
     * unsynced local work through `clearAllDataStore`).
     *
     * @returns {Promise<void>}
     * @throws {ApiError} The server's own error, unchanged, terminal or not.
     */
    async refresh() {
        if (this._refreshing) return this._refreshing;
        if (!this._refreshToken) throw new ApiError('No refresh token', { code: 'NO_REFRESH_TOKEN' });
        // Keeping the tokens means the caller WILL come back — `sync-flush` alone retries every
        // 1.5 s. Hammering a limiter that only charges failures would turn one 429 into hundreds,
        // for every client behind the same address. Replay the failure instead of re-asking.
        // Checked BEFORE the lock, so an outage does not build a queue of tabs on it.
        //
        // What the cooldown throttles is the REQUEST, never the disk read, and reading first is
        // what keeps it from blinding this tab: a background tab is frozen by the browser and
        // drops the `storage` event, so a tab that took a 503 would otherwise spend up to 30 s
        // replaying a dead error with a GOOD pair, rotated by another tab, sitting on disk.
        // Adopting costs nothing and asks nobody. And when the adopted pair ALSO needs rotating,
        // going to the server is right rather than rude: the pair only exists because the server
        // just answered another tab, which is the proof that the outage is over (`_adoptStoredTokens`
        // clears the cooldown for the same reason).
        const cooldownError = this._lastTransientRefreshError;
        if (cooldownError && Date.now() < this._refreshCooldownUntil) {
            if (!this._adoptStoredTokens(this._readStoredTokens())) throw cooldownError;
            if (this._accessTokenOutlivesSkew()) return;
        }

        this._refreshing = this._withRefreshLock(() => this._rotateOrAdopt())
            .finally(() => {
                this._refreshing = null;
            });
        return this._refreshing;
    }

    /**
     * @private The critical section of {@link refresh}: adopt what another tab already rotated, or
     * rotate. Runs under the cross-tab lock when there is one.
     *
     * Reading the disk HERE, and not before waiting for the lock, is the whole point: whoever held
     * the lock wrote a new pair while this tab waited, so the pair in memory is stale and
     * presenting it would be a reuse. localStorage stays the single source of truth; what changed
     * is who reads it, when, and under which exclusion.
     * @returns {Promise<void>}
     */
    async _rotateOrAdopt() {
        // Already renewed by another tab, and still usable: nothing to ask the server.
        if (this._adoptStoredTokens(this._readStoredTokens()) && this._accessTokenOutlivesSkew()) return;
        // The adoption above may have replaced the pair; either way, rotate the NEWEST one known.
        if (!this._refreshToken) throw new ApiError('No refresh token', { code: 'NO_REFRESH_TOKEN' });

        // The token actually PRESENTED to the server, captured before the round trip. On a 401 it
        // is the only thing that answers the question that matters, and asking the disk instead is
        // what made this path log the user out of a live session: see the comment below.
        const presented = this._refreshToken;

        try {
            const data = await this._request('POST', '/auth/refresh', {
                body: { refreshToken: presented },
                auth: false,
                _retry: false,
            });
            // `setTokens` also re-arms the auth-lost notification and the refresh cooldown, and
            // persists — which is what tells the other tabs, through the `storage` event.
            this.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        } catch (error) {
            if (isTerminalRefreshFailure(error)) {
                // A 401 is not always a dead credential. Without the cross-tab lock (insecure
                // context, old browser) another tab can rotate between this tab's read and its
                // request, and the server answers the loser 401 without revoking the family
                // (REFRESH_RACE_GRACE_MS). This tab simply lost the race, and the session is alive.
                //
                // THE QUESTION IS "IS THE TOKEN I PRESENTED STILL THE ONE I HOLD", NOT "DOES THE
                // DISK HAVE SOMETHING NEWER". Asking the disk was a real logout bug: the `storage`
                // event is local and synchronous while the 401 arrives over the network, so the
                // listener had usually adopted the winner's pair ALREADY. `_adoptStoredTokens`
                // then refuses an identical pair, returns false, and this branch killed a live
                // session — and worse, `clearTokens()` wipes localStorage, so the loser also
                // deleted the pair the winner had just rotated. Measured in a real browser: a tab
                // died in 3 of 5 forced-race trials.
                if (this._refreshToken && this._refreshToken !== presented) {
                    this._clearRefreshCooldown();
                    return;
                }
                // Nothing adopted it in the meantime; the disk is the last place to look.
                if (this._adoptStoredTokens(this._readStoredTokens())) {
                    this._clearRefreshCooldown();
                    return;
                }
                // The refresh token is gone/expired (or the org was deactivated): the session
                // is terminally lost. Drop the dead tokens and notify (handler wired post-boot
                // — at boot this falls to anonymous).
                this._clearRefreshCooldown();
                this.clearTokens();
                this._notifyAuthLost();
            } else {
                // Transient: the tokens are still the best credential this client has, and the
                // current access token may well outlive the outage.
                this._lastTransientRefreshError = error;
                this._refreshCooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
            }
            throw error;
        }
    }

    /** @private Re-arms refreshing after a decisive answer (success or terminal failure). */
    _clearRefreshCooldown() {
        this._refreshCooldownUntil = 0;
        this._lastTransientRefreshError = null;
    }

    /**
     * Registers a new user (self-registration; gated server-side).
     *
     * Resolving does NOT mean an account was created: the endpoint answers the same 201 and the
     * same `{ success: true }` whether it created one or found the username/e-mail already taken,
     * so that it cannot be used to enumerate accounts. Whichever happened is told by e-mail. Do not
     * reintroduce a caller that reports "conta criada" on resolve.
     * @param {{ username: string, password: string, nome: string, [k: string]: * }} payload
     * @returns {Promise<{ success: true }>} No account data, by design.
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
     * Fetches the runtime config. The frozen part of `GET /api/config` is the top-level
     * SHAPE of the config object (guarded by `frontend/tests/e2e/config-contract.e2e.test.js`),
     * NOT the transport: the route answers the standard `{ data }` envelope and `_unwrap`
     * strips it. Calling it "bare" here was wrong and cost a wrong assumption downstream.
     * @returns {Promise<Object>} The config object (already unwrapped).
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
     * Maps a catalog `category` (frontend key) to its dedicated REST collection — each resource type
     * is now its own table/route (no generic `/resources`).
     * @param {string} category
     * @returns {string}
     */
    _catalogEndpoint(category) {
        const ep = {
            basemap: 'basemaps',
            data_layer: 'data-layers',
            analysis_layer: 'analysis-layers',
            tileset: 'tilesets',
            streetview_marker: 'streetview-markers',
        }[category];
        if (!ep) throw new Error(`Unknown catalog category: ${category}`);
        return ep;
    }

    /**
     * Lists catalog items of one type.
     * @param {string} category - 'basemap'|'data_layer'|'analysis_layer'|'tileset'|'streetview_marker'
     * @returns {Promise<Array<Object>>}
     */
    async listResources(category) {
        return this._request('GET', `/${this._catalogEndpoint(category)}`);
    }

    /**
     * Creates a catalog item (metadata) in its type's table.
     * @param {string} category
     * @param {{ id: string, name: string, description?: string, config?: Object, sort_order?: number }} payload
     * @returns {Promise<Object>}
     */
    async createResource(category, payload) {
        return this._request('POST', `/${this._catalogEndpoint(category)}`, { body: payload });
    }

    /**
     * Updates a catalog item (partial metadata).
     * @param {string} category
     * @param {string} id
     * @param {{ name?: string, description?: string, config?: Object, sort_order?: number }} payload
     * @returns {Promise<Object>}
     */
    async updateResource(category, id, payload) {
        return this._request('PUT', `/${this._catalogEndpoint(category)}/${encodeURIComponent(id)}`, { body: payload });
    }

    /**
     * Soft-deletes a catalog item.
     * @param {string} category
     * @param {string} id
     * @returns {Promise<null>}
     */
    async deleteResource(category, id) {
        return this._request('DELETE', `/${this._catalogEndpoint(category)}/${encodeURIComponent(id)}`);
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
     *
     * A slug is unique per ORGANIZATION, not globally: a global admin listing every organization
     * can see the same slug twice, and the backend answers an unqualified write with "ambiguous
     * slug". `orgId` is what disambiguates it, and the admin catalog tab already sends the row's
     * `organization_id` — it was silently discarded here, which made those writes unusable.
     *
     * @param {string} slug
     * @param {'enabled'|'disabled'} status
     * @param {{orgId?: string}} [options]
     * @returns {Promise<Object>}
     */
    async setSv360ProjectStatus(slug, status, { orgId } = {}) {
        const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
        return this._request('PATCH', `/sv360/admin/projects/${encodeURIComponent(slug)}/status${qs}`, { body: { status } });
    }

    /**
     * Deletes a 360 project. See `setSv360ProjectStatus` for why `orgId` matters.
     *
     * @param {string} slug
     * @param {{orgId?: string}} [options]
     * @returns {Promise<null>}
     */
    async deleteSv360Project(slug, { orgId } = {}) {
        const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
        return this._request('DELETE', `/sv360/admin/projects/${encodeURIComponent(slug)}${qs}`);
    }

    // ===== CALIBRAÇÃO 360 — ESCRITAS (calibracao.html) =====
    //
    // Todas as ESCRITAS da página de calibração passam por aqui, e por um motivo só: este é o
    // único lugar do cliente que renova o access token ANTES de usá-lo (`_ensureFreshAccessToken`)
    // e que reage a um 401 com refresh + retry transparente. As LEITURAS da calibração não estão
    // aqui — elas são anônimas por contrato (`flexibleAuth`) e precisam de AbortSignal e de
    // `cache: 'no-cache'`, que `_request` não oferece; ficam em `js/calibration/api.js`.
    //
    // O `_request` também é o que traduz o envelope PLANO `{ error: '...' }` do sv360 num
    // `ApiError` com `.status`, que é como a página distingue 401 (sessão morreu) de 403 (não é
    // admin). A origem no ebgeo_360 não tinha autenticação nenhuma nestas rotas.

    /**
     * Grava o mesh_rotation_y de uma foto.
     * @param {string} photoId - UUID da foto.
     * @param {number} meshRotationY - Ângulo em graus.
     * @returns {Promise<Object>}
     */
    async setSv360Calibration(photoId, meshRotationY) {
        return this._request('PUT', `/sv360/photos/${encodeURIComponent(photoId)}/calibration`, {
            body: { mesh_rotation_y: meshRotationY },
        });
    }

    /**
     * Grava o mesh_rotation_x de uma foto.
     * @param {string} photoId - UUID da foto.
     * @param {number} meshRotationX - Ângulo em graus.
     * @returns {Promise<Object>}
     */
    async setSv360RotationX(photoId, meshRotationX) {
        return this._request('PUT', `/sv360/photos/${encodeURIComponent(photoId)}/rotation-x`, {
            body: { mesh_rotation_x: meshRotationX },
        });
    }

    /**
     * Grava o mesh_rotation_z de uma foto.
     * @param {string} photoId - UUID da foto.
     * @param {number} meshRotationZ - Ângulo em graus.
     * @returns {Promise<Object>}
     */
    async setSv360RotationZ(photoId, meshRotationZ) {
        return this._request('PUT', `/sv360/photos/${encodeURIComponent(photoId)}/rotation-z`, {
            body: { mesh_rotation_z: meshRotationZ },
        });
    }

    /**
     * Marca ou desmarca uma foto como revisada.
     *
     * O corpo é `{ calibration_reviewed }`, e NÃO o `{ reviewed }` que a origem enviava:
     * `reviewedBodySchema` daqui recusa chave desconhecida (`.unknown(false)`), então o nome da
     * origem devolveria 422 em vez de gravar.
     * @param {string} photoId - UUID da foto.
     * @param {boolean} reviewed
     * @returns {Promise<Object>}
     */
    async setSv360Reviewed(photoId, reviewed) {
        return this._request('PUT', `/sv360/photos/${encodeURIComponent(photoId)}/reviewed`, {
            body: { calibration_reviewed: reviewed },
        });
    }

    /**
     * Oculta ou reexibe uma ligação entre duas fotos.
     *
     * A rota daqui é `/photos/:uuid/targets/:targetId/visibility`; a da origem era
     * `/targets/:sourceId/:targetId/visibility`, sem o prefixo da foto de origem.
     * @param {string} photoId - UUID da foto de origem.
     * @param {string} targetId - UUID da foto de destino.
     * @param {boolean} hidden
     * @returns {Promise<Object>}
     */
    async setSv360TargetVisibility(photoId, targetId, hidden) {
        const path = `/sv360/photos/${encodeURIComponent(photoId)}/targets/${encodeURIComponent(targetId)}/visibility`;
        return this._request('PUT', path, { body: { hidden } });
    }

    /**
     * Cria uma ligação manual entre duas fotos.
     *
     * A rota daqui é `POST /photos/:uuid/targets` com `{ target_id }` no corpo; a da origem era
     * `POST /targets` com `{ source_id, target_id }`.
     * @param {string} photoId - UUID da foto de origem.
     * @param {string} targetId - UUID da foto de destino.
     * @returns {Promise<Object>}
     */
    async createSv360Target(photoId, targetId) {
        return this._request('POST', `/sv360/photos/${encodeURIComponent(photoId)}/targets`, {
            body: { target_id: targetId },
        });
    }

    /**
     * Remove uma ligação manual entre duas fotos.
     * @param {string} photoId - UUID da foto de origem.
     * @param {string} targetId - UUID da foto de destino.
     * @returns {Promise<Object>}
     */
    async deleteSv360Target(photoId, targetId) {
        const path = `/sv360/photos/${encodeURIComponent(photoId)}/targets/${encodeURIComponent(targetId)}`;
        return this._request('DELETE', path);
    }

    /**
     * Exclui uma foto (tombstone: sai da navegação, o dado fica).
     * @param {string} photoId - UUID da foto.
     * @returns {Promise<Object>}
     */
    async deleteSv360Photo(photoId) {
        return this._request('DELETE', `/sv360/photos/${encodeURIComponent(photoId)}`);
    }

    /**
     * Aplica ângulos padrão a todas as fotos vivas de um projeto.
     * @param {string} slug - Slug do projeto.
     * @param {Object} values - Campos mesh_rotation_y/x/z a aplicar.
     * @returns {Promise<Object>}
     */
    async batchSv360Project(slug, values) {
        return this._request('PUT', `/sv360/projects/${encodeURIComponent(slug)}/batch-calibration`, {
            body: values,
        });
    }

    /**
     * Limpa a marca de revisão de todas as fotos vivas de um projeto.
     * @param {string} slug - Slug do projeto.
     * @returns {Promise<Object>}
     */
    async resetSv360ProjectReviewed(slug) {
        return this._request('POST', `/sv360/projects/${encodeURIComponent(slug)}/reset-reviewed`);
    }

    /**
     * Aplica ângulos padrão a todas as fotos vivas de uma faixa de coleta.
     * @param {string} runId - UUID da faixa.
     * @param {Object} values - Campos mesh_rotation_y/x/z a aplicar.
     * @returns {Promise<Object>}
     */
    async batchSv360Run(runId, values) {
        return this._request('PUT', `/sv360/runs/${encodeURIComponent(runId)}/batch-calibration`, {
            body: values,
        });
    }

    // ===== ATLAS =====

    /** @returns {Promise<Object[]>} Atlases visible to the current user. */
    async listAtlas() {
        return this._request('GET', '/atlas');
    }

    /**
     * Everything the PROJECT CARDS draw beyond the plain listing: who takes part in each atlas,
     * the covers, and who is connected right now.
     *
     * Separate from {@link listAtlas} on purpose — that one is on the boot path of the map's
     * account control, the Maps tab and the atlas-name control, none of which draw any of this.
     *
     * @returns {Promise<{atlases: Object[], covers: Object<string,string>,
     *   presence: Object<string, Object[]>}>}
     */
    async getAtlasOverview() {
        return this._request('GET', '/atlas/overview');
    }

    /**
     * Who is connected to each of the caller's atlases, right now. The light half of
     * {@link getAtlasOverview}, for periodic refresh: it is the only one of the three that changes
     * on its own, and repeating the covers every cycle would send hundreds of kB to learn that
     * nobody joined.
     * @returns {Promise<Object<string, Array<{id: string, nome: string, status: string}>>>}
     */
    async getAtlasPresence() {
        return this._request('GET', '/atlas/presence');
    }

    /**
     * Sets the atlas cover (the image that replaces the coloured initials on its card).
     * @param {string} atlasId
     * @param {{image: string, width?: number, height?: number}} payload - `image` is a base64
     *   data URI of a png/jpeg/webp; the server re-checks the bytes against the declared type.
     * @returns {Promise<Object>} The stored cover's metadata (never the bytes).
     */
    async setAtlasCover(atlasId, payload) {
        return this._request('PUT', `/atlas/${atlasId}/cover`, { body: payload });
    }

    /**
     * Removes the atlas cover. Idempotent — removing an absent cover succeeds.
     * @param {string} atlasId
     * @returns {Promise<null>}
     */
    async deleteAtlasCover(atlasId) {
        return this._request('DELETE', `/atlas/${atlasId}/cover`);
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
     *
     * The server merge is SHALLOW, not deep (`settings || $2::jsonb`,
     * `backend/src/modules/atlas/atlas.queries.js:91`); this JSDoc claimed "deep-merged"
     * until 2026-07-25. Send the COMPLETE nested object: a `features` payload missing a
     * key re-enables that capability for the whole atlas, because the overlay is
     * default-open (`intersectAvailability` reads `features.X !== false`). The built-in
     * atlas-settings modal always rebuilds all five feature keys before saving, which is
     * why this never bit in-app; a hand-rolled client is what bites.
     *
     * @param {string} atlasId
     * @param {Object} settings - Full settings sections to overwrite (shallow merge, top level only).
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
     *
     * Gated at `manage` server-side (`backend/src/modules/sharing/sharing.routes.js`), NOT
     * owner-only: a co-Gestor administers sharing too. And a share carries any of the FOUR
     * grantable levels — this said `'read'|'write'`, the closed list the constitution forbids,
     * which is how a client written from it silently loses `comment` and `manage`.
     * @param {string} atlasId
     * @returns {Promise<{ isPublic: boolean, publicLink: string|null, shares: Array<{ userId: string, username: string, nome: string, permission: 'read'|'comment'|'write'|'manage', addedAt: string }> }>}
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

    // ===== RECURSOS PRIVADOS (acesso a recurso do catálogo) =====
    //
    // Eixo distinto do de atlas: aqui a pergunta é "quem vê ESTE recurso", e não
    // "quem mexe NESTE atlas". `/api/config` continua sendo o documento PÚBLICO,
    // igual para todo chamador; o que a pessoa ganha por concessão chega por
    // `getVisibleResources` e o cliente SOMA.

    /**
     * Os recursos PRIVADOS que este usuário enxerga (o payload ADITIVO).
     *
     * `atlasId` é opcional e MUDA a resposta: com ele entram também os recursos
     * que o atlas em foco empresta. Sem ele, só papel global e concessão pessoal.
     * @param {string|null} [atlasId]
     * @returns {Promise<{tilesets: Array, dataLayers: Array, analysisLayers: Array, views360: Array}>}
     */
    async getVisibleResources(atlasId = null) {
        const qs = atlasId ? `?atlasId=${encodeURIComponent(atlasId)}` : '';
        return this._request('GET', `/resource-access/visible${qs}`);
    }

    /**
     * Quem tem acesso a um recurso privado (exige `view_share` ou papel global).
     * @param {string} type - tileset | data_layer | analysis_layer | sv360_project
     * @param {string} id
     * @returns {Promise<Array>}
     */
    async listResourceGrants(type, id) {
        return this._request('GET', `/resource-access/${type}/${encodeURIComponent(id)}/grants`);
    }

    /**
     * Concede acesso a um recurso privado.
     * @param {string} type @param {string} id
     * @param {{granteeId: string, grantLevel: 'view'|'view_share'}} payload
     */
    async grantResource(type, id, payload) {
        return this._request('POST', `/resource-access/${type}/${encodeURIComponent(id)}/grants`, { body: payload });
    }

    /**
     * Revoga uma concessão E TODA a subárvore que dela deriva.
     * A resposta traz a lista dos derrubados, que é o que a UI mostra para
     * confirmar o alcance da poda.
     * @param {string} grantId
     * @returns {Promise<{revoked: Array}>}
     */
    async revokeResourceGrant(grantId) {
        return this._request('DELETE', `/resource-access/grants/${encodeURIComponent(grantId)}`);
    }

    /**
     * Marca um recurso como público ou privado (só administrador).
     * @param {string} type @param {string} id
     * @param {'public'|'private'} accessLevel
     */
    async setResourceVisibility(type, id, accessLevel) {
        return this._request('PATCH', `/resource-access/${type}/${encodeURIComponent(id)}/visibility`, {
            body: { accessLevel },
        });
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
     * Creates a user (admin-only). Payload per the backend `createUserAdminSchema`
     * (`backend/src/modules/users/users.schemas.js`).
     *
     * Rank and organization travel as the UUIDs `rank_id`/`organization_id`, not as the
     * display names `posto_graduacao`/`organizacao_militar` — those are read-only aliases the
     * SEARCH/LIST queries join in, and they are exactly what this block claimed to send until
     * 2026-08-13. The mistake had no status and no log to find it by: `validate` runs with
     * `stripUnknown: true`, so a caller written from the old text lost both fields and got a
     * 200. `org_role` is the role WITHIN the organization, distinct from the global `role`.
     * @param {{ username: string, password: string, nome: string, rank_id?: string|null,
     *   organization_id?: string|null, role?: 'user'|'admin',
     *   org_role?: 'owner'|'admin'|'editor'|'viewer' }} payload
     * @returns {Promise<Object>} The created user.
     */
    async createUser(payload) {
        return this._request('POST', '/users', { body: payload });
    }

    /**
     * Updates a user (admin-only). Partial payload per the backend `updateUserAdminSchema`.
     * See `createUser` on why rank/organization are UUID fields here.
     * @param {string} userId
     * @param {{ username?: string, nome?: string, rank_id?: string|null,
     *   organization_id?: string|null, role?: 'user'|'admin', is_active?: boolean,
     *   email_verified?: boolean, org_role?: 'owner'|'admin'|'editor'|'viewer' }} payload
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
        // This method builds its own request and therefore has NO 401 refresh+retry:
        // renewing up front is the only thing standing between an expired session and a
        // lost upload.
        await this._ensureFreshAccessToken();

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
            // Same envelope reading as `_request` (this path builds its own request), so a
            // validation failure names the field here too.
            throw new ApiError(buildApiErrorMessage(err, res.status), {
                status: res.status,
                code: err?.code,
                details: err?.details,
            });
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
