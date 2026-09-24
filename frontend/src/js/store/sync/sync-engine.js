// Path: js/store/sync/sync-engine.js
import { reconcileLegacyQueue } from './legacy-queue.js';

/**
 * @fileoverview High-level sync orchestrator for the EBGeo collaboration layer.
 *
 * `syncEngine` is the single public entry point the app uses to go online:
 * it wires together the HTTP client ({@link apiClient}), the WebSocket client
 * ({@link wsClient}), the local operation queue, the remote operation handler,
 * and the session context. Callers never touch those subsystems directly —
 * they call `configure/login/connect/flush/pull/disconnect` here.
 *
 * Responsibilities:
 * - Auth: login/register via the REST client and mirror identity into
 *   {@link sessionContext} (so permission guards work).
 * - Connect: do an initial pull (snapshot), wire idempotent WS handlers that
 *   feed inbound operations/snapshots into the remote handler, then open the WS.
 * - Flush: drain the local operation queue to the server over HTTP.
 * - Pull: catch up missed operations since the last applied version.
 *
 * The actual local-store mutation is delegated to `remote-operation-handler.js`
 * (`applyRemoteOperation` / `applyRemoteSnapshot`); this module only routes.
 *
 * @dependencies api-client.js, ws-client.js, operation-queue.js,
 *   operation-dispatcher.js, session-context.js, remote-operation-handler.js,
 *   sync-gateway.js, ../services.js
 */

import { apiClient, configureApiClient } from './api-client.js';
import { wsClient } from './ws-client.js';
import { isStructuralMarker } from './structural-markers.js';
import { SyncSession } from '@store/sync/sync-session.js';
import { ATLAS_RECORD_KEY, getStoreFor, reconcileDurablePointers, StoreName } from '@store/atlas-namespace.js';
import { readGeneration, writeGeneration } from '@store/namespace-generation.js';
import { enableOperationLogging, disableOperationLogging } from './operation-dispatcher.js';
import { sessionContext, sessionUserInfoFromMe } from './session-context.js';
import {
    applyRemoteOperation,
    applyRemoteOperations,
    applyRemoteSnapshot,
    applyMapCreationAck,
    setRemoteHandlerEventBus,
    recordLocalAppliedVersion,
    reconcilePendingLocalEdits,
    confirmEntityVersion,
    CONVERGENCE_GUARDED,
} from './remote-operation-handler.js';
import { syncGateway } from './sync-gateway.js';
import { connectionState } from './connection-state.js';
import { setImageSyncAtlas } from './image-sync.js';
import { applyAtlasSettings, revertAtlasSettings } from './atlas-settings.service.js';
import { refreshVisibleResources, clearVisibleResources } from './resource-access.service.js';
import { clearLocalEditMarks } from './overwrite-notice.js';
import { classifyIssue } from './issue-classes.js';
import { observeServerVersion } from './snapshot-frontier.js';
import { getEventBus } from '../services.js';
import { EventTypes } from '../../events/event_types.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from './diag/trace-stages.js';
import { showWarning } from '../../utilities/toast_service.js';

/**
 * Max operations pushed per HTTP batch when flushing the queue.
 *
 * VINTE E CINCO, E O NÚMERO FOI MEDIDO. A bancada `escrita-lote.bench.mjs` varre exatamente esta
 * variável: o servidor não distingue "o cliente escolheu empacotar 25" de "o escritor da bancada
 * mandou 25". Oito escritores no mesmo atlas, o mesmo total de operações repartido em lotes de
 * tamanhos diferentes, três rodadas:
 *
 *     lote     ops/s (3 rodadas)      p50 por envio
 *       10     818 / 725 / 691        ~89 ms
 *       25     968 / 773 / 752        ~213 ms
 *       50     843 / 792              ~445 ms
 *      100     706 / 677              ~1.095 ms
 *
 * Cem perdia nos DOIS eixos, consistentemente. Entre 10 e 25 a vazão favorece 25 nas três rodadas e
 * a latência por envio favorece 10 nas três; para carga em massa, que é o único regime em que o
 * teto morde, dá empate (100 operações levam 890 ms com lote 10 e 852 ms com lote 25). O desempate
 * é o custo que a bancada NÃO mede: 25 gera duas vezes e meia menos mensagens no fio e na CPU do
 * navegador.
 *
 * O TETO TAMBÉM AFASTA O 503. O servidor serializa a escrita por atlas num advisory lock com
 * `lock_timeout` de 5 s, e a recusa aparece quando `escritores x lote` passa de cerca de 4.000
 * operações. Com 100 isso eram 40 escritores simultâneos no mesmo atlas; com 25 são 160, bem acima
 * do limite de sala.
 */
const FLUSH_BATCH_SIZE = 25;

/**
 * The server's ceiling for ONE logical batch, mirrored here so the client never spends a round
 * trip discovering it.
 *
 * `LOTE_MAX_OPS` is 200 in `backend/src/modules/sync/sync.service.js`, and a batch above it is
 * refused whole, with a reason, before the server writes anything. The number is not a cost
 * ceiling (the measurement in `docs/wiki/lote-logico-de-gesto.md` shows the cost
 * per operation is flat, and one savepoint beats N): it bounds how long a push may hold the
 * atlas write lock, whose own timeout is 5 s.
 *
 * WHY THE CLIENT REFUSES IT LOCALLY INSTEAD OF LETTING THE SERVER SPEAK. A batch cannot be split
 * to fit, since splitting is what the batch exists to prevent, so the answer would be identical
 * on the next flush and on every flush after it. Recording the durable issue here turns an
 * endless 1,5 s knock into one problem the queue census names and the person can act on.
 * @type {number}
 */
const LOTE_MAX_OPS = 200;

/**
 * The pt-BR reason stored on every operation of a batch too large to be sent.
 * @type {string}
 */
const LOTE_GRANDE_DEMAIS = `Esta ação gerou mais de ${LOTE_MAX_OPS} alterações e o servidor `
    + 'não aceita enviá-las juntas. Ela está guardada nas pendências para revisão.';

/**
 * The pt-BR reason stored (and shown) when a piece that cannot be split any further still exceeds
 * the body limit of the push (413). The raw `error.message` would be the Express default
 * ("request entity too large") or, from a proxy answering with HTML, `HTTP 413`, and the pending
 * list shows the stored reason verbatim. Retrying the same bytes gets the same 413. The sentence does
 * NOT claim where the change came from (an import is the common road, but a large hand-drawn
 * viewshed or a paste reach it too, and the house rule is not to state a cause the code does not
 * know), so the advice is conditional.
 * @type {string}
 */
const CORPO_GRANDE_DEMAIS = 'Esta alteração é grande demais para o servidor aceitar de uma vez '
    + 'e ficou nas pendências. Se veio de uma importação, divida o arquivo em partes menores.';

/**
 * What the public-link visitor reads when the live connection cannot come back: the link's token
 * is ephemeral, has no refresh, and the upgrade refuses it once expired (`decidirReconexao`,
 * `ws-client.js`). Reloading re-resolves the link and gets a new one. A signed-in person never
 * reads this: a lost session is told by the auth-lost handler instead.
 * @type {string}
 */
const LINK_PUBLICO_VENCIDO = 'O acesso por link expirou nesta aba. Recarregue a página para '
    + 'voltar a receber as atualizações.';

/**
 * HTTP statuses that mean "these exact bytes will be refused forever".
 *
 * 400 (violação de dado/formato) e 422 (envelope inválido) são função determinística
 * do payload: reenviar é garantia de receber o mesmo erro. Deliberadamente FORA da
 * lista: 401 (token expirado — o retry acontece depois do refresh), 403 (permissão
 * perdida; a op ainda pode valer quando ela voltar), 409/429/5xx (transitórios). Numa
 * dúvida a fila espera, porque descartar op boa é perda de dado irreversível e a fila
 * travada não é.
 *
 * 413 belongs here too: it is a function of the SIZE of the bytes against a fixed body limit
 * (the backend's `express.json` cap on `/sync`, plus every proxy's `client_max_body_size`), so
 * the same batch is refused the same way forever. Outside this set it fell to the transient
 * branch: the whole queue stopped behind one oversized batch, resent with backoff for good,
 * while the warning blamed the connection. Here the isolation mode shrinks the batch, so a
 * batch that only overflows as a SUM drains op by op and nothing is discarded; only a piece
 * that is too large on its own becomes a durable issue.
 * @type {ReadonlySet<number>}
 */
const PERMANENT_PUSH_REJECTIONS = new Set([400, 413, 422]);

/**
 * HTTP statuses that mean "the atlas this queue is aimed at is not there any more":
 * deleted server-side, or the share that made it reachable was revoked to the point where
 * the route itself is gone.
 *
 * TERMINAL AND DISTINCT, and each half of that is load-bearing. Terminal: retrying is
 * pointless, so the isolation mode of {@link PERMANENT_PUSH_REJECTIONS} must never engage
 * (it would re-push the queue one operation at a time, forever, against an address that no
 * longer exists). Distinct: the operations are NOT discarded, because they are the user's
 * unsynced work and the rescue path (`preserveUnsyncedWorkAsLocal`) is what decides their
 * fate. What the old code did was neither — it fell through to the generic rethrow, which
 * `sync-flush` reported as a network hiccup, so a project deleted under the user's feet
 * looked exactly like a bad wifi and the queue stalled without anyone being told.
 * @type {ReadonlySet<number>}
 */
