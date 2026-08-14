// Path: e2e-ui/browser-collab-three-client-flow.spec.js

/**
 * THREE-CLIENT FLOW — three real browsers + real backend, on the full-chain harness. A
 * multi-phase session so roster/membership and convergence are exercised under changing
 * state, not just one broadcast:
 *
 *   1. all three create a feature        → each traverses the chain to the other two.
 *   2. C edits A's feature               → the edit traverses the chain to A and B.
 *   3. three-way conflict on ONE feature → each edit is acked by the server, and all three
 *                                          converge to the value POSTGRES holds (not merely
 *                                          to each other).
 *   4. a late joiner (C reconnects)      → A's offline-window write reaches B (full chain),
 *                                          and C catches up via snapshot (convergence check).
 *   5. C deletes a feature               → the delete traverses the chain to A and B.
 *
 * Run headed:  npx playwright test browser-collab-three-client-flow --headed
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';
import { waitForEntitySpan, waitForAcked } from './helpers/trace-helpers.js';

const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;

/**
 * Waits until EVERY client agrees with the value the server holds AT THAT MOMENT, and
 * returns it. Same helper (and same reasoning) as `browser-collab-crdt-conflict.spec.js`.
 *
 * Two things this states that "os clientes concordam entre si" does not:
 *   - Agreement between peers is not convergence. There is a real window where one op has
 *     propagated to all three while another is still in flight, so everyone legitimately
 *     shows a value the server is about to overwrite. A peers-only poll exits on that
 *     way-station and calls it proof.
 *   - The server is the authority (LWW by ARRIVAL order). If the backend stored a value no
 *     client ever shows, three agreeing clients are three clients that are all wrong.
 *
 * Server and clients are sampled TOGETHER on each attempt, because an op can still be
 * sitting in an outbound queue and flush later, legitimately moving the winner after a
 * one-shot read: fixing the winner up front makes the assertion demand a stale snapshot.
 * A permanent divergence never satisfies the poll and the message names both sides.
 */
async function convergedColor(db, pages, id, timeout = 30000) {
    let valor = null;
    await expect
        .poll(async () => {
            const row = await db.queryFeatureRow(id);
            const servidor = String(row?.properties?.lineColor ?? '').toLowerCase();
            if (!servidor) return null;
            const clientes = await Promise.all(
                pages.map(async (p) => String(await lineColor(p, id)).toLowerCase()),
            );
            valor = clientes.every((c) => c === servidor) ? servidor : null;
            return valor ?? `servidor=${servidor} clientes=${clientes.join(',')}`;
        }, { timeout, message: 'os três clientes concordam com o valor que o servidor tem AGORA' })
        .toMatch(/^#[0-9a-f]{6}$/);
    return valor;
}

/**
 * Anchors one client's edit ON THE SERVER: the local op exists in the queue AND the backend
 * acked it. `push.ack` is the only outbound stage guaranteed for all three writers
 * (`remote.applied` is not: the losers can be legitimately discarded by the peer's
 * convergence guard), and it also removes the outbound-queue race (flush is on a 1.5s
 * interval). Two steps because the stages are keyed differently: `enqueue` carries
 * `entityId`, `push.ack` carries only `opId` (the server acks by operation id).
 */
async function expectReachedServer(page, quem, entityId, operationType = 'update') {
    const enq = await waitForEntitySpan(page, { entityId, operationType, stage: 'enqueue' }, 25000);
    expect(enq, `a edição de ${quem} virou operação na fila`).toBeTruthy();
    await waitForAcked(page, enq.opId, 25000);
    return enq;
}

const COORDS_A = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COORDS_B = [[-43.3, -23.0], [-43.25, -22.95], [-43.2, -22.9]];
const COORDS_C = [[-43.1, -22.7], [-43.05, -22.65], [-43.0, -22.6]];
const COORDS_LATE = [[-43.4, -23.1], [-43.35, -23.05], [-43.3, -23.0]];

// ── Inline UI drivers (hardened for the late-join client, whose live source can lag) ──

async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

async function dismissFeaturePanel(page) {
    if ((await page.locator('.feature-panel[data-expanded="true"]').count()) === 0) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(350);
}

function lineInMapSource(page, featureId) {
    return page.evaluate(async (id) => {
        const src = globalThis.__ebgeoMap?.getSource('lines');
        if (!src || typeof src.getData !== 'function') return false;
        const data = await src.getData();
        return ((data && data.features) || []).some((f) => f.properties?.id === id);
    }, featureId);
}

function nudgeLayersRefresh(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        store.getEventBus().emit('layers:changed', { mapName: store.getCurrentMapNameSync() });
    });
}

async function selectFeatureUI(page, featureId) {
    await dismissFeaturePanel(page);
    await openLayersTab(page);
    await expect.poll(() => lineInMapSource(page, featureId), { timeout: 20000 }).toBe(true);
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect
        .poll(async () => {
            await nudgeLayersRefresh(page);
            for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
                await icon.click().catch(() => {});
            }
            return row.count();
        }, { timeout: 30000 })
        .toBeGreaterThan(0);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

