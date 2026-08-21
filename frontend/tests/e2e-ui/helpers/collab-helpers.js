// Path: e2e-ui/helpers/collab-helpers.js

/**
 * Shared helpers for the two-browser collaboration specs. Extracted from
 * browser-collab-shared-atlas.spec.js so each operation-family spec (mutations,
 * delete, all-types, maps/layers, processing) drives the app's REAL store ops and
 * asserts NATIVE cross-client sync, without re-deriving the seed/login/open plumbing.
 *
 * The pattern every spec follows:
 *   const { atlasId, userA, userB } = await seedSharedAtlas(browser, baseUrl);
 *   const A = await openClient(browser, baseUrl, atlasId, userA);
 *   const B = await openClient(browser, baseUrl, atlasId, userB);
 *   await applyStoreOp(A, async (store) => { await store.addFeature('lines', f); });
 *   await pollPeerFeature(B, 'lines', id);   // native sync carried it to B
 */

import { expect } from '@playwright/test';
import { waitForRemoteEntity } from './trace-helpers.js';
import { collectLedger, reduceLedger, renderReport } from './ledger.js';
import { ApiClient } from '../../../src/js/store/sync/api-client.js';
import { createVerifiedUser } from './accounts.js';

/**
 * Seeds two users + an atlas with one map "Mapa Tático", shared WRITE with user B.
 * Sharing is a backend-only route (no UI), so setup goes through the API.
 * @returns {Promise<{ atlasId: string, mapId: string, mapName: string,
 *   userA: {username,password}, userB: {username,password} }>}
 */
export async function seedSharedAtlas(browser, baseUrl, { mapName = 'Mapa Tático', permission = 'write' } = {}) {
    // As DUAS contas nascem no NODE (`helpers/accounts.js`): confirmar e-mail exige ler
    // `email_verification_tokens` no Postgres, fora do alcance do contexto do browser.
    // O `page.evaluate` abaixo só faz login com credenciais já usáveis.
    const [userA, userB] = await Promise.all([
        createVerifiedUser({ prefix: 'alfa', nome: 'Alfa' }),
        createVerifiedUser({ prefix: 'bravo', nome: 'Bravo' }),
    ]);
    const seedPage = await browser.newPage();
    await seedPage.goto('/');
    const seed = await seedPage.evaluate(async ({ base, mn, perm, a, b }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

        const apiA = new ApiClient({ baseUrl: `${base}/api/v1` });
        await apiA.login(a.username, a.password);

        const atlas = await apiA.createAtlas({ name: 'Atlas Colaborativo' });
        const mapId = crypto.randomUUID();
        await apiA.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: mn })]);
        await fetch(`${base}/api/v1/atlas/${atlas.id}/sharing/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiA.getAccessToken()}` },
            body: JSON.stringify({ userId: b.id, permission: perm }),
        });
        return { atlasId: atlas.id, mapId, mapName: mn };
    }, { base: baseUrl, mn: mapName, perm: permission, a: userA, b: userB });
    await seedPage.close();
    return { ...seed, userA, userB };
}

/**
 * Changes (PUT) or revokes (DELETE) user B's share permission, as the owner. Uses the
 * owner's own authenticated session via a fresh ApiClient. `permission` of null revokes.
 */
export async function setSharePermission(page, baseUrl, ownerCreds, atlasId, userId, permission) {
    return page.evaluate(async ({ base, c, id, uid, perm }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const url = `${base}/api/v1/atlas/${id}/sharing/users/${uid}`;
        const res = perm === null
            ? await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${api.getAccessToken()}` } })
            : await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.getAccessToken()}` },
                body: JSON.stringify({ permission: perm }),
            });
        return res.status;
    }, { base: baseUrl, c: ownerCreds, id: atlasId, uid: userId, perm: permission });
}

/**
 * Registers a brand-new user and shares the atlas with it (as the owner), returning the
 * new user's credentials (incl. id). For multi-client (3+) scale scenarios.
 */
export async function addSharedUser(page, baseUrl, ownerCreds, atlasId, { permission = 'write', label = 'charlie' } = {}) {
    // A conta nasce no Node (e-mail confirmado); só o compartilhamento roda no browser.
    const u = await createVerifiedUser({ prefix: label, nome: label });
    await page.evaluate(async ({ base, c, id, perm, uid }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const owner = new ApiClient({ baseUrl: `${base}/api/v1` });
        await owner.login(c.username, c.password);
        await fetch(`${base}/api/v1/atlas/${id}/sharing/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.getAccessToken()}` },
            body: JSON.stringify({ userId: uid, permission: perm }),
        });
    }, { base: baseUrl, c: ownerCreds, id: atlasId, perm: permission, uid: u.id });
    return u;
}

