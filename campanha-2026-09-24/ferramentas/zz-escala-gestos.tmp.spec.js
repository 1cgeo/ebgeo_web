// Path: tests/e2e-ui/zz-escala-gestos.tmp.spec.js
// TEMPORARY scale measurement (hunt/b61). Not to be committed.

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
    for (let off = 0; off < n; off += 1000) {
        const recs = ids.slice(off, off + 1000).map((id, k) => ({
            id, geometry: { type: 'Point', coordinates: [-43.2 + ((off + k) % 50) * 0.0002, -22.9 + Math.floor((off + k) / 50) * 0.0002] },
            properties: { id, source: 'point', nome: `P${off + k}`, size: 6, color: '#ff5500', visivel: true, layerId },
        }));
        if (recs.length) {
            await db.raw.none(`INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
                SELECT id, $1::uuid, 'point', geometry, properties, $3
                FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, geometry jsonb, properties jsonb)`,
            [seed.mapId, JSON.stringify(recs), layerId]);
        }
    }
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
    return { db, seed, A, B, ids, layerId };
}

const pontosDe = (page, mapId) => page.evaluate(async (m) => {
    const { getRepository } = await import('/src/js/store/repositories/index.js');
    const mapa = await getRepository().getMap(m);
    return (mapa?.features?.points ?? []).map((f) => ({ id: f.properties.id, color: f.properties.color, layerId: f.properties.layerId }));
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

async function censo(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.countByState();
    });
}

async function medirEtapa(nome, { A, B, db, seed }, gesto, { servidor, par, alvo }) {
    await B.evaluate(() => { window.__probe.maxGap = 0; window.__probe.longMs = 0; });
    const t0 = Date.now();
    const gestoMs = await A.evaluate(gesto.fn, gesto.arg);
    const servidorMs = await esperar(() => servidor(db), alvo);
    const parMs = await esperar(async () => par(await pontosDe(B, seed.mapId)), alvo);
    const probe = await B.evaluate(() => ({ ...window.__probe }));
    const fila = await censo(A);
    const r = { etapa: nome, gestoMs, servidorMs, parMs, totalMs: Date.now() - t0,
        parMaiorQuadroMs: Math.round(probe.maxGap), parLongTaskMs: Math.round(probe.longMs), filaAutor: fila };
    console.log('[escala]', JSON.stringify(r));
    return r;
}

async function f5(B, seed, par, alvo) {
    await B.reload();
    await expect(B.locator('.loading-background')).toHaveCount(0, { timeout: 120000 });
    const v = await esperar(async () => par(await pontosDe(B, seed.mapId)), alvo, 60000);
    console.log('[escala] F5 no par', JSON.stringify({ ok: typeof v === 'number', v }));
}

const vivas = (ids) => async (db) => Number((await db.raw.one(
    'SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND id = ANY($1::uuid[])', [ids])).n);

test('importar 5000 (addFeatures)', async ({ browser }) => {
    test.setTimeout(1200000);
    const ctx = await preparar(browser, 0);
    const novos = Array.from({ length: 5000 }, () => randomUUID());
    await medirEtapa('importar 5000', ctx, {
        fn: async (lista) => {
            const store = await import('/src/js/store/index.js');
            const s = performance.now();
            await store.addFeatures({ points: lista.map((id, i) => ({ type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.3 + (i % 70) * 0.0002, -22.8 + Math.floor(i / 70) * 0.0002] },
                properties: { id, source: 'point', nome: `I${i}`, size: 6, color: '#0055ff', visivel: true } })) });
            return Math.round(performance.now() - s);
        }, arg: novos,
    }, { servidor: vivas(novos), par: (pts) => pts.filter((p) => novos.includes(p.id)).length, alvo: 5000 });
    await f5(ctx.B, ctx.seed, (pts) => pts.filter((p) => novos.includes(p.id)).length, 5000);
});

