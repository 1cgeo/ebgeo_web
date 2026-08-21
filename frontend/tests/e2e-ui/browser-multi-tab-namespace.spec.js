// Path: e2e-ui/browser-multi-tab-namespace.spec.js

/**
 * @fileoverview E0 — DUAS ABAS do mesmo usuário, um contexto só. The gates of the multi-tab
 * plan (`docs/decisions/fase-multiaba-2026-08.md`, E0 item 6 and E7's Portão).
 *
 * The requirement being instrumented: two tabs in DIFFERENT atlases work; two tabs in the
 * SAME atlas collide; one tab never holds two atlases. Until this file, that requirement had
 * ZERO coverage at every layer — `context.newPage()` appears nowhere else in `tests/e2e-ui/`,
 * and the 16 `browser.newContext()` calls are USER PROFILES, which isolate the IndexedDB and
 * localStorage that two tabs of one user share.
 *
 * ---------------------------------------------------------------------------
 * THE CASES
 * ---------------------------------------------------------------------------
 * A0a two tabs, SAME LOCAL atlas → the second is BLOCKED. The only case that measures the
 *     ADDRESS rule itself: `keysCollide` still short-circuits any remote x remote pair, so a
 *     collision between two remote tabs (A2) proves the hold fired, not that the addresses
 *     were compared. A local x local collision can only come from `claimAddress`.
 * A0b a SECOND TAB really works: tab A on a server atlas, tab B on the LOCAL map (a pair that
 *     does not collide today), B draws and the point lands in B's own databases. It exists
 *     because EVERY line of A1 after its first assertion has never executed once, so on the
 *     day E7 lands, a broken second-tab routine would read as "E7 did not close".
 * A0c the same pair, asked of the SERVER: what tab B writes locally must not appear in tab A's
 *     server atlas. This is the only case here that does an HTTP `pullSync`, and the reason it
 *     matters is that the outbound queue is NOT per atlas today (`OPERATION_QUEUE.perAtlas`
 *     is false and `syncEngine.flush` does a global `peek` then pushes to `this._atlasId`).
 * A1  two tabs, DIFFERENT atlases → both live, both namespaces on disk, no cross-leak, and
 *     each point present in ITS server atlas and absent from the other. EXPECTED TO FAIL
 *     TODAY. E7 removes the hold and must delete the `test.fail` marker in the same commit.
 * A2  two tabs, SAME REMOTE atlas → the second is BLOCKED, visibly. A1's control.
 * A2b the blocked tab is actually STOPPED, not merely covered. EXPECTED TO FAIL: measuring A2
 *     turned up a defect the plan does not list (the blocked tab connects anyway ~2 s later).
 * A3b after the tab's OWN logout, nothing of the server atlas is left readable.
 * A4  a public-link visitor must not pollute the LOCAL atlas databases. EXPECTED TO FAIL (E1).
 *
 * A3 WAS REMOVED, NOT FORGOTTEN. It asserted that tab B's work "never disappears during tab A's
 * logout", and the recorded decision says the opposite in as many words (`docs/decisions/fase-multiaba-2026-08.md`,
 * E2: "O logout NÃO poupa depois do aviso confirmado. Sem sessão não existe aba legítima
 * segurando dado de servidor"). The implemented design agrees: the warned tab stops, RELEASES
 * its mount lock and clears its scope (`store/sync/tab-lock-sync-brake.js`), and only then does
 * the destroyer sweep. A `test.fail` case whose named assertion contradicts the design can never
 * go red, so it polices nothing while looking like a gate. The scenario lives on, with the
 * expectation the design actually holds, as B3 of `browser-multi-tab-teardown-queue.spec.js`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT COVER, WRITTEN DOWN SO THE LIST IS NOT MISTAKEN FOR THE REQUIREMENT
 * ---------------------------------------------------------------------------
 *  - TWO DISTINCT LOCAL ATLASES in two tabs. The decision of 2026-08-15 allows them and there
 *    is no UI to create a second local slot yet (E3 gives `createLocalAtlas` its first caller),
 *    so the pair is unreachable from the browser today.
 *  - "ONE TAB NEVER HOLDS TWO ATLASES". Measured while writing A1 and NOT asserted anywhere:
 *    tab B booted on `?atlas=Y` reports an active scope of `remote-<X>`, tab A's atlas, because
 *    `GlobalKey.STORE_ORIGIN` is global to the installation. The only read that could assert it
 *    is `activeScopeOf`, which is diagnostic-only for the HMR reason stated in `two-tabs.js`,
 *    so pinning it needs a signal E0 may not add. It is E1/E4's to close and to instrument.
 *  - A THIRD TAB, F5, close-and-reopen, and the "Usar aqui" takeover.
 *  - The unit-level case E7's Portão also asks for: `defaultCreateTransport` with node's real
 *    BroadcastChannel. That belongs in `tests/unit/tab-lock.test.js`, not here.
 *
 * ---------------------------------------------------------------------------
 * HOW A GATE COULD GO RED (OR GREEN) FOR THE WRONG REASON, AND WHAT STOPS IT
 * ---------------------------------------------------------------------------
 * Every `test.fail` case runs through `pendingGate` (`helpers/two-tabs.js`): a failure in the
 * setup, or a gate failure whose message is not the named one, makes the case PASS, and
 * Playwright reports a fail-marked test that passes as a run failure. So "expected failure"
 * can only mean the named assertion. That replaces the previous instruction to read the
 * attached error by hand, which was measured to lapse 2 runs in 6.
 *
 * `retries: 0` for this file (`test.describe.configure`): the config's `retries: 1` would
 * report a real two-tab race as "flaky", which is a green run.
 */

