// Path: e2e-ui/browser-collab-ledger.spec.js

/**
 * SyncLedger end-to-end demonstration — two real browsers + the real backend, on the
 * full-chain harness. Drives the op, asserts the WHOLE chain (expectFullSync), then reads
 * the UNIFIED ledger (client A ring + server ring + client B ring, merged by op.id) for a
 * structured, traceable oracle: the op converged on the peer, touched a server row, and
 * violated no SyncLedger invariant. The merged ledger.jsonl + report are attached as the
 * AI-readable artifact.
 *
 * Run headed:  npx playwright test browser-collab-ledger --headed
 */

import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';
import { getClientLedger } from './helpers/trace-helpers.js';
import { collectLedger, reduceLedger, renderReport } from './helpers/ledger.js';

collabTest.describe('SyncLedger — deterministic cross-client trace + invariant oracle', () => {
    collabTest('A creates a feature; B applies it; the merged ledger is clean, converged, full-chain', async ({ collab }, testInfo) => {
        collabTest.setTimeout(120000);
        const A = collab.author;

        // Clean slate: clear both client rings + the server ring so the ledger holds ONLY this
        // scenario's op (boot/setup ops are irrelevant). Done BEFORE the draw.
        await collab.clearTraces();
        await fetch(`${collab.baseUrl}/api/v1/debug/trace?atlasId=${encodeURIComponent(collab.atlasId)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${collab.ownerToken}` },
        }).catch(() => { /* best-effort */ });

        // ACT — A creates a feature by DRAWING it through the REAL line tool, and assert the
        // WHOLE chain carried it to B.
        const fa = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(fa, 'the line tool created a feature').toBeTruthy();
        await collab.expectFullSync({ entityId: fa, type: 'lines', operationType: 'create' });

        // COLLECT + REDUCE the unified ledger; attach it as the AI-readable artifact.
        const spans = await collectLedger(collab.pages, { baseUrl: collab.baseUrl, token: collab.ownerToken, atlasId: collab.atlasId });
        const report = reduceLedger(spans);
        await testInfo.attach('syncledger.report.md', { body: renderReport(report), contentType: 'text/markdown' });
        await testInfo.attach('syncledger.jsonl', {
            body: spans.map((s) => JSON.stringify(s)).join('\n'),
            contentType: 'application/x-ndjson',
        });

        // ORACLE — structured, traceable assertions (each points at a real span):
        const tl = report.timelines.find((t) => t.entityId === fa);
        expect(tl, 'the created feature should appear in the ledger').toBeTruthy();
        expect(tl.appliedOn, 'the feature converged onto client B').toContain('clientB');
        expect(report.orphans.find((o) => o.entityId === fa), 'the op is not an orphan').toBeFalsy();
        expect(report.summary.noEffects, 'a valid create touched a server row (I2)').toBe(0);

        // The author saw its own outbound stages — including the apply.persist IDB-write confirmation.
        const aStages = new Set((await getClientLedger(A)).map((s) => s.stage));
        expect(aStages.has('apply.persist'), 'A confirmed its IndexedDB write').toBe(true);
        expect(aStages.has('enqueue'), 'A enqueued the op').toBe(true);
        expect(aStages.has('flush.push'), 'A flushed the op').toBe(true);
    });
});
