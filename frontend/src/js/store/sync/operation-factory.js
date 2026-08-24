// Path: js/store/sync/operation-factory.js

/**
 * @fileoverview Factory for creating sync operations.
 * Provides standardized operation creation for the sync system.
 */

import { generateUUID } from '../../utilities/uuid.js';
import { addDomListener, cleanup, setupCleanup, trackTimer } from '@utils/event-cleanup.js';
import { StoreScopeKind, getActiveScope, remoteAtlasIdFromDbSuffix } from '@store/atlas-namespace.js';
import { isValidEntityType, isValidOperationType } from './operation-types.js';
import { noteLocalEdit } from './overwrite-notice.js';

// ===== CLIENT IDENTITY =====

/**
 * The client id has TWO parts, `<installation>_<tab>`, because the two halves answer different
 * questions and have different lifetimes:
 *
 * - INSTALLATION (`localStorage`, one per browser profile). What makes presence, the server's
 *   120 s `away` grace and the self-echo de-dup survive a reload and a reconnect. Never rotated.
 * - TAB (`sessionStorage`, one per tab, kept across F5 within that tab). What keeps two tabs from
 *   collapsing into one presence entry and one `away` slot on the server.
 *
 * The composite is what the server sees, so it MUST satisfy the server's `CLIENT_ID_RE`
 * (`backend/src/modules/collab/collab.gateway.js`). A malformed id is not refused there: the
 * gateway quietly mints its own and the tab is left stamping ops with an id the room does not
 * know, which kills the self-echo filter without a single error anywhere. Hence
 * {@link isValidClientId}, applied to the composite before it is ever handed out.
 *
 * The inbound self-echo filter compares INSTALLATIONS, not whole ids (see
 * {@link clientIdInstallation} and its call site in `ws-client.js`), and that is load-bearing in
 * two places: an operation queued before a reload still carries the PREVIOUS tab suffix, and one
 * written by an older build carries no suffix at all. Filtering by exact id would make the tab
 * re-apply its own work in both cases.
 *
 * That is sound only because one browser never has two tabs in the SAME atlas: the tab lock
 * forbids it, and an operation only reaches a tab through its atlas room.
 */
const INSTALLATION_STORAGE_KEY = 'ebgeo_client_id';
const TAB_STORAGE_KEY = 'ebgeo_tab_id';
const TAB_CLAIMS_STORAGE_KEY = 'ebgeo_tab_claims';
const CLIENT_ID_SEPARATOR = '_';
const TAB_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TAB_SUFFIX_LENGTH = 12;

/**
 * How recently another document must have touched a tab claim for it to count as LIVE.
 *
 * Generous on purpose, and the asymmetry is deliberate. Reading a live claim as stale is the
 * failure this whole mechanism exists to prevent (two live tabs sharing one id); reading a dead
 * claim as live only costs a fresh suffix, i.e. one extra presence entry, and the self-echo filter
 * does not even notice because it matches on the installation. Background tabs get their timers
 * throttled to about one per minute, so the window has to clear that by a wide margin.
 */
const TAB_CLAIM_FRESH_MS = 5 * 60 * 1000;
const TAB_CLAIM_HEARTBEAT_MS = 15 * 1000;

/** MIRROR of `CLIENT_ID_RE` in `backend/src/modules/collab/collab.gateway.js`. */
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * A tab suffix carries no separator (so the installation half stays recoverable) and is short
 * enough that a 36-char UUID plus separator plus suffix still fits the server's 64.
 */
const TAB_SUFFIX_PATTERN = /^[a-zA-Z0-9-]{4,27}$/;

/**
 * Full client id for THIS tab, memoized for the module's lifetime.
 * Resolved synchronously on first read: `ws-client.js` captures it while its module loads.
 * @type {string|null}
 */
let clientId = null;

/** Tracks the heartbeat timer and the page listeners that keep the tab claim honest. */
const tabClaimLifecycle = {};

/**
 * Returns the ambient `localStorage` when available, or `null` outside the
 * browser (Node/SSR/test runners). Guards against environments where the global
 * is undefined or throws on access (e.g. disabled storage in privacy mode).
 * @returns {Storage|null} The storage object, or null when unavailable.
 */
function safeLocalStorage() {
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        // Accessing localStorage can throw (sandboxed iframes, disabled storage).
    }
    return null;
}

/**
 * Returns the ambient `sessionStorage`, or `null` where it is unavailable. Without it the tab
 * suffix is in-memory only, so every reload looks like a NEW client: presence duplicates and the
 * ops queued before the reload stop matching. That is the documented degraded path, not the
 * normal one.
 * @returns {Storage|null}
 */
function safeSessionStorage() {
    try {
        if (typeof sessionStorage !== 'undefined') return sessionStorage;
    } catch {
        // Same hazards as localStorage (sandboxed iframe, storage disabled).
    }
    return null;
}