const ATLAS_GONE_STATUSES = new Set([404, 410]);

/**
 * The ids the server SPOKE ABOUT in a push response.
 *
 * Pure, and separate from {@link recordPushAcks} because it decides what leaves the queue.
 * An operation the server did not mention was not applied, was not refused, and has no
 * server version: dequeuing it on the strength of its NEIGHBOURS being accepted is how a
 * feature disappears from one machine and never appears on any other. It stays queued, and
 * `op_id` idempotency makes the retry free.
 *
 * A response that identifies NO operation at all acknowledges NOTHING, and that is the
 * contract, not an edge case: the return is empty and the whole batch stays queued. The
 * batch-as-acknowledgement reading (a bare 2xx meaning "all of it left") was the legacy
 * shape and is gone, because only the server naming an operation proves it arrived.
 *
 * @param {Object} resp - The pushOperations response.
 * @param {Object[]} ops - The operations that were pushed, in order.
 * @returns {string[]} Ids to dequeue.
 */
export function acknowledgedOperationIds(resp, ops) {
    const results = resp?.results || resp?.acks || [];
    const named = new Set();
    const uncertain = new Set();
    const refusedBatches = refusedBatchIds(resp, ops);
    for (const r of results) {
        const id = r?.operationId ?? r?.opId;
        if (!id) continue;
        const knownStatus = r.status === 'applied' || r.status === 'already_applied';
        const accepted = r.rejected !== true && r.success !== false
            && (r.status == null ? r.success === true : knownStatus);
        if (accepted) named.add(id);
        else uncertain.add(id);
    }
    for (const id of uncertain) named.delete(id);
    // A logical gesture is replayed atomically. Losing just one member's envelope makes
    // its next retry an incomplete batch, even when the original server commit succeeded.
    for (const op of ops) {
        if (op.batchId && !named.has(op.id)) refusedBatches.add(op.batchId);
    }
    // A MEMBER OF A REFUSED BATCH NEVER LEAVES THE QUEUE, EVEN ACKED AS APPLIED. The server
    // rolls the whole gesture back in one savepoint and answers every member with the same
    // status, so this can only fire against a server that broke that contract; letting the
    // sibling go on the strength of its own ack would leave the gesture half-queued, which is
    // exactly the shape nothing downstream can repair.
    return ops
        .filter(op => named.has(op.id) && !refusedBatches.has(op.batchId ?? null))
        .map(op => op.id);
}

/**
 * The `batchId`s the server refused in this response.
 *
 * Pure. The id is read from the receipt when the server echoed it and from the pushed envelope
 * otherwise, because the operation is the side that always knows which gesture it belongs to.
 *
 * @param {Object} resp - The pushOperations response.
 * @param {Object[]} ops - The operations that were pushed, in order.
 * @returns {Set<string>} Refused batch ids (never contains null).
 */
export function refusedBatchIds(resp, ops) {
    const results = resp?.results || resp?.acks || [];
    const byId = new Map(ops.map(op => [op.id, op]));
    const refused = new Set();
    for (const r of results) {
        if (r?.rejected !== true && r?.success !== false) continue;
        const id = r.operationId ?? r.opId;
        const batchId = r.batchId ?? byId.get(id)?.batchId ?? null;
        if (batchId !== null && batchId !== undefined) refused.add(batchId);
    }
    return refused;
}

// MARKER OPERATIONS (`isStructuralMarker`, imported above): a structural change made over REST
// that moved rows in bulk, so no per-entity operation describes it, and the peer resolves it by
// taking a snapshot. A live peer also learns about it from the `maps_merged` broadcast; the one
// that was OFFLINE has only this marker, and before it existed that peer's reconnect replay was
// empty by construction, so it kept showing the old state until a manual reload.
//
// THE LIST MOVED OUT OF THIS FILE ON 2026-09-13, and the move is what makes the mirror checkable:
// it is half of a wire contract whose other half is `STRUCTURAL_MARKER`
// (`backend/src/modules/sync/structural-marker.js`), and this module cannot be imported next to
// the backend's in a node test. See `store/sync/structural-markers.js`, a leaf with zero imports.

/**
 * Records a `push.ack` span per op from the server's push response — binding each
 * op.id to its server-assigned version and surfacing idempotent re-applies. The
 * flush path historically discarded this response entirely.
 * @param {Object} resp - The pushOperations response ({ results?, acks?, serverVersion? }).
 * @param {Object[]} ops - The ops that were pushed (in order).
 */
async function recordPushAcks(resp, ops, session) {
    if (!resp) return;
    const results = resp.results || resp.acks || [];
    const confirmed = new Set(acknowledgedOperationIds(resp, ops));
    const rejections = [];
    for (const op of ops) {
        session.assertActive();
        const r = results.find((x) => x && (x.operationId === op.id || x.opId === op.id));
        if (!r) continue;
        const sv = r.currentVersion ?? r.serverVersion ?? resp.serverVersion;
        if (confirmed.has(op.id)) observeServerVersion(sv, session.scope);

        // A policy denial (map delete without the `manage` tier, lock/unlock without
        // owner) is acked per-operation with 200 + rejected, so the batch is NOT
        // retried — retrying a denial can never succeed, and retrying it forever is
        // what used to freeze the whole outbound queue.
        //
        // But being dequeued silently is its own defect: the entity is already gone
        // from the local store, the server kept it, and the next snapshot brings it
        // back with no explanation. The user sees their action undo itself minutes
        // later. The server sends a `reason` precisely so the client can say what
        // happened; it was being discarded here.
        if (r.rejected === true || r.success === false) {
            rejections.push(r.reason || 'O servidor recusou uma alteração.');
        }
        record(TraceStage.PUSH_ACK, {
            opId: op.id,
            traceId: op.traceId,
            serverVersion: sv,
            outcome: r.idempotent ? TraceOutcome.IDEMPOTENT : (r.success === false ? TraceOutcome.FAILED : TraceOutcome.OK),
            // The gesture, on the span: a refusal that belongs to a batch is not one operation
            // going wrong, it is N operations going back, and a ledger that shows only the
            // culprit reads as an isolated failure.
            ...(op.batchId ? { batchId: op.batchId } : {}),
            ...(r.batchFailedOperationId ? { batchFailedOperationId: r.batchFailedOperationId } : {}),
            // The server's own words for WHY, on the span and not only in the toast. A denial is
            // invisible to a headless spec (no UI to show the toast), so the spec fails later and
            // elsewhere — on a poll that times out waiting for an entity the server refused. That
            // is what a whole family of 3D/360/basemap specs did when a write gate started
            // refusing references to catalog rows the specs had invented.
            ...(r.reason ? { reason: r.reason } : {}),
            // E A CLASSE, porque "recusado" não diz o que fazer a respeito. Uma DISPUTA
            // (`status: 'conflict'`, com as unidades em `conflict.fields`) pede uma decisão sobre
            // conteúdo; uma recusa de política pede outra conta. Sem isto, um diagnóstico de
            // conflito de mapa e um de permissão negada são a mesma linha no ledger.
            ...(r.rejected === true || r.success === false ? { classe: classifyIssue(r) } : {}),
        });
        // Seed the author's own applied serverVersion (LWW convergence): the author filters its
        // own WS echo, so without this it would never learn its op's server arrival order, and a
        // peer's concurrent OLDER op could overwrite the author's (correct) value. Applies to all
        // guarded entity types (feature/layer/group/3D/360).
        //
        // The OP ITSELF goes too, and it is not decoration: seeding a number repairs nothing when
        // the peer's older op has ALREADY been written over the local value (the defer guard has
        // two windows it cannot close — see `lastRemoteAppliedVersion` in
        // remote-operation-handler.js). The ack is where the author learns it won, so it is where
        // it must be able to put its value back, and only the op carries that value.
        // THE REVISION THE SERVER COMMITTED, written onto the local document so the author's NEXT
        // edit of the same entity declares a base the server still recognises. Without it the
        // second consecutive edit would carry the revision read from the snapshot, and the
        // server's own frontier (moved by the FIRST edit) would refuse it: the author would lose
        // a race against nobody. `entityVersion` rides every base-checked receipt; only three
        // paths carry a canonical operation the inbound handler could have applied instead.
        if (confirmed.has(op.id) && Number.isSafeInteger(r.entityVersion)) {
            await confirmEntityVersion(op, r.entityVersion, session);
            session.assertActive();
        }
        if (confirmed.has(op.id) && sv != null && op.entityId && CONVERGENCE_GUARDED.has(op.entityType)) {
            await recordLocalAppliedVersion(op.entityId, sv, r.canonicalOperation ?? op);
            session.assertActive();
        }
        if (confirmed.has(op.id) && op.entityType === 'map'
            && op.operationType === 'create' && r.canonicalOperation) {
            await applyMapCreationAck(r.canonicalOperation);
            session.assertActive();
        }
    }

    // One toast per distinct reason, not per operation: a batch can carry several
    // denials with the same cause and stacking N identical toasts is noise.
    for (const reason of new Set(rejections)) {
        try {
            showWarning(reason);
        } catch {
            // Headless (tests, worker): no UI to tell.
        }
    }
}