/**
 * Logs in through the real account UI and lands on the project chooser.
 *
 * Since 2026-08-05 the chooser is a PAGE (`atlas.html`), so login is followed by a real
 * navigation — waiting only for the element would race the document swap and fail unreadably.
 * The `project-picker-*` testids are unchanged (kept verbatim through the move).
 */
export async function loginUI(page, username, password) {
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 10000 });
}

/**
 * Leaves the chooser for the LOCAL map — the replacement for the old picker's close button, which
 * a page does not have. Also records the tab-scoped "Mapa local" intent, so a reload stays put
 * instead of bouncing back to the chooser.
 */
export async function goToLocalMapUI(page) {
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

/** Picks the atlas by id and waits for online + the live map. */
export async function openAtlasUI(page, atlasId) {
    await page.locator(`[data-testid="project-picker-item"][data-atlas-id="${atlasId}"]`).click();
    // Picking navigates to `/?atlas=<uuid>`; the map page's boot router opens it.
    await page.waitForURL(/[?&]atlas=/, { timeout: 20000 });
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function' && globalThis.__ebgeoMap.loaded(),
        { timeout: 20000 },
    );
}

/**
 * Opens a fresh browser context, logs in via the UI, opens the shared atlas (the app
 * auto-activates the atlas map). Returns the Page (its context is page.context()).
 */
export async function openClient(browser, baseUrl, atlasId, creds, { expectMapName } = {}) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    // Enable the SyncLedger tracer before app boot so every collab spec gets the in-page
    // ring (window.__ebgeoSyncTrace) the deterministic waits + ledger collection read.
    // Escape hatch: set EBGEO_E2E_NO_TRACE=1 to run the collab specs with the tracer fully
    // inert (the pollPeer* helpers fall back to their store poll), e.g. to isolate whether
    // a failure is tracer-related.
    //
    // __EBGEO_TRACE_RENDER__ turns on the entity-render probe (bus-tap.js), which is what
    // emits the `render.source` spans. Without it, full-chain LINK 6 ("appeared in the peer
    // browser") silently degraded to `remote.applied` only: `renderProbeOn(page)` was always
    // false, so the render assertion never ran — the README/docblock advertised six verified
    // links while five were checked. The flag had ZERO writers in the whole repo (only the
    // two reads in bus-tap.js and the helper), i.e. cobertura vazia by construction.
    if (process.env.EBGEO_E2E_NO_TRACE !== '1') {
        await page.addInitScript(() => {
            window.__EBGEO_TRACE__ = true;
            window.__EBGEO_TRACE_RENDER__ = true;
        });
    }
    await page.goto('/');
    await loginUI(page, creds.username, creds.password);
    await openAtlasUI(page, atlasId);

    // Readiness, not decoration: `openAtlasUI` returns once the atlas is opened, but the
    // app activates the atlas map ASYNCHRONOUSLY, so the client can still be sitting on the
    // local default map when this returns. Under full-suite load that window is wide enough
    // to be observed: browser-collab-maps-layers.spec.js:145 flaked in two consecutive full
    // runs on a SETUP assertion, reading "Principal" (the local map) where it expected the
    // shared one — before the test had done anything.
    //
    // THE WAIT USED TO BE OPT-IN, AND THE COMMENT HERE CLAIMED IT "FIXED THE CLASS FOR EVERY
    // COLLAB SPEC". It did not: it only helped the callers that remembered to ask, which is
    // the guard that guards its callers instead of its subject. Measured on 2026-08-16 in a
    // full run: `browser-context-move` failed BOTH attempts and `browser-cascade-atomicity`
    // flaked, both on their first line, both reading "Principal", and neither passed the
    // option. So the wait is now the DEFAULT and `expectMapName` only sharpens it.
    //
    // THE DEFAULT CONDITION READS THE MAP KEY, NOT THE NAME, and the first version of it read
    // the name — "leave the map called `Principal`" — with the limit written down as a
    // hypothetical. It was not hypothetical: `browser-p11-roundtrip` saves A's LOCAL workspace
    // to the server, so the resulting atlas legitimately carries a map named `Principal`, and B
    // burned the whole timeout sitting on exactly the map it was supposed to reach. A guard
    // whose stated limit is reachable by an existing spec is a guard that will fire on correct
    // behavior.
    //
    // The key is exact and name-independent: the local default map is KEY-ED BY ITS NAME, while
    // an atlas map is keyed by a UUID (`getCurrentMapIdSync`, `store/map.operations.js`). So
    // "the atlas map is active" is "the active map id is a UUID", whatever it is called.
    if (expectMapName) {
        await expect
            .poll(() => currentMapName(page), {
                timeout: 20000,
                message: `o cliente ativou o mapa do atlas ("${expectMapName}") apos abrir`,
            })
            .toBe(expectMapName);
    } else {
        await expect
            .poll(() => currentMapKeyIsUuid(page), {
                timeout: 20000,
                message: 'o cliente continua num mapa LOCAL depois de abrir o atlas (mapa local '
                    + 'e chaveado pelo nome, mapa de atlas por UUID): a ativacao do mapa do '
                    + 'atlas nao aconteceu',
            })
            .toBe(true);
    }
    return page;
}

