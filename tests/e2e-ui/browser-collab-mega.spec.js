// Path: e2e-ui/browser-collab-mega.spec.js

/**
 * MEGA HARNESS — one long, faithful collaboration scenario across TWO real browsers +
 * real backend, chaining every dimension the focused specs cover individually into a
 * single session, in the order a real shared editing session would unfold:
 *
 *   1. setup        two clients join one shared atlas (A owner, B writer); both ZOOM in.
 *   2. create       each draws a feature        → both see both (with live cursor sweeps).
 *  2b. multi        group 3 + recolor 3 + drag 3 at once → B sees every one change.
 *   3. cross-edit   each edits the OTHER's       → both converge.
 *   4. conflict     both edit the SAME at once   → both converge (LWW by arrival).
 *   5. maps         A adds a second map          → B lists it.
 *   6. undo/redo    B undoes/redoes ITS OWN edit → A sees it disappear then reappear.
 *   7. briefing     A authors a briefing         → B reflects create + update.
 *   8. temporal     A enables the temporal window→ B reflects the config.
 *   9. delete       A removes a feature          → B loses it.
 *
 * Dynamic PERMISSION and OFFLINE RECONNECT are intentionally NOT here (they need to
 * close/reopen B's browser — jarring for a live demo and reconnect-race-prone); they are
 * owned by browser-collab-permissions.spec.js and browser-collab-reconnect.spec.js. This
 * harness is one CONTINUOUS, both-browsers-live session.
 *
 * DEMO MODE: this harness is also a live demonstration. Run it headed (and optionally
 * slow it down) to watch two browsers collaborate, with the map zoomed in and cursors
 * moving between them:
 *   DEMO_PAUSE_MS=2000 npx playwright test browser-collab-mega --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);
const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;
const symbolName = async (page, id) => (await readFeatures(page, 'military_symbols')).find((x) => x.id === id)?.props?.nome;

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', nome: 'Eixo', lineColor: '#000000', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});
const newSymbol = (id) => ({
    type: 'Feature',
    properties: { id, source: 'military_symbol', layerId: 'default', nome: 'Pel', sidc: 'SFGPUCI-----' },
    geometry: { type: 'Point', coordinates: [-43.18, -22.85] },
});
const newPoint = (id, lng, lat) => ({
    type: 'Feature',
    properties: { id, source: 'point', layerId: 'default', nome: 'Pt', color: '#ffaa00', size: 28 },
    geometry: { type: 'Point', coordinates: [lng, lat] },
});
const pointLng = (page, id) => page.evaluate(async (i) => {
    const s = await import('/src/js/store/index.js');
    const f = (await s.getCurrentMapFeatures()).points.find((x) => x.properties?.id === i);
    return f ? f.geometry.coordinates[0] : null;
}, id);

// ── Demo helpers ─────────────────────────────────────────────────────────────
// This harness doubles as a demonstration: run it headed (optionally with a longer
// pause) to watch two browsers collaborate live:
//   DEMO_PAUSE_MS=2000 npx playwright test browser-collab-mega --headed
// Default tuned for a WATCHABLE headed demo (`npx playwright test browser-collab-mega
// --headed`). The test carries a generous test.setTimeout, so this pace is safe in the
// regression run too. For a fast CI pass set DEMO_PAUSE_MS=0; to slow the demo further,
// raise it (e.g. DEMO_PAUSE_MS=3000).
const DEMO_PAUSE_MS = Number(process.env.DEMO_PAUSE_MS ?? 1500);
const DEMO_CENTER = [-43.15, -22.85];
const demoPause = (page, mult = 1) => page.waitForTimeout(DEMO_PAUSE_MS * mult);

/** Centers + zooms a client's map so created features (and peer cursors) are visible. */
async function focusView(page, zoom = 12) {
    await page.evaluate(({ c, z }) => {
        if (globalThis.__ebgeoMap?.jumpTo) globalThis.__ebgeoMap.jumpTo({ center: c, zoom: z });
    }, { c: DEMO_CENTER, z: zoom });
}

/** Moves the REAL mouse across the map so the peer sees this client's live cursor move. */
async function sweepCursor(page, passes = 1) {
    const box = await page.locator('.maplibregl-canvas').first().boundingBox();
    if (!box) return;
    for (let p = 0; p < passes; p++) {
        for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            const x = box.x + box.width * (0.2 + 0.6 * t);
            const y = box.y + box.height * 0.5 + Math.sin(t * Math.PI * 2) * box.height * 0.15;
            await page.mouse.move(x, y, { steps: 3 });
            await page.waitForTimeout(90);
        }
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
}


