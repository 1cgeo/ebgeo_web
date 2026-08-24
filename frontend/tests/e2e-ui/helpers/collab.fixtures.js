// Path: e2e-ui/helpers/collab.fixtures.js

/**
 * The collaboration fixture — one import that gives a spec a fully wired multi-user
 * session and the full-chain DSL bound to it. It removes the seed/login/open/trace/DB
 * boilerplate every collab spec used to repeat, so a new robust spec is ~3 lines:
 *
 *   import { collabTest, drawLineUI } from '../helpers/collab.fixtures.js';
 *   collabTest('linha percorre a cadeia inteira', async ({ collab }) => {
 *     const id = await drawLineUI(collab.author, COORDS);
 *     await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
 *   });
 *
 * Scale to N clients (author + N peers) per describe:
 *   collabTest.use({ collabOptions: { peers: 2 } });   // three-client fan-out
 *
 * The fixture: seeds two users + a shared atlas, opens author + peers (each its own
 * browser context, with the SyncLedger tracer + render probe on), resolves the owner
 * token for backend-ring reads, opens the read-only SQL ground-truth connection, and
 * on teardown attaches the unified ledger and closes everything. Skips cleanly when the
 * backend was unavailable (global-setup recorded skip).
 */

import { test as base, expect } from '@playwright/test';
import { readState } from '../state.js';
import {
    seedSharedAtlas, addSharedUser, openClient,
    assertLedgerClean,
    drawLineUI, drawPolygonUI, drawPointUI, readFeatures, currentMapName,
    openLayersTab, selectFeatureUI, savePanelUI, recolorViaPanelUI, selectAndRecolorUI, deleteFeatureUI,
    vereditoDoCommitDeCor,
    renameViaPanelUI, selectAndRenameUI, drawMilitarySymbolUI,
} from './collab-helpers.js';
import { collectLedger, reduceLedger, renderReport, findChainViolations } from './ledger.js';
import { clearClientTrace } from './trace-helpers.js';
import { createDb, closeDb } from './db.js';
import { ApiClient } from '../../../src/js/store/sync/api-client.js';
import {
    expectFullSync, expectFullSyncDelete, expectNotSynced, expectBlockedAt,
} from './full-chain.js';

const state = readState();

/** Re-exported UI drivers + state reads so specs need a single import. */
export {
    drawLineUI, drawPolygonUI, drawPointUI, readFeatures, currentMapName,
    openLayersTab, selectFeatureUI, savePanelUI, recolorViaPanelUI, selectAndRecolorUI, deleteFeatureUI,
    vereditoDoCommitDeCor,
    renameViaPanelUI, selectAndRenameUI, drawMilitarySymbolUI,
};

