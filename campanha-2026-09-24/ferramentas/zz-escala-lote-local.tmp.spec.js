// Path: tests/e2e-ui/zz-escala-lote-local.tmp.spec.js
// TEMPORARY scale measurement (hunt/b61-lote). Not to be committed.
//
// The "D" column: the LOCAL gestures through the real funnels after removeFeatures/updateFeatures.
// Delete goes through selectionManager.deleteSelectedFeatures (lock filter, recovery wait, batch
// undo, the point control's deleteFeatures); the restyle through the point control's saveFeatures
// inside the batch collector, which is what the panel's "Salvar" runs; undo/redo through the store.

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { createDb } from './helpers/db.js';

const state = readState();
test.describe.configure({ retries: 0 });

async function preparar(browser, n) {
    const db = createDb(state.dbName);
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const camada = await db.raw.oneOrNone('SELECT id FROM layers WHERE map_id = $1 LIMIT 1', [seed.mapId]);
    const layerId = camada?.id ?? 'default';
    const ids = Array.from({ length: n }, () => randomUUID());
    const recs = ids.map((id, k) => ({
        id, geometry: { type: 'Point', coordinates: [-43.2 + (k % 50) * 0.0002, -22.9 + Math.floor(k / 50) * 0.0002] },
        properties: { id, source: 'point', nome: `P${k}`, size: 6, color: '#ff5500', visivel: true, layerId },
    }));
    await db.raw.none(`INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
        SELECT id, $1::uuid, 'point', geometry, properties, $3
        FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, geometry jsonb, properties jsonb)`,
    [seed.mapId, JSON.stringify(recs), layerId]);
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
    for (const p of [A, B]) await expect(p.locator('.loading-background')).toHaveCount(0, { timeout: 120000 });
    await B.evaluate(() => {
        const probe = { maxGap: 0, longMs: 0 };
        window.__probe = probe;
        let last = performance.now();
        const tick = (t) => { probe.maxGap = Math.max(probe.maxGap, t - last); last = t; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        new PerformanceObserver((l) => { for (const e of l.getEntries()) probe.longMs += e.duration; }).observe({ type: 'longtask' });
    });
    // The author's reads and writes of the map document, counted at the repository, so the column
    // carries the cause next to the time.
    await A.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const conta = { leituras: 0, escritas: 0 };
        window.__docs = conta;
        for (const nome of ['getMap', 'getExistingMap']) {
            if (typeof repo[nome] !== 'function') continue;
            const original = repo[nome].bind(repo);
            repo[nome] = (...a) => { conta.leituras++; return original(...a); };
        }
        for (const nome of ['saveMap']) {
            if (typeof repo[nome] !== 'function') continue;
            const original = repo[nome].bind(repo);
            repo[nome] = (...a) => { conta.escritas++; return original(...a); };
        }
    });
    return { db, seed, A, B, ids, layerId };
}

const pontosDe = (page, mapId) => page.evaluate(async (m) => {
    const { getRepository } = await import('/src/js/store/repositories/index.js');
    const mapa = await getRepository().getMap(m);
    return (mapa?.features?.points ?? []).map((f) => ({ id: f.properties.id, fillColor: f.properties.fillColor }));
}, mapId);

async function esperar(fn, alvo, timeout = 600000) {
    const t0 = Date.now();
    let v;
    while (Date.now() - t0 < timeout) {
        v = await fn();
        if (v === alvo) return Date.now() - t0;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return `TIMEOUT(${v})`;
}

async function medirEtapa(nome, { A, B, db, seed }, gesto, { servidor, par, alvo }) {
    await B.evaluate(() => { window.__probe.maxGap = 0; window.__probe.longMs = 0; });
    await A.evaluate(() => { window.__docs.leituras = 0; window.__docs.escritas = 0; });
    const t0 = Date.now();
    const gestoMs = await A.evaluate(gesto.fn, gesto.arg);
    const docs = await A.evaluate(() => ({ ...window.__docs }));
    const servidorMs = await esperar(() => servidor(db), alvo);
    const parMs = await esperar(async () => par(await pontosDe(B, seed.mapId)), alvo);
    const probe = await B.evaluate(() => ({ ...window.__probe }));
    const fila = await A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.countByState();
    });
    const r = { etapa: nome, gestoMs, docsNoGesto: docs, servidorMs, parMs, totalMs: Date.now() - t0,
        parMaiorQuadroMs: Math.round(probe.maxGap), parLongTaskMs: Math.round(probe.longMs), filaAutor: fila };
    console.log('[escala-D]', JSON.stringify(r));
    return r;
}

