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
 * TWO TESTS, ONE FLOW, AND THE SPLIT IS THE POINT (E0 item 7 of `docs/decisions/fase-multiaba-2026-08.md`).
 * The first test asserts facts of the SERVER and is green. It was green while the namespace furo
 * was wide open, because a spec that only reads the server cannot see WHERE ON DISK the client put
 * the atlas it just created. The second test drives the same flow and asserts facts of INDEXEDDB.
 * Splitting keeps the green guard green instead of demoting it to an expected failure.
 *
 * O SEGUNDO CASO FECHOU EM E3 e o `test.fail` dele saiu. Ele carregava o marcador desde o commit
 * que ENTREGOU a correção: o texto do caso descrevia o código de antes e ninguém apagou o
 * marcador junto. Ao promover, a asserção nomeada teve de mudar de feição também — a antiga
 * respondia igual antes e depois da correção. O porquê está escrito no caso.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { idbDatabaseNames, readIdbFeatureIds, mapsDbOf, remoteSuffix, pendingGate } from './helpers/two-tabs.js';

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

    // O CASO DE E3 FICA NUMA DESCRIBE PRÓPRIA, com `retries: 0`, e a razão não é estética.
    // Medido: um `test.fail()` que passa DETERMINISTICAMENTE já sai `unexpected` mesmo com
    // `retries: 1` (duas tentativas passed,passed, exit 1). O que `retries: 1` esconde é o
    // caso em que a correção de E3 for parcial ou tiver corrida: a dupla passed,failed é
    // classificada `flaky` e a rodada sai com exit 0, isto é, verde. O guarda VERDE acima
    // fica de fora deste opt-out de propósito: ele é um teste de servidor comum e a
    // confiabilidade de rede da suíte vale para ele.
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
            // A MARCA MUDOU DE FEIÇÃO JUNTO COM A CORREÇÃO, e essa troca é a metade do conserto
            // que faltava. A asserção original perguntava pela feição do atlas LOCAL, e essa
            // pergunta deixou de distinguir as duas metades: E3 também parou de esvaziar o slot
            // local, e o upload PRESERVA os ids (o guarda verde acima acha `featureId` no
            // servidor por esse mesmo id), então a feição original continua legível no slot local
            // depois da correção — pelo motivo certo. Antes de E3 ela também estava lá, pelo
            // motivo errado (o wipe apagava o slot local e o pull do servidor reescrevia tudo
            // dentro dele). Uma marca que responde igual nos dois estados não reprova nada.
            //
            // A feição medida agora é a que só pode existir DEPOIS da troca: um ponto desenhado
            // com a aba já viva no atlas de servidor. Antes de E3 ele caía em `ebgeo_maps` (o
            // escopo montado continuava sendo o local); depois de E3 ele cai em
            // `ebgeo_maps__remote-<atlasId>`, e nada dele pode aparecer num banco local.
            //
            // Why this needs its own test instead of a few more lines in the one above: that test
            // is a GREEN guard of server-side facts and must stay green. It was green throughout
            // this furo, which is exactly the point — a spec that only reads the server cannot see
            // where the client wrote. The read below is `indexedDB.databases()`, a fact of the
            // browser profile.
            //
            // It runs through `pendingGate` for the reason written at that helper: without it, a
            // broken setup and the defect are both reported as "expected failure".
            test.setTimeout(120000);

            // AINDA PENDENTE, e a marca voltou depois de MEDIDA no navegador (2026-08-21).
            //
            // O cabeçalho acima estava certo sobre a marca velha ser insatisfazível, e certo
            // sobre a metade de E3 que ENTROU: os bancos `ebgeo_*__remote-<atlasId>` existem
            // depois do "Enviar ao servidor", e a edição ao vivo aparece dentro deles (o
            // controle positivo do gate passa). Estava errado ao concluir que o defeito tinha
            // fechado, porque essa conclusão saiu de leitura de código e de teste unitário,
            // nunca do navegador.
            //
            // MEDIDO: com backend, banco e portas isolados, o vazamento reproduz. A edição
            // feita com a aba JÁ VIVA no atlas de servidor aparece TAMBÉM em `ebgeo_maps`
            // local. Duas execuções de duas em que o gate chegou a avaliar. A única execução
            // verde foi a que rodou com o servidor de aplicação caindo (o caso irmão morreu
            // com ERR_CONNECTION_REFUSED na mesma rodada), e por isso não conta.
            //
            // O QUE ISSO ESTREITA: a ativação de namespace acontece, então o furo não é a
            // ordem de `account.control.js` (claim → activate → wipe), que o guarda unitário
            // `portao-de-montagem.test.js` já prende. O que sobra é a escrita ao vivo
            // alcançando o escopo LOCAL depois da ativação. Pista não confirmada, e o próximo
            // a pegar isto deve começar por ela: `activateRemoteAtlas`
            // (`store/remote-atlas.api.js:414`) é assíncrona, e um repositório que tenha
            // resolvido o nome do banco (ou aberto a conexão) ANTES dela continuaria
            // escrevendo no endereço velho, com o registro já dizendo remoto. Confira se a
            // resolução do nome é por chamada ou memoizada.
            //
            // NÃO foi consertado de propósito: é o caminho de ativação de escopo, a causa
            // registrada já se mostrou errada duas vezes nesta fase, e conserto apressado aqui
            // arrisca mais que o defeito conhecido.
            test.fail();

            await pendingGate(testInfo, {
                marca: '(local) não recebeu a edição feita no atlas de servidor',

                setup: async () => {
                    const driven = await driveSaveLocalToServer(browser, state.baseUrl);
                    // A EDIÇÃO AO VIVO, e ela é o instrumento: só existe depois de a aba estar
                    // no atlas de servidor, então o banco em que ela cai NOMEIA o escopo montado.
                    const liveId = await drawPointUI(driven.page, [-43.31, -23.01]);
                    expect(liveId, 'a aba desenhou já viva no atlas de servidor').toBeTruthy();
                    await driven.page.keyboard.press('Escape');
                    const names = await idbDatabaseNames(driven.page);
                    await testInfo.attach('indexedDB.databases() depois do "Enviar ao servidor"', {
                        body: names.join('\n'),
                        contentType: 'text/plain',
                    });
                    return { ...driven, liveId, names };
                },

                gate: async ({ page, names, featureId, liveId, atlasId }) => {
                    // THE LEAK ASSERTION COMES FIRST, and the order is chosen for the evidence it
                    // prints: this one names the database the server atlas actually fell into and
                    // the feature id sitting in it, which is the fact E3 had to move.
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

                    // ... and the atlas the user is now live on owns its own ten databases, where
                    // the logged-out purge can find it.
                    const remoteDb = mapsDbOf(remoteSuffix(atlasId));
                    expect(names, 'o atlas salvo tem namespace próprio').toContain(remoteDb);
                    const remote = await readIdbFeatureIds(page, remoteDb);
                    // CONTROLE POSITIVO DA LEITURA: sem ele, "o banco local não tem a edição"
                    // seria a mesma resposta de um leitor que devolve vazio para tudo.
                    expect(remote.featureIds, 'a edição ao vivo está no namespace do atlas de servidor')
                        .toContain(liveId);
                    expect(remote.featureIds, 'a feição salva está no namespace do atlas de servidor')
                        .toContain(featureId);
                },
            });
        });
    });
});