/**
 * Orchestrates the online sync lifecycle: auth, initial pull, WebSocket wiring,
 * queue flush, and catch-up pull. A single shared instance ({@link syncEngine})
 * is used app-wide.
 */
class SyncEngine {
    constructor() {
        /** @type {string|null} The atlas currently connected (null when offline). */
        this._atlasId = null;
        /** @type {number} Highest server version applied locally. */
        this._lastVersion = 0;
        /**
         * @type {boolean} Whether the local state is COMPLETE at {@link _lastVersion} (a snapshot
         * was applied, or a tail landed on a complete generation). It is what the WS handshake
         * needs to say "up to date" about an atlas still at version zero, where `lastVersion: 0`
         * on its own reads as "I hold nothing".
         */
        this._haveSnapshot = false;
        /** Whether WS inbound handlers have been wired (wire-once guard). */
        this._handlersWired = false;
        this._session = null;
    }

    /** @returns {string|null} The connected atlas id, or null. */
    get atlasId() {
        return this._atlasId;
    }

    /** @returns {number} The highest server version applied locally. */
    get lastVersion() {
        return this._lastVersion;
    }

    _beginSession(atlasId) {
        this._session?.close();
        this._session = new SyncSession(atlasId, sessionContext.userId);
        return this._session;
    }

    /**
     * Points the underlying HTTP client at a backend (base URL + fetch impl).
     * @param {{ baseUrl?: string, fetch?: typeof fetch }} opts
     * @returns {void}
     */
    configure(opts) {
        configureApiClient(opts);
    }

