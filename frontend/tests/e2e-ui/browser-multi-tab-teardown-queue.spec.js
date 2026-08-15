// Path: e2e-ui/browser-multi-tab-teardown-queue.spec.js

/**
 * @fileoverview A SEGUNDA METADE DA BATERIA DE DUAS ABAS: a fila de saída e o aviso de
 * desmontagem. Companion of `browser-multi-tab-namespace.spec.js`, which owns the namespace
 * cases (A*). Both files share `helpers/two-tabs.js` and the same rule: ONE profile, N tabs.
 *
 * WHY IT IS A SECOND FILE AND NOT MORE CASES IN THE FIRST. The A cases ask "which databases
 * exist and what is inside them". These ask two other questions, with instruments of their own:
 * "what happens to WORK THAT HAS NOT LEFT THIS MACHINE when the neighbour tab moves", and "what
 * happens to a live tab when the neighbour tab destroys the databases under it". Keeping them
 * apart also keeps a run readable: the A file is the E7 gate, this one is not.
 *
 * ---------------------------------------------------------------------------
 * OS CASOS
 * ---------------------------------------------------------------------------
 * B0  o bfcache está DESLIGADO neste runner. Instrument control, and the honest answer to the
 *     one requirement of this phase that a browser here cannot verify (see below).
 * B1  a fila da aba A sobrevive à TROCA DE PROJETO na aba B. The defect this closes was the
 *     most expensive of the phase and reachable by the commonest gesture in the product: the
 *     queue was ONE database and `unmountCurrentAtlas` called `operationQueue.clear()`, so a tab
 *     switching project destroyed the pending work of every other tab. What is lost there is the
 *     payload of the operation, that is, the feature the user drew and had not uploaded.
 * B2  a fila do atlas X sobrevive a SAIR de X e VOLTAR (o portão que o plano herdou de E8). One
 *     tab, on purpose: the wipe of `openRemoteAtlas` runs three lines after the namespace of the
 *     atlas being opened is activated, so a queue inside that wipe would be destroyed by the very
 *     act of opening the atlas it belongs to, immediately before the connect that would drain it.
 * B3  o aviso de desmontagem congela a aba vizinha, e os bancos NÃO voltam. This case REPLACES
 *     A3 of the sibling file, which asserted the opposite and was written before the notice
 *     existed; the reason is in the case's own comment.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA BATERIA NÃO COBRE, ESCRITO PARA NÃO SER CONFUNDIDO COM O REQUISITO
 * ---------------------------------------------------------------------------
 *  - O WEB LOCK SOB `pagehide`/bfcache, que é a janela em que a Decisão 1 (`_PLANO-multiaba.md`)
 *    alega que o lock é melhor que um lease. NÃO É REPRODUZÍVEL AQUI, e a razão é medida, não
 *    suposta: o Playwright 1.61.1 sobe o Chromium com `--disable-back-forward-cache` entre os
 *    switches PADRÃO (`node_modules/playwright-core/lib/coreBundle.js`, na lista
 *    `chromiumSwitches`), então nenhuma página deste runner entra em bfcache. B0 mede o efeito
 *    disso em vez de confiar na leitura. Um caso escrito como se cobrisse esta janela seria
 *    cobertura vazia: ele passaria porque a aba nunca congela, e não porque o lock aguenta.
 *    Ligar o bfcache exigiria `ignoreDefaultArgs` mais `--enable-features=BackForwardCache`, e
 *    ainda assim uma aba do mapa (WebSocket vivo, transação de IndexedDB aberta) é candidata
 *    duvidosa a bfcache (duas incertezas independentes, uma delas do produto). O que existe hoje
 *    é o primitivo REAL com um segundo lock tomado no mesmo processo (`tests/unit/`), que é
 *    indistinguível de outro cliente para o código sob teste e NÃO é outra aba.
 *  - A ORDEM DENTRO DE B3 ("a irmã parou ANTES de o emissor esvaziar"). O que se assere é o
 *    efeito da ordem (os bancos não voltam), não a ordem. Uma medição da ordem exigiria um sinal
 *    que só o `src/` pode emitir.
 *  - DUAS ABAS EM ATLAS REMOTOS DISTINTOS. Bloqueado por E7 (`keysCollide` ainda faz qualquer par
 *    remoto x remoto colidir), e a aba bloqueada nem chega a executar o caminho destrutivo:
 *    `openRemoteAtlas` retorna cedo quando a reivindicação falha. Por isso B1 usa o par
 *    alcançável hoje (aba A no slot LOCAL, aba B trocando de projeto) e B3 usa o mesmo par.
 *  - A FILA DE UM ATLAS QUE NÃO EXISTE MAIS (a política de oferecer download antes de destruir).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    loginUI,
    goToLocalMapUI,
    drawPointUI,
    currentMapName,
    attemptStoreWriteBlocked,
} from './helpers/collab-helpers.js';
import {
    createTabContext,
    closeTabContexts,
    openTab,
    tabDiagnostic,
    waitForOverlayTitle,
    readIdbKeys,
    readIdbFeatureIds,
    sampleIdbKeys,
    classifyKeySamples,
    idbDatabaseNames,
    mapsDbOf,
    queueDbOf,
    remoteSuffix,
    logoutUI,
    attachNamespaces,
    QUEUE_STORE,
    TEARDOWN_OVERLAY_TITLE,
    BLOCK_OVERLAY_SELECTOR,
} from './helpers/two-tabs.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// A SKIPPED FILE IS NOT A PASSED FILE. Repeated from the sibling spec ON PURPOSE and not
// factored out: this file is meant to be runnable alone (`npx playwright test
// browser-multi-tab-teardown`), and a guard that lives in another file guards nothing then.
// Both guards read the same state, so on a machine without PostgreSQL the run reports two
// failures for one cause, which is the loud direction.
test('a bateria de desmontagem e fila REQUER backend (sem ele, nada aqui roda)', () => {
    if (!state.skip) return;
    expect(
        process.env.EBGEO_E2E_NO_DB,
        'os casos de fila e desmontagem foram PULADOS por falta de backend. Suba PostgreSQL + '
        + 'PostGIS e rode de novo, ou declare a intenção com EBGEO_E2E_NO_DB=1 para aceitar a '
        + 'rodada sem eles. Um pulo silencioso é verde sem verificação.',
    ).toBeTruthy();
});

/**
 * Registers one user and creates `atlasNames.length` server atlases, each with one UUID-keyed
 * map. Same seed the sibling file uses, duplicated rather than imported so neither file can
 * break the other's setup while both are being edited.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} baseUrl
 * @param {string[]} atlasNames
 * @returns {Promise<{username:string,password:string,atlases:Array<{id:string,name:string,mapId:string,mapName:string}>}>}
 */
