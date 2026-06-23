// Path: e2e-ui/browser-collab-ledger.spec.js

/**
 * SyncLedger end-to-end demonstration — two real browsers + the real backend. Unlike the
 * other collab specs (which poll the store), this one drives the op and then reads the
 * UNIFIED ledger (client A ring + server ring + client B ring, merged by op.id) to make
 * a structured, rastreável assertion: the op converged on the peer, touched a row on the
 * server, and violated no SyncLedger invariant. The merged ledger.jsonl + report are
 * attached to the Playwright report as the AI-readable artifact.
 *
 * UI-first: client A creates the feature by DRAWING it through the real line tool
 * (drawLineUI: toolbar activate + canvas vertex clicks + right-click finish), exactly
 * like a user — the tool generates the feature id, which we read back and trace.
 *
 * Run headed:  npx playwright test browser-collab-ledger --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, pollPeerFeature, drawLineUI } from './helpers/collab-helpers.js';
import { waitForRemoteEntity, getClientLedger, clearClientTrace } from './helpers/trace-helpers.js';
import { collectLedger, reduceLedger, renderReport } from './helpers/ledger.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('SyncLedger — deterministic cross-client trace + invariant oracle', () => {
    test('A creates a feature; B applies it; the merged ledger is clean and converged', async ({ browser }, testInfo) => {
        test.setTimeout(120000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        // Owner session for the server-side ledger (env-gated /debug/trace endpoint).
        const owner = new ApiClient({ baseUrl: `${state.baseUrl}/api/v1` });
        await owner.login(seed.userA.username, seed.userA.password);

        try {
            // Clean slate: clear both client rings + the server ring so the ledger holds
            // ONLY this scenario's op (setup/boot ops are irrelevant to the assertion).
            // Done BEFORE the draw so the line tool's own enqueue/flush spans are captured.
            await clearClientTrace(A);
            await clearClientTrace(B);
            await fetch(`${state.baseUrl}/api/v1/debug/trace?atlasId=${encodeURIComponent(seed.atlasId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${owner.getAccessToken()}` },
            }).catch(() => { /* best-effort */ });

            // ACT — A creates a feature by DRAWING it through the REAL line tool (drives the
            // same outbound pipeline a user would). The tool generates the id; read it back.
            const fa = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
            expect(fa, 'the line tool created a feature').toBeTruthy();

            // DETERMINISTIC WAIT — B emitted remote.applied for this entity (no blind sleep);
            // then the SyncLedger-gated store helper confirms B's store reflects it.
            await waitForRemoteEntity(B, fa);
            await pollPeerFeature(B, 'lines', fa);

            // COLLECT + REDUCE the unified ledger, and attach it as the AI-readable artifact.
            const spans = await collectLedger([A, B], {
                baseUrl: state.baseUrl, token: owner.getAccessToken(), atlasId: seed.atlasId,
            });
            const report = reduceLedger(spans);
            await testInfo.attach('syncledger.report.md', { body: renderReport(report), contentType: 'text/markdown' });
            await testInfo.attach('syncledger.jsonl', {
                body: spans.map((s) => JSON.stringify(s)).join('\n'),
                contentType: 'application/x-ndjson',
            });

            // ORACLE — structured, rastreável assertions (each points at a real span):
            const tl = report.timelines.find((t) => t.entityId === fa);
            expect(tl, 'the created feature should appear in the ledger').toBeTruthy();
            expect(tl.appliedOn, 'the feature converged onto client B').toContain('clientB');
            expect(report.orphans.find((o) => o.entityId === fa), 'the op is not an orphan').toBeFalsy();
            expect(report.summary.noEffects, 'a valid create touched a server row (I2)').toBe(0);

            // The author saw its own outbound stages too.
            const aStages = new Set((await getClientLedger(A)).map((s) => s.stage));
            expect(aStages.has('enqueue'), 'A enqueued the op').toBe(true);
            expect(aStages.has('flush.push'), 'A flushed the op').toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
            await owner.logout().catch(() => { /* best-effort */ });
        }
    });
});
