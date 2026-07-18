// Path: e2e-ui/helpers/full-chain.js

/**
 * The full-chain assertion DSL — the centrepiece of the robust collab specs.
 *
 * `expectFullSync` walks ONE operation through every link of the multi-user pipeline,
 * in order, and on failure throws naming the EXACT link that broke plus the last stage
 * each actor reached. It cross-checks the deterministic SyncLedger spans against two
 * independent ground-truths the trace can't fake: the client IndexedDB (via the
 * repository) and the backend Postgres rows (via direct SQL).
 *
 *   Link 1  author IndexedDB     apply.persist(author)        + repo.getMap(author)
 *   Link 2  transport → backend  push.ack(author)             (flush.push diagnostic)
 *   Link 3  backend stored       server.inserted/applied      + SELECT operations / entity row
 *   Link 4  signal → peers       server.broadcast + ws.inbound(peer)
 *   Link 5  peer IndexedDB       apply.persist(peer)          + repo.getMap(peer)
 *   Link 6  appeared in browser  remote.applied(peer)         + render.source(inSource)
 *
 * Usage (bound by the collab fixture): `await collab.expectFullSync({ entityId, type, operationType })`.
 */

import { expect } from '@playwright/test';
import {
    waitForEntitySpan, tryWaitStage, waitForRenderSource, renderProbeOn,
    peerSawRemoteApplied, findDropSpan, opHistory,
} from './trace-helpers.js';
import { readIdbEntity } from './idb.js';
import { TABLE_BY_ENTITY } from './db.js';

const LINK_NAMES = {
    1: 'author IndexedDB',
    2: 'transport → backend',
    3: 'backend stored (Postgres)',
    4: 'signal relayed to peers',
    5: 'peer IndexedDB',
    6: 'appeared in peer browser',
};

/** A precise, diagnostic-bearing failure of the full chain. */
export class FullChainError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FullChainError';
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Compact "stage → stage:outcome" trail for one actor's spans. */
function trail(spans) {
    if (!spans || !spans.length) return '(no spans)';
    return spans.map((s) => `${s.stage}${s.outcome && s.outcome !== 'ok' ? `:${s.outcome}` : ''}`).join(' → ');
}

/** Fetches the backend ring's spans for one op (filtered server-side by op_id). Best-effort. */
async function fetchServerOpTrace(ctx, opId) {
    if (!ctx.baseUrl || !ctx.ownerToken || !ctx.atlasId || !opId) return [];
    try {
        const url = `${ctx.baseUrl}/api/v1/debug/trace?atlasId=${encodeURIComponent(ctx.atlasId)}&opId=${encodeURIComponent(opId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${ctx.ownerToken}` } });
        if (!res.ok) return [];
        const body = await res.json();
        return body?.data?.spans || [];
    } catch {
        return [];
    }
}

/** Polls the backend ring until a server stage appears for opId (or timeout). */
async function pollServerStage(ctx, opId, stage, timeout = 12000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const spans = await fetchServerOpTrace(ctx, opId);
        const hit = spans.find((s) => s.stage === stage);
        if (hit) return { hit, spans };
        if (Date.now() >= deadline) return { hit: null, spans };
        await sleep(150);
    }
}

/** Gathers each actor's op trail for the error message (author, peers, server). */
async function dumpChain(ctx, opId, entityId) {
    const lines = [`  op=${opId ?? '(unresolved)'} entity=${entityId}`];
    try {
        const a = opId ? await opHistory(ctx.author, opId) : [];
        lines.push(`  author : ${trail(a)}`);
        const peers = ctx.peers || [];
        for (let i = 0; i < peers.length; i++) {
            const ph = opId ? await opHistory(peers[i], opId) : [];
            lines.push(`  peer[${i}]: ${trail(ph)}`);
        }
        const srv = await fetchServerOpTrace(ctx, opId);
        lines.push(`  server : ${trail(srv)}`);
    } catch (e) {
        lines.push(`  (diagnostic gather failed: ${e.message})`);
    }
    return lines.join('\n');
}

/** Builds and returns a FullChainError for `link`, with the chain dump appended. */
async function broke(ctx, link, opId, entityId, detail) {
    const dump = await dumpChain(ctx, opId, entityId);
    return new FullChainError(
        `[full-chain] BROKE AT LINK ${link} — ${LINK_NAMES[link]}: ${detail}\n${dump}`,
    );
}

