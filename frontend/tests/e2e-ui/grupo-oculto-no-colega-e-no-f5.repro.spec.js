// Path: e2e-ui/grupo-oculto-no-colega-e-no-f5.repro.spec.js

/**
 * REPRO: a HIDDEN GROUP stopped being drawn only in the session of whoever hid it.
 *
 * A group's `visible` is shared state: it travels by sync operation and the server persists it
 * (`groups.visible`, returned by the snapshot). Hiding a group, though, was a session-only patch
 * of each member's `visivel` on the author's MapLibre source, and the render filter
 * (`layers/visibility-filter.js`) knew nothing about groups. Measured with two browsers before
 * the fix:
 *   - the owner hid the group: on the owner the two members disappeared;
 *   - the editor's tree showed the group hidden ("Mostrar grupo") while BOTH members were still
 *     drawn (`queryRenderedFeatures` found them), with `visivel: true` in its store;
 *   - the owner pressed F5: the members were drawn again under a tree that said hidden.
 * The same patch also overwrote a member's own state: showing the group again wrote
 * `visivel: true` on the source of a member that was hidden on its own.
 *
 * The fix moves the rule into the filter (`hiddenGroupMemberIds` + `setHiddenFeatureIds`),
 * recomputed from the stored groups on GROUPS_CHANGED, on every map setup and on the local toggle,
 * and the toggle no longer writes any `visivel`.
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const CENTRO = [-43.2, -22.9];

/** Ids among `ids` that the map of `page` actually DRAWS right now. */
function desenhadas(page, ids) {
    return page.evaluate((alvos) => {
        const map = globalThis.__ebgeoMap;
        const set = new Set(alvos);
        const achadas = new Set();
        for (const f of map.queryRenderedFeatures()) {
            const id = f.properties?.id;
            if (set.has(id)) achadas.add(id);
        }
        return [...achadas].sort();
    }, ids);
}

async function enquadrar(page) {
    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 12 }), CENTRO);
}

async function agrupar(page, ids) {
    return page.evaluate(async (alvos) => {
        const { getGroupManager } = await import('/src/js/store/services.js');
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const pts = f.points.filter((p) => alvos.includes(p.properties.id));
        return (await getGroupManager().createGroup(pts)).id;
    }, ids);
}

/** Clicks the REAL visibility button of a group's header. */
async function alternarGrupo(page, gid) {
    await openLayersTab(page);
    await page.locator(`.group-container[data-group-id="${gid}"] .group-header .visibility-toggle`).first()
        .evaluate((el) => el.click());
}

function grupoVisivelNoStore(page, gid) {
    return page.evaluate(async (g) => {
        const store = await import('/src/js/store/index.js');
        return store.getMapGroups(store.getCurrentMapNameSync())?.[g]?.visible;
    }, gid);
}

collabTest('grupo oculto pelo Dono: o Editor deixa de desenhar os membros, e o F5 do Dono tambem', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const m1 = await drawPointUI(A, CENTRO);
    const m2 = await drawPointUI(A, [-43.21, -22.91]);
    const fora = await drawPointUI(A, [-43.19, -22.89]);
    const gid = await agrupar(A, [m1, m2]);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('groups', gid)), { timeout: 20000 }).toBe(true);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(fora)), { timeout: 20000 }).toBe(true);

    const todos = [m1, m2, fora].sort();
    for (const p of [A, B]) await enquadrar(p);
    await expect.poll(() => desenhadas(B, todos), { timeout: 20000, message: 'premissa: o Editor desenha os tres' }).toEqual(todos);

    await alternarGrupo(A, gid);
    await expect.poll(async () => (await collab.db.queryEntityRow('groups', gid))?.visible, { timeout: 20000 }).toBe(false);
    await expect.poll(() => desenhadas(A, todos), { timeout: 10000, message: 'o Dono deixa de desenhar os membros' }).toEqual([fora]);

    await expect.poll(() => grupoVisivelNoStore(B, gid), { timeout: 20000 }).toBe(false);
    await expect.poll(() => desenhadas(B, todos), {
        timeout: 10000,
        message: 'o Editor deixa de desenhar os membros do grupo oculto, e continua desenhando a feicao fora dele',
    }).toEqual([fora]);

    // F5 do Dono: o grupo continua oculto no desenho, nao so na arvore.
    await A.reload();
    await expect.poll(() => currentMapKeyIsUuid(A), { timeout: 30000 }).toBe(true);
    await expect.poll(() => grupoVisivelNoStore(A, gid), { timeout: 20000 }).toBe(false);
    await enquadrar(A);
    await expect.poll(() => desenhadas(A, todos), { timeout: 20000, message: 'depois do F5 o Dono continua sem desenhar os membros' })
        .toEqual([fora]);

    // CONTROLE: mostrar o grupo devolve os membros ao desenho dos dois lados.
    await alternarGrupo(A, gid);
    await expect.poll(async () => (await collab.db.queryEntityRow('groups', gid))?.visible, { timeout: 20000 }).toBe(true);
    await expect.poll(() => desenhadas(A, todos), { timeout: 10000 }).toEqual(todos);
    await expect.poll(() => desenhadas(B, todos), { timeout: 20000 }).toEqual(todos);
});

collabTest('mostrar o grupo nao desoculta o membro que estava oculto por conta propria', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const m1 = await drawPointUI(A, CENTRO);
    const m2 = await drawPointUI(A, [-43.21, -22.91]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(m2)), { timeout: 20000 }).toBe(true);

    // m1 oculto pelo botao da propria feicao, ANTES de agrupar.
    await openLayersTab(A);
    for (const icon of await A.locator('.layer-expand-icon.collapsed').all()) await icon.click().catch(() => {});
    await A.locator(`.feature-item[data-feature-id="${m1}"] .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryFeatureRow(m1))?.properties?.visivel, { timeout: 20000 }).toBe(false);

    const gid = await agrupar(A, [m1, m2]);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('groups', gid)), { timeout: 20000 }).toBe(true);
    await enquadrar(A);
    const ambos = [m1, m2].sort();
    await expect.poll(() => desenhadas(A, ambos), { timeout: 10000, message: 'premissa: so m2 desenhado' }).toEqual([m2]);

    await alternarGrupo(A, gid);
    await expect.poll(() => grupoVisivelNoStore(A, gid), { timeout: 10000 }).toBe(false);
    await expect.poll(() => desenhadas(A, ambos), { timeout: 10000 }).toEqual([]);

    await alternarGrupo(A, gid);
    await expect.poll(() => grupoVisivelNoStore(A, gid), { timeout: 10000 }).toBe(true);
    await expect.poll(() => desenhadas(A, ambos), {
        timeout: 10000,
        message: 'mostrar o grupo devolve m2 e deixa m1, oculto por conta propria, oculto',
    }).toEqual([m2]);
    // Nada foi escrito na feicao: o estado proprio de m1 continua o dele no servidor.
    await A.waitForTimeout(2000);
    expect((await collab.db.queryFeatureRow(m1))?.properties?.visivel).toBe(false);
});
