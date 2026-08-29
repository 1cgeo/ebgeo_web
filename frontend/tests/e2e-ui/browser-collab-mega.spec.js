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
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { waitForEntitySpan, waitForAcked } from './helpers/trace-helpers.js';
import { createDb, closeDb } from './helpers/db.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
    assertLedgerClean,
    drawLineUI,
    drawPointUI,
    currentMapName,
    selectFeatureUI,
    renameViaPanelUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Drives a real store op on `page`. Retained ONLY for the mutations that have no single-
 * gesture UI to a deterministic value in this harness (each call site carries a `// no-UI:`
 * note): the panel color picker (recolor) opens the OS-native color dialog — not drivable
 * to an exact hex in Playwright; multi-DRAG to exact deltas, grouping via canvas multi-
 * select (headless WebGL hit-testing is unreliable — see layers-tab-local.spec.js), and the
 * briefing/temporal authoring flows. Feature CREATE, rename, map create/switch, undo/redo
 * and delete all go through the REAL UI below.
 */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);
const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;
const symbolName = async (page, id) => (await readFeatures(page, 'military_symbols')).find((x) => x.id === id)?.props?.nome;

const pointLng = (page, id) => page.evaluate(async (i) => {
    const s = await import('/src/js/store/index.js');
    const f = (await s.getCurrentMapFeatures()).points.find((x) => x.properties?.id === i);
    return f ? f.geometry.coordinates[0] : null;
}, id);

// ── Inline UI drivers (learned from the clean sibling specs) ─────────────────
// drawMilitarySymbolUI: shared-atlas spec's drawMilitarySymbol gesture;
// createMapUI/switchMapUI: maps-tab-navigation spec;
// selectFeatureInTreeUI: shared-atlas selectFeatureById (layers tree row click);
// renameViaPanelUI: the feature-identification editable name the attribute panel renders;
// deleteSelectedViaUI: the real Delete key → confirm-modal destructive flow.

/** Places a MILITARY SYMBOL via the real tool (single click, default SIDC). @returns {Promise<string>} new id. */
async function drawMilitarySymbolUI(page, [lng, lat]) {
    const before = new Set((await readFeatures(page, 'military_symbols')).map((f) => f.id));
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 14 }), [lng, lat]);
    await page.waitForTimeout(300);
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();
    // A ferramenta agora vem por `await import()`: sem esta espera o clique no mapa da linha
    // seguinte chega antes de o controle existir, e nenhuma feicao nasce.
    await esperarFerramentaPronta(page, 'militarySymbol');
    const pt = await page.evaluate((c) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const p = map.project(c);
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
    }, [lng, lat]);
    await page.mouse.click(pt.x, pt.y);
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'military_symbols')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

/** Opens the Maps sidebar tab (idempotent) and waits for the current-map card to render. */
async function openMapsTab(page) {
    if ((await page.locator('.maps-tab #current-map-name-input').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });
}