import { test, expect } from '@playwright/test';
import { utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { loginUI, goToLocalMapUI, drawPointUI, currentMapName } from './helpers/collab-helpers.js';
import {
    createTabContext,
    closeTabContexts,
    openTab,
    tabVerdict,
    tabDiagnostic,
    pendingGate,
    readIdbFeatureIds,
    idbDatabaseNames,
    atlasDbNames,
    mapsDbOf,
    remoteSuffix,
    logoutUI,
    attachNamespaces,
    hmrEventsOf,
    BLOCK_OVERLAY_SELECTOR,
} from './helpers/two-tabs.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Maps databases of every NON-remote (local slot) namespace present on disk. */
const localMapsDbs = (names) => names.filter(
    (n) => n === 'ebgeo_maps' || (n.startsWith('ebgeo_maps__') && !n.startsWith('ebgeo_maps__remote-')),
);

// A SKIPPED FILE IS NOT A PASSED FILE. `describeOrSkip` turns every gate below into a skip when
// the globalSetup could not raise the backend, and nothing else in the repository asserts the
// skip count: the Playwright suite is outside `npm test`, there is no CI and there are no git
// hooks, so a green `npm run test:e2e:ui` on a machine without PostgreSQL would be
// indistinguishable from the gates passing. This case makes that state LOUD, and the escape
// hatch is explicit and named.
test('o instrumento de duas abas REQUER backend (sem ele, os portões não rodam)', () => {
    if (!state.skip) return;
    expect(
        process.env.EBGEO_E2E_NO_DB,
        'os portões de duas abas foram PULADOS por falta de backend. Suba PostgreSQL + PostGIS '
        + 'e rode de novo, ou declare a intenção com EBGEO_E2E_NO_DB=1 para aceitar a rodada '
        + 'sem eles. Um pulo silencioso é verde sem verificação.',
    ).toBeTruthy();
});

/**
 * Registers one user and creates `atlasNames.length` server atlases, each with one UUID-keyed
 * map. Runs in its own throwaway context so the tabs under test boot on a clean profile.
 * @returns {Promise<{username:string,password:string,atlases:Array<{id:string,name:string,mapId:string,mapName:string}>}>}
 */
async function seedUserWithAtlases(browser, baseUrl, atlasNames) {
    const user = await createVerifiedUser({ prefix: 'tabs', nome: 'Duas Abas' });
    const page = await browser.newPage();
    await page.goto('/');
    const seed = await page.evaluate(async ({ base, names, u }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const { username, password } = u;
        await api.login(username, password);
        const atlases = [];
        for (const name of names) {
            const atlas = await api.createAtlas({ name });
            const mapId = crypto.randomUUID();
            const mapName = `Mapa ${name}`;
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: mapName })]);
            atlases.push({ id: atlas.id, name, mapId, mapName });
        }
        return { username, password, atlases };
    }, { base: baseUrl, names: atlasNames, u: user });
    await page.close();
    return seed;
}

