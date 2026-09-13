// Path: e2e-ui/browser-save-local-to-server.spec.js

/**
 * @fileoverview Browser E2E for "Salvar atlas local no servidor" (item 2) — the UI flow that
 * couldn't be auto-tested at the unit/transport layer.
 *
 * A logged-in user working on the LOCAL store draws a feature, opens the account menu, clicks
 * "Enviar ao servidor", names the atlas, and confirms. We then assert — by reading the connected
 * atlas id and pulling a FRESH snapshot from the backend over HTTP — that the local store was
 * packaged into a NEW server atlas (feature present) AND that the app went live on it (sync online).
 *
 * TWO TESTS, ONE FLOW, AND THE SPLIT IS THE POINT.
 * The first test asserts facts of the SERVER and is green. It was green while the namespace furo
 * was wide open, because a spec that only reads the server cannot see WHERE ON DISK the client put
 * the atlas it just created. The second test drives the same flow and asserts facts of INDEXEDDB.
 * Splitting keeps the green guard green instead of demoting it to an expected failure.
 *
 * O SEGUNDO CASO DEIXOU DE SER FALHA ESPERADA EM 2026-09-13, e a razão é que o portão dele havia
 * parado de medir o defeito: ele caía no CONTROLE POSITIVO da leitura, porque o snapshot passou a
 * viver numa GERAÇÃO de bancos (`__generation-<uuid>`) e o nome sem geração já não guarda nada. O
 * caso lê a geração ativa e AFIRMA o comportamento; o porquê inteiro está escrito nele.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';
import {
    idbDatabaseNames, readIdbFeatureIds, mapsDbOf, activeMapsDbOf, remoteSuffix,
} from './helpers/two-tabs.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Drives the whole UI flow: register → login → local map → draw a point → account menu →
 * "Enviar ao servidor" → name + confirm → the app is LIVE on the new atlas.
 * @returns {Promise<{ctx: import('@playwright/test').BrowserContext,
 *   page: import('@playwright/test').Page, creds: {username:string,password:string},
 *   featureId: string}>}
 */
async function driveSaveLocalToServer(browser, baseUrl) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.goto('/');

    // A conta nasce no NODE, com o e-mail já confirmado pela rota pública (o token de
    // verificação só existe como linha no Postgres, fora do alcance do `page.evaluate`), e o
    // login segue sendo o da UI real — que é o que este spec quer exercitar. Nada de token no
    // `localStorage` da página: o boot continua anônimo, como este fluxo exige.
    const creds = await createVerifiedUser({ prefix: 'save', nome: 'Save Local' });

    await loginUI(page, creds.username, creds.password);
    // Leave the chooser for the LOCAL map — we want to work on the local store here, not open
    // a server atlas.
    await goToLocalMapUI(page);

    // Wait for the live map, then draw a point into the LOCAL store with the REAL point tool
    // (logged in, NOT connected).
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
        { timeout: 20000 },
    );
    const featureId = await drawPointUI(page, [-43.2, -22.9]);
    expect(featureId, 'the point tool created the local feature').toBeTruthy();
    await page.keyboard.press('Escape'); // deactivate the still-active point tool
    // Sanity: feature is in the local store and we are NOT connected to any atlas yet.
    const localCount = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
        const f = await store.getCurrentMapFeatures();
        return { points: (f.points || []).length, connected: !!syncEngine.atlasId };
    });
    expect(localCount.points).toBeGreaterThan(0);
    expect(localCount.connected).toBe(false);

    // Open the account menu → "Enviar ao servidor" (visible only when logged in + local).
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    const saveBtn = page.locator('[data-testid="account-save-server-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Create-atlas modal: name + confirm.
    await expect(page.locator('[data-testid="create-atlas-name"]')).toBeVisible();
    await page.locator('[data-testid="create-atlas-name"]').fill('Atlas Salvo UI');
    await page.locator('[data-testid="create-atlas-confirm"]').click();

    // The app must now be LIVE on the new remote atlas.
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 20000 });

    // WHICH atlas, read from the ADDRESS BAR and not from `syncEngine.atlasId` through an
    // `import()`. `deep-link/atlas-url-sync.js` writes `?atlas=` from that very field, so the URL
    // is the same fact by an independent path — and it is the path that survives `src/` being
    // edited while the suite runs: Vite then serves the module with an HMR `?t=` and a probe's
    // `import()` receives a SECOND instance whose `atlasId` is null while the page says
    // "Conectado". That is not hypothetical, it broke this spec 3/3 on 2026-08-15.
    await page.waitForURL(/[?&]atlas=/, { timeout: 20000 });
    const atlasId = new URL(page.url()).searchParams.get('atlas');
    expect(atlasId, 'a URL passou a nomear o atlas recém-criado').toBeTruthy();

    return { ctx, page, creds, featureId, atlasId };
}