export const collabTest = base.extend({
    /** Per-describe knobs: author + `peers` peers, share `permission`, seed `mapName`. */
    collabOptions: [{ peers: 1, permission: 'write', mapName: 'Mapa Tático' }, { option: true }],

    collab: async ({ browser, collabOptions }, use) => {
        const baseUrl = state.baseUrl;
        const { peers: peerCount, permission, mapName } = collabOptions;

        // 1) Seed two users + shared atlas (owner=userA, shared write with userB).
        const seed = await seedSharedAtlas(browser, baseUrl, { mapName, permission });

        // 2) Owner token for the backend trace ring (/debug/trace needs atlas read).
        let ownerToken;
        try {
            const owner = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await owner.login(seed.userA.username, seed.userA.password);
            ownerToken = owner.getAccessToken();
        } catch {
            // Backend ring is best-effort enrichment; the client rings + SQL carry the core signal.
        }

        // 3) Extra peers beyond userB (for 3+ client fan-out), each registered + shared.
        const extraCreds = [];
        if (peerCount > 1) {
            const tmp = await browser.newPage();
            await tmp.goto('/');
            for (let i = 1; i < peerCount; i++) {
                extraCreds.push(await addSharedUser(tmp, baseUrl, seed.userA, seed.atlasId, { permission, label: `peer${i}` }));
            }
            await tmp.close();
        }

        // 4) Open author + all peers (fresh contexts, trace + render probe on).
        // `expectMapName` faz o openClient esperar o mapa do atlas ficar ATIVO antes de
        // devolver o cliente. Sem isso o spec podia comecar com o peer ainda no mapa local,
        // e a primeira assercao caia lendo "Principal" (visto em duas suites cheias
        // seguidas, no maps-layers). Prontidao do harness, nao assercao do teste.
        const author = await openClient(browser, baseUrl, seed.atlasId, seed.userA, { expectMapName: mapName });
        const peerCredsList = [seed.userB, ...extraCreds];
        const peers = [];
        for (const creds of peerCredsList) {
            peers.push(await openClient(browser, baseUrl, seed.atlasId, creds, { expectMapName: mapName }));
        }

        // 5) Read-only SQL ground-truth connection (null if no dbName, e.g. skip path).
        const db = state.dbName ? createDb(state.dbName) : null;

        const ctx = {
            author, peers, db,
            atlasId: seed.atlasId, mapId: seed.mapId, mapName: seed.mapName,
            baseUrl, ownerToken,
            userA: seed.userA, userB: seed.userB,
        };

        const collab = {
            ...ctx,
            /** All pages (author first) — for ledger collection / broadcast assertions. */
            pages: [author, ...peers],
            /**
             * Clears every client's trace ring. Call BEFORE a new op when the SAME entity is
             * mutated repeatedly (e.g. rename→recolor→move on one line), so the next
             * expectFullSync resolves the CURRENT op's id unambiguously (entity+opType alone is
             * not unique across repeated updates). The backend ring + SQL are opId-filtered, so
             * only the client rings need clearing.
             */
            clearTraces: async () => {
                for (const page of [author, ...peers]) await clearClientTrace(page);
            },
            /** Credentials of each peer (index-aligned with `peers`) — for reopen/late-join. */
            peerCreds: peerCredsList,
            /**
             * Closes peer[index]'s context and reopens a FRESH session for the same user (a
             * disconnect + rejoin / late-join). Updates `peers[index]` in place and returns the
             * new page. Used by reconnect / three-client late-join tests.
             */
            reopenPeer: async (index) => {
                try { await peers[index].context().close(); } catch { /* already closed */ }
                // Mesma prontidao do open inicial: um peer reaberto tambem ativa o mapa do
                // atlas de forma assincrona, e o late-join e justamente onde se espera carga.
                const fresh = await openClient(browser, baseUrl, seed.atlasId, peerCredsList[index], { expectMapName: mapName });
                peers[index] = fresh;
                return fresh;
            },
            expectFullSync: (opRef) => expectFullSync(ctx, opRef),
            expectFullSyncDelete: (opRef) => expectFullSyncDelete(ctx, opRef),
            /**
             * Runs the full chain from an ARBITRARY author (any of the open pages) to all the
             * others — for round-trip tests (A creates, B edits, A must see it): the author is
             * whichever page made the change, every other page is a verified peer.
             */
            expectFullSyncFrom: (fromPage, opRef) =>
                expectFullSync({ ...ctx, author: fromPage, peers: [author, ...peers].filter((p) => p !== fromPage) }, opRef),
            expectFullSyncDeleteFrom: (fromPage, opRef) =>
                expectFullSyncDelete({ ...ctx, author: fromPage, peers: [author, ...peers].filter((p) => p !== fromPage) }, opRef),
            /** Runs the chain from the author to a SPECIFIC subset of peers (e.g. while one is offline). */
            expectFullSyncTo: (peersSubset, opRef) => expectFullSync({ ...ctx, peers: peersSubset }, opRef),
            expectNotSynced: (opRef, opts) => expectNotSynced(ctx, opRef, opts),
            expectBlockedAt: (opRef, opts) => expectBlockedAt(ctx, opRef, opts),
            /** Opt-in session-wide invariant check (use for clean convergence flows only). */
            assertLedgerClean: (opts) =>
                assertLedgerClean(base.info(), [author, ...peers], baseUrl, seed.userA, seed.atlasId, opts),
            /**
             * Session-wide full-chain net: asserts NO IndexedDB write the pipeline claimed
             * went unconfirmed (I-AP1 author / I-AP2 peer apply.persist invariants).
             */
            assertChainClean: async () => {
                const spans = await collectLedger([author, ...peers], { baseUrl, token: ownerToken, atlasId: seed.atlasId });
                const violations = findChainViolations(spans);
                expect(violations, `full-chain invariant violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
            },
        };

        await use(collab);

        // Teardown: attach the unified ledger for forensics, then close contexts + DB.
        try {
            const spans = await collectLedger([author, ...peers], { baseUrl, token: ownerToken, atlasId: seed.atlasId });
            const report = reduceLedger(spans);
            const info = base.info();
            await info.attach('syncledger.report.md', { body: renderReport(report), contentType: 'text/markdown' });
            await info.attach('syncledger.jsonl', {
                body: spans.map((s) => JSON.stringify(s)).join('\n'),
                contentType: 'application/x-ndjson',
            });
        } catch {
            // Forensic attachment is best-effort; never let it mask the real test result.
        }
        for (const page of [author, ...peers]) {
            try { await page.context().close(); } catch { /* already closed */ }
        }
    },
});

// Skip every collab test cleanly when the backend never came up (mirrors the existing
// `state.skip ? describe.skip : describe` gate, but baked into the shared test object).
collabTest.beforeEach(() => {
    collabTest.skip(state.skip === true, `backend unavailable: ${state.reason || ''}`);
});

// Close the shared SQL connection once after the whole worker finishes.
collabTest.afterAll(async () => {
    await closeDb();
});

export { expect };