/**
 * Whether an id is acceptable to the server's collab gateway.
 * @param {string} id
 * @returns {boolean}
 */
export function isValidClientId(id) {
    return typeof id === 'string' && CLIENT_ID_PATTERN.test(id);
}

/** @returns {string} A fresh tab suffix, in the server's alphabet. */
function mintTabSuffix() {
    const bytes = crypto.getRandomValues(new Uint8Array(TAB_SUFFIX_LENGTH));
    let out = '';
    for (const byte of bytes) out += TAB_SUFFIX_ALPHABET[byte % TAB_SUFFIX_ALPHABET.length];
    return out;
}

/**
 * @private Reads the tab-claim registry: suffix → epoch ms of its last heartbeat.
 * @param {Storage} store
 * @returns {Object<string, number>}
 */
function readTabClaims(store) {
    try {
        const parsed = JSON.parse(store.getItem(TAB_CLAIMS_STORAGE_KEY) || 'null');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * @private Writes the registry back, dropping entries no document could still own.
 * @param {Storage} store
 * @param {Object<string, number>} claims
 */
function writeTabClaims(store, claims) {
    const now = Date.now();
    for (const [suffix, seen] of Object.entries(claims)) {
        if (!Number.isFinite(seen) || now - seen > TAB_CLAIM_FRESH_MS * 2) delete claims[suffix];
    }
    try {
        store.setItem(TAB_CLAIMS_STORAGE_KEY, JSON.stringify(claims));
    } catch {
        // Quota or disabled storage: the claim is best-effort, the id is not.
    }
}

/** @private Renews this tab's claim, so other documents keep seeing it as alive. */
function touchTabClaim(suffix) {
    const store = safeLocalStorage();
    if (!store) return;
    const claims = readTabClaims(store);
    claims[suffix] = Date.now();
    writeTabClaims(store, claims);
}

/**
 * @private Drops this tab's claim, so the SAME tab reloading takes its suffix back.
 *
 * This is what separates a reload from a duplication, and there is no other signal that does:
 * both documents start with a copy of the same `sessionStorage`. On a reload `pagehide` fires
 * first and frees the claim; on a duplication the original keeps beating and the copy sees a live
 * claim. When `pagehide` never fires (a crash, a kill) the claim is left behind and the tab comes
 * back with a new suffix, which is the harmless direction.
 */
function releaseTabClaim(suffix) {
    const store = safeLocalStorage();
    if (!store) return;
    const claims = readTabClaims(store);
    delete claims[suffix];
    writeTabClaims(store, claims);
}

/**
 * @private Keeps the claim alive while this document is, and releases it on the way out.
 * Registers nothing outside a real document (Node, worker), where there is no second tab anyway.
 */
function startTabClaimUpkeep(suffix) {
    const view = globalThis.window;
    if (!view || typeof view.addEventListener !== 'function') return;
    setupCleanup(tabClaimLifecycle);
    trackTimer(tabClaimLifecycle, setInterval(() => touchTabClaim(suffix), TAB_CLAIM_HEARTBEAT_MS), 'interval');
    addDomListener(tabClaimLifecycle, view, 'pagehide', () => releaseTabClaim(suffix));
    // Back from the bfcache: this document is live again and takes its claim back.
    addDomListener(tabClaimLifecycle, view, 'pageshow', () => touchTabClaim(suffix));
}

/**
 * @private Resolves the suffix identifying THIS tab, minting a new one when the one inherited
 * from `sessionStorage` belongs to a tab that is still open (a duplicated tab, a `window.open`
 * with an opener, a reopened tab, a restored session: all four copy `sessionStorage` wholesale).
 * @returns {string}
 */
function resolveTabSuffix() {
    const session = safeSessionStorage();
    const local = safeLocalStorage();

    let suffix = null;
    try {
        suffix = session?.getItem(TAB_STORAGE_KEY) || null;
    } catch {
        suffix = null;
    }
    if (suffix && !TAB_SUFFIX_PATTERN.test(suffix)) suffix = null;

    if (suffix && local) {
        const lastSeen = readTabClaims(local)[suffix];
        // A claim still being renewed means another document is using this suffix right now.
        if (Number.isFinite(lastSeen) && Date.now() - lastSeen < TAB_CLAIM_FRESH_MS) suffix = null;
    }

    if (!suffix) {
        suffix = mintTabSuffix();
        try {
            session?.setItem(TAB_STORAGE_KEY, suffix);
        } catch {
            // In-memory for this load only (see safeSessionStorage).
        }
    }

    touchTabClaim(suffix);
    startTabClaimUpkeep(suffix);
    return suffix;
}

/**
 * @private Resolves the per-browser half of the id, minting one when it is missing or when the
 * stored value cannot yield a composite the server would accept.
 * @returns {string}
 */
function resolveInstallationId(suffixLength) {
    const store = safeLocalStorage();
    let installation = null;
    try {
        installation = store?.getItem(INSTALLATION_STORAGE_KEY) || null;
    } catch {
        installation = null;
    }

    const fits = (value) => typeof value === 'string'
        && !value.includes(CLIENT_ID_SEPARATOR)
        && isValidClientId(`${value}${CLIENT_ID_SEPARATOR}${'x'.repeat(suffixLength)}`);

    if (!fits(installation)) {
        installation = generateUUID();
        try {
            store?.setItem(INSTALLATION_STORAGE_KEY, installation);
        } catch {
            // In-memory for this load only.
        }
    }
    return installation;
}

/**
 * Gets or creates the client ID for this tab: `<installation>_<tab>`.
 * Synchronous by contract — `ws-client.js` reads it while its module is loading.
 * @returns {string} Client ID
 */
export function getClientId() {
    if (clientId) return clientId;
    const suffix = resolveTabSuffix();
    clientId = `${resolveInstallationId(suffix.length)}${CLIENT_ID_SEPARATOR}${suffix}`;
    return clientId;
}

/**
 * The per-browser half of a client id. Ids written before the id gained a tab half have no
 * separator and are their own installation, which is what keeps operations queued by an older
 * build recognizable as ours.
 * @param {string} id
 * @returns {string|null}
 */
export function clientIdInstallation(id) {
    if (typeof id !== 'string' || !id) return null;
    const cut = id.indexOf(CLIENT_ID_SEPARATOR);
    return cut === -1 ? id : id.slice(0, cut);
}

/**
 * Resets the client ID (for testing): drops the memo, the persisted halves, the claim registry
 * and the heartbeat.
 */
export function resetClientId() {
    cleanup(tabClaimLifecycle);
    clientId = null;
    const store = safeLocalStorage();
    if (store) {
        store.removeItem(INSTALLATION_STORAGE_KEY);
        store.removeItem(TAB_CLAIMS_STORAGE_KEY);
    }
    const session = safeSessionStorage();
    if (session) session.removeItem(TAB_STORAGE_KEY);
}

// ===== LAMPORT CLOCK =====

/**
 * Logical clock for causal ordering of operations across clients.
 * Incremented on every local operation. When receiving remote operations,
 * call advanceLamportClock(remoteTimestamp) to synchronize.
 * @type {number}
 */
let lamportClock = 0;

/**
 * Gets the current Lamport clock value (without incrementing).
 * @returns {number} Current clock value
 */
export function getLamportClock() {
    return lamportClock;
}

/**
 * Advances the Lamport clock after receiving a remote operation.
 * Sets clock to max(local, remote) + 1 to maintain causal ordering.
 * @param {number} remoteTimestamp - Lamport timestamp from the remote operation
 */
export function advanceLamportClock(remoteTimestamp) {
    lamportClock = Math.max(lamportClock, remoteTimestamp) + 1;
}

// ===== ACTION TRACE ID (SyncLedger) =====

/**
 * Ambient trace id for the user gesture currently being committed. Set by
 * `runTransaction` for the duration of a transaction's deferred sync logging and
 * cleared afterwards, so every op produced by that gesture shares one traceId.
 * Best-effort enrichment only — `op.id` is the always-works correlation key, so a
 * null traceId never breaks sync.
 * @type {string|null}
 */
let actionTraceId = null;

/** Sets the ambient action trace id (null clears it). */
export function setActionTraceId(id) {
    actionTraceId = id || null;
}

/** @returns {string|null} The ambient action trace id. */
export function getActionTraceId() {
    return actionTraceId;
}

// ===== SCOPE STAMP: WHICH ATLAS AN OPERATION WAS BORN IN =====

/**
 * Reads the address of the atlas scope the operation now being created belongs to.
 *
 * THE STAMP IS TAKEN HERE, IN THE FACTORY, AND NEVER IN THE DISPATCHER. The dispatcher
 * has two retry paths that REBUILD the operation about two seconds after the gesture
 * (`handleQueueFailure`), so a switch of atlas in between would stamp the op with the
 * atlas the user moved TO, i.e. would hand the wrong project the previous project's
 * work. The factory runs inside the gesture, so it reads the scope that produced the data.
 *
 * The two fields answer two different questions, and they diverge on the rescued slot:
 * `adoptRemoteAtlasAsLocal` keeps a `remote-<atlasId>` suffix on a LOCAL slot, so the same
 * ten databases can be a local atlas whose bytes came from a server atlas.
 *
 * - `scopeSuffix` is the ADDRESS ON DISK (the database suffix), and it is what decides
 *   whether a tab may read the operation back (`operation-queue.js`). The legacy slot's
 *   address is the EMPTY STRING, a real address, so it is never collapsed into null; null
 *   means no atlas was mounted at all.
 * - `atlasId` is the SERVER atlas the operation belongs to, or null when it belongs to no
 *   server atlas. It is the half the backend can check, and it is derived from the suffix
 *   for a local slot precisely so a rescued slot keeps naming its atlas of origin.
 *
 * @returns {{scopeSuffix: string|null, atlasId: string|null}}
 */
function readScopeStamp() {
    const scope = getActiveScope();
    if (!scope) return { scopeSuffix: null, atlasId: null };

    const scopeSuffix = typeof scope.dbSuffix === 'string' ? scope.dbSuffix : null;
    const atlasId = scope.kind === StoreScopeKind.REMOTE
        ? (scope.atlasId || null)
        : (scopeSuffix === null ? null : remoteAtlasIdFromDbSuffix(scopeSuffix));

    return { scopeSuffix, atlasId };
}

// ===== OPERATION CREATION =====

/**
 * @typedef {Object} Operation
 * @property {string} id - Unique operation ID
 * @property {string} entityType - Type of entity affected
 * @property {string} operationType - Type of operation (create/update/delete)
 * @property {string} entityId - ID of the affected entity
 * @property {string|null} mapId - ID of the map context (null for atlas-level)
 * @property {Object|null} data - New/updated data (null for deletes)
 * @property {Object|null} previousData - Previous data (for undo support)
 * @property {number} timestamp - Wall clock timestamp in milliseconds (Date.now())
 * @property {number} lamportTimestamp - Logical clock for causal ordering across clients
 * @property {string} clientId - ID of the client that created this operation
 * @property {string|null} traceId - SyncLedger gesture id (best-effort; survives the wire via Joi .unknown)
 * @property {string|null} scopeSuffix - Database suffix of the atlas scope the op was born in
 * @property {string|null} atlasId - Server atlas the op belongs to (null when it belongs to none)
 */

/**
 * Creates a sync operation object.
 *
 * @param {string} entityType - Type of entity (from EntityType)
 * @param {string} operationType - Operation type (from OperationType)
 * @param {string} entityId - ID of the affected entity
 * @param {string|null} mapId - Map context (null for atlas-level operations)
 * @param {Object|null} data - New/updated data
 * @param {Object|null} previousData - Previous data for undo support
 * @returns {Operation} Created operation
 * @throws {Error} If entity or operation type is invalid
 */
export function createOperation(entityType, operationType, entityId, mapId, data = null, previousData = null) {
    if (!isValidEntityType(entityType)) {
        throw new Error(`Invalid entity type: ${entityType}`);
    }
    if (!isValidOperationType(operationType)) {
        throw new Error(`Invalid operation type: ${operationType}`);
    }
    if (!entityId) {
        throw new Error('Entity ID is required');
    }

    const { scopeSuffix, atlasId } = readScopeStamp();
    const agora = Date.now();
    // O CARIMBO DE "EU MEXI AQUI", e ele é posto no ÚNICO ponto por onde toda op de saída passa.
    // É o que permite ao caminho de entrada distinguir "um colega alterou algo" de "um colega
    // alterou justamente o que eu estava editando", que é a única das duas que merece aviso.
    // Ver `sync/overwrite-notice.js`.
    noteLocalEdit(entityId, agora);

    return {
        id: generateUUID(),
        entityType,
        operationType,
        entityId,
        mapId: mapId || null,
        data,
        previousData,
        timestamp: agora,
        lamportTimestamp: ++lamportClock,
        clientId: getClientId(),
        traceId: actionTraceId,
        scopeSuffix,
        atlasId
    };
}

/**
 * Creates a batch of operations sharing the same batchId and wall-clock timestamp.
 *
 * @param {Array<{entityType: string, operationType: string, entityId: string, mapId?: string, data?: Object, previousData?: Object}>} operations - Operations to create
 * @returns {Operation[]} Array of created operations
 */
export function createBatchOperations(operations) {
    const batchId = generateUUID();
    const timestamp = Date.now();
    const client = getClientId();
    // Read ONCE for the batch: every op of one gesture is born in the same scope, and a
    // per-op read would let a scope switch split a batch across two atlases.
    const { scopeSuffix, atlasId } = readScopeStamp();

    return operations.map((op, index) => ({
        id: generateUUID(),
        entityType: op.entityType,
        operationType: op.operationType,
        entityId: op.entityId,
        mapId: op.mapId || null,
        data: op.data || null,
        previousData: op.previousData || null,
        timestamp,
        lamportTimestamp: ++lamportClock,
        clientId: client,
        traceId: actionTraceId,
        scopeSuffix,
        atlasId,
        batchId,
        batchIndex: index
    }));
}