/** Creates a new map through the real Maps-tab UI (header "Novo mapa" → prompt → confirm). */
async function createMapUI(page, name) {
    await openMapsTab(page);
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`)).toBeVisible({ timeout: 5000 });
}

/** Switches the active map by clicking its card in the real Maps-tab list. */
async function switchMapUI(page, name) {
    await openMapsTab(page);
    const card = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await expect.poll(async () => currentMapName(page), { timeout: 10000 }).toBe(name);
}

/** Selects a feature by id via its row in the real layers tree (expands collapsed nodes first). */
/**
 * Seleciona pela arvore de camadas, DELEGANDO ao driver compartilhado.
 *
 * A copia local que morava aqui nao esperava o painel de atributos ABRIR: ela clicava na linha e
 * seguia. Medido em 2026-08-28, e e a causa do flake cronico desta spec: em 3 rodadas seguidas,
 * na primeira tentativa de cada uma, `.feature-panel[data-expanded="true"]` contava ZERO logo
 * apos o clique, e o `.feature-identification-name` que o gesto seguinte pegava era o da feicao
 * ANTERIOR (uma das rodadas mostrou o painel ainda em "Ponto #3" enquanto o alvo era o simbolo
 * militar). O `onNameChange` daquele painel obsoleto chama
 * `control.updateFeaturesProperty(selectedFeatures, ...)` com a selecao que ele capturou no
 * fechamento, entao o display trocava para o nome novo e o STORE nao recebia nada: nenhuma op,
 * nenhum span, e o par esperando para sempre. `selectFeatureUI` (helpers/collab-helpers.js) faz
 * o MESMO clique cru e depois exige `data-expanded="true"`, que e a espera que faltava.
 */
const selectFeatureInTreeUI = (page, featureId) => selectFeatureUI(page, featureId);

/**
 * Renomeia pelo painel de atributos, DELEGANDO ao driver compartilhado, e so entao fecha.
 *
 * A copia local tambem parava no `Enter` e fechava com `Escape`, enquanto o driver da casa
 * COMITA pelo botao "Salvar", que e o gesto que o produto pede. Duas copias do mesmo gesto sao
 * exatamente o defeito que esta spec pagou: a divergencia so aparece na cópia que esta FORA da
 * suite normal, onde ninguem olha.
 */
async function renameSelecionadaViaPanelUI(page, featureId, newName) {
    await selectFeatureInTreeUI(page, featureId);
    await renameViaPanelUI(page, newName);
    await page.keyboard.press('Escape'); // fecha o painel para nao interceptar os gestos seguintes
}

/** Deletes a feature through the real UI: select it, press Delete, confirm the destructive modal. */
async function deleteSelectedViaUI(page, featureId) {
    await selectFeatureInTreeUI(page, featureId);
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    // The tree-select → Delete-keypress handoff can race (selection not yet registered when the
    // key fires), so retry the keypress until the destructive confirm modal actually appears.
    await expect(async () => {
        await page.locator('#map-sig .maplibregl-canvas').press('Delete');
        await expect(confirmBtn).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 10000 });
    await confirmBtn.click();
}

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
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
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
    test('setup → create → multi (group/update/drag) → cross-edit → conflict → maps → undo/redo → briefing → temporal → delete', async ({ browser }, testInfo) => {
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

            // 2. CREATE — A DRAWS a line with the real line tool, B places a military symbol
            //    with the real military tool; each sees the other's. A sweeps its cursor so B
            //    can watch it move (live presence), then both pause to look. Both ids are
            //    generated by the tools and read back.
            const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
            await sweepCursor(A);
            const symId = await drawMilitarySymbolUI(B, [-43.18, -22.85]);
            await sweepCursor(B);
            await pollPeerFeature(B, 'lines', lineId);
            await pollPeerFeature(A, 'military_symbols', symId);
            await demoPause(A);

            // 2b. MULTI — the core "operate on many at once" flow over THREE features:
            //     multi-UPDATE + multi-DRAG (asserted cross-client), then multi-SELECT as a
            //     visual flourish. Update/drag run BEFORE grouping/selection so neither the
            //     group nor the active selection can interfere with their sync. Map stays
            //     zoomed in and the cursor moves so it's all visible headed.
            // CREATE the three points by DRAWING each with the real point tool (single click).
            const ptCoords = [[-43.18, -22.86], [-43.15, -22.85], [-43.12, -22.84]];
            const pts = [];
            for (const c of ptCoords) {
                const id = await drawPointUI(A, c);
                pts.push({ id, lng: c[0], lat: c[1] });
            }
            for (const p of pts) await pollPeerFeature(B, 'points', p.id);
            await sweepCursor(A);
            await demoPause(B);

            // multi-UPDATE: recolor all three → B sees every one change.
            // // no-UI: the panel color picker opens the OS-native color dialog (color-picker.helpers.js),
            // which Playwright cannot drive to an EXACT hex; the assertion pins color === '#e21111'.
            for (const p of pts) await applyStoreOp(A, 'updateFeatureProperty', ['points', p.id, 'color', '#e21111']);
            for (const p of pts) await pollPeerFeatureWhere(B, 'points', p.id, (pr) => pr.color === '#e21111');
            await demoPause(B);

            // multi-DRAG: shift all three geometries → B sees every one move.
            // // no-UI: a multi-feature canvas drag to an EXACT longitude delta is not a single
            // reliable gesture headless (WebGL pointer hit-testing); the geometry update stays a
            // store op so the asserted +0.02 longitude shift is deterministic.
            for (const p of pts) {
                // Read the LIVE point and shift only its geometry (preserve every property the
                // draw + recolor put on it), matching the original {...feature, geometry} intent.
                await A.evaluate(async ({ id, dLng, dLat }) => {
                    const store = await import('/src/js/store/index.js');
                    const f = (await store.getCurrentMapFeatures()).points.find((x) => x.properties?.id === id);
                    const moved = { ...f, geometry: { type: 'Point', coordinates: [f.geometry.coordinates[0] + dLng, f.geometry.coordinates[1] + dLat] } };
                    await store.updateFeature('points', moved);
                }, { id: p.id, dLng: 0.03, dLat: 0.02 });
            }
            for (const p of pts) {
                await expect.poll(async () => pointLng(B, p.id), { timeout: 20000 }).toBeGreaterThan(p.lng + 0.02);
            }
            await sweepCursor(B);
            await demoPause(A);

            // multi-SELECT: group the three into ONE unit on A → the group SYNCS to B.
            // // no-UI: grouping is a canvas multi-select (click + shift-click) + context-menu
            // "Criar Grupo"; its headless WebGL hit-testing is unreliable (documented in
            // layers-tab-local.spec.js), so we exercise the SAME store op the menu invokes over
            // the three live point features (looked up by their drawn ids).
            const ptIds = pts.map((p) => p.id);
            const createdGroup = await A.evaluate(async (ids) => {
                const store = await import('/src/js/store/index.js');
                const all = (await store.getCurrentMapFeatures()).points || [];
                const members = all.filter((f) => ids.includes(f.properties?.id));
                return store.createGroup(members);
            }, ptIds);
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

            // 3. CROSS-EDIT — A RENAMES B's symbol through the real attribute panel (select the
            //    symbol in A's layers tree → edit the editable feature-name input); B recolors
            //    A's line; both converge. Generous timeout: the multi phase above queued a burst
            //    of ops, so this edit may sit behind that backlog before it reaches the peer.
            await renameSelecionadaViaPanelUI(A, symId, 'Companhia');
            // // no-UI: recolor — the panel color picker opens the OS-native color dialog, not
            // drivable to the EXACT '#22aa22' the assertion pins; driven as a store op.
            await applyStoreOp(B, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#22aa22']);
            await pollPeerFeatureWhere(A, 'lines', lineId, (p) => p.lineColor === '#22aa22', 35000);
            await pollPeerFeatureWhere(B, 'military_symbols', symId, (p) => p.nome === 'Companhia', 35000);
            expect(await symbolName(A, symId)).toBe('Companhia');
            await demoPause(A);

            // 4. CONFLICT — both recolor the SAME line at once → converge to one color.
            // // no-UI: simultaneous recolor to two EXACT hexes is the whole point of the LWW
            // assertion; the panel color picker can't be driven to exact values, so both
            // recolors are store ops fired concurrently.
            await Promise.all([
                applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#ff0000']),
                applyStoreOp(B, 'updateFeatureProperty', ['lines', lineId, 'lineColor', '#0000ff']),
            ]);
            // Convergence is asserted against the SERVER, not between the clients.
            //
            // This used to poll until `ca === cb` and accept whichever colour they agreed on.
            // Client agreement is not convergence: there is a window where A's op has reached
            // both clients while B's is still in flight, so both legitimately show A's colour
            // before the real winner lands. The poll exited on that way-station. The same
            // defect was the flake in browser-collab-crdt-conflict.spec.js; this is the third
            // place it appeared, so it is a pattern, not an accident.
            //
            // `enqueue` carries entityId, `push.ack` carries only opId (the server acks by
            // operation), hence the two-step wait.
            for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
                const enq = await waitForEntitySpan(page, { entityId: lineId, operationType: 'update', stage: 'enqueue' }, 25000);
                expect(enq, `o recolor de ${quem} virou operação na fila`).toBeTruthy();
                await waitForAcked(page, enq.opId, 25000);
            }
            const megaDb = state.dbName ? createDb(state.dbName) : null;
            try {
                const frow = megaDb ? await megaDb.queryFeatureRow(lineId) : null;
                const winner = String(frow?.properties?.lineColor ?? '').toLowerCase();
                expect(winner, 'o servidor gravou uma das duas cores em disputa').toMatch(/^#(ff0000|0000ff)$/);
                for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
                    await expect
                        .poll(async () => String(await lineColor(page, lineId)).toLowerCase(), {
                            timeout: 20000,
                            message: `${quem} convergiu para a cor que o servidor gravou (${winner})`,
                        })
                        .toBe(winner);
                }
            } finally {
                if (megaDb) closeDb(megaDb);
            }
            await demoPause(B);

            // 5. MAPS — A creates a second map through the real Maps-tab UI → B lists it.
            //    createMap makes the new map A's ACTIVE map (real product behaviour), so A
            //    switches BACK to the shared atlas map (also via the real card) — the later
            //    phases (undo/redo, briefing, temporal, delete of the original line) all run
            //    against the shared map.
            await createMapUI(A, 'Mapa Secundário');
            await expect
                .poll(async () => B.evaluate(async () => {
                    const { getRepository } = await import('/src/js/store/repositories/index.js');
                    const all = await getRepository().getAllMaps();
                    return Array.from(all instanceof Map ? all.values() : Object.values(all || {})).map((m) => m && m.name);
                }), { timeout: 20000 })
                .toContain('Mapa Secundário');
            await switchMapUI(A, seed.mapName);
            expect(await currentMapName(A), 'A is back on the shared atlas map').toBe(seed.mapName);
            await demoPause(A);

            // NOTE — dynamic PERMISSION (downgrade/upgrade) and OFFLINE RECONNECT are not in
            // this harness on purpose: both require closing/reopening B's browser, which is
            // jarring in a live demo and is the reconnect-race source of flakiness. They are
            // covered end to end by the dedicated specs browser-collab-permissions.spec.js
            // and browser-collab-reconnect.spec.js. This harness stays a continuous, both-
            // browsers-live session.

            // 6. UNDO / REDO (per user) — B DRAWS a feature, then undoes ITS OWN last action
            //    with the real Ctrl+Z shortcut → A sees it disappear; B redoes with Ctrl+Y →
            //    A sees it reappear. Undo is a per-user local stack; the executors emit sync
            //    ops so it propagates. The shortcuts are real keyboard gestures on the canvas.
            const undoId = await drawLineUI(B, [[-43.05, -22.7], [-43.0, -22.65], [-42.95, -22.6]]);
            await pollPeerFeature(A, 'lines', undoId);
            await demoPause(A);
            await B.locator('#map-sig .maplibregl-canvas').press('Control+z');
            await expect.poll(async () => hasLine(B, undoId), { timeout: 10000 }).toBe(false);
            await pollPeerFeatureGone(A, 'lines', undoId);
            await demoPause(A);
            await B.locator('#map-sig .maplibregl-canvas').press('Control+y');
            await expect.poll(async () => hasLine(B, undoId), { timeout: 10000 }).toBe(true);
            await pollPeerFeature(A, 'lines', undoId);
            await demoPause(A);

            // 7. BRIEFING — a common module: A authors a briefing → B reflects create+update.
            // // no-UI: briefing authoring (create + rename) in this harness is exercised as a
            // store op — the full editor flow (open Briefings tab, create, edit metadata) is a
            // multi-modal sequence outside this harness's create→sync→converge focus.
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
            // // no-UI: per-map temporal config (ativo/unidade/bounds) is set via the temporal
            // settings modal; this harness asserts the synced config shape, so it drives the
            // store op directly rather than the modal's several controls.
            await applyStoreOp(A, 'setMapTemporalConfig', [seed.mapName, { ativo: true, unidade: 'horas', inicio: 1700000000000, fim: 1700003600000 }]);
            await expect
                .poll(async () => B.evaluate(async (mn) => {
                    const cfg = await (await import('/src/js/store/index.js')).getMapTemporalConfig(mn);
                    return cfg && cfg.ativo === true ? cfg.unidade : null;
                }, seed.mapName), { timeout: 20000 })
                .toBe('horas');
            await demoPause(B);

            // 9. DELETE — A removes the original line through the real UI (select it in the
            //    layers tree → Delete key → confirm the destructive modal) → B loses it.
            await deleteSelectedViaUI(A, lineId);
            await pollPeerFeatureGone(B, 'lines', lineId);
            await demoPause(A, 2);

            // SyncLedger oracle: the merged causal ledger (A + server + B) is attached for
            // inspection. allowNoEffects: the undo→redo phase re-creates a soft-deleted feature,
            // which is a BY-DESIGN server no-op (tombstone, per the backend "confirmed gaps") —
            // not an I2 violation, so it is not asserted against here.
            await assertLedgerClean(testInfo, [A, B], state.baseUrl, seed.userA, seed.atlasId, { allowNoEffects: true });
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