/**
 * Core walker. `mode` is 'upsert' (create/update — entity must EXIST at the ends) or
 * 'delete' (entity must be GONE at the ends; backend row tombstoned).
 */
async function runFullChain(ctx, opRef, mode) {
    const { author, peers = [], db } = ctx;
    const {
        entityId,
        entityType = 'feature',
        type,
        operationType = mode === 'delete' ? 'delete' : 'create',
        timeout = 15000,
        // Skip the render.source check (link 6) for features whose source the probe cannot
        // resolve to a GeoJSON source — e.g. military_symbols render via an icon/image layer,
        // not a `getSource('military_symbols')` GeoJSON source. remote.applied + IDB still verify link 6.
        skipRender = false,
    } = opRef;
    const wantPresent = mode !== 'delete';
    let opId = opRef.opId || null;

    // ---- Link 1: author IndexedDB ----
    const apAuthor = await waitForEntitySpan(author, { entityId, operationType, stage: 'apply.persist' }, timeout);
    if (!apAuthor) throw await broke(ctx, 1, opId, entityId, `author never recorded apply.persist for entity ${entityId}`);
    opId = opId || apAuthor.opId;
    const idbA = await readIdbEntity(author, { entityId, entityType, mapId: ctx.mapId, storage: type });
    // The apply.persist span already proves the author wrote it; the by-UUID IDB read is an extra
    // ground-truth that is reliable for FEATURES (consistent UUID-keying) but not for a
    // locally-authored MAP/LAYER/GROUP, whose local record may be NAME-keyed on its author while
    // the sync UUID rides only the op. Enforce the author IDB read for features only; the
    // PEER-side IDB read (link 5) stays a hard check for every entity type.
    if (entityType === 'feature' && idbA.found !== wantPresent) {
        throw await broke(ctx, 1, opId, entityId,
            `author IndexedDB ${idbA.found ? 'still has' : 'is missing'} entity ${entityId} (expected ${wantPresent ? 'present' : 'absent'})`);
    }

    // ---- Link 2: transport → backend (server acked the author's flush) ----
    const ack = await tryWaitStage(author, opId, 'push.ack', timeout);
    if (!ack) throw await broke(ctx, 2, opId, entityId, `op ${opId} never acked (push.ack missing — flushed but not confirmed)`);
    if (ack.outcome === 'failed') throw await broke(ctx, 2, opId, entityId, `op ${opId} push.ack outcome=failed`);

    // ---- Link 3: backend stored (spans + SQL ground-truth) ----
    const ins = await pollServerStage(ctx, opId, 'server.inserted', timeout);
    if (ins.spans.length && !ins.hit) throw await broke(ctx, 3, opId, entityId, `backend ring has spans for op but no server.inserted`);
    const applied = ins.spans.find((s) => s.stage === 'server.applied');
    if (applied && applied.outcome === 'no-effect') {
        throw await broke(ctx, 3, opId, entityId, `server.applied rowsAffected=0 (acked but wrote nothing)`);
    }
    if (db) {
        const opRow = await db.queryOperation(opId);
        if (!opRow) throw await broke(ctx, 3, opId, entityId, `op ${opId} absent from Postgres "operations" table`);
        if (entityType === 'feature') {
            const frow = await db.queryFeatureRow(entityId);
            if (!frow) throw await broke(ctx, 3, opId, entityId, `feature ${entityId} row absent in Postgres`);
            const tombstoned = !!frow.deleted_at;
            if (tombstoned === wantPresent) {
                throw await broke(ctx, 3, opId, entityId,
                    `feature ${entityId} Postgres row deleted_at=${frow.deleted_at} (expected ${wantPresent ? 'live' : 'tombstoned'})`);
            }
        } else if (TABLE_BY_ENTITY[entityType] && wantPresent) {
            const erow = await db.queryEntityRow(TABLE_BY_ENTITY[entityType], entityId);
            if (!erow) throw await broke(ctx, 3, opId, entityId, `${entityType} ${entityId} row absent in Postgres (${TABLE_BY_ENTITY[entityType]})`);
        }
    }

    // ---- Link 4: signal relayed to peers ----
    const bc = await pollServerStage(ctx, opId, 'server.broadcast', timeout);
    if (bc.spans.length && !bc.hit) throw await broke(ctx, 4, opId, entityId, `backend ring shows op but no server.broadcast`);
    for (let i = 0; i < peers.length; i++) {
        const wsin = await tryWaitStage(peers[i], opId, 'ws.inbound', timeout);
        if (!wsin) throw await broke(ctx, 4, opId, entityId, `peer[${i}] never received op ${opId} over WebSocket (ws.inbound missing)`);
    }

    // ---- Link 5: peer IndexedDB ----
    for (let i = 0; i < peers.length; i++) {
        const apPeer = await tryWaitStage(peers[i], opId, 'apply.persist', timeout);
        if (!apPeer) throw await broke(ctx, 5, opId, entityId, `peer[${i}] never persisted op ${opId} to IndexedDB (apply.persist missing)`);
        const idbP = await readIdbEntity(peers[i], { entityId, entityType, mapId: ctx.mapId, storage: type });
        if (idbP.found !== wantPresent) {
            throw await broke(ctx, 5, opId, entityId,
                `peer[${i}] IndexedDB ${idbP.found ? 'still has' : 'is missing'} entity ${entityId} (expected ${wantPresent ? 'present' : 'absent'})`);
        }
    }

    // ---- Link 6: appeared in the peer's browser ----
    for (let i = 0; i < peers.length; i++) {
        const ra = await waitForEntitySpan(peers[i], { entityId, operationType, stage: 'remote.applied' }, timeout);
        if (!ra) throw await broke(ctx, 6, opId, entityId, `peer[${i}] never emitted remote.applied for ${entityId}`);
        // Stronger render proof for features, when the render probe is on.
        if (entityType === 'feature' && !skipRender && (await renderProbeOn(peers[i]))) {
            const rs = await waitForRenderSource(peers[i], entityId, { present: wantPresent, timeout });
            if (!rs) {
                throw await broke(ctx, 6, opId, entityId,
                    `feature ${entityId} ${wantPresent ? 'never rendered into' : 'never left'} the peer[${i}] MapLibre source (render.source)`);
            }
        }
    }

    return { opId, entityId };
}