/** Seeds an atlas with one feature and publishes it, returning the anonymous link. */
async function seedPublicAtlas(browser, baseUrl) {
    const user = await createVerifiedUser({ prefix: 'pubtab', nome: 'Public Owner' });
    const page = await browser.newPage();
    await page.goto('/');
    const seed = await page.evaluate(async ({ base, u }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const apiBase = `${base}/api/v1`;
        const api = new ApiClient({ baseUrl: apiBase });
        await api.login(u.username, u.password);
        const atlas = await api.createAtlas({ name: 'Atlas Público' });
        const mapId = crypto.randomUUID();
        await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'Mapa Público' })]);
        const featureId = crypto.randomUUID();
        await api.pushOperations(atlas.id, [
            createOperation('feature', 'create', featureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'ponto publico' },
            }),
        ]);
        const res = await fetch(`${apiBase}/atlas/${atlas.id}/sharing/public`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${api.getAccessToken()}` },
        });
        const body = await res.json();
        return { atlasId: atlas.id, mapId, featureId, publicLink: body?.data?.publicLink };
    }, { base: baseUrl, u: user });
    await page.close();
    return seed;
}

/**
 * A tab is READY only when its atlas map is the current one, not when the badge says online.
 *
 * MEASURED, and it is why this exists: with only the badge wait, A2 was green 3/5 in series. The
 * app activates the atlas map ASYNCHRONOUSLY after the connect, so a draw fired in that window
 * lands in the local default map and the poll for "a new feature in the current map" times out.
 * `openClient` (collab-helpers) carries the same wait for the same reason.
 * @param {import('@playwright/test').Page} page
 * @param {{mapName: string}} atlas
 */
async function waitAtlasTabReady(page, atlas) {
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 30000 });
    await waitMapLoaded(page);
    await expect
        .poll(() => currentMapName(page), { timeout: 30000, message: 'a aba ativou o mapa do atlas' })
        .toBe(atlas.mapName);
}

/** Waits for the live MapLibre map of one tab. */
function waitMapLoaded(page) {
    return page.waitForFunction(
        () => !!(globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded && globalThis.__ebgeoMap.loaded()),
        null,
        { timeout: 30000 },
    );
}

/** Polls the RAW IndexedDB of `dbName` until it holds `featureId` (or times out). */
async function expectFeatureInDb(page, dbName, featureId, message) {
    await expect
        .poll(async () => (await readIdbFeatureIds(page, dbName)).featureIds, { timeout: 15000, message })
        .toContain(featureId);
}

/** Every point feature id the SERVER holds for one atlas, over HTTP. */
function serverPointIds(page, baseUrl, creds, atlasId) {
    return page.evaluate(async ({ base, c, aid }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const pulled = await api.pullSync(aid, 0);
        return (pulled.snapshot?.maps || [])
            .flatMap((m) => m.features?.points || [])
            .map((p) => p.properties?.id)
            .filter(Boolean);
    }, { base: baseUrl, c: creds, aid: atlasId });
}

describeOrSkip('Duas abas, um usuário: namespace por atlas (E0)', () => {
    // A real race between two tabs must never be reported as "flaky", which is a pass.
    test.describe.configure({ retries: 0 });

    // NOT DECORATION. Four cases here end inside `pendingGate`, which THROWS the expected
    // failure, so the `ctx.close()` written at the end of a case body is unreachable for them by
    // construction. Without this the worker carried four live contexts — eight tabs, their
    // WebSockets, their 1.5 s flush loops and their MapLibre canvases — through every later case
    // on the single worker this config uses. That is the "sustained load" a heavy spec then gets
    // blamed for. `closeTabContexts` ends every context `createTabContext` handed out, whatever
    // the case did with it.
    test.afterEach(closeTabContexts);

    test('A0z — o servidor do e2e não pode trocar a página no meio da medição (controle do instrumento)', async ({ browser }) => {
        // O CONTROLE DE UM CONSERTO QUE, SEM ELE, É INDISTINGUÍVEL DE SORTE. Este arquivo é
        // servido pelo `tests/e2e-ui/vite.e2e.config.js`, que remove o watcher e o HMR do Vite,
        // porque um `src/` editado durante a rodada reinjeta o módulo com `?t=<epoch>` e recarrega
        // a página: medido em 2026-08-15, isso derrubou 6 de 10 casos deste arquivo de uma vez
        // (`ReferenceError: localforage is not defined` num módulo `?t=`, `Execution context was
        // destroyed` em dois casos que não navegam, e `Failed to fetch` na semeadura).
        //
        // A ASSERÇÃO MUDOU DEPOIS DE UMA MEDIÇÃO, e a versão anterior era forte demais. Ela exigia
        // a AUSÊNCIA DO CANAL (nenhum WebSocket de volta para a origem do app), e isso é
        // inalcançável no Vite 8: medido em 2026-08-15, `curl` no dev server servido por
        // `vite.e2e.config.js` devolve um HTML que injeta `/@vite/client` MESMO com `hmr: false`,
        // e o cliente abre `ws://localhost:<porta>/?token=...`. Ou seja, `hmr: false` desliga o
        // HMR sem remover o canal.
        //
        // O QUE PROTEGE A MEDIÇÃO, ENTÃO, É `watch: null`: sem watcher, nada dispara invalidação e
        // o canal não tem o que empurrar. Como isso é uma afirmação sobre COMPORTAMENTO e não
        // sobre topologia, ela é provada pelo EXPERIMENTO em vez de por proxy: tocamos um arquivo
        // de `src/` durante a medição, que é exatamente o gesto que derrubou 6 de 10 casos deste
        // arquivo, e exigimos que nada seja re-servido e que a página não navegue.
        //
        // O toque é um `utimes` (só o mtime muda, byte nenhum), então ele não pode quebrar nada
        // nem sujar a árvore, e é o sinal que um watcher escuta.
        test.setTimeout(60000);

        const ctx = await createTabContext(browser, state.baseUrl);
        const tab = await openTab(ctx, '/');
        await waitMapLoaded(tab);
        await tab.waitForTimeout(3000);

        const navegacoesAntes = hmrEventsOf(tab).navigations.length;
        expect(navegacoesAntes, 'o instrumento registrou a navegação inicial (não está cego)')
            .toBeGreaterThan(0);

        // O ATO: tocar um arquivo que a página TEM carregado, para que uma invalidação, se
        // houvesse watcher, alcançasse esta aba.
        const alvo = fileURLToPath(new URL('../../src/js/store/atlas-namespace.js', import.meta.url));
        const agora = new Date();
        await utimes(alvo, agora, agora);
        await tab.waitForTimeout(4000);

        const eventos = hmrEventsOf(tab);
        expect(
            eventos.modules,
            'um arquivo de src foi TOCADO durante a medição e nenhum módulo foi re-servido com '
            + '?t=<epoch>: o watcher está mesmo desligado',
        ).toEqual([]);
        expect(
            eventos.navigations.length,
            'e a página não navegou por conta própria depois do toque',
        ).toBe(navegacoesAntes);
    });

    test('A0a — duas abas no MESMO atlas LOCAL colidem (a regra do ENDEREÇO, sem a espera)', async ({ browser }) => {
        // WHY THIS IS NOT A DUPLICATE OF A2. `keysCollide` (`src/js/utilities/tab-lock.js`)
        // returns true for ANY remote x remote pair while the hold E7 removes is in place, so
        // A2's collision is produced by the hold and says nothing about address equality. Two
        // tabs on the same LOCAL slot never touch that branch: the only thing that can block
        // the second one is the claim on the same address. When E7 lands, A2 changes meaning
        // and this case does not.
        // ANÔNIMO de propósito: sem sessão, `/` cai direto no mapa local (o mapa É o produto
        // para quem não entrou), então as duas abas seguram o MESMO slot local sem passar pelo
        // seletor de projetos e sem tocar em atlas de servidor nenhum.
        test.setTimeout(90000);

        const ctx = await createTabContext(browser, state.baseUrl);
        const tabA = await openTab(ctx, '/');
        await waitMapLoaded(tabA);
        await expect(tabA.locator(BLOCK_OVERLAY_SELECTOR), 'a aba A não é bloqueada').toBeHidden();

        const tabB = await openTab(ctx, '/');

        await expect(tabB.locator(BLOCK_OVERLAY_SELECTOR), 'a segunda aba no mesmo atlas local é bloqueada')
            .toBeVisible({ timeout: 30000 });
        const verdict = await tabVerdict(tabB, { timeout: 5000 });
        expect(verdict.blocked, 'e continua bloqueada depois do settle do lock').toBe(true);

        await ctx.close();
    });

    /**
     * The one two-tab pair that is REACHABLE today: tab A stays on the LOCAL map and tab B
     * opens a server atlas by URL.
     *
     * THE ORDER IS NOT INTERCHANGEABLE, and finding that out cost a run. With tab A on the
     * SERVER atlas and tab B opening `/`, tab B is BLOCKED (measured 2026-08-15: the overlay
     * resolves visible, 23 polls). The reason is the leak this file lists as uncovered: the
     * origin marker is global to the installation, so tab B boots claiming tab A's remote
     * atlas before it ever decides to be a local tab, and the two keys collide. Local-first is
     * therefore the only order in which "two tabs, two different things" runs at all today,
     * and it is the order A3 already uses.
     * @returns {Promise<Object>}
     */
    async function parLocalERemoto(browser, testInfo, atlasName) {
        const seed = await seedUserWithAtlases(browser, state.baseUrl, [atlasName]);
        const [X] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tabA = await openTab(ctx, '/');
        await loginUI(tabA, seed.username, seed.password);
        await goToLocalMapUI(tabA);
        await waitMapLoaded(tabA);
        await expect(tabA.locator(BLOCK_OVERLAY_SELECTOR), 'a aba A (local) não é bloqueada').toBeHidden();

        const tabB = await openTab(ctx, `/?atlas=${X.id}`);
        await waitAtlasTabReady(tabB, X);
        await expect(tabB.locator(BLOCK_OVERLAY_SELECTOR), 'a aba B (remota) não é bloqueada').toBeHidden();

        await attachNamespaces(testInfo, tabB, `${atlasName} depois das duas aberturas`);
        return { seed, X, ctx, tabA, tabB };
    }

    test('A0b — uma SEGUNDA aba desenha, e o ponto cai no namespace dela', async ({ browser }, testInfo) => {
        // WHY IT EXISTS. Every line of A1 after its first assertion has never executed: the
        // gate aborts there. So `drawPointUI` in a second tab, `waitAtlasTabReady` in a second
        // tab and `expectFeatureInDb` against a second tab are, in this file, unproven code —
        // and on the day E7 lands, any defect in them would read as "E7 did not close".
        test.setTimeout(120000);

        const { X, ctx, tabB } = await parLocalERemoto(browser, testInfo, 'Atlas A0b');

        // The SECOND tab really draws, and the point really lands where that tab writes.
        const pointB = await drawPointUI(tabB, [-43.4, -23.1]);
        expect(pointB, 'a aba B (segunda aba) desenhou').toBeTruthy();
        await tabB.keyboard.press('Escape');

        const remoteDb = mapsDbOf(remoteSuffix(X.id));
        await expectFeatureInDb(tabB, remoteDb, pointB, 'o ponto da segunda aba está no namespace dela');

        // ...and NOT in any local database, which is the leak direction the disk can see.
        const names = await attachNamespaces(testInfo, tabB, 'A0b depois do desenho');
        const localDbs = localMapsDbs(names);
        expect(localDbs.length, 'existe ao menos um banco local para conferir').toBeGreaterThan(0);
        for (const db of localDbs) {
            const local = await readIdbFeatureIds(tabB, db);
            expect(local.featureIds, `${db} (local) não recebeu o ponto do atlas de servidor`)
                .not.toContain(pointB);
        }

        await ctx.close();
    });

    test('A0c — o que a aba LOCAL escreve não chega ao atlas de servidor da outra', async ({ browser }, testInfo) => {
        // THE ONLY CASE HERE THAT ASKS THE SERVER, and the reason it has to exist: every other
        // read in this file is IndexedDB, while the outbound queue is a SINGLE global database
        // (`atlas-namespace.js`, `OPERATION_QUEUE.perAtlas: false`) drained by
        // `syncEngine.flush`, which does a global `operationQueue.peek()` and pushes the batch
        // to `this._atlasId`. A leak of that kind leaves the local disk perfectly tidy and
        // sends the data to the wrong atlas, so a disk-only gate is green while it happens.
        test.setTimeout(120000);

        const { seed, X, ctx, tabA, tabB } = await parLocalERemoto(browser, testInfo, 'Atlas A0c');

        // POSITIVE control of the server read: what the REMOTE tab draws DOES reach X. Without
        // it, "the local point is not in X" is also what a broken pull returns.
        const pointRemoto = await drawPointUI(tabB, [-43.2, -22.9]);
        expect(pointRemoto, 'a aba remota desenhou').toBeTruthy();
        await tabB.keyboard.press('Escape');
        await expect
            .poll(() => serverPointIds(tabB, state.baseUrl, seed, X.id),
                { timeout: 30000, message: 'o ponto da aba remota chegou ao servidor' })
            .toContain(pointRemoto);

        // The LOCAL tab draws into its own store, while the other tab is connected.
        const pointLocal = await drawPointUI(tabA, [-43.4, -23.1]);
        expect(pointLocal, 'a aba local desenhou').toBeTruthy();
        await tabA.keyboard.press('Escape');

        // Several turns of the 1.5 s auto-flush, so "it did not leak" is not "it had no time".
        await tabB.waitForTimeout(6000);
        const noServidor = await serverPointIds(tabB, state.baseUrl, seed, X.id);
        expect(noServidor, 'o ponto remoto continua no servidor (o pull mede mesmo)').toContain(pointRemoto);
        expect(noServidor, 'o ponto LOCAL da outra aba não foi empurrado para o atlas de servidor')
            .not.toContain(pointLocal);

        await ctx.close();
    });

    test('A1 — duas abas em atlas DISTINTOS: as duas vivem e não vazam uma na outra', async ({ browser }, testInfo) => {
        // FECHADO POR E7, e este é o portão da fase inteira: a retenção remoto x remoto saiu de
        // `keysCollide`, e duas abas em atlas de servidor DIFERENTES passaram a coexistir de
        // verdade, em navegador, com os dois conjuntos de bancos no disco. Medido na primeira
        // rodada em que o marcador caiu: `ebgeo__remote-6bbceb76…` e `ebgeo__remote-d155ac8c…`
        // lado a lado, e a aba B online no atlas Y.
        //
        // O gate continua sendo uma asserção COMPOSTA sobre o que a aba B virou, e isso não é
        // estilo: "bloqueada", "caiu no seletor de projetos" e "nunca bootou" produzem três
        // diffs diferentes, em vez de um único "o badge não está online" que não diria qual dos
        // três aconteceu.
        //
        // O CONTROLE NEGATIVO DESTE CASO É O A2 (duas abas no MESMO atlas, a segunda BLOQUEADA).
        // Sem ele, "as duas abas passaram" seria indistinguível de um predicado que virou
        // sempre-falso, que é literalmente a mudança que E7 fez.
        test.setTimeout(120000);

        const resultado = await pendingGate(testInfo, {
            marca: 'a aba B vive no atlas Y',

            setup: async () => {
                const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Atlas X', 'Atlas Y']);
                const [X, Y] = seed.atlases;

                const ctx = await createTabContext(browser, state.baseUrl);
                const tabA = await openTab(ctx, '/');
                await loginUI(tabA, seed.username, seed.password);
                await tabA.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
                await waitAtlasTabReady(tabA, X);

                // Tab B is a SECOND TAB of the same profile (shared localStorage carries the session).
                const tabB = await openTab(ctx, `/?atlas=${Y.id}`);
                await tabB.waitForTimeout(6000); // past the settle window of the lock
                return { seed, X, Y, ctx, tabA, tabB };
            },

            gate: async ({ tabB }) => {
                const diag = await tabDiagnostic(tabB);
                expect(diag, 'a aba B vive no atlas Y').toMatchObject({
                    blocked: false,
                    page: 'mapa',
                    syncState: 'online',
                });
            },
        });

        // ===== TUDO ABAIXO SÓ RODA DEPOIS DE E7. Cada linha é parte do portão e nenhuma delas
        // jamais executou; ao promover, rode o corpo inteiro e leia asserção por asserção.
        //
        // O `pendingGate` devolve o CONTEXTO já montado: refazer o cenário aqui gastaria o
        // orçamento de 120 s duas vezes no dia em que o portão abrir. Quando o gate não passa,
        // ele lança (falha esperada) ou devolve `passed: false` (harness quebrado, e aí o caso
        // vira verde de propósito, que sob `test.fail()` reprova a rodada), então esta linha só
        // é alcançada com o defeito fechado.
        if (!resultado.passed) return;
        const { seed, X, Y, ctx, tabA, tabB } = resultado.context;
        await waitAtlasTabReady(tabB, Y);

        // --- Both namespaces on disk, read from the browser, not from an app module. ---
        const names = await attachNamespaces(testInfo, tabA, 'A1 depois das duas aberturas');
        for (const db of atlasDbNames(remoteSuffix(X.id))) expect(names).toContain(db);
        for (const db of atlasDbNames(remoteSuffix(Y.id))) expect(names).toContain(db);

        // --- No cross-leak ON DISK: what is drawn in X lands in X and nowhere else. ---
        const pointX = await drawPointUI(tabA, [-43.2, -22.9]);
        await tabA.keyboard.press('Escape');
        const pointY = await drawPointUI(tabB, [-43.4, -23.1]);
        await tabB.keyboard.press('Escape');
        expect(pointX, 'a aba A desenhou').toBeTruthy();
        expect(pointY, 'a aba B desenhou').toBeTruthy();

        await expectFeatureInDb(tabA, mapsDbOf(remoteSuffix(X.id)), pointX, 'o ponto de X está em X');
        await expectFeatureInDb(tabB, mapsDbOf(remoteSuffix(Y.id)), pointY, 'o ponto de Y está em Y');

        const inX = await readIdbFeatureIds(tabA, mapsDbOf(remoteSuffix(X.id)));
        const inY = await readIdbFeatureIds(tabA, mapsDbOf(remoteSuffix(Y.id)));
        expect(inX.featureIds, 'o ponto de Y NÃO está nos bancos de X').not.toContain(pointY);
        expect(inY.featureIds, 'o ponto de X NÃO está nos bancos de Y').not.toContain(pointX);

        // --- ...and NO cross-leak ON THE SERVER, which the disk cannot see. The queue is global
        //     today and the flush pushes it to whichever atlas the flushing tab is on, so this
        //     half of the gate is E2B's and not E7's. Both have to hold for A1 to be green. ---
        await expect
            .poll(() => serverPointIds(tabA, state.baseUrl, seed, X.id),
                { timeout: 30000, message: 'o ponto de X chegou ao atlas X do servidor' })
            .toContain(pointX);
        await expect
            .poll(() => serverPointIds(tabB, state.baseUrl, seed, Y.id),
                { timeout: 30000, message: 'o ponto de Y chegou ao atlas Y do servidor' })
            .toContain(pointY);
        expect(await serverPointIds(tabA, state.baseUrl, seed, X.id),
            'o atlas X do servidor não recebeu o ponto de Y').not.toContain(pointY);
        expect(await serverPointIds(tabB, state.baseUrl, seed, Y.id),
            'o atlas Y do servidor não recebeu o ponto de X').not.toContain(pointX);

        await ctx.close();
    });

    test('A2 — duas abas no MESMO atlas REMOTO: a segunda é BLOQUEADA (controle negativo de A1)', async ({ browser }, testInfo) => {
        test.setTimeout(120000);

        const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Atlas Único']);
        const [X] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tabA = await openTab(ctx, '/');
        await loginUI(tabA, seed.username, seed.password);
        await tabA.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
        await waitAtlasTabReady(tabA, X);

        // --- POSITIVE control of the instrument, BEFORE anything is contested: the namespace of X
        //     exists and really holds what tab A drew. Without this, "tab B has no data" would be
        //     indistinguishable from "the reader never finds anything". ---
        const pointA = await drawPointUI(tabA, [-43.2, -22.9]);
        expect(pointA, 'a aba A desenhou o ponto de controle').toBeTruthy();
        await tabA.keyboard.press('Escape');
        await expectFeatureInDb(tabA, mapsDbOf(remoteSuffix(X.id)), pointA, 'o ponto está no namespace de X');

        // --- NEGATIVE control of the same reader: a namespace nobody opened must read as absent.
        //     A reader that answered "exists" for every name would pass every leak assertion. ---
        const ghost = await readIdbFeatureIds(tabA, mapsDbOf(remoteSuffix(crypto.randomUUID())));
        expect(ghost.exists, 'um namespace inexistente lê como ausente (e não é criado pela leitura)').toBe(false);

        const namesBefore = await attachNamespaces(testInfo, tabA, 'A2 com só a aba A');
        for (const db of atlasDbNames(remoteSuffix(X.id))) expect(namesBefore).toContain(db);

        // --- The gate: a second tab on the SAME atlas is blocked, and blocked VISIBLY.
        //     SAIBA O QUE ELE MEDE HOJE: com a espera de `keysCollide` no lugar, QUALQUER par
        //     remoto x remoto colide, então este verde prova que houve arbitragem e não que os
        //     endereços foram comparados. Quem mede a regra do endereço é A0a. Depois de E7,
        //     este caso passa a medir a regra, e A0a continua sendo o controle dela. ---
        const tabB = await openTab(ctx, `/?atlas=${X.id}`);
        await expect(tabB.locator(BLOCK_OVERLAY_SELECTOR), 'a aba B mostra o overlay de bloqueio')
            .toBeVisible({ timeout: 30000 });
        await expect(tabB.locator('.tab-lock-overlay__title'))
            .toHaveText('EBGeo está aberto em outra aba');

        // The block is not a flicker: it is still there after the lock settles.
        const verdictB = await tabVerdict(tabB, { timeout: 5000 });
        expect(verdictB.blocked, 'a aba B continua bloqueada depois do settle do lock').toBe(true);

        // Tab A is untouched by the arbitration it won.
        await expect(tabA.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 15000 });
        await expect(tabA.locator(BLOCK_OVERLAY_SELECTOR), 'a aba A não é bloqueada').toBeHidden();

        await ctx.close();
    });

    test('A2b — o bloqueio PARA a aba bloqueada, não apenas a cobre', async ({ browser }, testInfo) => {
        // PENDENTE — ACHADO NOVO DESTE INSTRUMENTO, não previsto no `docs/decisions/fase-multiaba-2026-08.md`.
        //
        // MEDIDO (2026-08-15, com o código de hoje): a segunda aba no MESMO atlas mostra o overlay
        // e, cerca de dois segundos depois, CONECTA assim mesmo. Amostras da sonda na aba B:
        //   @2s  overlayVisible=true, atlasId=null,  conn=offline
        //   @4s  overlayVisible=true, atlasId=<X>,   conn=online, a URL ganha `&map=`
        // Ou seja: as duas abas ficam ONLINE no mesmo atlas, uma delas atrás de um overlay que diz
        // que ela está parada. `store/sync/tab-lock-sync-brake.js` declara no topo que bloquear é
        // `stopAutoFlush()` + `syncEngine.disconnect()` justamente porque "atrás do overlay antigo a
        // aba bloqueada seguia escrevendo no servidor"; a medição diz que a aba bloqueada volta a
        // conectar depois disso, provavelmente pelo replay do open adiado (`deferAtlasOpen` /
        // `resumeDeferredAtlasOpen`), que roda sem a aba ter recuperado a claim.
        //
        // Por que fica FORA de A2: A2 é o controle negativo de A1 e precisa continuar VERDE.
        // Candidato a fechar em E2 (freio + aviso de desmontagem) ou junto de E7.
        test.fail();
        test.setTimeout(120000);

        await pendingGate(testInfo, {
            marca: 'uma aba bloqueada não fica online no atlas que a outra segura',

            setup: async () => {
                const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Atlas Freio']);
                const [X] = seed.atlases;

                const ctx = await createTabContext(browser, state.baseUrl);
                const tabA = await openTab(ctx, '/');
                await loginUI(tabA, seed.username, seed.password);
                await tabA.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
                await waitAtlasTabReady(tabA, X);

                const tabB = await openTab(ctx, `/?atlas=${X.id}`);
                await expect(tabB.locator(BLOCK_OVERLAY_SELECTOR), 'a aba B foi bloqueada (pré-condição)')
                    .toBeVisible({ timeout: 30000 });
                // Long enough to cover the window in which the measurement above saw B connect.
                await tabB.waitForTimeout(10000);
                return { ctx, tabB };
            },

            gate: async ({ tabB }) => {
                const diag = await tabDiagnostic(tabB);
                expect(diag.syncState, 'uma aba bloqueada não fica online no atlas que a outra segura')
                    .not.toBe('online');
            },
        });
    });

    test('A3b — depois que a PRÓPRIA aba B desloga, nada do atlas de servidor sobra', async ({ browser }, testInfo) => {
        // A metade do encerramento do antigo A3, que ficou quando ele saiu (ver o cabeçalho do
        // arquivo). Este caso não depende de aviso nem de freio: uma aba que desloga apaga o
        // próprio namespace, e tem que continuar apagando. Por isso é verde e fica verde.
        test.setTimeout(120000);

        const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Atlas Fim']);
        const [X] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tab = await openTab(ctx, '/');
        await loginUI(tab, seed.username, seed.password);
        await tab.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
        await waitAtlasTabReady(tab, X);

        const point = await drawPointUI(tab, [-43.25, -22.95]);
        expect(point, 'a aba desenhou antes do próprio logout').toBeTruthy();
        await tab.keyboard.press('Escape');
        const dbX = mapsDbOf(remoteSuffix(X.id));
        await expectFeatureInDb(tab, dbX, point, 'antes do logout, o ponto está no namespace do atlas');

        await logoutUI(tab);

        await attachNamespaces(testInfo, tab, 'A3b depois do logout');

        // A PERGUNTA É "A FEIÇÃO AINDA É LEGÍVEL EM ALGUM LUGAR", não "o banco tal está vazio".
        // As duas saídas legítimas (os bancos sumiram do disco, ou sobraram vazios) dão a mesma
        // resposta aqui, e a varredura passa por TODO banco de mapas, inclusive os locais, então
        // ela nunca é vácua: `ebgeo_maps` existe sempre. A versão anterior perguntava as duas
        // coisas em DOIS snapshots de `indexedDB.databases()` e perdia a corrida com o delete das
        // cascas, que é assíncrono: ela reprovou dizendo que o namespace tinha saído do disco,
        // que é justamente o resultado certo.
        const ondeAindaEsta = [];
        for (const db of await idbDatabaseNames(tab)) {
            if (!db.startsWith('ebgeo_maps')) continue;
            const r = await readIdbFeatureIds(tab, db);
            if (r.featureIds.includes(point)) ondeAindaEsta.push(db);
        }
        expect(ondeAindaEsta, 'depois do próprio logout, a feição do servidor não é legível em banco nenhum')
            .toEqual([]);
        // ...e o leitor não está simplesmente devolvendo vazio para tudo: o banco de mapas do
        // slot local existe e foi lido.
        expect(await idbDatabaseNames(tab), 'o slot local continua no disco').toContain('ebgeo_maps');

        await ctx.close();
    });

    test('A4 — visitante de link público não polui o atlas LOCAL', async ({ browser }, testInfo) => {
        // FECHADO POR E1, e este caso é a prova em navegador daquela etapa. O defeito:
        // `openPublicAtlasFromUrl` (`src/js/index.js`) ativava o namespace remoto e chamava
        // `clearAllDataStore()` três linhas depois; sem ninguém autenticado, aquele wipe varria o
        // registro remoto e re-apontava a store para um slot LOCAL, então o snapshot público era
        // escrito dentro do atlas do próprio visitante e ficava lá.
        //
        // E1 tirou a varredura de dentro do wipe: ela passou a ser chamada POR NOME, nos dois
        // caminhos que significam "a sessão acabou". Um visitante anônimo de link público não é
        // um deles.
        test.setTimeout(120000);

        await pendingGate(testInfo, {
            marca: '(local) não recebeu a feição pública',

            setup: async () => {
                const seed = await seedPublicAtlas(browser, state.baseUrl);
                expect(seed.publicLink, 'o atlas foi publicado').toBeTruthy();

                const ctx = await createTabContext(browser, state.baseUrl);
                const tab = await openTab(ctx, `/?atlasPublico=${seed.publicLink}`);

                // POSITIVE control: the visit really loaded the public atlas. Without it, "nothing
                // in the local databases" is also what a failed open produces.
                await waitMapLoaded(tab);
                await expect
                    .poll(async () => tab.evaluate(async () => {
                        const store = await import('/src/js/store/index.js');
                        const f = await store.getCurrentMapFeatures();
                        return (f.points || []).map((p) => p.properties?.id);
                    }), { timeout: 30000, message: 'a feição pública chegou ao visitante' })
                    .toContain(seed.featureId);

                const names = await attachNamespaces(testInfo, tab, 'A4 depois da visita pública');
                return { ctx, tab, seed, names };
            },

            gate: async ({ tab, seed, names }) => {
                // The leak assertion first, for the evidence it prints: it names the database the
                // public atlas fell into and the feature id sitting in it.
                const localDbs = localMapsDbs(names);
                expect(localDbs.length, 'existe ao menos um banco local para conferir').toBeGreaterThan(0);
                for (const db of localDbs) {
                    const local = await readIdbFeatureIds(tab, db);
                    expect(local.featureIds, `${db} (local) não recebeu a feição pública`)
                        .not.toContain(seed.featureId);
                }
                const remoteDb = mapsDbOf(remoteSuffix(seed.atlasId));
                expect(names, 'o namespace do atlas público existe').toContain(remoteDb);
                const remote = await readIdbFeatureIds(tab, remoteDb);
                expect(remote.featureIds, 'a feição pública está no namespace do atlas público')
                    .toContain(seed.featureId);
            },
        });
    });
});