async function f5(B, seed, par, alvo) {
    await B.reload();
    await expect(B.locator('.loading-background')).toHaveCount(0, { timeout: 120000 });
    const v = await esperar(async () => par(await pontosDe(B, seed.mapId)), alvo, 60000);
    console.log('[escala-D] F5 no par', JSON.stringify({ ok: typeof v === 'number', v }));
}

const vivas = (ids) => async (db) => Number((await db.raw.one(
    'SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND id = ANY($1::uuid[])', [ids])).n);

const desfazer = async () => { const s = performance.now(); await (await import('/src/js/store/index.js')).undoLastAction(); return Math.round(performance.now() - s); };
const refazer = async () => { const s = performance.now(); await (await import('/src/js/store/index.js')).redoLastAction(); return Math.round(performance.now() - s); };

test('excluir 1000 pela seleção, desfazer, refazer', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const naLista = (pts) => pts.filter((p) => ctx.ids.includes(p.id)).length;
    await medirEtapa('excluir 1000 (deleteSelectedFeatures)', ctx, {
        fn: async (lista) => {
            const store = await import('/src/js/store/index.js');
            const sm = store.getControl('ClipboardManager').selectionManager;
            const map = globalThis.__ebgeoMap;
            const alvo = new Set(lista);
            const fonte = await map.getSource('points').getData();
            const sel = fonte.features.filter((f) => alvo.has(f.properties.id));
            const estado = store.getStateManager();
            estado.batchUpdate(() => { for (const f of sel) estado.addToSelection('point', String(f.properties.id), f); });
            const s = performance.now();
            await sm.deleteSelectedFeatures();
            return Math.round(performance.now() - s);
        }, arg: ctx.ids,
    }, { servidor: vivas(ctx.ids), par: naLista, alvo: 0 });
    await medirEtapa('desfazer a exclusao de 1000', ctx, { fn: desfazer }, { servidor: vivas(ctx.ids), par: naLista, alvo: 1000 });
    await medirEtapa('refazer a exclusao de 1000', ctx, { fn: refazer }, { servidor: vivas(ctx.ids), par: naLista, alvo: 0 });
    await f5(ctx.B, ctx.seed, naLista, 0);
});

test('estilo em massa de 1000 pelo Salvar do painel, desfazer, refazer', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const verdes = async (db) => Number((await db.raw.one(
        "SELECT count(*)::int AS n FROM features WHERE id = ANY($1::uuid[]) AND properties->>'fillColor' = '#00aa00'", [ctx.ids])).n);
    const parVerdes = (pts) => pts.filter((p) => p.fillColor === '#00aa00').length;
    await medirEtapa('estilo em massa de 1000 (saveFeatures)', ctx, {
        fn: async (lista) => {
            const store = await import('/src/js/store/index.js');
            const sm = store.getControl('ClipboardManager').selectionManager;
            const controle = await sm.ensureControlFor('point');
            const map = globalThis.__ebgeoMap;
            const alvo = new Set(lista);
            const fonte = await map.getSource('points').getData();
            const sel = fonte.features.filter((f) => alvo.has(f.properties.id)).map((f) => structuredClone(f));
            const iniciais = new Map(sel.map((f) => [f.properties.id, { ...f.properties }]));
            for (const f of sel) f.properties.fillColor = '#00aa00';
            const s = performance.now();
            store.startBatchUndo();
            await controle.saveFeatures(sel, iniciais);
            store.commitBatchUndo();
            return Math.round(performance.now() - s);
        }, arg: ctx.ids,
    }, { servidor: verdes, par: parVerdes, alvo: 1000 });
    await medirEtapa('desfazer o estilo de 1000', ctx, { fn: desfazer }, { servidor: verdes, par: parVerdes, alvo: 0 });
    await medirEtapa('refazer o estilo de 1000', ctx, { fn: refazer }, { servidor: verdes, par: parVerdes, alvo: 1000 });
    await f5(ctx.B, ctx.seed, parVerdes, 1000);
});