async function recolorViaPanelUI(page, hex) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    const native = panel.locator('.color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await page.waitForFunction(
        async (h) => {
            const src = globalThis.__ebgeoMap?.getSource('lines');
            if (!src || typeof src.getData !== 'function') return false;
            const data = await src.getData();
            return ((data && data.features) || []).some((f) => String(f.properties?.lineColor).toLowerCase() === h.toLowerCase());
        },
        hex,
        { timeout: 5000 },
    );
    const saveBtn = panel.locator('.attr-modern-btn-save');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

collabTest.describe('Three-client flow — multi-phase session with three collaborators', () => {
    collabTest.use({ collabOptions: { peers: 2, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('create-all → cross-edit → 3-way conflict → late-join catch-up → delete', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        let C = collab.peers[1];

        // 1. CREATE-ALL — each client draws a line; each traverses the chain to the other two.
        const fa = await drawLineUI(A, COORDS_A);
        await collab.expectFullSync({ entityId: fa, type: 'lines', operationType: 'create' });
        const fb = await drawLineUI(B, COORDS_B);
        await collab.expectFullSyncFrom(B, { entityId: fb, type: 'lines', operationType: 'create' });
        const fc = await drawLineUI(C, COORDS_C);
        await collab.expectFullSyncFrom(C, { entityId: fc, type: 'lines', operationType: 'create' });

        // 2. CROSS-EDIT — C recolors A's feature; the edit traverses the chain to A and B.
        await collab.clearTraces();
        await selectAndRecolorUI(C, fa, '#22aa22');
        await collab.expectFullSyncFrom(C, { entityId: fa, type: 'lines', operationType: 'update' });

        // 3. THREE-WAY CONFLICT — all three recolor fb at once → converge to the value THE
        //    SERVER holds. The previous version polled until the three clients merely AGREED
        //    WITH EACH OTHER, never reading Postgres and never waiting for anyone's push.ack.
        //    That verde provava pouco: três clientes podem concordar num valor que o servidor
        //    nunca aceitou (op ainda na fila de saída, op rejeitada, ou os três exibindo o
        //    estado anterior enquanto as três updates ainda voam). É o mesmo defeito que
        //    `browser-collab-crdt-conflict.spec.js` documentou e corrigiu; aqui segue o mesmo
        //    padrão: primeiro cada edição chega ao servidor, depois o BANCO decide o vencedor
        //    e os clientes respondem a ele. Concordância entre pares vira consequência.
        //
        //    Selecionar em SÉRIE e só então recolorir em paralelo, como em
        //    `browser-collab-crdt-conflict.spec.js`. O gesto único (select+recolor junto) leva
        //    segundos por causa da expansão de camadas, e a update remota dos outros dois
        //    clientes chega no meio: o painel re-renderiza, a seleção cai, o save não vira
        //    operação nenhuma e a edição some SEM ERRO. Foi exatamente o que a âncora nova
        //    pegou na primeira execução limpa (`a edição de B virou operação na fila` →
        //    null), com o poll antigo passando verde porque o preview local de B era
        //    sobrescrito pela update remota e os três acabavam iguais. Na hora do select
        //    ainda não há update concorrente (o create de fb já assentou no expectFullSync
        //    da fase 1), então essa parte é segura em série; a concorrência que o teste
        //    precisa é no COMMIT da cor, que é um clique, e essa continua paralela.
        await collab.clearTraces();
        await selectFeatureUI(A, fb);
        await selectFeatureUI(B, fb);
        await selectFeatureUI(C, fb);
        await Promise.all([
            recolorViaPanelUI(A, '#ff0000'),
            recolorViaPanelUI(B, '#0000ff'),
            recolorViaPanelUI(C, '#00ff00'),
        ]);
        for (const [page, quem] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
            await expectReachedServer(page, quem, fb, 'update');
        }
        const winner = await convergedColor(collab.db, [A, B, C], fb);
        expect(winner, 'o servidor gravou uma das três cores em disputa').toMatch(/^#(ff0000|0000ff|00ff00)$/);

        // As TRÊS chegaram ao log append-only (nenhuma foi silenciosamente descartada a
        // caminho). A coluna é `op_type` (`backend/src/database/migrations/003_sync.sql:19`),
        // não `operation_type`.
        const opsFb = await collab.db.queryOperationsByEntity(fb);
        expect(
            opsFb.filter((o) => o.op_type === 'update').length,
            'as três atualizações concorrentes chegaram ao log do servidor',
        ).toBeGreaterThanOrEqual(3);

        // 4. LATE JOIN — C disconnects (full session close). A's offline-window write reaches B
        //    through the whole chain; C reconnects (fresh session) and catches up via snapshot.
        await C.context().close();
        const fLate = await drawLineUI(A, COORDS_LATE);
        await collab.expectFullSyncTo([B], { entityId: fLate, type: 'lines', operationType: 'create' });
        C = await collab.reopenPeer(1);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fLate), { timeout: 35000 }).toBe(true);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fa), { timeout: 35000 }).toBe(true);

        // 5. DELETE — C removes a feature; the delete traverses the chain to A and B.
        await deleteFeatureUI(C, fc);
        await collab.expectFullSyncDeleteFrom(C, { entityId: fc, type: 'lines', operationType: 'delete' });
    });
});