test('colar (duplicar) 1000', async ({ browser }) => {
    test.setTimeout(1200000);
    const ctx = await preparar(browser, 1000);
    const novos = Array.from({ length: 1000 }, () => randomUUID());
    const copias = (pts) => pts.filter((p) => novos.includes(p.id)).length;
    await medirEtapa('colar 1000 (copias de 1000 existentes)', ctx, {
        fn: async ({ lista, m, ids }) => {
            const store = await import('/src/js/store/index.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const alvo = new Set(lista);
            const originais = (await getRepository().getMap(m)).features.points.filter((f) => alvo.has(f.properties.id));
            const s = performance.now();
            await store.addFeatures({ points: originais.map((f, i) => ({ ...f,
                geometry: { ...f.geometry, coordinates: [f.geometry.coordinates[0] + 0.01, f.geometry.coordinates[1]] },
                properties: { ...f.properties, id: ids[i], nome: `copia ${i}` } })) });
            return Math.round(performance.now() - s);
        }, arg: { lista: ctx.ids, m: ctx.seed.mapId, ids: novos },
    }, { servidor: vivas(novos), par: copias, alvo: 1000 });
    await f5(ctx.B, ctx.seed, copias, 1000);
});

test('mover 1000 para outra camada', async ({ browser }) => {
    test.setTimeout(1200000);
    const ctx = await preparar(browser, 1000);
    let destino = null;
    const noDestino = async (db) => Number((await db.raw.one(
        "SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND id = ANY($1::uuid[]) AND properties->>'layerId' = $2",
        [ctx.ids, destino])).n);
    destino = await ctx.A.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const c = await store.createLayer('Destino em massa');
        return c?.id ?? c;
    });
    await medirEtapa('mover 1000 para camada', ctx, {
        fn: async ({ lista, camada }) => {
            const store = await import('/src/js/store/index.js');
            const s = performance.now();
            await store.moveFeaturesToLayer(lista.map((id) => ({ type: 'point', id })), camada);
            return Math.round(performance.now() - s);
        }, arg: { lista: ctx.ids, camada: destino },
    }, { servidor: noDestino, par: (pts) => pts.filter((p) => p.layerId === destino).length, alvo: 1000 });
});

test('excluir 1000, desfazer, refazer', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const naLista = (pts) => pts.filter((p) => ctx.ids.includes(p.id)).length;
    await medirEtapa('excluir 1000', ctx, {
        fn: async (lista) => {
            const store = await import('/src/js/store/index.js');
            const s = performance.now();
            store.startBatchUndo();
            for (const id of lista) await store.removeFeature('points', id);
            store.commitBatchUndo();
            return Math.round(performance.now() - s);
        }, arg: ctx.ids,
    }, { servidor: vivas(ctx.ids), par: naLista, alvo: 0 });
    await medirEtapa('desfazer a exclusao de 1000', ctx, {
        fn: async () => { const s = performance.now(); await (await import('/src/js/store/index.js')).undoLastAction(); return Math.round(performance.now() - s); },
    }, { servidor: vivas(ctx.ids), par: naLista, alvo: 1000 });
    await medirEtapa('refazer a exclusao de 1000', ctx, {
        fn: async () => { const s = performance.now(); await (await import('/src/js/store/index.js')).redoLastAction(); return Math.round(performance.now() - s); },
    }, { servidor: vivas(ctx.ids), par: naLista, alvo: 0 });
    await f5(ctx.B, ctx.seed, naLista, 0);
});

test('estilo em massa de 1000, desfazer', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    const verdes = async (db) => Number((await db.raw.one(
        "SELECT count(*)::int AS n FROM features WHERE id = ANY($1::uuid[]) AND properties->>'color' = '#00aa00'", [ctx.ids])).n);
    const parVerdes = (pts) => pts.filter((p) => p.color === '#00aa00').length;
    await medirEtapa('estilo em massa de 1000', ctx, {
        fn: async ({ lista, m }) => {
            const store = await import('/src/js/store/index.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const alvo = new Set(lista);
            const pontos = (await getRepository().getMap(m)).features.points.filter((f) => alvo.has(f.properties.id));
            const s = performance.now();
            store.startBatchUndo();
            for (const f of pontos) await store.updateFeature('points', { ...f, properties: { ...f.properties, color: '#00aa00' } });
            store.commitBatchUndo();
            return Math.round(performance.now() - s);
        }, arg: { lista: ctx.ids, m: ctx.seed.mapId },
    }, { servidor: verdes, par: parVerdes, alvo: 1000 });
    await medirEtapa('desfazer o estilo de 1000', ctx, {
        fn: async () => { const s = performance.now(); await (await import('/src/js/store/index.js')).undoLastAction(); return Math.round(performance.now() - s); },
    }, { servidor: verdes, par: parVerdes, alvo: 0 });
    await f5(ctx.B, ctx.seed, parVerdes, 0);
});