describeOrSkip('Salvar atlas local no servidor (UI, item 2)', () => {
    test('logged-in local user packages the local store into a new server atlas and goes live', async ({ browser }) => {
        const { ctx, page, creds, featureId, atlasId } = await driveSaveLocalToServer(browser, state.baseUrl);

        // End-to-end check: pull a FRESH snapshot of that atlas from the backend and confirm the
        // local feature made it to the server.
        const result = await page.evaluate(async ({ baseUrl, c, fid, aid }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(c.username, c.password);
            const pulled = await api.pullSync(aid, 0);
            const maps = pulled.snapshot?.maps || [];
            const points = maps.flatMap((m) => m.features?.points || []);
            return { mapCount: maps.length, found: points.some((p) => p.properties.id === fid) };
        }, { baseUrl: state.baseUrl, c: creds, fid: featureId, aid: atlasId });

        expect(result.mapCount).toBeGreaterThan(0);
        expect(result.found).toBe(true);

        // --- Journey continues: EDIT the now-live remote atlas with the REAL point tool; the edit
        //     must sync to the server. (The user owns the atlas they just created, so editing must be
        //     permitted, and the auto-flush must carry the new op up.) ---
        const liveId = await drawPointUI(page, [-43.3, -23.0]);
        expect(liveId, 'the owner can edit the atlas they just saved').toBeTruthy();
        await page.keyboard.press('Escape'); // deactivate the still-active point tool

        const synced = await page.evaluate(async ({ baseUrl, c, fid, aid }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(c.username, c.password);
            for (let i = 0; i < 25; i++) {
                const pulled = await api.pullSync(aid, 0);
                const pts = (pulled.snapshot?.maps || []).flatMap((m) => m.features?.points || []);
                if (pts.some((p) => p.properties.id === fid)) return true;
                await new Promise((r) => setTimeout(r, 300));
            }
            return false;
        }, { baseUrl: state.baseUrl, c: creds, fid: liveId, aid: atlasId });
        expect(synced, 'the post-save live edit reaches the server via auto-flush').toBe(true);

        await ctx.close();
    });

    // O CASO DO NAMESPACE FICA NUMA DESCRIBE PRÓPRIA, com `retries: 0`, e a razão não é
    // estética: o que ele mede é EM QUAL banco uma escrita caiu, que é pergunta de corrida. Com
    // `retries: 1`, uma reprodução do vazamento sairia da rodada classificada `flaky` e o
    // processo terminaria com exit 0, isto é, verde sobre um defeito observado. Precedente do
    // mesmo opt-out: `browser-multi-tab-namespace.spec.js`. O guarda VERDE acima fica de fora
    // dele de propósito: é um teste de servidor comum, e a tolerância de rede da suíte vale
    // para ele.
    test.describe('namespace do atlas salvo (portão de E3)', () => {
        test.describe.configure({ retries: 0 });

        test('o atlas salvo passa a viver no NAMESPACE DELE, não no slot local', async ({ browser }, testInfo) => {
            // FECHADO POR E3. `saveLocalToServer` (`src/js/account/account.control.js`) ia
            // `acquireTabLock` → `clearAllDataStore()` → `markStoreRemote` → `connect`, sem
            // `activateRemoteAtlas` em lugar nenhum: o atlas de servidor recém-criado era escrito
            // nos bancos do slot LOCAL (`ebgeo_*` sem sufixo), fora do registro remoto, onde o
            // expurgo de logout não o acha e o trabalho local de outra aba divide o endereço. E3
            // pôs a ativação ENTRE a reivindicação e o wipe (a ordem está presa em
            // `tests/unit/portao-de-montagem.test.js`, "saveLocalToServer: idem").
            //
            // A feição medida é a que só pode existir DEPOIS da troca: um ponto desenhado com a
            // aba já viva no atlas de servidor. Antes de E3 ele caía num banco do slot local (o
            // escopo montado continuava sendo o local); depois de E3 ele cai no namespace do
            // atlas, e nada dele pode aparecer num banco local. A feição ORIGINAL não serve de
            // marca: o upload PRESERVA os ids e E3 parou de esvaziar o slot local, então ela é
            // legível nos dois lados depois da correção, e uma marca que responde igual nos dois
            // estados não reprova nada.
            //
            // Why this needs its own test instead of a few more lines in the one above: that test
            // is a GREEN guard of server-side facts and must stay green. It was green throughout
            // this furo, which is exactly the point — a spec that only reads the server cannot see
            // where the client wrote. The read below is `indexedDB.databases()`, a fact of the
            // browser profile.
            //
            // ================= POR QUE O `test.fail()` SAIU, EM 2026-09-13 =====================
            //
            // Ele estava aqui desde 2026-08-21, quando o vazamento foi MEDIDO no navegador. Na
            // segunda passada de homologação o caso saiu "Expected to fail, but passed" nas DUAS
            // bases (candidata e `8309b289`), e o anexo do portão disse por quê: ele não caiu na
            // marca do vazamento, caiu no CONTROLE POSITIVO da leitura ("a edição ao vivo está no
            // namespace do atlas de servidor"). Ou seja, a asserção de vazamento passou e a que
            // prova que o leitor enxerga alguma coisa falhou. Um portão que cai pelo controle
            // positivo não está medindo o defeito: está medindo o instrumento.
            //
            // O INSTRUMENTO É QUE ESTAVA DESATUALIZADO, e o responsável é `bc797944`: desde
            // 2026-09-13 o snapshot prepara os nove bancos de DADO sob um sufixo
            // `__generation-<uuid>` e só então vira o ponteiro. `mapsDbOf(remoteSuffix(atlasId))`
            // devolve o nome SEM geração, que depois do `connect` não guarda nada, e daí o
            // controle positivo vermelho. O modo de falha é o pior possível para este caso: a
            // asserção de AUSÊNCIA contra um nome que ninguém escreve passa de graça, então sem o
            // controle positivo este teste teria ficado verde para sempre sobre um leitor cego.
            //
            // A leitura passou a resolver a geração ATIVA (`activeMapsDbOf`, `helpers/two-tabs.js`,
            // que lê o ponteiro do `localStorage` e escreve o formato por extenso em vez de
            // importar `resolveDbName`). Com o instrumento consertado sobra o que as duas rodadas
            // mediram: a edição ao vivo NÃO aparece em banco local nenhum. Por isso a marca de
            // falha esperada saiu e o caso passou a AFIRMAR o comportamento em vez de esperar o
            // defeito. Ele NÃO foi executado por quem o reescreveu (Playwright fora do laço
            // dele): fica para o coordenador, e um vermelho aqui é a corrida de 2026-08-21 de
            // volta, agora com o instrumento capaz de vê-la.
            test.setTimeout(120000);

            const { ctx, page, featureId, atlasId } = await driveSaveLocalToServer(browser, state.baseUrl);
            try {
                // A EDIÇÃO AO VIVO, e ela é o instrumento: só existe depois de a aba estar no
                // atlas de servidor, então o banco em que ela cai NOMEIA o escopo montado.
                const liveId = await drawPointUI(page, [-43.31, -23.01]);
                expect(liveId, 'a aba desenhou já viva no atlas de servidor').toBeTruthy();
                await page.keyboard.press('Escape');

                const names = await idbDatabaseNames(page);
                await testInfo.attach('indexedDB.databases() depois do "Enviar ao servidor"', {
                    body: names.join('\n'),
                    contentType: 'text/plain',
                });

                // O CONTROLE POSITIVO VEM PRIMEIRO, e a ordem é a lição do portão anterior:
                // enquanto ele vinha por último, a asserção de ausência (que passa de graça
                // contra um banco vazio) era lida antes de qualquer prova de que o leitor
                // enxerga alguma coisa. Agora o caso só chega à ausência depois da presença.
                const remoteDb = await activeMapsDbOf(page, remoteSuffix(atlasId));
                expect(names, 'o atlas salvo tem namespace próprio')
                    .toContain(mapsDbOf(remoteSuffix(atlasId)));
                const remote = await readIdbFeatureIds(page, remoteDb);
                expect(remote.featureIds, `a edição ao vivo está em ${remoteDb}`).toContain(liveId);
                expect(remote.featureIds, `a feição salva está em ${remoteDb}`).toContain(featureId);

                // ...E NENHUM BANCO LOCAL RECEBEU A EDIÇÃO AO VIVO. O filtro pega o slot legado
                // (`ebgeo_maps`) e qualquer slot local nomeado, com ou sem geração, e deixa de
                // fora só o que começa por `ebgeo_maps__remote-`.
                const localDbs = names.filter(
                    (n) => n === 'ebgeo_maps'
                        || (n.startsWith('ebgeo_maps__') && !n.startsWith('ebgeo_maps__remote-')),
                );
                expect(localDbs.length, 'existe ao menos um banco local para conferir')
                    .toBeGreaterThan(0);
                for (const db of localDbs) {
                    const local = await readIdbFeatureIds(page, db);
                    expect(local.featureIds, `${db} (local) não recebeu a edição feita no atlas de servidor`)
                        .not.toContain(liveId);
                }
            } finally {
                await ctx.close();
            }
        });
    });
});