/**
 * Asserts a create/update op traversed the ENTIRE chain to every peer.
 * @param {Object} ctx - { author, peers, db, atlasId, baseUrl, ownerToken, mapId }
 * @param {Object} opRef - { entityId, entityType?, type?(storage bucket), operationType?, opId?, timeout? }
 * @returns {Promise<{opId: string, entityId: string}>}
 */
export function expectFullSync(ctx, opRef) {
    return runFullChain(ctx, opRef, 'upsert');
}

/** Asserts a DELETE op traversed the chain: entity GONE at both ends, backend row tombstoned. */
export function expectFullSyncDelete(ctx, opRef) {
    return runFullChain(ctx, opRef, 'delete');
}

/**
 * Negative assertion: an edit must NOT propagate to the peers (permission/lock/isolation).
 * Settles briefly, then asserts no peer applied the op and the entity is absent from every
 * peer's IndexedDB. If `expectDrop` is given, also asserts the author recorded that
 * preflush.drop reason (best-effort — some blocks happen before any op/span exists).
 *
 * @param {Object} ctx
 * @param {Object} opRef - { entityId, entityType?, type?, operationType? }
 * @param {Object} [opts] - { settle?: ms, expectDrop?: DropReason }
 */
export async function expectNotSynced(ctx, opRef, { settle = 3000, expectDrop } = {}) {
    const { author, peers = [] } = ctx;
    const { entityId, entityType = 'feature', type, operationType } = opRef;
    await sleep(settle);

    if (expectDrop) {
        const drop = await findDropSpan(author, entityId, expectDrop);
        expect(drop, `expected author preflush.drop(reason=${expectDrop}) for ${entityId}`).toBeTruthy();
    }

    for (let i = 0; i < peers.length; i++) {
        const applied = await peerSawRemoteApplied(peers[i], entityId, operationType);
        expect(applied, `peer[${i}] unexpectedly applied a remote op for ${entityId}`).toBe(false);
        const idbP = await readIdbEntity(peers[i], { entityId, entityType, mapId: ctx.mapId, storage: type });
        expect(idbP.found, `peer[${i}] IndexedDB unexpectedly contains ${entityId}`).toBe(false);
    }
}

/** Thin alias documenting intent: the op should be blocked, naming the expected drop reason. */
export function expectBlockedAt(ctx, opRef, { reason, settle } = {}) {
    return expectNotSynced(ctx, opRef, { expectDrop: reason, settle });
}