// THE PRICE, measured: 1000 restyles in ONE logical batch while the colleague deletes one of them.
// Deterministic interleaving: A's first push is HELD at the network until B's delete is in the
// Postgres, so A's batch necessarily carries an UPDATE over a tombstone.
test('estilo de 1000 com 1 feição apagada pelo colega no meio', async ({ browser }, testInfo) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const { A, B, db, ids } = ctx;
    const vitima = ids[500];

    let liberar;
    const liberado = new Promise((r) => { liberar = r; });
    let segurados = 0;
    const pushes = [];
    await A.route((url) => /\/api\/v1\/atlas\/[^/]+\/sync$/.test(url.pathname), async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const corpo = route.request().postDataJSON?.() ?? null;
        pushes.push(Array.isArray(corpo?.operations) ? corpo.operations.length : null);
        segurados++;
        await liberado;
        return route.continue();
    });
    // Every toast A shows from here on, as text: the refusal notice lasts 10 s and would be gone by the end.
    await A.evaluate(() => {
        window.__toasts = [];
        const vistos = new WeakSet();
        new MutationObserver(() => {
            for (const t of document.querySelectorAll('.toast')) {
                if (vistos.has(t) || !t.innerText.trim()) continue;
                vistos.add(t);
                window.__toasts.push(t.innerText.trim());
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    const gestoMs = await A.evaluate(async (lista) => {
        const store = await import('/src/js/store/index.js');
        const sm = store.getControl('ClipboardManager').selectionManager;
        const controle = await sm.ensureControlFor('point');
        const map = globalThis.__ebgeoMap;
        const alvo = new Set(lista);
        const fonte = await map.getSource('points').getData();
        const sel = fonte.features.filter((f) => alvo.has(f.properties.id)).map((f) => structuredClone(f));
        const iniciais = new Map(sel.map((f) => [f.properties.id, { ...f.properties }]));
        for (const f of sel) f.properties.fillColor = '#00aa00';
        const s = performance.now();
        store.startBatchUndo();
        await controle.saveFeatures(sel, iniciais);
        store.commitBatchUndo();
        return Math.round(performance.now() - s);
    }, ids);
    await expect.poll(() => segurados, { timeout: 30000, message: 'o primeiro envio de A nao saiu' }).toBeGreaterThan(0);

    // B deletes the victim through its own store, while A's push is held.
    await B.evaluate(async (id) => (await import('/src/js/store/index.js')).removeFeature('points', id), vitima);
    await expect.poll(async () => (await db.raw.one('SELECT deleted_at IS NOT NULL AS d FROM features WHERE id = $1', [vitima])).d,
        { timeout: 30000, message: 'a exclusao de B nao chegou ao servidor' }).toBe(true);

    liberar();
    // Settle: the server count stops moving for 15 s.
    const verdes = async () => Number((await db.raw.one(
        "SELECT count(*)::int AS n FROM features WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND properties->>'fillColor' = '#00aa00'", [ids])).n);
    let ultimo = -1;
    let estavelDesde = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
        const v = await verdes();
        if (v !== ultimo) { ultimo = v; estavelDesde = Date.now(); }
        if (Date.now() - estavelDesde > 15000) break;
        await new Promise((r) => setTimeout(r, 1000));
    }
    const vivas = Number((await db.raw.one('SELECT count(*)::int AS n FROM features WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [ids])).n);
    const fila = await A.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState());
    const naTelaDoAutor = await A.evaluate(async (m) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const pts = (await getRepository().getMap(m))?.features?.points ?? [];
        return { total: pts.length, verdes: pts.filter((f) => f.properties.fillColor === '#00aa00').length };
    }, ctx.seed.mapId);
    const toastsNaTela = await A.evaluate(() => window.__toasts);

    const comando = A.locator('[data-abre-pendencias="true"]');
    let painel = null;
    if (await comando.count()) {
        await comando.first().dispatchEvent('click');
        const p = A.locator('[data-testid="pendencias-painel"]');
        await expect(p).toBeVisible({ timeout: 15000 });
        // The panel first says it is reading; the STATE that counts is the counters and the rows.
        await expect(A.locator('[data-testid="pendencias-contadores"]')).toBeVisible({ timeout: 60000 });
        await expect.poll(() => A.locator('[data-testid="pendencias-linha"]').count(), { timeout: 60000 }).toBeGreaterThan(0);
        await A.waitForTimeout(1000);
        painel = await p.innerText();
        const junto = A.locator('[data-testid="pendencias-junto"]');
        console.log('[escala-D] resumo junto: ' + ((await junto.count()) ? await junto.innerText() : '(ausente)'));
        // THE GROUPED ACTION, through the real button: accept on a SISTER must decide the whole group.
        const irmas = A.locator('[data-testid="pendencias-linha"][data-classe="recusada-junto"]');
        console.log('[escala-D] linhas recusada-junto: ' + await irmas.count());
        if (await irmas.count() > 0) {
        const irma = irmas.first();
        await irma.locator('[data-acao="aceitar"]').dispatchEvent('click');
        const confirmar = A.locator('.confirm-modal-btn-confirm');
        await expect(confirmar).toBeVisible({ timeout: 10000 });
        console.log('[escala-D] pergunta: ' + (await A.locator('.confirm-modal-container').innerText({ timeout: 10000 })).replace(/s+/g, ' '));
        await A.screenshot({ path: 'test-results/zz-pendencias-pergunta.png' });
        await confirmar.click();
        await expect.poll(() => A.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState()), { timeout: 60000 })
            .toMatchObject({ problemas: 0, pendentes: 0 });
        console.log('[escala-D] depois de aceitar numa irma: ' + JSON.stringify({ fila: await A.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState()), servidorVerdes: await verdes() }));
        }
        console.log('[escala-D] linhas no painel: ' + await A.locator('[data-testid="pendencias-linha"]').count());
        await A.screenshot({ path: testInfo.outputPath('pendencias-conflito.png') });
        await A.screenshot({ path: 'test-results/zz-pendencias-conflito.png' });
    }
    console.log('[escala-D] conflito', JSON.stringify({
        gestoMs, pushes, servidorVerdesVivas: ultimo, servidorVivas: vivas, vivasSemEstilo: vivas - ultimo,
        vitimaApagada: true, filaAutor: fila, autorLocal: naTelaDoAutor, toastsNaTela,
    }));
    console.log('[escala-D] painel de pendencias\n' + (painel ?? '(comando de pendencias ausente)'));
});

// ITEM 3 of the review: with independent operations there is no culprit. B (editor) deletes 1000
// while the owner A locks the map: every delete is refused with the same reason. The panel groups
// them by action and reason, and ONE click decides the 1000.
test('exclusao de 1000 com o mapa travado no meio: um grupo, um clique', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const { A, B, db, ids, seed } = ctx;

    let liberar;
    const liberado = new Promise((r) => { liberar = r; });
    let segurados = 0;
    await B.route((url) => /\/api\/v1\/atlas\/[^/]+\/sync$/.test(url.pathname), async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        segurados++;
        await liberado;
        return route.continue();
    });

    await B.evaluate(async (lista) => {
        const store = await import('/src/js/store/index.js');
        const sm = store.getControl('ClipboardManager').selectionManager;
        const map = globalThis.__ebgeoMap;
        const alvo = new Set(lista);
        const fonte = await map.getSource('points').getData();
        const sel = fonte.features.filter((f) => alvo.has(f.properties.id));
        const estado = store.getStateManager();
        estado.batchUpdate(() => { for (const f of sel) estado.addToSelection('point', String(f.properties.id), f); });
        await sm.deleteSelectedFeatures();
    }, ids);
    await expect.poll(() => segurados, { timeout: 30000 }).toBeGreaterThan(0);

    // The owner locks the map while B's first send is held.
    await A.evaluate(async () => (await import('/src/js/locking/map-lock.controller.js')).mapLockController.toggleMapLock());
    await expect.poll(async () => (await db.raw.one('SELECT locked FROM maps WHERE id = $1', [seed.mapId])).locked,
        { timeout: 30000 }).toBe(true);
    liberar();

    await expect.poll(async () => (await B.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState())).pendentes,
        { timeout: 600000 }).toBe(0);
    const vivas = Number((await db.raw.one('SELECT count(*)::int AS n FROM features WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [ids])).n);
    const fila = await B.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState());

    const comando = B.locator('[data-abre-pendencias="true"]');
    await comando.first().dispatchEvent('click');
    await expect(B.locator('[data-testid="pendencias-painel"]')).toBeVisible({ timeout: 15000 });
    await expect(B.locator('[data-testid="pendencias-contadores"]')).toBeVisible({ timeout: 60000 });
    const resumo = B.locator('[data-testid="pendencias-mesma-acao"]');
    await expect(resumo.first()).toBeVisible({ timeout: 60000 });
    const frase = await resumo.first().innerText();
    await B.screenshot({ path: 'test-results/zz-pendencias-mesma-acao.png' });

    await B.locator('[data-testid="pendencias-linha"]').first().locator('[data-acao="aceitar"]').dispatchEvent('click');
    const confirmar = B.locator('.confirm-modal-btn-confirm');
    await expect(confirmar).toBeVisible({ timeout: 10000 });
    const pergunta = (await B.locator('.confirm-modal-container').innerText()).replace(/\s+/g, ' ');
    await confirmar.click();
    await expect.poll(async () => (await B.evaluate(async () => (await import('/src/js/store/sync/operation-queue.js')).operationQueue.countByState())).problemas,
        { timeout: 60000 }).toBe(0);
    console.log('[escala-D] travado no meio', JSON.stringify({ vivasNoServidor: vivas, filaAntes: fila, resumo: frase, pergunta }));
});