    /**
     * Logs in and mirrors the user identity into the session context so that
     * permission guards reflect the authenticated role.
     * @param {{ username: string, password: string }} credentials
     * @returns {Promise<Object>} The authenticated user.
     */
    async login({ username, password }) {
        const user = await apiClient.login(username, password);
        sessionContext.setSession(sessionUserInfoFromMe(user, username));
        // A soma dos recursos privados concedidos, ainda SEM atlas em foco: o que a
        // pessoa tem por papel global ou por concessao pessoal ja vale no mapa local.
        // Best-effort de proposito — uma falha aqui nao pode derrubar o login.
        await refreshVisibleResources(null);
        // E a tela precisa SABER que a soma chegou. O boot resolve isso por construcao
        // (a soma acontece antes de qualquer controle existir), mas o login por gesto
        // acontece com o mapa montado: sem este aviso, o recurso privado so aparecia no
        // proximo F5 ou ao abrir um atlas. O MESMO evento do overlay, e nao um novo,
        // pela razao ja escrita no handler de `atlasResources`: os assinantes ignoram o
        // payload e apenas releem o `config`. Vai sem chave `settings` de proposito —
        // nao houve mudanca de settings.
        try {
            getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'granted_resources' });
        } catch {
            // No UI bus (headless).
        }
        return user;
    }

    /**
     * Registers a new user (self-registration; gated server-side). Forwards the full payload so the
     * optional military attributes (and, once enabled, the e-mail) reach the backend untouched.
     * @param {{ username: string, password: string, nome: string, posto_graduacao?: string,
     *   organizacao_militar?: string, email?: string }} payload
     * @returns {Promise<{ success: true }>} Never account data: the endpoint answers identically
     *   whether it created an account or found one, so it cannot be used to enumerate accounts.
     */
    async register(payload) {
        return apiClient.register(payload);
    }

    /**
     * Goes online for an atlas: wires the remote handler + WS inbound routing,
     * (optionally) pulls the initial snapshot, then opens the WebSocket.
     * @param {string} atlasId
     * @param {Object} [opts]
     * @param {boolean} [opts.initialPull=true] - Pull a snapshot before connecting.
     * @returns {Promise<Object>} The WS `connected` payload.
     */
    async connect(atlasId, { initialPull = true } = {}) {
        const session = this._beginSession(atlasId);
        this._wireOnce();

        await this._ensureProtocol(session);
        await this._prepareLegacyQueue(session);

        // EVERY CONNECT STARTS WITHOUT A CLAIM. Only the initial pull can grant completeness, and
        // it is a claim about the disk of THIS atlas: a connect that skips the pull must not
        // inherit the one earned by the atlas before it (`_lastVersion` has the same hazard, which
        // is what `forgetAtlas` exists for on the way out).
        this._haveSnapshot = false;
        const snapshot = initialPull ? await this._pullInitialState(session) : null;

        this._atlasId = atlasId;
        setImageSyncAtlas(atlasId);
        // Authenticated connect → log local mutations for outbound sync. Re-enabled explicitly here
        // because a prior public-visitor connect (connectPublic) disables logging.
        enableOperationLogging();

        // Elevate the role for the atlas OWNER the instant the snapshot lands — BEFORE the WS
        // handshake — so the owner's account config buttons (Configurar/Compartilhar/Excluir)
        // appear immediately on an F5 reconnect instead of waiting on, or being lost to, the
        // socket handshake (which is the only thing that applied the role before, via `payload`
        // below). The `connected` payload still re-confirms the role and resolves the non-owner
        // roles (manager/editor/commenter/viewer).
        const ownerId = snapshot?.atlas?.sync?.ownerId;
        if (ownerId && sessionContext.userId && ownerId === sessionContext.userId) {
            sessionContext.setSession({
                userId: sessionContext.userId,
                role: 'owner',
                username: sessionContext.username,
            });
        }

        const payload = await wsClient.connect(atlasId, {
            lastVersion: this._lastVersion,
            haveSnapshot: this._haveSnapshot,
        });
        session.assertActive();

        // Reflect the PER-ATLAS role from the connect payload (owner/editor/viewer). This is the
        // ONLY place the axis is resolved for a non-owner: hydration seeds it at VIEWER and the
        // server decides, so a self-registered owner or a write-shared collaborator can edit.
        // (Until 2026-08-20 login also seeded it, from the org-scoped role — the axis D7 removed.) PRESERVE the restored username — setSession would otherwise null it, blanking the
        // account avatar on an F5-reconnect (where this is the only session set after restore).
        if (payload?.role) {
            sessionContext.setSession({
                userId: payload.userId ?? sessionContext.userId,
                role: payload.role,
                username: sessionContext.username,
            });
        }

        // Apply the per-atlas config overlay from the snapshot's settings (no extra round-trip).
        await this._applyAtlasSettingsOverlay(atlasId, snapshot?.atlas?.settings, session);
        session.assertActive();
        return payload;
    }

    /**
     * @private The initial pull of a connect: ASKS FOR WHAT IS MISSING, not for everything.
     *
     * Every connect used to pull from version 0, which the server answers with a full snapshot,
     * which `applyRemoteSnapshot` stages into a BRAND NEW generation of nine databases. So the
     * durable cursor was written by every recovery and read by almost nobody, and reconnecting to
     * an atlas whose data was already complete on disk re-downloaded and re-wrote all of it. The
     * cursor is now the question: with a complete generation on disk, the connect asks for the tail
     * since that cursor and the local databases stay where they are.
     *
     * THE FULL SNAPSHOT STILL HAPPENS, and the three reasons are not interchangeable: there is no
     * complete generation on disk (first open, after a logout wipe, corrupt record); the server
     * ANSWERS with one (`isSnapshot`, which it decides by `min_version` and by a catalog identity
     * that only a snapshot can repair, as the default-layer regularization of 2026-09 did); or the tail carries a
     * structural marker, whose effect no per-entity op describes.
     *
     * THE MARKER PATH PULLS FROM ZERO ITSELF instead of delegating to `resync()`, and that is not
     * duplication for its own sake: `resync()` early-returns on a null `this._atlasId`, which is
     * exactly the state of a connect that has not finished, so delegating would silently apply
     * nothing at all.
     *
     * @param {import('./sync-session.js').SyncSession} session - The session being connected.
     * @returns {Promise<Object|null>} The applied snapshot, or null when the pull was a tail (the
     *   caller reads `atlas.sync.ownerId` and `atlas.settings` from it, and falls back to REST).
     */
    async _pullInitialState(session) {
        const since = await this._durablePullCursor(session);
        // The generation that cursor vouches for, read in the same breath: it is what the tail below
        // is applied to, and the only one `_advanceDurableCursor` may move the cursor of.
        const provenGeneration = since > 0 ? readGeneration(session.scope).active : null;
        const result = await apiClient.pullSync(session.atlasId, since, { signal: session.signal });
        session.assertActive();

        // COMPLETENESS IS DECIDED PER BRANCH, and it starts false so a branch that adds one later
        // has to say so. It is not the same question as `_lastVersion`: the version says how far
        // the disk got, and this says whether everything up to there is actually there. The WS
        // handshake needs both, because "version 0" alone cannot mean "up to date".
        this._haveSnapshot = false;

        if (result?.snapshot) {
            await applyRemoteSnapshot(result.snapshot, session);
            session.assertActive();
            this._haveSnapshot = true;
            // THE SOCKET DEPARTS FROM THE CURSOR THE SNAPSHOT JUST WROTE, so the handshake's
            // `sync_request` asks for the tail after exactly what is on disk. The durable cursor
            // is written from `snapshot.currentVersion` (`applyRemoteSnapshot`), so that is the
            // number this has to carry; the envelope's own `currentVersion` is the fallback for
            // a response that omits it inside the snapshot.
            this._lastVersion = result.snapshot.currentVersion ?? result.currentVersion ?? 0;
            return result.snapshot;
        }

        const operations = Array.isArray(result?.operations) ? result.operations : [];
        if (operations.some(isStructuralMarker)) {
            const fresh = await apiClient.pullSync(session.atlasId, 0, { signal: session.signal });
            session.assertActive();
            if (fresh?.snapshot) {
                await applyRemoteSnapshot(fresh.snapshot, session);
                session.assertActive();
                this._haveSnapshot = true;
            }
            this._lastVersion = fresh?.currentVersion ?? 0;
            return fresh?.snapshot ?? null;
        }

        // `false` is the handler's word for "not written" (buffered for a map that is not here yet):
        // see `_advanceDurableCursor` for why one of those keeps the cursor where it was.
        let everyOperationLanded = true;
        for (const op of operations) {
            const applied = await applyRemoteOperation(op, { scope: session.scope, signal: session.signal, waitForDeferred: true });
            session.assertActive();
            if (applied === false) everyOperationLanded = false;
        }
        this._lastVersion = result?.currentVersion ?? 0;
        if (since > 0 && everyOperationLanded) this._advanceDurableCursor(session, result?.currentVersion, provenGeneration);
        // A TAIL IS ONLY COMPLETE ON TOP OF SOMETHING COMPLETE, and `since` is that proof: it is
        // non-zero only when `_durablePullCursor` found an active generation still holding THIS
        // atlas. Asked from zero and answered with a tail, the disk holds whatever the ops carried
        // and nothing else, which is not a state worth vouching for.
        this._haveSnapshot = since > 0;
        return null;
    }

    /**
     * @private Moves the durable cursor up to the version a TAIL just brought the disk to.
     *
     * UNTIL 2026-09-21 ONLY A SNAPSHOT WROTE THE CURSOR, so it stayed at the version of the opening
     * for as long as no snapshot was staged, and every reload re-pulled and re-applied the WHOLE
     * tail since the atlas was first opened on this computer. A long-lived atlas only made it
     * longer. The tail is applied on top of a generation `_durablePullCursor` proved complete, so
     * once every operation of it is on disk the disk IS at `currentVersion`, and saying so is what
     * makes the next connect ask for what is actually missing.
     *
     * THREE CONDITIONS, AND EACH ONE IS A WAY THE CURSOR COULD LIE:
     *  - every operation LANDED. One that came back `false` was buffered in memory (a feature for
     *    a map that is not here yet), and a cursor past it would make it unrecoverable short of a
     *    full snapshot. Staying behind costs a longer tail next time, never data.
     *  - the ACTIVE generation is still the one the tail was applied to (`provenGeneration`). The
     *    record is re-read here, in the same synchronous step as the write, and COMPARED: a
     *    snapshot staged in between owns its own cursor, and this tail says nothing about it.
     *  - it only moves FORWARD, and only to a safe integer.
     *
     * WHAT IT GIVES UP, stated because it was relied on for a few hours: a reload used to re-apply every
     * operation since the opening, which repaired by accident any local divergence those
     * operations happened to describe (measured on 2026-09-21 with a hand-made one). After the
     * first reload that is no longer true. The real case that accident covered, a layer move whose
     * source emptying is refused, never needed it: it resolves on the push receipt, one way when the
     * server accepts the move and the other way when it refuses it, both measured on 2026-09-21
     * (`tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js`).
     *
     * Best-effort: a storage that refuses the write leaves the old cursor, which is the old cost.
     *
     * @param {import('./sync-session.js').SyncSession} session - The session being connected.
     * @param {number} version - `currentVersion` of the tail response.
     * @param {string|null} provenGeneration - The generation the tail was applied to.
     * @returns {boolean} Whether the cursor moved.
     */
    _advanceDurableCursor(session, version, provenGeneration) {
        if (!Number.isSafeInteger(version) || version <= 0) return false;
        try {
            const record = readGeneration(session.scope);
            if (!record.active || record.active !== provenGeneration || version <= record.cursor) return false;
            writeGeneration(session.scope, { ...record, cursor: version });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @private From which server version this connect may ask for a tail. Zero means "send me
     * everything", and it is the answer whenever the local side cannot be shown to be complete.
     *
     * THE POINTER ALONE IS NOT EVIDENCE, and this is the trap the check exists for: the durable
     * record lives in `localStorage` while the data lives in IndexedDB, so a namespace emptied by
     * a logout wipe, or by the browser reclaiming storage, leaves a cursor naming a generation
     * whose databases are empty. Pulling a tail into that would produce an atlas missing
     * everything written before the cursor, with no error anywhere. So the generation is asked
     * whether it still holds THIS atlas; only then is its cursor trusted.
     *
     * @param {import('./sync-session.js').SyncSession} session - The session being connected.
     * @returns {Promise<number>} The cursor, or 0.
     */
    async _durablePullCursor(session) {
        if (session.scope?.kind !== 'remote') return 0;
        // A journaled edit may have crashed before materialization. A tail alone cannot
        // replay it: ask for a complete snapshot, whose apply path replays prepared edits.
        if ((await session.queue.countByState?.())?.preparadas > 0) return 0;
        // A `localStorage` that was cleared while IndexedDB survived leaves the pointer gone and the
        // acervo intact; the mirror in the global database is what rebuilds it, and it has to happen
        // BEFORE the record is read here, or the connect would answer "nothing on disk" and pull a
        // full snapshot over data that was already complete.
        await reconcileDurablePointers(session.scope);
        session.assertActive();
        let record;
        try {
            record = readGeneration(session.scope);
        } catch {
            // A corrupt record resolves no database at all: the snapshot is the repair.
            return 0;
        }
        if (!record.active || !Number.isSafeInteger(record.cursor) || record.cursor <= 0) return 0;
        // THE CURSOR VOUCHES FOR A RECORTE, AND THE RECORTE IS PER CALLER. The server cuts the
        // snapshot by who asks (`getAtlasSnapshot`: a `read` snapshot has no comment, and catalog
        // definitions pass the caller's access predicate), so a generation staged for a public-link
        // visitor is complete FOR THE VISITOR only. Until 2026-09-23 the account that logged in
        // afterwards on the same machine got a tail over it and never saw what the visit had not
        // received. Repro: `tests/e2e-ui/visita-publica-depois-conta-ve-tudo.repro.spec.js`.
        // A record written before the principal was recorded carries none and is trusted: this build
        // launches with the field, so such a record only exists on a development machine.
        if (Object.hasOwn(record, 'principal') && record.principal !== (session.principalId ?? null)) return 0;

        const atlas = await getStoreFor(StoreName.ATLAS, { ...session.scope, dataGeneration: record.active })
            .getItem(ATLAS_RECORD_KEY);
        session.assertActive();
        return atlas?.id === session.atlasId ? record.cursor : 0;
    }

    /**
     * Goes online for a PUBLIC atlas as an anonymous, read-only visitor (the public viewer-link
     * flow). Same wiring as {@link connect}, but the session becomes a "visitante" (VIEWER) rather
     * than an authenticated identity. The caller must have set the ephemeral public token on the
     * api client and marked the store remote first.
     * @param {string} atlasId
     * @returns {Promise<Object>} The WS `connected` payload.
     */
    async connectPublic(atlasId) {
        const session = this._beginSession(atlasId);
        this._wireOnce();

        const result = await apiClient.pullSync(atlasId, 0, { signal: session.signal });
        session.assertActive();
        const snapshot = result?.snapshot ?? null;
        if (snapshot) {
            await applyRemoteSnapshot(snapshot, session);
            session.assertActive();
        }
        this._lastVersion = result?.currentVersion ?? 0;
        this._haveSnapshot = Boolean(snapshot);

        this._atlasId = atlasId;
        setImageSyncAtlas(atlasId);
        // Anonymous read-only visitor: NEVER log ops — there is no token to push them and they would
        // orphan the op queue for a later real login (which would then flush them to the wrong atlas).
        disableOperationLogging();
        const payload = await wsClient.connect(atlasId, {
            lastVersion: this._lastVersion,
            haveSnapshot: this._haveSnapshot,
        });

        session.assertActive();

        // Anonymous read-only visitor: the permission guard blocks editing the remote store, and
        // isAuthenticated() stays false (no account menu).
        sessionContext.setVisitorSession();

        // The per-atlas config overlay still applies — a visitor respects 3D/360/basemap availability.
        await this._applyAtlasSettingsOverlay(atlasId, snapshot?.atlas?.settings, session);
        session.assertActive();
        return payload;
    }

    /**
     * @private Applies the connected atlas's per-atlas config overlay (3D/360/basemap availability)
     * as a restrictive intersection over the deploy config, then lets the UI re-gate. Prefers the
     * settings already carried in the pulled snapshot (no extra round-trip); falls back to a REST
     * fetch only when they aren't present. Best-effort: a failure leaves the deploy config intact.
     * @param {string} atlasId
     * @param {Object} [snapshotSettings] - atlas.settings from the pulled snapshot, if any.
     * @param {SyncSession} session - Opening session; late responses must not outlive it.
     */
    async _applyAtlasSettingsOverlay(atlasId, snapshotSettings, session) {
        // D1 — SOMAR PRIMEIRO, INTERSECTAR DEPOIS, e a ordem esta aqui de proposito.
        // O baseline passa a ser publico(deploy) uniao concedido(pessoal) uniao
        // emprestado(atlas), e so entao a allowlist do atlas intersecta por cima. A
        // ordem inversa faria o recurso EMPRESTADO escapar da restricao que o
        // Gestor configurou no mesmo atlas.
        session.assertActive();
        await refreshVisibleResources(atlasId);
        session.assertActive();
        try {
            const settings = snapshotSettings ?? await apiClient.getAtlasSettings(atlasId);
            session.assertActive();
            applyAtlasSettings(settings);
            getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings });
        } catch {
            // Network/settings failure is optional; cancellation is not success.
            session.assertActive();
            // No settings reachable / no UI bus — non-fatal.
        }
    }

    /**
     * Drains the local operation queue to the server over HTTP, dequeuing each
     * batch only after the server accepts it.
     *
     * Uma op nunca sai da fila sem que o servidor tenha se pronunciado sobre ELA: ou
     * ele a aceitou (2xx), ou a recusou por operação (`rejected` no ack), ou a recusou
     * de forma permanente quando ela era a única do lote (modo de isolamento abaixo).
     * Quem decide isso é {@link acknowledgedOperationIds}, e não o sucesso do LOTE: o
     * dequeue por lote inteiro tirava da fila op que o servidor sequer mencionou.
     *
     * O que sai daqui é sempre do atlas MONTADO: `peek` filtra pelo escopo ativo
     * (`operation-queue.js`), então uma aba não drena o trabalho nascido no atlas da outra.
     * @returns {Promise<{ pushed: number }>}
     */
    async flush() {
        const session = this._session ?? this._beginSession(this._atlasId);
        session.assertActive();
        if (session.flushPromise) return session.flushPromise;
        session.flushPromise = this._flushSession(session).finally(() => { session.flushPromise = null; });
        return session.flushPromise;
    }

    async _ensureProtocol(session) {
        if (session.scope?.kind !== 'remote' || session.protocolReady) return;
        const protocol = await apiClient.getSyncProtocol(session.atlasId, { signal: session.signal });
        session.assertActive();
        if (!Array.isArray(protocol?.writeVersions) || !protocol.writeVersions.includes(2) || protocol.receiptLookup !== true) {
            throw Object.assign(new Error('O cliente e o servidor do EBGeo precisam ser atualizados para versões compatíveis.'),
                { status: 426, code: 'SYNC_PROTOCOL_INCOMPATIBLE' });
        }
        session.protocolReady = true;
    }

    async _prepareLegacyQueue(session) {
        if (session.scope?.kind !== 'remote' || session.legacyReviewed) return;
        const pending = await reconcileLegacyQueue(session.queue,
            ops => apiClient.lookupOperationReceipts(session.atlasId, ops, { signal: session.signal }),
            () => session.assertActive());
        session.assertActive();
        session.legacyReviewed = true;
        if (pending) showWarning('Há alterações de uma versão antiga guardadas para revisão. Elas não serão reenviadas automaticamente.');
    }

    async _flushSession(session) {
        await this._ensureProtocol(session);
        await this._prepareLegacyQueue(session);
        let pushed = 0;
        let needsRecovery = false;
        // MODO DE ISOLAMENTO: uma vez ligado, o lote vira de tamanho 1 e assim fica até
        // que a op ofensora seja encontrada e descartada. Voltar ao lote cheio no
        // primeiro push aceito faria o lote grande falhar de novo a cada op boa que
        // precede a ofensora (um round-trip perdido por op, em vez de um por op).
        let isolating = false;
        // THE CUT OF THE NEXT PEEK, which only a 413 moves: it halves while the SUM of the bytes
        // is over the body limit, and it goes back to the full cut once an indivisible piece that
        // is too large on its own has been set aside (the rest may well fit whole).
        let recorte = FLUSH_BATCH_SIZE;
        let ops = await session.queue.peek(recorte);
        while (ops && ops.length > 0) {
            session.assertActive();
            const opIds = ops.map(op => op.id);

            // ACIMA DO TETO DO SERVIDOR, A RECUSA É LOCAL E NÃO CUSTA VIAGEM. `peek` entrega um
            // lote lógico inteiro mesmo quando ele passa do recorte, porque partir o gesto é o
            // que o lote existe para impedir; quando o gesto passa do teto do servidor, ele não
            // pode ser enviado de jeito nenhum, e todas as ops dele viram problema durável.
            if (ops.length > LOTE_MAX_OPS) {
                for (const operation of ops) {
                    await session.queue.recordIssue(operation, {
                        rejected: true, reason: LOTE_GRANDE_DEMAIS,
                        batchId: operation.batchId ?? null, batchTooLarge: true,
                    });
                }
                needsRecovery = true;
                record(TraceStage.PREFLUSH_DROP, {
                    atlasId: session.atlasId, opIds, batchId: ops[0].batchId ?? null,
                    batchSize: ops.length, outcome: TraceOutcome.DROPPED,
                    reason: DropReason.SERVER_REJECTED, error: LOTE_GRANDE_DEMAIS,
                });
                try {
                    showWarning(LOTE_GRANDE_DEMAIS);
                } catch {
                    // Headless (tests, worker): no UI to tell.
                }
                isolating = false;
                ops = await session.queue.peek(recorte);
                continue;
            }
            record(TraceStage.FLUSH_PUSH, {
                atlasId: session.atlasId, opIds, batchSize: ops.length, outcome: TraceOutcome.OK,
            });
            let resp;
            try {
                resp = await apiClient.pushOperations(session.atlasId, ops, { signal: session.signal });
                session.assertActive();
            } catch (error) {
                session.assertActive();
                // A rejected batch is NOT dequeued — the queue re-peeks the same ops next
                // flush. Surface the poison batch (which op ids stalled) instead of the
                // historic silent stall.
                record(TraceStage.FLUSH_PUSH, {
                    atlasId: session.atlasId, opIds, outcome: TraceOutcome.FAILED,
                    error: error?.message || String(error),
                });

                // O atlas sumiu do servidor: classe TERMINAL, e nada é descartado aqui.
                // Sai antes do modo de isolamento de propósito (isolar op a op contra um
                // endereço que não existe é um round-trip por op, para sempre).
                if (ATLAS_GONE_STATUSES.has(error?.status)) {
                    record(TraceStage.FLUSH_PUSH, {
                        atlasId: session.atlasId, opIds, outcome: TraceOutcome.FAILED,
                        reason: 'atlas_gone', error: error?.message || String(error),
                    });
                    await this._reconcileConvergenceGuard(session);
                    throw error;
                }

                // ── Rede de segurança: op envenenada ────────────────────────────────
                // O servidor recusa violação de integridade POR OPERAÇÃO (200 +
                // `rejected`), então este ramo só existe para o que a classificação de
                // lá não cobre (um 422 do Joi, um erro não previsto). Sem ele o lote
                // volta para a fila idêntico e é reenviado a cada 1,5 s para sempre: o
                // sync do usuário para, em silêncio.
                //
                // A op ofensora é identificada POR CONSTRUÇÃO, nunca por um id que o
                // servidor mande: reduzimos o lote a UMA op e reenviamos. Se o erro
                // permanente se repete com lote de tamanho 1, a ofensora é aquela — e
                // nenhuma op irmã pode ter sido descartada por engano, porque irmã só
                // sai da fila quando o servidor a aceita.
                if (PERMANENT_PUSH_REJECTIONS.has(error?.status)) {
                    // A 413 IS ABOUT THE SUM OF THE BYTES, NOT ABOUT ONE OP, so it HALVES the cut
                    // instead of isolating: isolating would send every remaining op alone for the
                    // rest of the flush (up to 25 times the pushes), while halving finds the largest
                    // cut that fits in a few round trips. `peek` never splits a logical batch, so
                    // when halving hands back the same piece it is indivisible, and it is refused
                    // below like any poison piece.
                    const corpoGrande = error?.status === 413;
                    if (corpoGrande && ops.length > 1) {
                        const metade = Math.max(1, Math.floor(ops.length / 2));
                        const menor = await session.queue.peek(metade);
                        if (menor.length < ops.length) {
                            recorte = metade;
                            ops = menor;
                            continue;
                        }
                    }
                    // `!isolating` E NÃO SÓ O TAMANHO, desde que o recorte respeita o lote. Um
                    // `peek(1)` devolve o menor pedaço INDIVISÍVEL, que é um lote inteiro quando a
                    // primeira op pertence a um: sem esta condição, um lote de N envenenado
                    // reduziria para N a cada volta e o laço giraria para sempre.
                    if (!corpoGrande && !isolating && ops.length > 1) {
                        isolating = true;
                        ops = await session.queue.peek(1);
                        continue;
                    }
                    const poison = ops[0];
                    // TODAS AS OPS DO PEDAÇO, e não só a primeira: o servidor aplica ou recusa o
                    // lote inteiro, então guardar o problema em uma só deixaria as irmãs
                    // enviáveis e o gesto seria reenviado pela metade na volta seguinte.
                    for (const operation of ops) {
                        await session.queue.recordIssue(operation, {
                            rejected: true, reason: corpoGrande ? CORPO_GRANDE_DEMAIS : error.message,
                            status: error.status,
                            ...(operation.batchId ? {
                                batchId: operation.batchId, batchFailedOperationId: poison.id,
                            } : {}),
                        });
                    }
                    needsRecovery = true;
                    // The queue always advances here: `recordIssue` writes a durable issue and
                    // `_loadOperations` skips an operation that carries one, so the next `peek`
                    // cannot return this envelope again. Nothing is removed from disk, which is
                    // the point of the durable issue; there is no "queue did not move" branch to
                    // guard against, and the one that used to sit here was unreachable.
                    record(TraceStage.PREFLUSH_DROP, {
                        atlasId: session.atlasId, opId: poison.id, traceId: poison.traceId,
                        entityType: poison.entityType, entityId: poison.entityId,
                        outcome: TraceOutcome.DROPPED, reason: DropReason.SERVER_REJECTED,
                        error: error?.message || String(error),
                    });
                    // Descarte silencioso é o outro defeito: a entidade já mudou local-
                    // mente, o servidor nunca a viu, e o próximo snapshot desfaz a ação
                    // do usuário sem explicação.
                    try {
                        showWarning(corpoGrande ? CORPO_GRANDE_DEMAIS
                            : 'Uma alteração foi recusada pelo servidor. Ela está guardada nas pendências para revisão.');
                    } catch {
                        // Headless (tests, worker): no UI to tell.
                    }
                    isolating = false;
                    recorte = FLUSH_BATCH_SIZE;
                    ops = await session.queue.peek(recorte);
                    continue;
                }

                await this._reconcileConvergenceGuard(session);
                throw error;
            }
            session.assertActive();
            await recordPushAcks(resp, ops, session);
            session.assertActive();
            // TODA RECUSA VIRA PROBLEMA DURÁVEL, E O CONFLITO É UMA DELAS. O servidor devolve a
            // disputa por este mesmo canal (`rejected: true` mais `status: 'conflict'` e o objeto
            // `conflict` com as unidades, a `entityVersion` e o `serverData` quando houver), e o
            // ack inteiro é guardado, de modo que a classe (`classifyIssue`) e os campos em
            // disputa sobrevivem ao F5. A operação NÃO é retirada da fila e passa a bloquear os
            // dependentes dela, que é o que a feição já fazia e agora vale para toda entidade.
            const refused = (resp?.results ?? resp?.acks ?? []).filter(r => r.rejected === true || r.success === false);
            let issues = 0;
            const recorded = new Set();
            for (const result of refused) {
                const operation = ops.find(op => op.id === (result.operationId ?? result.opId));
                if (!operation) continue;
                await session.queue.recordIssue(operation, result);
                recorded.add(operation.id);
                needsRecovery = true;
                issues++;
            }
            // E O LOTE INTEIRO VIRA PROBLEMA, MEMBRO A MEMBRO. O servidor devolve as N ops de um
            // lote recusado com o mesmo `status`, o mesmo `batchId` e o `batchFailedOperationId`
            // da culpada, então este laço normalmente não acrescenta nada; ele existe porque a
            // alternativa a um recibo faltante é a pior de todas as duas: uma irmã sem problema
            // guardado volta enviável e o gesto sai pela metade na próxima rodada. O motivo
            // guardado é o da CULPADA, que é a única frase que explica a recusa.
            const refusedBatches = refusedBatchIds(resp, ops);
            if (refusedBatches.size > 0) {
                const culprit = new Map();
                for (const result of refused) {
                    const id = result.operationId ?? result.opId;
                    const batchId = result.batchId ?? ops.find(op => op.id === id)?.batchId ?? null;
                    if (batchId !== null && !culprit.has(batchId)) {
                        culprit.set(batchId, { id: result.batchFailedOperationId ?? id, result });
                    }
                }
                for (const operation of ops) {
                    const batchId = operation.batchId ?? null;
                    if (batchId === null || recorded.has(operation.id) || !refusedBatches.has(batchId)) continue;
                    const falha = culprit.get(batchId);
                    await session.queue.recordIssue(operation, {
                        ...falha.result,
                        operationId: operation.id,
                        batchId,
                        batchFailedOperationId: falha.id,
                    });
                    recorded.add(operation.id);
                    needsRecovery = true;
                    issues++;
                }
            }
            const ackedIds = acknowledgedOperationIds(resp, ops);
            const removed = await session.queue.dequeue(ackedIds);
            if (removed === 0 && issues === 0) {
                // Nada saiu da fila: o próximo peek devolve exatamente estas ops e o laço
                // gira em vazio para sempre. Falhar alto é a saída que preserva o dado E
                // avisa (o `sync-flush` conta a falha e fala com o usuário).
                record(TraceStage.FLUSH_PUSH, {
                    atlasId: session.atlasId, opIds, outcome: TraceOutcome.FAILED,
                    reason: 'unacknowledged_batch',
                });
                await this._reconcileConvergenceGuard(session);
                throw new Error(
                    `sync: o servidor não confirmou nenhuma das ${ops.length} operações enviadas`
                );
            }
            pushed += removed;
            ops = await session.queue.peek(isolating ? 1 : recorte);
        }
        session.assertActive();
        if (needsRecovery) await this.resync();
        session.assertActive();
        await this._reconcileConvergenceGuard(session);
        return { pushed };
    }

    /**
     * Roda a auto-cura do freio de convergencia FORA de um flush.
     *
     * POR QUE ELA PRECISA DE PORTA PUBLICA (medido em 2026-08-29). A reconciliacao so existia
     * dentro de `flush()`, e `flushOnce` (sync-flush.js) sai antes de chamar o flush quando a
     * fila local esta VAZIA. O resultado e um buraco exatamente no estado em que a rede de
     * seguranca e necessaria: um contador de edicao local que ficou presoparalisa as ops remotas
     * daquela entidade, e um cliente sem nada mais a enviar nunca mais reconcilia. Ele diverge em
     * silencio ate um F5.
     *
     * Medido no `browser-collab-three-client-flow`: na disputa de tres clientes, o perdedor ficava
     * com a propria cor por 30 s (o teste inteiro), com os `ws.inbound` do vencedor chegando e
     * NENHUM `apply.persist` atras deles, enquanto os outros dois convergiam.
     *
     * @returns {Promise<void>}
     */
    async reconcileConvergenceGuard() {
        await this._reconcileConvergenceGuard();
    }

    /**
     * @private Self-heals the pending-local-edit convergence guard against the operation queue
     * after a flush (clears leaked deferrals; see reconcilePendingLocalEdits). Never throws.
     * @returns {Promise<void>}
     */
    async _reconcileConvergenceGuard(session = this._session) {
        try {
            session ??= new SyncSession(this._atlasId, sessionContext.userId);
            session.assertActive();
            const remaining = await (session.queue.getPendingProjection?.() ?? session.queue.getAll());
            session.assertActive();
            const remainingIds = new Set(remaining.map((o) => o.entityId).filter(Boolean));
            await reconcilePendingLocalEdits(remainingIds);
        } catch (err) {
            if (err?.name === 'AbortError') return;
            console.warn('reconcilePendingLocalEdits failed:', err);
        }
    }

    /**
     * Pulls operations (or a snapshot) missed since the last applied version
     * and applies them locally, advancing `lastVersion`.
     * @returns {Promise<void>}
     */
    async pull() {
        const session = this._session ?? this._beginSession(this._atlasId);
        const result = await apiClient.pullSync(session.atlasId, this._lastVersion, { signal: session.signal });
        session.assertActive();
        if (result?.snapshot) {
            await applyRemoteSnapshot(result.snapshot, session);
            session.assertActive();
            this._haveSnapshot = true;
        } else if (result?.operations) {
            // Same structural-marker guard as the syncResponse handler. Without it a
            // `map_merge` marker would fall through to applyRemoteOperation's
            // `default:` branch — a console.warn and a silent no-op — leaving this peer
            // stale with no sign anything was missed. Harmless today only because
            // pull() has no caller left in src/; a guard that exists in one of two
            // twin paths is the kind of asymmetry that becomes a bug the day the dead
            // path is revived.
            if (result.operations.some(isStructuralMarker)) {
                await this.resync();
                return;
            }
            for (const op of result.operations) {
                if (await applyRemoteOperation(op, session) === false) return false;
            }
        }
        session.assertActive();
        this._lastVersion = result?.currentVersion ?? this._lastVersion;
    }

    /**
     * Re-pulls a FRESH FULL snapshot and applies it. Used when a peer performs a server-side
     * operation OUTSIDE the CRDT op log (duplicate/merge a map, rename the atlas, import) — the new
     * state never arrives as ops, so an incremental pull would miss it; only a snapshot picks it
     * up. Best-effort and guarded against overlapping runs.
     * @returns {Promise<void>}
     */
    async resync() {
        if (!this._atlasId) return;
        const session = this._session ?? this._beginSession(this._atlasId);
        // A second notification may describe a commit newer than the in-flight snapshot.
        // Share the worker, but fetch again before reporting that all requests are complete.
        session.resyncRequested = true;
        if (session.resyncPromise) return session.resyncPromise;
        session.recovering = true;
        session.resyncPromise = (async () => {
            let staleResponses = 0;
            do {
                session.resyncRequested = false;
                const result = await apiClient.pullSync(session.atlasId, 0, { signal: session.signal });
                session.assertActive();
                if (result?.snapshot) {
                    try {
                        await applyRemoteSnapshot(result.snapshot, session);
                    } catch (error) {
                        session.assertActive();
                        if (error?.code !== 'STALE_SYNC_SNAPSHOT' || ++staleResponses >= 3) throw error;
                        session.resyncRequested = true;
                        continue;
                    }
                    session.assertActive();
                    this._lastVersion = result.currentVersion ?? this._lastVersion;
                    wsClient.setLastVersion(this._lastVersion);
                    this._haveSnapshot = true;
                    wsClient.setHaveSnapshot(true);
                }
            } while (session.resyncRequested);
            session.recovering = false;
        })().finally(() => { session.resyncPromise = null; });
        return session.resyncPromise;
    }

    /**
     * Closes the WebSocket (no reconnect). Local state is retained.
     *
     * `forgetAtlas` E O QUE SEPARA "PAUSAR" DE "SAIR", e a falta dele era um defeito medido.
     * Ate 2026-08-25 este metodo limpava papel, recursos concedidos, marcas de edicao e a
     * sobreposicao de configuracao, e NAO zerava `_atlasId`; so `logoutAndDisconnect` zerava. O
     * campo e lido por `currentAtlasLockKey` (`account/open-atlas.service.js`) ANTES de qualquer
     * outra fonte, entao uma aba que saisse de um atlas de servidor para um atlas LOCAL sem
     * recarregar a pagina continuava anunciando a chave `remote:<id>` do atlas que acabara de
     * deixar. As consequencias sao duas, e nenhuma delas produz erro: a aba bloqueia outra aba
     * que queira abrir aquele atlas de servidor, e ela propria fica sem defender o slot local que
     * de fato montou. O mesmo campo alimenta `deep-link/atlas-url-sync.js`, entao a barra de
     * enderecos tambem continuava exibindo `?atlas=` de um atlas fechado.
     *
     * O PADRAO CONTINUA `false` DE PROPOSITO. O freio do tab-lock
     * (`store/sync/tab-lock-sync-brake.js`) chama este metodo para PARAR a aba, e a retomada
     * reconecta o MESMO atlas: zerar o id ali apagaria justamente o que a retomada precisa ler.
     * Quem passa `true` e quem esta indo embora do atlas para valer, e hoje sao os dois caminhos
     * de entrada em atlas LOCAL (`switchAtlas` e `switchToNewLocalAtlas`).
     *
     * @param {object} [options]
     * @param {boolean} [options.resumeGranted=true] - Re-somar as concessoes PESSOAIS sem atlas
     *   em foco. O logout passa false, porque limpa a sessao logo em seguida.
     * @param {boolean} [options.forgetAtlas=false] - Esquecer QUAL atlas estava conectado. Passe
     *   true quando a aba nao vai voltar a esse atlas por si mesma.
     * @returns {void}
     */
    disconnect({ resumeGranted = true, forgetAtlas = false } = {}) {
        this._session?.close();
        this._session = null;
        wsClient.disconnect();
        // O REGISTRO DE OPERACOES SAI JUNTO COM O SOCKET, e ate 2026-09-13 so o logout o
        // desligava. A janela que isso deixava aberta e a de F7: entre montar o namespace
        // remoto e terminar a negociacao (`activateRemoteAtlas` -> `markStoreRemote` ->
        // `connect`, em `account/open-atlas.service.js`) o escopo ja e remoto, e o estado do
        // registro era o que tivesse sobrado da conexao anterior. Desligar aqui torna a janela
        // DETERMINISTICA: nela toda edicao remota e RECUSADA por
        // `persistOperationIntents` (que lanca), em vez de gravar a entidade sem intencao
        // nenhuma. Quem religa e o proprio `connect`, depois do snapshot.
        disableOperationLogging();
        // O PAPEL E DO ATLAS, e sai com ele. Ficando, o `owner` do atlas A valeria durante a
        // janela de conexao do atlas B, que e conceder o que o servidor ainda nao respondeu.
        // Ver `sessionContext.forgetAtlasRole`.
        sessionContext.forgetAtlasRole();
        // The per-atlas config overlay no longer applies — restore the deploy-level config and
        // re-gate the UI back to its defaults.
        //
        // As DUAS chamadas, e nao uma: `revertAtlasSettings` restaura o baseline por
        // cima do `config`, e o baseline CONTEM os recursos concedidos (e o que
        // impede o revert de apaga-los). Quem os tira e `clearVisibleResources`.
        // Chamar so uma deixa metade do trabalho feito.
        clearVisibleResources();
        // Id de entidade nao e unico ENTRE atlas, entao uma marca de "eu editei isto" deixada
        // do atlas anterior faria o proximo atlas avisar de atropelo que nunca houve.
        clearLocalEditMarks();
        revertAtlasSettings();
        // Quem continua LOGADO nao perde a concessao PESSOAL ao sair do atlas: ela
        // nao depende de atlas nenhum. O que cai e so o EMPRESTIMO, e a forma de
        // dizer isso e re-somar sem atlas em foco. Sem `await` de proposito —
        // `disconnect` e sincrono e nenhum chamador espera por ele; o logout, que
        // chama este metodo antes de limpar a sessao, apaga a soma logo em seguida.
        if (resumeGranted && sessionContext.isAuthenticated()) {
            refreshVisibleResources(null).catch(() => {});
        }
        try {
            getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: null });
        } catch {
            // No UI bus (headless).
        }
        if (forgetAtlas) {
            // As TRES linhas sao a mesma frase dita as tres partes que guardam "em que atlas eu
            // estou": o motor, a versao que ele ja aplicou, e o destino das imagens. Zerar so o
            // id deixaria um `_lastVersion` de outro atlas valendo no proximo `connect` sem pull
            // inicial, e deixaria a sincronizacao de imagens escrevendo no atlas abandonado.
            this._atlasId = null;
            this._lastVersion = 0;
            this._haveSnapshot = false;
            setImageSyncAtlas(null);
        }
    }

    /**
     * Full teardown: disconnect, revoke tokens server-side, clear the session,
     * and stop logging local operations.
     * @returns {Promise<void>}
     */
    async logoutAndDisconnect() {
        // `resumeGranted: false` NAO e microotimizacao: a re-soma de `disconnect` sai
        // sem `await`, entao no logout ela poderia aterrissar DEPOIS do
        // `clearVisibleResources` e re-somar o que acabara de ser apagado. Desligar a
        // re-soma na origem torna a ordem deterministica em vez de provavel.
        this.disconnect({ resumeGranted: false });
        setImageSyncAtlas(null);
        await apiClient.logout();
        sessionContext.clearSession();
        clearVisibleResources();
        // Id de entidade nao e unico ENTRE atlas, entao uma marca de "eu editei isto" deixada
        // do atlas anterior faria o proximo atlas avisar de atropelo que nunca houve.
        clearLocalEditMarks();
        // Redundante com o `disconnect` acima DE PROPOSITO: a chamada e idempotente, e o
        // logout e o caminho onde "parar de registrar" tem de valer mesmo que alguem mude o
        // disconnect. Duas chamadas, um estado.
        disableOperationLogging();
        // Forget the atlas so a subsequent boot/connect starts clean and nothing thinks
        // a server atlas is still open.
        this._atlasId = null;
        this._lastVersion = 0;
        this._haveSnapshot = false;
    }

    /**
     * Wires the remote handler event bus, the sync gateway, and the WS inbound handlers.
     * Idempotent (wire-once). Operation logging is toggled per connect path (connect enables it,
     * connectPublic disables it for the read-only visitor), NOT here.
     * @private
     */
    _wireOnce() {
        if (this._handlersWired) return;

        // Feed remote-handler events into the app event bus when the service
        // container is up. In headless / flush-only usage (no `initServices()`),
        // `getEventBus()` throws — the engine can still queue/flush/sync without a
        // UI bus, and the remote handler guards a null bus, so we degrade quietly.
        try {
            setRemoteHandlerEventBus(getEventBus());
        } catch {
            // Services not initialized — proceed without UI event emission.
        }
        syncGateway.setRemoteOperationHandler(async (op) => {
            const session = this._session;
            if (!session) return false;
            session.assertActive();
            const applied = await applyRemoteOperation(op, { scope: session.scope, signal: session.signal, waitForDeferred: true });
            session.assertActive();
            return applied;
        }, async (ops) => {
            const session = this._session;
            if (!session) return false;
            session.assertActive();
            const applied = await applyRemoteOperations(ops, { scope: session.scope, signal: session.signal, waitForDeferred: true });
            session.assertActive();
            return applied;
        });

        // Return the promise so the ws-client can SERIALIZE applies (the handler does an
        // async read-modify-write of the map; a block body that didn't return the promise
        // let a batch of ops apply concurrently and clobber each other — all but one lost).
        wsClient.on('operation', (op) => syncGateway.applyRemoteOperation(op));
        // One frame, one apply: consecutive creates on a map share a single document write.
        wsClient.on('operationBatch', (ops) => syncGateway.applyRemoteOperations(ops));

        wsClient.on('syncResponse', async (msg) => {
            // Drop a late sync_response that arrives after a disconnect (e.g. during the
            // disconnect→clear window of a logout/atlas-switch) so it can't persist remote
            // data into a store being torn down (inv 2/3). The inbound op path is already
            // gated by syncGateway.isOnline(); the snapshot path was not.
            if (!connectionState.isOnline()) return false;
            const session = this._session;
            if (!session) return false;
            session.assertActive();
            if (msg?.isSnapshot) {
                await applyRemoteSnapshot(msg.snapshot, session);
                session.assertActive();
                // A snapshot that lands (or that is refused because the disk already holds it)
                // leaves the local state COMPLETE, so a later reconnect may ask for a tail. This
                // is the only path that learns it for a connect that skipped the initial pull.
                this._haveSnapshot = true;
                wsClient.setHaveSnapshot(true);
            } else {
                const ops = msg?.ops || [];
                // A structural REST change (map merge) moves rows in bulk, so no
                // per-entity op describes it. The backend logs a MARKER op instead
                // (see MAP_MERGE_ENTITY_TYPE in backend maps.service.js), which this
                // peer resolves the same way the live `maps_merged` broadcast is
                // resolved: by taking a snapshot. Applying the rest of the tail
                // first would be wasted work, since the snapshot supersedes it.
                if (ops.some(isStructuralMarker)) {
                    await this.resync();
                    return; // resync() re-reads the version from the snapshot
                }
                // THE TAIL GOES THROUGH THE FRAME PATH, like a live frame: same contract (in order, stop
                // at the first `false`), and consecutive creates on one map share one document write.
                // A peer back from offline receives a colleague's import here, whole.
                if (await applyRemoteOperations(ops, { scope: session.scope, signal: session.signal, waitForDeferred: true }) === false) return false;
            }
            session.assertActive();
            const version = msg?.currentVersion;
            if (Number.isFinite(version)) {
                this._lastVersion = version;
                wsClient.setLastVersion(version);
            }
            session.recovering = false;
        });

        // The connected atlas was deleted server-side (`atlas_deleted` broadcast). Stop the
        // auto-reconnect from chasing the dead room, then notify the UI to tear down + redirect.
        wsClient.on('atlasDeleted', (msg) => {
            this.disconnect();
            try {
                getEventBus().emit(EventTypes.ATLAS_DELETED_REMOTE, { atlasId: msg?.atlasId });
            } catch {
                // No UI bus (headless) — disconnect already handled the transport teardown.
            }
        });

        // Ownership changed server-side (`atlas_owner_changed`). Re-resolve THIS client's role
        // locally from the broadcast (it carries the new owner id) so the UI re-gates immediately;
        // the WS heartbeat reconcile is the server-side fallback that adjusts ws.permission.
        wsClient.on('atlasOwnerChanged', (msg) => {
            const myId = sessionContext.userId;
            if (myId) {
                if (msg?.newOwnerId === myId) {
                    sessionContext.updateRole('owner');
                } else if (sessionContext.role === 'owner') {
                    sessionContext.updateRole('manager'); // demoted ex-owner → co-Gestor
                }
            }
            try {
                getEventBus().emit(EventTypes.ATLAS_OWNER_CHANGED, {
                    atlasId: msg?.atlasId,
                    newOwnerId: msg?.newOwnerId,
                });
            } catch {
                // No UI bus (headless).
            }

            // E A SOMA DOS RECURSOS PRIVADOS MUDA JUNTO, que é o que ninguém re-pedia.
            // O braço do EMPRÉSTIMO (`fn_granted_resource_ids`, no servidor) pergunta pelo
            // DONO do atlas: trocado o dono, o que o atlas emprestava pode deixar de valer
            // para TODA a sala de uma vez. Sem esta re-soma o `config` continua listando o
            // recurso que o servidor já recusa, e o usuário vê CAMADA QUEBRADA em vez de
            // camada ausente — o pior dos dois, porque não se explica sozinho.
            //
            // O guard de `isOnline` cobre SÓ a re-soma, pela mesma razão do handler de
            // settings: um frame atrasado, chegando depois do disconnect, mexeria num
            // baseline que já foi restaurado. O bloco de papel acima fica fora dele de
            // propósito (re-gatear o papel é barato e não toca o baseline).
            if (!connectionState.isOnline()) return;
            // Pelo atlas CONECTADO, nunca pelo `msg.atlasId`: o payload aditivo é do escopo
            // em foco, e o frame só chega pela sala em que estamos.
            refreshVisibleResources(this._atlasId).then((ok) => {
                if (!ok) return;
                try {
                    // O MESMO evento do overlay, e não um novo, pela razão escrita no
                    // handler de `atlasResources`: os assinantes que releem o `config`
                    // (catálogo, seletor de base, barra inferior) assinam este. Os únicos
                    // assinantes de ATLAS_OWNER_CHANGED cuidam do menu de conta, então
                    // emitir só aquele mudaria a soma e não mudaria a tela.
                    getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'atlas_owner' });
                } catch {
                    // No UI bus (headless).
                }
            }).catch(() => {});
        });

        // A share for THIS client changed live (`sharing_updated`): re-gate the local role from the
        // broadcast (which carries the affected user's new frontend `role`) so the safe view engages on
        // a write→read downgrade and the toolbars return on an upgrade — without a reconnect. Only the
        // affected user reacts; a global admin keeps full access regardless of per-atlas shares. The
        // updateRole() fires SESSION_CHANGED, which the view-mode driver and maps tab already consume.
        wsClient.on('sharingUpdated', (msg) => {
            const myId = sessionContext.userId;
            if (!myId || String(msg?.userId) !== String(myId)) return;
            if (sessionContext.isAdmin()) return;
            if ((msg.action === 'user_updated' || msg.action === 'user_added') && msg.role) {
                sessionContext.updateRole(msg.role);
            }
        });

        // Atlas settings changed server-side (`atlas_settings_updated`) — re-apply the per-atlas
        // config overlay (3D/360/basemap availability), then notify the UI to re-gate.
        wsClient.on('atlasSettings', (msg) => {
            // Drop a late atlas_settings_updated frame arriving after a disconnect (the
            // disconnect→revert window): re-applying with no connected atlas would re-capture the
            // just-restored config as a new baseline and wrongly re-restrict it (mirrors the
            // sync_response gate above).
            if (!connectionState.isOnline()) return;
            applyAtlasSettings(msg?.settings);
            try {
                getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: msg?.settings });
            } catch {
                // No UI bus (headless).
            }
        });

        // O atlas passou a emprestar (ou deixou de emprestar) um recurso privado.
        // Re-pede o payload ADITIVO, que e pessoal: o frame so avisa que mudou.
        wsClient.on('atlasResources', () => {
            // O MESMO guard do frame de settings, e pela mesma razao: um frame que
            // chega atrasado, depois do disconnect, re-somaria num escopo que ja nao
            // existe. `refreshVisibleResources` mexe no baseline, entao a janela
            // disconnect -> revert e exatamente onde o dano apareceria.
            if (!connectionState.isOnline()) return;
            refreshVisibleResources(this._atlasId).then((ok) => {
                if (!ok) return;
                try {
                    // O MESMO evento do overlay, e nao um novo, porque os tres
                    // assinantes (catalogo, seletor de base e barra inferior) IGNORAM
                    // o payload: os tres apenas releem o `config`, que e exatamente o
                    // que precisa acontecer aqui. Um evento novo obrigaria os tres a
                    // assinarem duas coisas para reagir ao mesmo fato. Vai sem chave
                    // `settings` de proposito: nao houve mudanca de settings, e
                    // mandar `undefined` ali seria afirmar que houve.
                    getEventBus().emit(EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'atlas_resources' });
                } catch {
                    // No UI bus (headless).
                }
            }).catch(() => {});
        });

        // A peer created/altered server-side data OUTSIDE the CRDT op log (duplicate/merge a map,
        // rename the atlas). The entities never arrive as ops, so re-pull a fresh snapshot to pick
        // them up, then refresh the UI. (These events were silently dropped before.)
        wsClient.on('serverResync', async () => {
            await this.resync();
            try {
                getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } catch {
                // No UI bus (headless).
            }
        });

        // The socket gave up reconnecting because its token expired and nothing can renew it.
        // Not modal and not a reload: the person may still be reading the map as it is.
        wsClient.on('credentialExpired', () => {
            try {
                showWarning(LINK_PUBLICO_VENCIDO, { duration: 0, closable: true });
            } catch {
                // No document (headless).
            }
        });

        this._handlersWired = true;
    }
}

/** Shared singleton sync orchestrator. */
export const syncEngine = new SyncEngine();

export { SyncEngine };
