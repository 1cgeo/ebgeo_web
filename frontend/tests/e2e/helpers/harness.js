// Path: tests/e2e/helpers/harness.js

/**
 * @fileoverview Shared helpers for the E2E suite. Every E2E test builds its OWN
 * ApiClient / WsClient / user / atlas through these helpers so tests stay isolated
 * across the single shared backend brought up by `global-setup.js`.
 *
 * Node 24 provides global `WebSocket` and `fetch`, so the WS socket factory and
 * the HTTP transport need no polyfills.
 */

import { ApiClient } from '../../../src/js/store/sync/api-client.js';
import { WsClient } from '../../../src/js/store/sync/ws-client.js';
import { ConnectionState } from '../../../src/js/store/sync/connection-state.js';
import { createOperation } from '../../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../../src/js/utilities/uuid.js';
import { setTracing, clearTrace, getTrace } from '../../../src/js/store/sync/diag/trace-core.js';
import { pendingVerificationToken } from './db.js';

/** True when prerequisites were missing in global-setup; tests describe.skipIf this. */
export const E2E_SKIP = process.env.EBGEO_E2E_SKIP === '1';

/**
 * Origin of the running backend (e.g. 'http://127.0.0.1:3911'), set by globalSetup.
 * @returns {string}
 */
export function getBaseUrl() {
    return process.env.EBGEO_E2E_BASE_URL;
}

/**
 * Builds an ApiClient pointed at the live backend's `/api/v1` base.
 * @returns {ApiClient}
 */
export function makeApi() {
    return new ApiClient({ baseUrl: `${getBaseUrl()}/api/v1` });
}

/**
 * Registers a brand-new user (unique username), confirms the e-mail, and logs in,
 * storing tokens on `api`.
 *
 * THREE calls, not two, and the middle one is not optional: `registerSchema` requires
 * `email`, so the account is created PENDING and `login` answers 401 EMAIL_NOT_VERIFIED
 * until the `?verify=` link is followed. Since there is no SMTP relay here, the token is
 * read straight out of `email_verification_tokens` (`helpers/db.js`) and then spent
 * through the PUBLIC route `POST /auth/verify-email` — the real path, so the route stays
 * exercised by every spec in this leg instead of being bypassed by writing
 * `email_verified` by hand.
 *
 * @param {ApiClient} api
 * @param {Object} [opts]
 * @param {string} [opts.nome='Test User']
 * @returns {Promise<{ user: Object, username: string, password: string, email: string }>}
 */
export async function registerAndLogin(api, { nome = 'Test User' } = {}) {
    const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
    const password = 'Sup3r-Secret-Pw!';
    const email = `${username}@example.mil`;
    await api.register({ username, password, nome, email });
    await api.verifyEmail(await pendingVerificationToken(username));
    const user = await api.login(username, password);
    return { user, username, password, email };
}

/**
 * Creates an atlas via the live backend.
 * @param {ApiClient} api
 * @param {Object} [opts]
 * @param {string} [opts.name='E2E Atlas']
 * @returns {Promise<Object>} The created atlas.
 */
export async function createAtlas(api, { name = 'E2E Atlas' } = {}) {
    return api.createAtlas({ name });
}

/**
 * Creates a map inside an atlas by pushing a CRDT 'map' create op (maps have no
 * REST write route — they travel as sync operations).
 * @param {ApiClient} api
 * @param {string} atlasId
 * @param {Object} [opts]
 * @param {string} [opts.name='Mapa 1']
 * @returns {Promise<string>} The new map id.
 */
export async function createMap(api, atlasId, { name = 'Mapa 1' } = {}) {
    const mapId = generateUUID();
    const op = createOperation('map', 'create', mapId, null, { name });
    await api.pushOperations(atlasId, [op]);
    return mapId;
}

/**
 * Generates a fresh stable client id (presence / op idempotency).
 * @returns {string}
 */
export function newClientId() {
    return generateUUID();
}

/**
 * Builds a WsClient bound to its own ConnectionState and the global WebSocket.
 * @param {ApiClient} api
 * @param {Object} opts
 * @param {string} opts.clientId
 * @returns {WsClient}
 */
export function makeWs(api, { clientId }) {
    return new WsClient({
        apiClient: api,
        connectionState: new ConnectionState(),
        socketFactory: (url) => new globalThis.WebSocket(url),
        clientId,
        heartbeatMs: 1e7,
    });
}

/**
 * Enables the SyncLedger tracer for this Node process and clears the in-process ring.
 * The WsClient records ws.inbound / push.ack / conn.transition spans into it, so a
 * transport-level e2e test can read the client side of the ledger.
 * @returns {void}
 */
export function enableClientTrace() {
    clearTrace();
    setTracing(true);
}

/**
 * Reads the in-process client ring (optionally filtered).
 * @param {(span: Object) => boolean} [filter]
 * @returns {Object[]}
 */
export function getClientTrace(filter) {
    return getTrace(filter);
}

/**
 * Fetches the server-side SyncLedger spans for an atlas from the env-gated
 * `GET /api/v1/debug/trace` endpoint (mounted only under NODE_ENV=test / EBGEO_TRACE).
 * @param {ApiClient} api - An authenticated client (its token authorizes the read).
 * @param {string} atlasId
 * @param {{ opId?: string, traceId?: string }} [query]
 * @returns {Promise<Object[]>}
 */
export async function getServerTrace(api, atlasId, query = {}) {
    const params = new URLSearchParams({ atlasId, ...query });
    const res = await fetch(`${getBaseUrl()}/api/v1/debug/trace?${params.toString()}`, {
        headers: { Authorization: `Bearer ${api.getAccessToken()}` },
    });
    if (!res.ok) return [];
    const body = await res.json();
    return body?.data?.spans || [];
}

/**
 * Polls `predicate` until it returns truthy or the timeout elapses.
 * @param {() => (boolean|Promise<boolean>)} predicate
 * @param {Object} [opts]
 * @param {number} [opts.timeout=4000]
 * @param {number} [opts.interval=20]
 * @returns {Promise<*>} The truthy value the predicate resolved to.
 * @throws {Error} If the timeout elapses first.
 */
export async function waitFor(predicate, { timeout = 4000, interval = 20 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = await predicate();
        if (value) return value;
        if (Date.now() >= deadline) {
            throw new Error('waitFor: timed out');
        }
        await new Promise((r) => setTimeout(r, interval));
    }
}