/** Reads the current map's features (per storage type) from the app store. */
export function readFeatures(page, type) {
    return page.evaluate(async (t) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const arr = (f[t] || []);
        return arr.map((x) => ({ id: x.properties?.id, nome: x.properties?.nome, props: x.properties }));
    }, type);
}

export const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/**
 * True when the ACTIVE map is keyed by a UUID, i.e. it is a map of an opened atlas rather than
 * the name-keyed local default. This is the name-independent way to ask "did the atlas map
 * activate", which matters because an atlas can carry a map named `Principal` too.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export const currentMapKeyIsUuid = (page) =>
    page.evaluate(async () => {
        const id = (await import('/src/js/store/index.js')).getCurrentMapIdSync();
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id ?? ''));
    });

/**
 * @private Shared draw driver, exactly like a user: fit the map to the coords, activate the tool
 * from the draw toolbar, click the canvas at each vertex (multi-vertex tools finish on a
 * right-click of the last point), and return the freshly-created feature's id (the tool generates
 * it; we diff `storage` before/after to find it).
 * @returns {Promise<string|null>}
 */
async function drawViaToolUI(page, { toolId, storage, coords, multi }) {
    const before = new Set((await readFeatures(page, storage)).map((f) => f.id));

    // Fit/center the map so every vertex is guaranteed in-frame for the clicks.
    await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        if (cs.length === 1) { map.jumpTo({ center: cs[0], zoom: 14 }); return; }
        const lngs = cs.map((c) => c[0]); const lats = cs.map((c) => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, duration: 0 });
    }, coords);
    await page.waitForTimeout(300); // let the camera settle before projecting

    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
    const btn = page.locator(`.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });

    // THE BUTTON FLIPPING IS NOT THE TOOL BEING READY. `data-active` is set on click, while the
    // control's `activate()` — which wires the map 'click' handler — runs after; in a
    // back-to-back draw loop the first vertex clicks can land before the handler exists, so only
    // some register and the draw never finishes.
    //
    // THE WAIT THAT USED TO BE HERE COULD NEVER PASS. It asked `getControl(toolId)?.isActive`,
    // but the registry is keyed by CONTROL CLASS NAME (`AddPointControl`), never by the
    // toolbar's `data-tool-id` (`point`) — so the lookup always returned null, the predicate was
    // always false, the 5s timeout always expired, and `.catch(() => {})` swallowed it. Every UI
    // draw in this suite silently burned five seconds on a check that could not pass, and the
    // only real protection was the 150 ms sleep that followed — which is why the draws flaked
    // under full-suite load and passed in isolation.
    //
    // The signal used now is the one the tool manager itself publishes AFTER `activate()`
    // returns (`_syncToStateManager`, `tool_manager/tool_manager.js`), and it is NOT swallowed:
    // a tool that never reports active is a real failure and says so.
    await page.waitForFunction(async (id) => {
        const s = await import('/src/js/store/index.js');
        const active = s.getStateManager?.()?.getActiveTool?.();
        if (!active) return false;
        // `AddMilitarySymbolControl` becomes `militarysymbol` while the toolbar id is
        // `militarySymbol`: compare case-insensitively, ignoring separators.
        const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
        return norm(active) === norm(id);
    }, toolId, { timeout: 15000 });

    // O MAPA PRECISA ESTAR ASSENTADO ANTES DE SER DIRIGIDO, e "o tool está ativo" não diz isso.
    //
    // Quem abre um atlas de servidor (`openRemoteAtlas`) segue trabalhando DEPOIS do ponto em que
    // `openClient` libera o teste: o helper espera o mapa do atlas ficar ativo (chave UUID), mas
    // ainda vêm `BaseLayerControl.switchMap()`, que RECARREGA O ESTILO, e
    // `reapplyAtlasAppearance()`, que chama `map.setProjection(...)`. Trocar a projeção muda o que
    // `map.project()` devolve, e recarregar o estilo derruba as fontes sob o desenho em curso. Um
    // desenho iniciado nessa janela clica em pixels que já não correspondem ao lng/lat pedido, ou
    // perde o vértice, e o sintoma é o mesmo timeout mudo lá embaixo — foi assim que o §14.9
    // reprovava na PRIMEIRA linha, logo após `openClient`, e não na segunda.
    //
    // `isStyleLoaded()` cobre a recarga de estilo e `isMoving()` cobre câmera/projeção em
    // transição. Isto é espera por ESTADO do mapa, não por prazo.
    await page.waitForFunction(() => {
        const map = globalThis.__ebgeoMap;
        return !!map && map.isStyleLoaded?.() === true && map.isMoving?.() === false;
    }, null, { timeout: 20000 });

    // DESOCUPA O MAPA ANTES DE DESENHAR, e isto FECHA a corrida que a espera abaixo só sabia
    // anotar.
    //
    // MEDIDO numa falha real da suíte cheia: `[-43.22,-22.92] <- div.feature-tab-content active`,
    // com `drawPoints: 0` e o tool ativo. Terminar uma feição SELECIONA a nova
    // (`toggleFeatureSelection` + `updateUI`) e abre o painel de atributos, que fica aberto. Numa
    // varredura que desenha vinte tipos em sequência, o painel da feição anterior cobre o pixel do
    // desenho seguinte, o clique vai para o painel, o canvas nunca o vê, e o desenho fica pendurado
    // sem erro nenhum.
    //
    // A espera por "o ponto pertence ao canvas" (em `clicarNoMapa`) NÃO resolve este caso, e a
    // diferença é o que justifica esta linha: ela funciona para a PALETA de ferramentas, que se
    // fecha sozinha por transição de 200 ms, e não para o painel de atributos, que fica aberto até
    // alguém fechá-lo. Esperar por uma condição que ninguém vai satisfazer é queimar 5 s e clicar
    // errado do mesmo jeito.
    //
    // A ORDEM É CONTRATO. `closeFeaturePanel()` RESTAURA a aba de barra lateral que estava aberta
    // antes (`sidebar.previousTab`), então fechar o painel pode ABRIR a barra e trocar um overlay
    // por outro. Por isso o `collapseSidebar()` vem DEPOIS, e não antes.
    //
    // Isto não maquia o produto: o que este helper mede é DESENHAR, e o estado do painel é
    // incidental ao desenho. O painel continua sendo exercitado por quem o testa de propósito
    // (`selectFeatureViaTree`, o rename pelo painel), e nenhum desses caminhos passa por aqui.
    await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const sm = s.getStateManager?.();
        if (!sm) return;
        sm.closeFeaturePanel?.();
        sm.collapseSidebar?.();
    });

    /**
     * Projeta UM lng/lat para pixel de viewport, NO INSTANTE DO CLIQUE.
     *
     * Projetar todos os pontos de uma vez, antes do primeiro clique, era uma foto que envelhecia
     * durante o desenho. O que a invalida é o próprio produto: ao terminar uma feição,
     * `createFeature` chama `selectionManager.toggleFeatureSelection` + `updateUI()`, que ABRE o
     * painel de atributos e REDIMENSIONA o canvas do mapa. Num spec que desenha duas linhas
     * seguidas (o caso §14.9), a segunda projeta seus pixels enquanto o painel da primeira ainda
     * está animando, e os cliques caem em lng/lat que não são os pedidos — às vezes fora da tela,
     * às vezes perto demais um do outro, e aí `isPointTooClose` descarta o vértice final e a linha
     * de um ponto só é jogada fora SEM erro nenhum. O sintoma é sempre o mesmo timeout mudo de 20 s
     * apontando para o tool, que está certo.
     *
     * Reprojetar por clique custa um round-trip por vértice e remove a premissa inteira.
     * @param {[number, number]} lngLat
     * @returns {Promise<{x: number, y: number}>}
     */
    const projetar = ([lng, lat]) => page.evaluate(([lo, la]) => {
        const map = globalThis.__ebgeoMap;
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const p = map.project([lo, la]);
        const x = Math.round(rect.left + p.x);
        const y = Math.round(rect.top + p.y);
        // QUEM ESTÁ POR CIMA DESTE PIXEL? O clique vai para o elemento do TOPO, e os handlers de
        // desenho estão no CANVAS: o de finalizar (`contextmenu`) é registrado nele diretamente.
        // Terminar uma feição abre o painel de atributos (`toggleFeatureSelection` + `updateUI`),
        // que cobre parte do mapa, então num spec que desenha várias feições seguidas um vértice
        // pode cair SOB o painel. Aí o evento é do painel, o canvas nunca o vê, e o desenho fica
        // pendurado: tool ativo, vértices de menos, nenhuma feição e nenhum erro. Nomear o
        // elemento que interceptou transforma esse silêncio em diagnóstico.
        const topo = document.elementFromPoint(x, y);
        const coberto = topo && topo !== canvas && !canvas.contains(topo);
        return {
            x,
            y,
            coberto: !!coberto,
            porQuem: coberto ? `${topo.tagName.toLowerCase()}.${String(topo.className || '').slice(0, 60)}` : null,
        };
    }, [lng, lat]);


    /** Pontos de clique que tinham outro elemento por cima, para o diagnóstico da falha. */
    const cobertos = [];

    /**
     * Clica num lng/lat, anotando se havia outro elemento por cima do ponto.
     * @param {[number, number]} lngLat
     * @param {{button?: 'left'|'right'}} [opcoes]
     * @returns {Promise<void>}
     */
    const clicarNoMapa = async (lngLat, { button = 'left' } = {}) => {
        // ESPERE O PONTO FICAR ALCANÇÁVEL ANTES DE CLICAR.
        //
        // MEDIDO, não suposto: o diagnóstico de uma falha real trouxe
        // `drawPoints: 1, isActive: true` com `[-43.18,-22.89] <- div.toolbar-popup-grid`, isto é, o
        // clique de finalizar caiu na PALETA DE FERRAMENTAS que este mesmo helper abre para escolher
        // o tool. A paleta fecha por `visibility: hidden`, que não recebe clique, mas a regra tem
        // `transition: ... visibility 200ms`: durante a transição ela ainda é alvo. Clicar dentro
        // dessa janela entrega o evento à paleta, o canvas nunca vê, e o desenho fica pendurado sem
        // erro nenhum.
        //
        // A espera é pela CONDIÇÃO de que se precisa (o ponto pertence ao canvas), não pelo modelo
        // de quem o cobre: serve para a paleta, para o painel de atributos e para o próximo overlay
        // que alguém acrescentar. Se não liberar, clica assim mesmo e ANOTA, porque um clique a
        // menos com diagnóstico é melhor que uma espera que reprova sozinha (a versão anterior disto
        // era um `throw` e reprovou de imediato um caso que estava verde).
        await page.waitForFunction((ll) => {
            const map = globalThis.__ebgeoMap;
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            const pt = map.project(ll);
            const topo = document.elementFromPoint(
                Math.round(rect.left + pt.x),
                Math.round(rect.top + pt.y),
            );
            return !!topo && (topo === canvas || canvas.contains(topo));
        }, lngLat, { timeout: 5000 }).catch(() => { /* anotado abaixo */ });

        const p = await projetar(lngLat);
        // ANOTA, NÃO REPROVA. A cobertura é uma PISTA forte para um desenho que não acontece, e foi
        // ela que explicou o polígono pendurado; mas ela não é prova de que o clique se perdeu, e
        // transformá-la em erro reprovou de imediato um caso que estava verde
        // (`browser-collab-maps-layers`, cujo primeiro vértice cai sob `.features-tab-content` e
        // ainda assim desenha). Guarda que reprova comportamento correto é pior que guarda nenhum:
        // vira ruído e alguém o desliga. Então isto entra no diagnóstico da falha lá embaixo, onde
        // responde a pergunta certa ("o clique chegou ao canvas?") sem inventar um veredito.
        if (p.coberto) cobertos.push(`[${lngLat}] <- ${p.porQuem}`);
        await page.mouse.click(p.x, p.y, button === 'right' ? { button: 'right' } : undefined);
    };

    if (!multi) {
        await clicarNoMapa(coords[0]);
    } else {
        // CADA VÉRTICE É CONFIRMADO ANTES DO PRÓXIMO CLIQUE, e o que estava aqui era um
        // `waitForTimeout(120)` — um palpite, não uma espera.
        //
        // A interleaving perdedora: o clique-direito que FINALIZA chega antes de o último clique
        // esquerdo ter sido processado pelo handler de 'click' do mapa. A linha fecha com menos
        // vértices do que o teste desenhou e é DESCARTADA (uma linha de um ponto não vira feição),
        // então nada aparece na store e o `expect.poll` abaixo queima 20 s para dizer só que não
        // apareceu. É por isso que o caso de 2 vértices era o mais frágil da suíte: ele tem UM
        // clique esquerdo, então essa corrida é a única coisa entre desenhar e não desenhar.
        //
        // `drawPoints` é o array de vértices em progresso do próprio controle, então esperá-lo
        // crescer é esperar o efeito REAL do clique, não um prazo. Line e polygon são os dois
        // únicos `multi` da suíte e ambos o expõem; a chave do registro é o nome da classe
        // (`AddLineControl`), nunca o id da barra (`line`), que é a confusão que já custou uma
        // espera impossível neste mesmo arquivo.
        const controlKey = `Add${toolId.charAt(0).toUpperCase()}${toolId.slice(1)}Control`;
        for (let i = 0; i < coords.length - 1; i++) {
            await clicarNoMapa(coords[i]);
            await page.waitForFunction(async ({ key, n }) => {
                const s = await import('/src/js/store/index.js');
                const control = s.getControl?.(key);
                // Sem o controle no registro a espera não tem sujeito: falhar aqui é honesto,
                // porque o silêncio devolveria a corrida que esta espera existe para fechar.
                if (!control || !Array.isArray(control.drawPoints)) {
                    throw new Error(`drawViaToolUI: "${key}" nao expoe drawPoints para confirmar o vertice`);
                }
                return control.drawPoints.length >= n;
            }, { key: controlKey, n: i + 1 }, { timeout: 10000 });
        }
        await clicarNoMapa(coords[coords.length - 1], { button: 'right' }); // finish
    }

    // Return the freshly-created feature id (the one absent before the draw).
    //
    // THE MESSAGE NAMES THE TOOL, and the previous one did not: a timeout here read only
    // "expect(received).toBeTruthy() / Received: null", inside a shared helper called for three
    // different tools in one sweep, so the first question a reader has — WHICH draw failed —
    // could not be answered from the report. A helper used in a loop owes its failure the loop
    // variable.
    //
    // 20s, not 10s: measured under sustained full-suite load, where this is the last draw of a
    // 20-type sweep. It passes 5 of 5 in isolation at either budget, so the number was the
    // arbitrary part, not the behaviour.
    let id = null;
    try {
        await expect.poll(async () => {
            const fresh = (await readFeatures(page, storage)).find((f) => !before.has(f.id));
            id = fresh?.id ?? null;
            return id;
        }, {
            timeout: 20000,
            message: `a ferramenta "${toolId}" nao criou feicao em "${storage}" depois dos cliques`,
        }).toBeTruthy();
    } catch (erro) {
        // O TIMEOUT MUDO NÃO DIZ POR QUE, e este é o ponto exato onde a informação existe e some.
        // Um desenho pode não virar feição por motivos que a store não distingue: o tool foi
        // desativado no meio, os vértices não chegaram, ou chegaram e o clique-direito descartou o
        // último por proximidade (`isPointTooClose`), caso em que a linha fica com um ponto só e é
        // jogada fora SEM erro. Ler o estado do controle aqui separa os três em uma linha, em vez
        // de custar uma sessão de investigação por hipótese.
        const diag = await page.evaluate(async ({ key }) => {
            const s = await import('/src/js/store/index.js');
            const c = s.getControl?.(key);
            const map = globalThis.__ebgeoMap;
            return {
                controleAchado: !!c,
                isActive: c?.isActive ?? null,
                drawPoints: Array.isArray(c?.drawPoints) ? c.drawPoints.length : null,
                toolAtivo: s.getStateManager?.()?.getActiveTool?.() ?? null,
                zoom: map?.getZoom?.() ?? null,
                projecao: map?.getProjection?.()?.type ?? null,
                estiloCarregado: map?.isStyleLoaded?.() ?? null,
            };
        }, { key: `Add${toolId.charAt(0).toUpperCase()}${toolId.slice(1)}Control` }).catch(() => null);
        erro.message += `\n  [diagnóstico do tool] ${JSON.stringify(diag)}`;
        // `isActive: true` com `drawPoints` abaixo do mínimo do tipo é a assinatura de um clique
        // que não chegou ao canvas; a lista abaixo diz QUAL elemento estava por cima de cada ponto.
        if (cobertos.length > 0) {
            erro.message += `\n  [pontos cobertos por outro elemento] ${cobertos.join(' | ')}`;
        }
        throw erro;
    }
    return id;
}

/** Draws a LINE via the real line tool (vertex clicks + right-click finish). @returns {Promise<string>} new id. */
export const drawLineUI = (page, coords) => drawViaToolUI(page, { toolId: 'line', storage: 'lines', coords, multi: true });

/** Draws a POLYGON via the real polygon tool (vertex clicks + right-click finish). @returns {Promise<string>} new id. */
export const drawPolygonUI = (page, coords) => drawViaToolUI(page, { toolId: 'polygon', storage: 'polygons', coords, multi: true });

/** Places a POINT via the real point tool (single canvas click). @returns {Promise<string>} new id. */
export const drawPointUI = (page, lngLat) => drawViaToolUI(page, { toolId: 'point', storage: 'points', coords: [lngLat], multi: false });

/**
 * Attempts a RAW store write (addFeature of a line) via page.evaluate — bypassing the UI — so a
 * no-edit role's store-level guardWrite is exercised directly. The write MUST be blocked (guardWrite
 * returns without persisting), so the caller's before/after diff proves nothing was created. Used by
 * the permission specs now that the safe view (D1) hides the draw toolbar, leaving no UI gesture to drive.
 * @param {import('@playwright/test').Page} page
 * @param {Array<[number, number]>} coords
 */
export async function attemptStoreWriteBlocked(page, coords) {
    await page.evaluate(async (cs) => {
        const store = await import('/src/js/store/index.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');
        const id = generateUUID();
        const feature = {
            type: 'Feature',
            id,
            geometry: { type: 'LineString', coordinates: cs },
            properties: { id, nome: 'blocked-attempt', tipo: 'line', visivel: true },
        };
        try {
            await store.addFeature('lines', feature);
        } catch {
            // guardWrite denies a read-only write (returns or throws) → no feature; either is "blocked".
        }
    }, coords);
}

// ── Real attribute-panel / layers-tree gestures (shared UI drivers) ───────────
// Extracted so the round-trip / conflict specs drive edits as a USER does, not via
// store ops. Selectors: layers-tree select (browser-collab-shared-atlas.spec.js), the
// color picker's native input (tool_manager/helpers/color-picker.helpers.js), the
// Delete-key + confirm-modal delete (keyboard-shortcuts.spec.js + confirm.modal.js).

/** Opens the layers ("camadas") tab (idempotent — never toggles it closed). */
export async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/** Selects a feature by id through the REAL layers tree → expands the sidebar feature panel. */
export async function selectFeatureUI(page, featureId) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

/** Commits the open panel's pending edits the way a user does — clicking "Salvar". */
export async function savePanelUI(page) {
    const saveBtn = page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

/** Recolors the currently-selected feature via the panel color picker's native input, then saves. */
export async function recolorViaPanelUI(page, hex) {
    const native = page.locator('.feature-panel[data-expanded="true"] .color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await savePanelUI(page);
}

/** Selects a feature in the layers tree, then recolors it through the panel (one gesture). */
export async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

/** Deletes a feature through the REAL UI: select in the layers tree, press Delete, confirm. */
export async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

/**
 * Renames the currently-selected feature through the sidebar panel's editable name field:
 * click the display to enter edit mode, type the new name, commit with Enter, then save.
 */
export async function renameViaPanelUI(page, newName) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    await panel.locator('.feature-identification-name').click();
    const input = panel.locator('.feature-identification-name-input:not(.feature-identification-name-input--hidden)');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(newName);
    await input.press('Enter');
    await savePanelUI(page);
}

/** Selects a feature in the layers tree, then renames it through the panel (one gesture). */
export async function selectAndRenameUI(page, featureId, newName) {
    await selectFeatureUI(page, featureId);
    await renameViaPanelUI(page, newName);
}

/** Places a MILITARY SYMBOL with the real tool (activate → single click, default SIDC). @returns {Promise<string>} new id. */
export async function drawMilitarySymbolUI(page, lngLat) {
    const before = new Set((await readFeatures(page, 'military_symbols')).map((f) => f.id));

    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 14 }), lngLat);
    await page.waitForTimeout(300); // let the camera settle before projecting

    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();

    const pt = await page.evaluate((c) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const p = map.project(c);
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
    }, lngLat);
    await page.mouse.click(pt.x, pt.y);

    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'military_symbols')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

/**
 * Waits until the peer's store has a feature of `type` with `id`. SyncLedger-gated:
 * first waits deterministically for the peer's `remote.applied` span (the op was applied
 * + lifecycle event emitted), then asserts the store. Falls back to a store poll if the
 * trace never fires, so the assertion stays honest. Replaces the old blind 20s poll.
 */
export async function pollPeerFeature(page, type, id, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { timeout });
    } catch {
        // Trace was active but the signal never came → genuine miss; a short store poll confirms.
        traced = true;
    }
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout: traced ? 5000 : timeout })
        .toBe(true);
}

/** Waits until the peer's feature of `type`/`id` satisfies `pred(props)` (SyncLedger-gated). */
export async function pollPeerFeatureWhere(page, type, id, pred, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { timeout });
    } catch {
        traced = true;
    }
    await expect
        .poll(async () => {
            const hit = (await readFeatures(page, type)).find((x) => x.id === id);
            return hit ? !!pred(hit.props) : false;
        }, { timeout: traced ? 8000 : timeout })
        .toBe(true);
}

/** Waits until the peer's store NO LONGER has the feature (delete sync; SyncLedger-gated). */
export async function pollPeerFeatureGone(page, type, id, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { operationType: 'delete', timeout });
    } catch {
        traced = true;
    }
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout: traced ? 5000 : timeout })
        .toBe(false);
}

/**
 * Collects the UNIFIED SyncLedger (each client's ring + the server ring) at the end of a
 * collaboration scenario, attaches the merged ledger.jsonl + the human/AI report to the
 * Playwright report, and asserts the session was correct: NO op was acked-but-no-effect
 * (invariant I2 — the flagship "wrote 0 rows" guard). The server ring is best-effort (the
 * /debug/trace endpoint is mounted only under NODE_ENV=test). Use ONLY for well-behaved
 * convergence flows — not for permission/lock edge-case specs where a 0-row outcome may be
 * the intended behaviour.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Page[]} pages
 * @param {string} baseUrl
 * @param {{ username: string, password: string }} ownerCreds
 * @param {string} atlasId
 * @param {{ allowNoEffects?: boolean }} [opts] - allowNoEffects: skip the I2 assertion for specs
 *   that exercise undo→redo (re-creating a soft-deleted feature is a BY-DESIGN server no-op — a
 *   tombstone — per the backend "Sync CRDT — confirmed gaps"; it is not a violation).
 * @returns {Promise<Object>} The reduced report.
 */
export async function assertLedgerClean(testInfo, pages, baseUrl, ownerCreds, atlasId, { allowNoEffects = false } = {}) {
    let token;
    try {
        const owner = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await owner.login(ownerCreds.username, ownerCreds.password);
        token = owner.getAccessToken();
    } catch {
        // Server-side ledger is optional enrichment; the client rings carry the core signal.
    }
    const spans = await collectLedger(pages, { baseUrl, token, atlasId });
    const report = reduceLedger(spans);
    await testInfo.attach('syncledger.report.md', { body: renderReport(report), contentType: 'text/markdown' });
    await testInfo.attach('syncledger.jsonl', {
        body: spans.map((s) => JSON.stringify(s)).join('\n'),
        contentType: 'application/x-ndjson',
    });
    if (!allowNoEffects) {
        expect(report.summary.noEffects, `acked-but-no-effect ops: ${JSON.stringify(report.noEffects)}`).toBe(0);
    }
    return report;
}