describeOrSkip('Mega harness — full collaboration session end to end', () => {
    test('setup → create → multi (group/update/drag) → cross-edit → conflict → maps → undo/redo → briefing → temporal → delete', async ({ browser }) => {
        // Inherently long (9 phases, two live browsers, demo pauses) — give it generous
        // headroom over the 60s default so full-suite load can't tip it into a timeout.
        test.setTimeout(180000);
        // 1. SETUP — two clients join the shared atlas, then both zoom to the SAME area so
        //    every feature created below (and each other's live cursor) is in view.
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            await focusView(A, 12);
            await focusView(B, 12);
            await demoPause(A);

            // 2. CREATE — A draws a line, B a military symbol; each sees the other's. A sweeps
            //    its cursor so B can watch it move (live presence), then both pause to look.
            const lineId = crypto.randomUUID();
            const symId = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(lineId)]);
            await sweepCursor(A);
            await applyStoreOp(B, 'addFeature', ['military_symbols', newSymbol(symId)]);
            await sweepCursor(B);
            await pollPeerFeature(B, 'lines', lineId);
            await pollPeerFeature(A, 'military_symbols', symId);
            await demoPause(A);

            // 2b. MULTI — the core "operate on many at once" flow over THREE features:
            //     multi-UPDATE + multi-DRAG (asserted cross-client), then multi-SELECT as a
            //     visual flourish. Update/drag run BEFORE grouping/selection so neither the
            //     group nor the active selection can interfere with their sync. Map stays
            //     zoomed in and the cursor moves so it's all visible headed.
            const pts = [
                newPoint(crypto.randomUUID(), -43.18, -22.86),
                newPoint(crypto.randomUUID(), -43.15, -22.85),
                newPoint(crypto.randomUUID(), -43.12, -22.84),
            ];
            for (const p of pts) await applyStoreOp(A, 'addFeature', ['points', p]);
            for (const p of pts) await pollPeerFeature(B, 'points', p.properties.id);
            await sweepCursor(A);
            await demoPause(B);

            // multi-UPDATE: recolor all three → B sees every one change.
            for (const p of pts) await applyStoreOp(A, 'updateFeatureProperty', ['points', p.properties.id, 'color', '#e21111']);
            for (const p of pts) await pollPeerFeatureWhere(B, 'points', p.properties.id, (pr) => pr.color === '#e21111');
            await demoPause(B);

            // multi-DRAG: shift all three geometries → B sees every one move.
            for (const p of pts) {
                const moved = { ...p, geometry: { type: 'Point', coordinates: [p.geometry.coordinates[0] + 0.03, p.geometry.coordinates[1] + 0.02] } };
                await applyStoreOp(A, 'updateFeature', ['points', moved]);
            }
            for (const p of pts) {
                await expect.poll(async () => pointLng(B, p.properties.id), { timeout: 20000 }).toBeGreaterThan(p.geometry.coordinates[0] + 0.02);
            }
            await sweepCursor(B);
            await demoPause(A);

            // multi-SELECT: group the three into ONE unit on A → the group SYNCS to B.
            const createdGroup = await applyStoreOp(A, 'createGroup', [pts]);
            const groupId = createdGroup.id;
            // On A: the three are grouped as one multi-selection unit.
            const groupInfoA = await A.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const groups = store.getMapGroups();
                const arr = Array.isArray(groups) ? groups : Object.values(groups || {});
                return { count: arr.length, features: arr[0]?.features?.length };
            });
            expect(groupInfoA.count, 'a group was created on A').toBeGreaterThanOrEqual(1);
            expect(groupInfoA.features, 'the group holds all three features').toBe(3);
            // On B: the group propagates (live), with all three members — the peer-side
            // persistence that the live handler + snapshot now provide.
            await expect
                .poll(async () => B.evaluate(async (gid) => {
                    const store = await import('/src/js/store/index.js');
                    const groups = store.getMapGroups();
                    const arr = Array.isArray(groups) ? groups : Object.values(groups || {});
                    const g = arr.find((x) => x && x.id === gid);
                    return g ? g.features.length : 0;
                }, groupId), { timeout: 20000 })
                .toBe(3);
            await demoPause(A);

            // 3. CROSS-EDIT — A renames B's symbol; B recolors A's line; both converge.
            // Generous timeout: the multi phase above queued a burst of ops, so this edit may
            // sit behind that backlog before it reaches the peer.
            await applyStoreOp(A, 'updateFeatureProperty', ['military_symbols', symId, 'nome', 'Companhia']);
            await applyStoreOp(B, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#22aa22']);
            await pollPeerFeatureWhere(A, 'lines', lineId, (p) => p.lineColor === '#22aa22', 35000);
            await pollPeerFeatureWhere(B, 'military_symbols', symId, (p) => p.nome === 'Companhia', 35000);
            expect(await symbolName(A, symId)).toBe('Companhia');
            await demoPause(A);

            // 4. CONFLICT — both recolor the SAME line at once → converge to one color.
            await Promise.all([
                applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#ff0000']),
                applyStoreOp(B, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#0000ff']),
            ]);
            await expect
                .poll(async () => {
                    const ca = await lineColor(A, lineId);
                    const cb = await lineColor(B, lineId);
                    return ca && ca === cb ? ca : null;
                }, { timeout: 25000 })
                .toMatch(/^#(ff0000|0000ff)$/);
            await demoPause(B);

            // 5. MAPS — A creates a second map → B lists it.
            const secondMap = await applyStoreOp(A, 'addMap', ['Mapa Secundário']);
            expect(secondMap.id, 'new map has a UUID').toBeTruthy();
            await expect
                .poll(async () => B.evaluate(async () => {
                    const { getRepository } = await import('/src/js/store/repositories/index.js');
                    const all = await getRepository().getAllMaps();
                    return Array.from(all instanceof Map ? all.values() : Object.values(all || {})).map((m) => m && m.name);
                }), { timeout: 20000 })
                .toContain('Mapa Secundário');
            await demoPause(A);

            // NOTE — dynamic PERMISSION (downgrade/upgrade) and OFFLINE RECONNECT are not in
            // this harness on purpose: both require closing/reopening B's browser, which is
            // jarring in a live demo and is the reconnect-race source of flakiness. They are
            // covered end to end by the dedicated specs browser-collab-permissions.spec.js
            // and browser-collab-reconnect.spec.js. This harness stays a continuous, both-
            // browsers-live session.

            // 6. UNDO / REDO (per user) — B creates a feature, then undoes ITS OWN last
            //    action → A sees it disappear; B redoes → A sees it reappear. Undo is a
            //    per-user local stack; the executors emit sync ops so it propagates.
            const undoId = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(undoId)]);
            await pollPeerFeature(A, 'lines', undoId);
            await demoPause(A);
            await applyStoreOp(B, 'undoLastAction', []);
            expect(await hasLine(B, undoId), 'B undid its own create locally').toBe(false);
            await pollPeerFeatureGone(A, 'lines', undoId);
            await demoPause(A);
            await applyStoreOp(B, 'redoLastAction', []);
            expect(await hasLine(B, undoId), 'B redid its own create locally').toBe(true);
            await pollPeerFeature(A, 'lines', undoId);
            await demoPause(A);

            // 7. BRIEFING — a common module: A authors a briefing → B reflects create+update.
            const briefing = await applyStoreOp(A, 'createBriefing', [{ name: 'Plano Op', description: 'v1' }]);
            const briefingId = briefing.id;
            await expect
                .poll(async () => B.evaluate(async (id) => (await (await import('/src/js/store/index.js')).getBriefingById(id))?.name, briefingId), { timeout: 20000 })
                .toBe('Plano Op');
            await applyStoreOp(A, 'updateBriefing', [briefingId, { name: 'Plano Op (rev)' }]);
            await expect
                .poll(async () => B.evaluate(async (id) => (await (await import('/src/js/store/index.js')).getBriefingById(id))?.name, briefingId), { timeout: 20000 })
                .toBe('Plano Op (rev)');
            await demoPause(B);

            // 8. TEMPORAL — A enables the map's temporal window → B reflects the config.
            await applyStoreOp(A, 'setMapTemporalConfig', [seed.mapName, { ativo: true, unidade: 'horas', inicio: 1700000000000, fim: 1700003600000 }]);
            await expect
                .poll(async () => B.evaluate(async (mn) => {
                    const cfg = await (await import('/src/js/store/index.js')).getMapTemporalConfig(mn);
                    return cfg && cfg.ativo === true ? cfg.unidade : null;
                }, seed.mapName), { timeout: 20000 })
                .toBe('horas');
            await demoPause(B);

            // 9. DELETE — A removes the original line → B loses it.
            await applyStoreOp(A, 'removeFeature', ['lines', lineId]);
            await pollPeerFeatureGone(B, 'lines', lineId);
            await demoPause(A, 2);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