test('agrupar 500', async ({ browser }) => {
    test.setTimeout(1200000);
    const ctx = await preparar(browser, 500);
    let grupo = null;
    const membros = async (db) => Number((await db.raw.one(
        'SELECT count(*)::int AS n FROM group_features gf JOIN groups g ON g.id = gf.group_id WHERE g.map_id = $1 AND g.deleted_at IS NULL',
        [ctx.seed.mapId])).n);
    await medirEtapa('agrupar 500', ctx, {
        fn: async (lista) => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            const feats = (f.points || []).filter((x) => lista.includes(x.properties?.id));
            const s = performance.now();
            await store.createGroup(feats);
            return Math.round(performance.now() - s);
        }, arg: ctx.ids,
    }, { servidor: membros, par: async () => ctx.B.evaluate(async (m) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const gs = (await getRepository().getGroups(m)) ?? [];
        const lista = Array.isArray(gs) ? gs : Object.values(gs);
        return lista.reduce((n, g) => n + ((g?.features ?? []).length), 0);
    }, ctx.seed.mapId), alvo: 500 });
    grupo = await ctx.B.evaluate(async (m) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const gs = (await repo.getGroups?.(m)) ?? [];
        return gs.map((g) => (g.features ?? []).length);
    }, ctx.seed.mapId).catch((e) => String(e));
    console.log('[escala] grupos no par', JSON.stringify(grupo));
});

test('transferir camada de 1000 para outro mapa: mover e copiar', async ({ browser }) => {
    test.setTimeout(1800000);
    const ctx = await preparar(browser, 1000);
    await ctx.A.evaluate(async () => { const store = await import('/src/js/store/index.js'); await store.addMap('Destino'); await store.addMap('Copia'); });
    const idDe = (nome) => ctx.A.evaluate(async (n) => (await import('/src/js/store/services/map-resolver.service.js')).mapResolver.resolveToId(n) ?? null, nome);
    await expect.poll(() => idDe('Destino'), { timeout: 60000 }).toMatch(/^[0-9a-f]{8}-/);
    await expect.poll(() => idDe('Copia'), { timeout: 60000 }).toMatch(/^[0-9a-f]{8}-/);
    await expect.poll(async () => (await censo(ctx.A)).pendentes, { timeout: 60000 }).toBe(0);
    const destinoId = await idDe('Destino');
    const copiaId = await idDe('Copia');
    const noMapa = (mapa) => async (db) => Number((await db.raw.one(
        'SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND map_id = $1', [mapa])).n);
    await medirEtapa('copiar camada de 1000 para outro mapa', ctx, {
        fn: async (camada) => {
            const store = await import('/src/js/store/index.js');
            const s = performance.now();
            const r = await store.transferLayerToMap(camada, 'Copia', { mode: 'copy' });
            return { ms: Math.round(performance.now() - s), r: JSON.stringify(r).slice(0, 120) };
        }, arg: ctx.layerId,
    }, { servidor: noMapa(copiaId), par: async () => 1000, alvo: 1000 });
    await medirEtapa('mover camada de 1000 para outro mapa', ctx, {
        fn: async (camada) => {
            const store = await import('/src/js/store/index.js');
            const s = performance.now();
            const r = await store.transferLayerToMap(camada, 'Destino', { mode: 'move' });
            return { ms: Math.round(performance.now() - s), r: JSON.stringify(r).slice(0, 120) };
        }, arg: ctx.layerId,
    }, { servidor: noMapa(destinoId), par: (pts) => 1000 - pts.filter((p) => ctx.ids.includes(p.id)).length, alvo: 1000 });
    const origem = Number((await ctx.db.raw.one('SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND map_id = $1', [ctx.seed.mapId])).n);
    console.log('[escala] origem depois do mover', origem);
});