async function seedUserWithAtlases(browser, baseUrl, atlasNames) {
    const page = await browser.newPage();
    await page.goto('/');
    const seed = await page.evaluate(async ({ base, names }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const username = `fila_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const password = 'Sup3r-Secret-Pw!';
        await api.register({ username, password, nome: 'Fila e Desmontagem' });
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
    }, { base: baseUrl, names: atlasNames });
    await page.close();
    return seed;
}

/** Waits for the live MapLibre map of one tab. */
function waitMapLoaded(page) {
    return page.waitForFunction(
        () => !!(globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded && globalThis.__ebgeoMap.loaded()),
        null,
        { timeout: 30000 },
    );
}

/**
 * A tab is READY only when its atlas map is the current one, not when the badge says online:
 * the app activates the atlas map asynchronously after the connect. Same wait as the sibling
 * file, for the same measured reason.
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

/**
 * Switches project THE WAY A USER DOES: back to the chooser page, then pick the atlas.
 * @param {import('@playwright/test').Page} page
 * @param {{id: string, mapName: string}} atlas
 */
async function trocarDeProjeto(page, atlas) {
    await page.goto('/projetos.html');
    const item = page.locator(`[data-testid="project-picker-item"][data-atlas-id="${atlas.id}"]`);
    await expect(item, `o projeto "${atlas.mapName}" aparece no seletor`).toBeVisible({ timeout: 20000 });
    await item.click();
    await waitAtlasTabReady(page, atlas);
}

/**
 * Puts `howMany` operations in the queue of the scope this tab has mounted.
 *
 * THE ONE PROGRAMMATIC SEED IN THIS FILE, and the README's UI-first rule allows it because
 * there is NO UI that can produce this state: on the local slot the default map is keyed by
 * NAME, and `logOperation` (`store/sync/operation-dispatcher.js`) drops every map-scoped op
 * whose context mapId is not a UUID before it ever reaches the queue, because the backend would
 * reject it and one such op fails the whole flush batch. So a local tab cannot enqueue by
 * drawing, at all. B2 covers the UI-driven half (a real draw in a server atlas, with the push
 * blocked), and this seeds the half no gesture can reach.
 *
 * The ASSERTIONS never read the queue through this module: they read the raw database.
 * @param {import('@playwright/test').Page} page
 * @param {number} howMany
 * @returns {Promise<string[]>} The operation ids (each one appears inside a queue key).
 */
function enqueueOperations(page, howMany) {
    return page.evaluate(async (n) => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const ids = [];
        for (let i = 0; i < n; i += 1) {
            const entityId = crypto.randomUUID();
            const operation = createOperation('feature', 'create', entityId, crypto.randomUUID(), {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2 - i / 100, -22.9] },
                properties: { id: entityId, source: 'point', nome: `trabalho pendente ${i}` },
            });
            await operationQueue.enqueue(operation);
            ids.push(operation.id);
        }
        return ids;
    }, howMany);
}

/**
 * Keys of one queue database that carry any of `opIds`.
 * @param {string[]} keys - Raw queue keys (`op_<epoch>_<opId>`).
 * @param {string[]} opIds
 * @returns {string[]} The matching operation ids, sorted.
 */
const opIdsPresent = (keys, opIds) => opIds.filter((id) => keys.some((k) => k.includes(id))).sort();

/**
 * Blocks the OUTBOUND push of one tab, so its queue accumulates instead of draining.
 *
 * Only `POST /atlas/<id>/sync`: the pull is a GET on the same path, and blocking it too would
 * keep the tab from ever coming online, which is a different (and useless) scenario. The route
 * is installed on the PAGE, so it survives the navigations of a project switch.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function blockOutboundPush(page) {
    return page.route('**/api/v1/atlas/*/sync**', (route) => (
        route.request().method() === 'POST' ? route.abort('failed') : route.continue()
    ));
}

describeOrSkip('Duas abas, um usuário: fila de saída e aviso de desmontagem', () => {
    // A real race between two tabs must never be reported as "flaky", which is a pass. Same
    // reasoning as the sibling file, and it has to be repeated per describe: `retries` is
    // configured, not inherited from another file.
    test.describe.configure({ retries: 0 });

    // Every context handed out by `createTabContext`, whatever the case did with it. Without
    // this, a case that throws leaks its context (two live tabs, their WebSockets, their 1.5 s
    // flush loops and their MapLibre canvases) into every later case on the single worker.
    test.afterEach(closeTabContexts);

    test('B0 — o bfcache está DESLIGADO neste runner (nenhum caso pode alegar cobri-lo)', async ({ browser }) => {
        // O CONTROLE QUE IMPEDE UM TESTE DE FINGIR. A Decisão 1 do plano escolhe o Web Lock em
        // vez de um lease porque "a aba congelada MANTÉM o lock", e a aba congelada é a que está
        // no bfcache. Este runner não produz essa aba: o Playwright 1.61.1 sobe o Chromium com
        // `--disable-back-forward-cache` na sua lista de switches padrão. A leitura do
        // `node_modules` diz isso; este caso MEDE o efeito, porque um switch pode mudar de nome
        // entre versões e um caso que "cobre bfcache" passaria em silêncio de qualquer jeito.
        //
        // A medição: um marcador posto no `window` sobrevive a ir e voltar SE, e só se, o
        // documento foi restaurado do bfcache. Aqui ele não sobrevive, logo o documento foi
        // reexecutado, logo não houve bfcache. O controle positivo (o marcador existe antes de
        // navegar) é o que separa "não sobreviveu" de "nunca foi escrito".
        test.setTimeout(120000);

        const ctx = await createTabContext(browser, state.baseUrl);
        const tab = await openTab(ctx, '/');
        await waitMapLoaded(tab);

        await tab.evaluate(() => { window.__ebgeoBfcacheProbe = 'vivo'; });
        expect(
            await tab.evaluate(() => window.__ebgeoBfcacheProbe ?? null),
            'controle positivo: o marcador existe ANTES da navegação',
        ).toBe('vivo');

        // Uma navegação de documento para fora e a volta pelo histórico, que é exatamente o
        // gesto que o bfcache serve.
        await tab.goto('/projetos.html');
        await tab.goBack();
        await tab.waitForLoadState('domcontentloaded');

        expect(
            await tab.evaluate(() => window.__ebgeoBfcacheProbe ?? null),
            'o documento foi REEXECUTADO na volta: este runner não tem bfcache, então nenhum '
            + 'caso deste repositório pode alegar cobrir o Web Lock sob bfcache',
        ).toBeNull();
    });

    test('B1 — a fila da aba A sobrevive à troca de projeto na aba B', async ({ browser }, testInfo) => {
        // O DEFEITO QUE ESTE CASO FECHA, e por que ele era o mais caro da fase: a fila era UM
        // banco só e `unmountCurrentAtlas` (`store/store.js`) chamava `operationQueue.clear()`,
        // que apagava a fila INTEIRA, de todos os atlas. A aba B trocando de projeto destruía o
        // trabalho pendente da aba A, e o que se perde é o `data` da operação, isto é, a feição
        // que o usuário desenhou e ainda não subiu. Nenhum erro, nenhum aviso.
        //
        // O PAR É O ALCANÇÁVEL HOJE: aba A no slot LOCAL, aba B em atlas de servidor. Duas abas
        // em atlas remotos distintos colidem enquanto E7 não sai, e a aba bloqueada nem chega a
        // rodar o caminho destrutivo (`openRemoteAtlas` retorna cedo quando a claim falha), o
        // que tornaria o caso verde sem medir nada.
        test.setTimeout(180000);

        const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Fila X', 'Fila Y']);
        const [X, Y] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tabA = await openTab(ctx, '/');
        await loginUI(tabA, seed.username, seed.password);
        await goToLocalMapUI(tabA);
        await waitMapLoaded(tabA);

        const opIds = await enqueueOperations(tabA, 3);
        const filaLocal = queueDbOf('');

        // --- POSITIVE control, BEFORE anything is contested: the three operations really are on
        //     disk, in the queue database of the slot this tab has mounted. Asserting only
        //     afterwards cannot tell "it survived" from "it never existed". ---
        const antes = await readIdbKeys(tabA, filaLocal, QUEUE_STORE);
        expect(antes.exists, `a fila do slot local (${filaLocal}) existe no disco`).toBe(true);
        expect(opIdsPresent(antes.keys, opIds), 'as três operações estão enfileiradas')
            .toEqual([...opIds].sort());

        // --- NEGATIVE control of the same reader: a queue database nobody opened must read as
        //     absent, and the read must not manufacture it. A reader that answered "exists" for
        //     every name would pass the survival assertion below with the queue destroyed. ---
        const fantasma = await readIdbKeys(tabA, queueDbOf(remoteSuffix(crypto.randomUUID())), QUEUE_STORE);
        expect(fantasma.exists, 'uma fila inexistente lê como ausente (e não é criada pela leitura)')
            .toBe(false);

        // --- O GESTO: a aba B abre um projeto, e depois TROCA para outro. As duas metades
        //     rodam o wipe de entrada de `openRemoteAtlas`; a segunda é a troca atlas→atlas, que
        //     é o gesto exato do defeito. ---
        const tabB = await openTab(ctx, '/projetos.html');
        await trocarDeProjeto(tabB, X);
        await trocarDeProjeto(tabB, Y);

        await attachNamespaces(testInfo, tabA, 'B1 depois das duas trocas da aba B');

        const depois = await readIdbKeys(tabA, filaLocal, QUEUE_STORE);
        expect(depois.exists, `a fila do slot local (${filaLocal}) continua no disco`).toBe(true);
        expect(
            opIdsPresent(depois.keys, opIds),
            'as operações pendentes da aba A sobrevivem à troca de projeto da aba B',
        ).toEqual([...opIds].sort());

        // A aba A continua sendo a aba A: se ela tivesse sido bloqueada ou levada para o
        // seletor, a fila poderia ter sobrevivido por ela ter parado de existir como aba.
        const diagA = await tabDiagnostic(tabA);
        expect(diagA, 'a aba A seguiu viva no mapa local durante tudo isso').toMatchObject({
            blocked: false,
            page: 'mapa',
        });
    });

    test('B2 — a fila do atlas X sobrevive a sair de X e voltar', async ({ browser }, testInfo) => {
        // O PORTÃO QUE O PLANO HERDOU DE E8, uma aba só de propósito. `openRemoteAtlas` ativa o
        // namespace do atlas que está abrindo e esvazia TRÊS LINHAS DEPOIS; uma fila dentro desse
        // wipe seria a fila DO ATLAS QUE ESTÁ SENDO ABERTO, destruída imediatamente antes do
        // connect que a drenaria. O trabalho pendente morreria na volta, calado.
        //
        // A fila é enchida pelo GESTO REAL (o desenho de um ponto com a ferramenta), com o push
        // abortado para que ela não drene em 1,5 s. Bloquear só o POST é deliberado: o pull é um
        // GET no mesmo caminho, e bloquear os dois deixaria a aba sem nunca ficar online.
        test.setTimeout(180000);

        const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Volta X', 'Desvio Y']);
        const [X, Y] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tab = await openTab(ctx, '/');
        await loginUI(tab, seed.username, seed.password);
        await trocarDeProjeto(tab, X);

        await blockOutboundPush(tab);
        const point = await drawPointUI(tab, [-43.2, -22.9]);
        expect(point, 'a aba desenhou o ponto que vai ficar pendente').toBeTruthy();
        await tab.keyboard.press('Escape');

        const filaX = queueDbOf(remoteSuffix(X.id));
        // POSITIVE control: o desenho realmente virou operação pendente na fila DE X.
        await expect
            .poll(async () => (await readIdbKeys(tab, filaX, QUEUE_STORE)).keys.length,
                { timeout: 20000, message: `o desenho ficou pendente na fila de X (${filaX})` })
            .toBeGreaterThan(0);
        const antes = (await readIdbKeys(tab, filaX, QUEUE_STORE)).keys;
        await testInfo.attach('B2 fila de X depois do desenho', {
            body: `${filaX}\n${antes.join('\n')}`, contentType: 'text/plain',
        });

        // --- SAI de X para Y: o wipe de entrada de Y não pode alcançar a fila de X. ---
        await trocarDeProjeto(tab, Y);
        const duranteY = await readIdbKeys(tab, filaX, QUEUE_STORE);
        expect(duranteY.exists, 'a fila de X continua no disco enquanto a aba está em Y').toBe(true);
        expect(duranteY.keys, 'nenhuma operação de X se perdeu ao abrir Y')
            .toEqual(expect.arrayContaining(antes));

        // --- E VOLTA para X: agora o wipe de entrada mira o namespace de X, que é o do dono da
        //     fila. É aqui que a fila morria no desenho antigo. ---
        await trocarDeProjeto(tab, X);
        const devolta = await readIdbKeys(tab, filaX, QUEUE_STORE);
        expect(devolta.exists, 'a fila de X continua no disco depois de voltar para X').toBe(true);
        expect(
            devolta.keys,
            'a fila de X sobrevive ao wipe de entrada do PRÓPRIO atlas dela',
        ).toEqual(expect.arrayContaining(antes));
    });

    test('B3 — o aviso de desmontagem congela a aba vizinha, e os bancos não voltam', async ({ browser }, testInfo) => {
        // ESTE CASO SUBSTITUI O A3 DO ARQUIVO IRMÃO, e a substituição é uma correção de
        // EXPECTATIVA, não de código. A3 exigia que o trabalho da aba B nunca desaparecesse
        // durante o logout da aba A. A decisão registrada diz o contrário, em tantas palavras
        // (`_PLANO-multiaba.md`, E2): "O logout NÃO poupa depois do aviso confirmado. Sem sessão
        // não existe aba legítima segurando dado de servidor". O desenho implementado faz
        // exatamente isso (`store/sync/tab-lock-sync-brake.js`, `applyTeardownFreeze`): a aba
        // avisada PARA, SOLTA O LOCK DE MONTAGEM e limpa o escopo ativo, e só então o emissor
        // destrói. Manter A3 seria manter, em verde-como-esperado, uma asserção que contradiz a
        // decisão, e um `test.fail` assim nunca vira vermelho, logo nunca cobra nada.
        //
        // O QUE IMPORTA MEDIR, então, é o que o aviso existe para conseguir:
        //   1. a aba vizinha SABE (o overlay muda de texto: bloqueado e congelado dividem um
        //      elemento e uma classe, e só o texto os separa);
        //   2. os bancos condenados vão embora (o expurgo alcançou o que a aba largou);
        //   3. e NÃO VOLTAM: uma escrita que ainda chegue àquela aba não pode recriá-los, que é
        //      o modo de falha caro: o registro já saiu, então o namespace ressuscitado é resíduo
        //      que nenhuma varredura posterior encontra.
        //
        // O par é o alcançável hoje (aba A no slot LOCAL, aba B em atlas de servidor): um par
        // remoto x remoto colidiria enquanto E7 não sai.
        test.setTimeout(180000);

        const seed = await seedUserWithAtlases(browser, state.baseUrl, ['Atlas Desmontado']);
        const [X] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const tabA = await openTab(ctx, '/');
        await loginUI(tabA, seed.username, seed.password);
        await goToLocalMapUI(tabA);
        await waitMapLoaded(tabA);

        const tabB = await openTab(ctx, `/?atlas=${X.id}`);
        await waitAtlasTabReady(tabB, X);
        await expect(tabB.locator(BLOCK_OVERLAY_SELECTOR), 'a aba B não está bloqueada (pré-condição)')
            .toBeHidden();

        // --- POSITIVE control BEFORE the destructive act: o namespace de X existe e tem dentro
        //     dele o que a aba B desenhou. Sem isso, "os bancos não voltaram" é indistinguível de
        //     "os bancos nunca tiveram nada". ---
        const dbX = mapsDbOf(remoteSuffix(X.id));
        const point = await drawPointUI(tabB, [-43.25, -22.95]);
        expect(point, 'a aba B desenhou antes do logout da aba A').toBeTruthy();
        await tabB.keyboard.press('Escape');
        await expect
            .poll(async () => (await readIdbFeatureIds(tabB, dbX)).featureIds,
                { timeout: 20000, message: 'antes do logout, o ponto está no namespace de X' })
            .toContain(point);
        const namesAntes = await attachNamespaces(testInfo, tabB, 'B3 antes do logout da aba A');
        expect(namesAntes, 'o namespace de X está no disco antes do ato').toContain(dbX);

        // --- O ATO, na OUTRA aba. ---
        await logoutUI(tabA);

        // --- 1. A ABA VIZINHA SABE. `waitForOverlayTitle` nunca lança: ele devolve o que a aba
        //     VIROU, para que a diferença nomeie o estado (caiu no seletor? nunca congelou?
        //     ficou só bloqueada?) em vez de dizer "elemento não encontrado". ---
        const estado = await waitForOverlayTitle(tabB, TEARDOWN_OVERLAY_TITLE, { timeout: 45000 });
        await testInfo.attach('B3 o que a aba B virou depois do logout da aba A', {
            body: JSON.stringify(estado, null, 2), contentType: 'application/json',
        });
        expect(
            estado,
            'a aba vizinha recebeu o aviso de desmontagem e congelou (overlay com o texto de '
            + 'encerramento, não o de bloqueio)',
        ).toMatchObject({ matched: true, blocked: true, overlayTitle: TEARDOWN_OVERLAY_TITLE });

        // --- 2. O EXPURGO ALCANÇOU O QUE A ABA LARGOU. O namespace pode terminar apagado do
        //     disco ou esvaziado, e as duas saídas são legítimas: a pergunta é se a feição ainda
        //     é legível ali. ---
        await expect
            .poll(async () => (await readIdbFeatureIds(tabB, dbX)).featureIds,
                {
                    timeout: 30000,
                    message: 'o expurgo alcançou o namespace que a aba congelada soltou (se ele '
                        + 'sobreviveu, o aviso não chegou ou o lock não foi liberado)',
                })
            .not.toContain(point);

        // --- 3. E NÃO VOLTA. Uma escrita ainda chega a essa aba (o gesto do usuário está atrás
        //     do overlay, mas o `src/` não está), e ela não pode recriar o namespace condenado.
        //     Documentado no `@fileoverview` do freio: uma escrita perdida cai no slot LOCAL
        //     (`ensureAtlasScope`), que é o mal menor, e NUNCA de volta no namespace destruído. ---
        try {
            await attemptStoreWriteBlocked(tabB, [[-43.3, -23.0], [-43.31, -23.01]]);
        } catch (error) {
            await testInfo.attach('B3 a escrita tentada na aba congelada lançou (não é o defeito)', {
                body: String(error && error.stack ? error.stack : error), contentType: 'text/plain',
            });
        }
        const amostras = await sampleIdbKeys(tabB, dbX, { durationMs: 8000, intervalMs: 200 });
        const c = classifyKeySamples(amostras);
        await testInfo.attach('B3 amostragem do namespace condenado depois da escrita', {
            body: `total=${c.total} ausente=${c.absent} vazio=${c.empty} comChaves=${c.withKeys} `
                + `ilegivel=${c.unreadable} maxChaves=${c.maxKeys}\n`
                + amostras.map((s, i) => `${i}: ${s.kind}${s.n ? ` (${s.n})` : ''}${s.error ? ` :: ${s.error}` : ''}`).join('\n'),
            contentType: 'text/plain',
        });
        // A amostragem tem que ter RODADO e LIDO: uma série toda ilegível não é prova de nada,
        // em direção nenhuma.
        expect(c.total, 'a amostragem realmente rodou').toBeGreaterThan(20);
        expect(c.readable, 'a amostragem conseguiu LER o disco').toBeGreaterThan(20);
        expect(
            c.withKeys,
            `os bancos condenados não voltam a existir com dado (${c.withKeys} amostras de `
            + `${c.readable} leituras boas encontraram chaves em ${dbX})`,
        ).toBe(0);

        // --- E a aba B continua VIVA: se ela tivesse morrido, "não recriou" seria só "não existe
        //     mais ninguém para recriar", que é outra afirmação. ---
        const diagB = await tabDiagnostic(tabB);
        await testInfo.attach('B3 a aba B no fim', {
            body: JSON.stringify(diagB, null, 2), contentType: 'application/json',
        });
        expect(diagB.url, 'a aba congelada continua carregada (a medição acima teve sujeito)')
            .toBeTruthy();
        // ...e o leitor não está devolvendo vazio para tudo: o disco ainda tem bancos.
        expect(await idbDatabaseNames(tabB), 'o instrumento ainda enxerga bancos no disco')
            .not.toEqual([]);
    });
});
