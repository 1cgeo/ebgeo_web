// Path: e2e-ui/imagem-sem-referencia-de-zoom.spec.js

/**
 * IMAGE WITH NO ZOOM REFERENCE: the gesture that FROZE the page.
 *
 * WHAT THIS SPEC PINS, and why it exists. A legacy `.ebgeo` can carry an image whose
 * dimensions were written under other names (`largura`/`altura`, not `width`/`height`)
 * and with no `createdAtZoom` at all. On `main`, with that data, the zoom-correction
 * arithmetic (`currentZoom - properties.createdAtZoom`) became NaN, and the NaN went
 * whole into the image layer's `icon-size` and into the selection-box geometry.
 *
 * Measured on `main` on 2026-09-01, 6 runs out of 6: selecting the image from the
 * features tab (the click zooms to it), pressing Esc and switching maps at high zoom
 * FREEZES the page's main thread. The debugger cannot pause, which points at a native
 * call (canvas or readPixels with a NaN or enormous dimension) rather than at JS in a
 * loop. Nothing is thrown and nothing reaches the console: the only evidence is the page
 * no longer answering.
 *
 * WHAT IT ACTUALLY PROVES, MEASURED BY REVERTING THE GUARD, and it is LESS than the
 * paragraph above may suggest. With the two old lines back in
 * `zoom-correction.helpers.js` this spec goes red 3 runs out of 3, so it is a real
 * guard and not a vacuous green. But it fails on the DERIVED SIZE, never on liveness:
 * all four `expectPageAlive` calls passed in all three reverted runs and the whole
 * gesture completed. IT DOES NOT REPRODUCE THE FREEZE. The freeze was measured on the
 * owner's real file, which carries far more than one 1x1 image, and nothing here
 * reproduces it, so read a green as "the derived size is a real number in a real
 * browser", not as "the page cannot freeze".
 *
 * AND THE REVERTED RUN CORRECTED THE HYPOTHESIS ON ONE POINT, which is why the failure
 * message carries the whole object: the observed value is
 * `{"naStore":1,"naFonte":1,"achou":true,"tamanhoDesenhado":null}`. NULL, not NaN. The
 * feature reaches the MapLibre source through a JSON round trip, and `JSON.stringify(NaN)`
 * is `null`, so the source LAUNDERS the NaN and `icon-size` receives an absent value and
 * falls back to its own default. Whatever reaches native code with a NaN still in it,
 * therefore, is NOT this path: the remaining candidate is the selection-box polygon,
 * whose coordinates are geometry rather than properties. That narrows where a future
 * investigation should look, and it is the kind of thing only a negative control tells
 * you: the assertion was written expecting NaN and would have read "not finite" either
 * way.
 *
 * So: the NaN being the root cause of the FREEZE remains a hypothesis, unproven. The
 * liveness checks stay because they are the only assertion that does not depend on it,
 * and if the freeze ever comes back for any reason this spec goes red just the same.
 *
 * The arithmetic itself is pinned in node by
 * `tests/unit/zoom-correction-sem-referencia.repro.test.js`, with a negative control.
 * This file covers what node cannot reach: the drawing.
 *
 * LOCAL AND ANONYMOUS, WHICH IS NOT THE SAME AS "no backend". Nothing here needs a
 * LOGIN, and nothing here touches an atlas of the server: the image is seeded through
 * the real store ops (`storeImage` + `addFeature`), the same ones the `.ebgeo` import
 * calls, into the local IndexedDB, and every gesture after that is a real click on the
 * product's own tabs. The backend still has to be UP, because the map boot is fail-fast
 * on `GET /api/config` (`src/js/index.js` calls `showUnavailableScreen()` and returns
 * before `initServices()`), so without it this spec would never reach a rendered map.
 * The fixture boots the real one once (`tests/e2e-ui/global-setup.js`) and this spec
 * inherits it like every other; it just never logs into it.
 *
 * THE TWO CLICKS ARE RE-SENT IN A LOOP, and that is not defensive noise: both lists this
 * spec clicks (the Maps-tab cards and the features-tab rows) are rebuilt whole on every
 * refresh, so a single click races the re-render. Measured: the first version used
 * `card.click()` and failed 3 runs out of 3 on "element was detached from the DOM,
 * retrying" until the case timed out. The reasoning is on each helper.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const MAPA_DA_IMAGEM = 'Mapa com Imagem Legada';

/** A 1x1 transparent PNG, the smallest file the decoder accepts. */
const PNG_1X1_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Boots the app and waits for the real 2D map plus the toolbar. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getZoom === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
    // The splash covers the canvas and swallows clicks until it detaches.
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20000 });
}

/**
 * Drives one op on the app's real store facade.
 * @param {import('@playwright/test').Page} page
 * @param {string} opName - Exported op name
 * @param {Array} args - Arguments for the op
 * @returns {Promise<*>} Whatever the op returns
 */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/**
 * Seeds ONE image exactly as the owner's file carries it: with `largura`/`altura` in
 * place of `width`/`height`, and with no `createdAtZoom`. The three absences are the
 * subject of the test, so they are spelled out here instead of hidden in a helper.
 * @param {import('@playwright/test').Page} page
 * @param {Array<number>} coordinates - `[lng, lat]` of the image
 * @returns {Promise<string>} The id of the seeded feature
 */
function seedLegacyImage(page, coordinates) {
    return page.evaluate(async ({ base64, coords }) => {
        const store = await import('/src/js/store/index.js');
        const { loadImageToMap } = await import('/src/js/utilities/map-image-loader.js');

        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });

        const id = `img-legado-${Date.now()}`;
        await store.storeImage(id, blob);
        await loadImageToMap(globalThis.__ebgeoMap, id, blob);

        await store.addFeature('images', {
            type: 'Feature',
            id,
            properties: {
                id,
                source: 'image',
                size: 1,
                rotation: 0,
                opacity: 1,
                // THE THREE ABSENCES THAT MAKE THE DEFECT: no `width`, no `height` and no
                // `createdAtZoom`. The dimensions arrive under the name the old file uses,
                // which no line of the product reads.
                largura: 640,
                altura: 480,
                nome: 'Foto legada',
                descricao: '',
                visivel: true,
                bloqueado: false,
                layerId: store.getActiveLayerIdSync(),
            },
            geometry: { type: 'Point', coordinates: coords },
        });

        return id;
    }, { base64: PNG_1X1_BASE64, coords: coordinates });
}

/**
 * Makes a sidebar tab be the open one, WITHOUT assuming the click is idempotent.
 *
 * It is not: `_handleTabClick` (`sidebar/sidebar.control.js`) collapses the sidebar when
 * `isExpanded && currentTab === tabId`, so clicking the tab that is already open CLOSES
 * it. Two switches in a row each call their opener, and the second click was landing on
 * an already-active tab and shutting the panel; the symptom was one run in three failing
 * with "element(s) not found" on a map card that had been clickable a moment earlier.
 * Reading `data-active` first (written by `setActiveTab` on buttons that are built once
 * and never rebuilt) turns the gesture into "make sure it is open".
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} tab - The `data-tab` value
 */
async function ensureTabOpen(page, tab) {
    const btn = page.locator(`.sidebar-nav-btn[data-tab="${tab}"]`);
    await expect(btn).toBeVisible({ timeout: 10000 });
    if (await btn.getAttribute('data-active') !== 'true') {
        await btn.click();
    }
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 10000 });
}

/** Opens the Maps tab and waits for the current-map card to render. */
async function openMapsTab(page) {
    await ensureTabOpen(page, 'mapas');
    const nameInput = page.locator('.maps-tab #current-map-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await expect(nameInput).not.toHaveValue('', { timeout: 10000 });
}

/** The ACTIVE map, read from the store rather than from any rendered value. */
const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/**
 * Switches maps through the Maps-tab card, which is the product's real gesture.
 *
 * THE CLICK IS RE-SENT UNTIL IT TAKES, and the first version of this helper did not do
 * that: it called `card.click()` and failed 3 runs out of 3 with "element was detached
 * from the DOM, retrying" until the case timed out. The maps list is rebuilt whole on
 * every `_loadMaps` (each row is a fresh `_createMapListItem`), and seeding a feature
 * right before this is exactly what triggers one, so Playwright's actionability check
 * never gets a stable node to click.
 *
 * `evaluate((el) => el.click())` skips the actionability check, but on its own it only
 * moves the failure: it resolves the element and THEN clicks it, so a re-render in that
 * gap sends the click to a DETACHED node, which raises nothing and does nothing. What
 * closes the race is re-locating INSIDE the loop, so a lost click is simply re-sent.
 * Re-clicking the card of the map that is already active is inert, so the loop has no
 * side effect. (Same shape as `switchToMapUI` in `browser-collab-maps-layers.spec.js`,
 * where the lesson was first paid for.)
 *
 * The exit condition is the STORE, never the rendered name input: the input is part of
 * the same re-rendered subtree, so asserting on it would be reading the symptom's
 * neighbour instead of the effect.
 *
 * IT ALSO WAITS FOR THE TAB TO CATCH UP, and that second wait is not belt-and-braces: it
 * is what makes the NEXT switch possible. `_handleSelectMap` (`sidebar/tabs/maps.tab.js`)
 * opens with `if (mapName === this._currentMapName) return;`, and that cached name is
 * only refreshed by `_loadMaps`, which runs off the `LAYERS_CHANGED` this same handler
 * emits AFTER `setCurrentMap` resolved. So there is a window in which the store already
 * reports the new map while the tab still believes the OLD one is current, and a click on
 * the old one inside that window is swallowed by the early return: no error, no effect,
 * and indistinguishable from a click lost to a re-render. Measured: with the store as the
 * only exit condition, two back-to-back switches failed 2 runs out of 3, always the
 * second one, with the store stuck on the previous map for the full 20 s of re-clicking.
 * Waiting for `data-selected="true"` on the target card is waiting for exactly the value
 * `_createMapListItem` writes from `_currentMapName`, so it proves the tab is consistent.
 *
 * ONE THING TO KNOW WHEN THIS GOES RED: if the page freezes DURING a switch (which is
 * the defect the spec exists for), this poll is what fails first, and its message names
 * the map rather than the freeze. The `expectPageAlive` call that follows every switch
 * is the one that says so in words; a timeout here means the same thing.
 */
async function switchMapUI(page, name) {
    await openMapsTab(page);
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`))
        .toBeVisible({ timeout: 10000 });

    await expect.poll(async () => {
        if (await currentMapName(page) === name) return name;
        // RE-LOCATES on every attempt: holding the handle is the defect described above.
        const alvo = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"] .map-list-name`);
        if (await alvo.count() > 0) {
            await alvo.first().evaluate((el) => el.click())
                .catch(() => { /* re-render mid-click: the next turn re-sends it */ });
        }
        return currentMapName(page);
    }, {
        timeout: 20000,
        message: `o mapa ativo nao virou "${name}" nem com o clique reenviado`,
    }).toBe(name);

    // The tab has to agree before the caller may switch again: see the note above.
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`))
        .toHaveAttribute('data-selected', 'true', { timeout: 10000 });
}

/** Opens the layers/features tab and waits for a layer container. */
async function openLayersTab(page) {
    await ensureTabOpen(page, 'camadas');
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/**
 * The assertion that does not depend on the hypothesis: the page answers.
 *
 * `page.evaluate` on a frozen page simply never returns, so racing it against the clock
 * is what turns "hung" into "red with a message". Five seconds is orders of magnitude
 * above the real cost (milliseconds) and below the runner's own timeout.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} quando - What had just happened, for the failure message
 */
async function expectPageAlive(page, quando) {
    const resposta = await Promise.race([
        // The `.catch` is NOT decoration. The loser of a race stays pending, so on a real
        // freeze this `evaluate` is still in flight when the test ends, and the context
        // teardown rejects it with "Target closed" once nobody is listening: an unhandled
        // rejection that lands after the fact and buries the failure that matters. A
        // rejection that arrives BEFORE the clock still fails the assertion, because
        // `undefined` is not 1, and that is the right verdict: the page did not answer.
        page.evaluate(() => 1).catch(() => undefined),
        new Promise((resolve) => setTimeout(() => resolve('congelou'), 5000)),
    ]);
    expect(resposta, `a pagina parou de responder ${quando}`).toBe(1);
}

describeOrSkip('Imagem sem referencia de zoom (real Chromium, local e anonimo)', () => {
    test('selecionar pela aba, Esc e trocar de mapa NAO trava a pagina', async ({ page }) => {
        await bootApp(page);
        const mapaInicial = await currentMapName(page);
        expect(mapaInicial).toBeTruthy();

        // --- the second map, and the legacy image inside it -----------------------
        const criado = await applyStoreOp(page, 'addMap', [MAPA_DA_IMAGEM]);
        expect(criado?.name).toBe(MAPA_DA_IMAGEM);
        await applyStoreOp(page, 'setCurrentMap', [MAPA_DA_IMAGEM]);

        const featureId = await seedLegacyImage(page, [-43.2, -22.9]);
        expect(featureId).toBeTruthy();

        // Leave and come back through the real UI: it is the return that rebuilds the
        // map's layers from the store, which is the path the legacy image enters the
        // drawing by (`setupImageLayers` calls `applyZoomCorrections` synchronously).
        await switchMapUI(page, mapaInicial);
        await switchMapUI(page, MAPA_DA_IMAGEM);
        await expectPageAlive(page, 'ao voltar para o mapa da imagem');

        // --- the gesture that used to freeze --------------------------------------
        await openLayersTab(page);
        await expect(page.locator('.layer-content .feature-item .feature-main').first())
            .toBeVisible({ timeout: 10000 });

        // Displace the camera and zoom OUT first. Without this the assertion below would
        // be vacuous whenever the boot zoom already sits above the bar, and the exit
        // condition of the loop could short-circuit on a zoom no click produced. Same
        // move, for the same reason, as `layers-tab-local.spec.js` §2.28-29.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-30, -10], zoom: 4 }));
        const zoomAntes = await page.evaluate(() => globalThis.__ebgeoMap.getZoom());
        expect(zoomAntes).toBeLessThan(6);

        // 1. clicking the row SELECTS and zooms to the feature (zoomAndSelectFeature).
        //
        // Re-sent on every turn, for the same reason the map switch is: the features tab
        // rebuilds its rows on each refresh, and a click delivered to a detached row is
        // silent. The exit condition is the SELECTION, which is not animated: the fly-to
        // that follows takes about a second, and re-clicking during it would restart the
        // animation from the top on every turn and could keep the zoom below the bar
        // forever. So the loop stops as soon as the panel opens, and the zoom is then
        // polled WITHOUT clicking anything.
        await expect.poll(async () => {
            const estado = await page.evaluate(() => ({
                selecionada: !!document.querySelector('.feature-panel[data-expanded="true"]'),
                zoom: globalThis.__ebgeoMap.getZoom(),
            }));
            if (estado.selecionada || estado.zoom > 10) return true;
            const alvo = page.locator('.layer-content .feature-item .feature-main');
            if (await alvo.count() > 0) {
                await alvo.first().evaluate((el) => el.click())
                    .catch(() => { /* re-render mid-click: the next turn re-sends it */ });
            }
            return false;
        }, {
            timeout: 20000,
            message: 'o clique na linha da aba nao selecionou a imagem',
        }).toBe(true);

        // The fly-to lands on its own now that nothing is restarting it. `zoomToFeature`
        // uses `minZoom: 12`, so the bar at 10 is comfortably below where it must land,
        // and comfortably above the 4 it started from.
        await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getZoom()), { timeout: 15000 })
            .toBeGreaterThan(10);
        await expectPageAlive(page, 'depois de selecionar a imagem pela aba');

        // 2. Esc clears the selection, already at high zoom.
        await page.keyboard.press('Escape');
        await expectPageAlive(page, 'depois do Esc');

        // 3. switching maps at high zoom: this is where the page froze, 6 out of 6.
        await switchMapUI(page, mapaInicial);
        await expectPageAlive(page, 'depois de trocar de mapa no zoom alto');

        // --- and the store on the other side is still readable ---------------------
        const depois = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            return {
                mapa: store.getCurrentMapNameSync(),
                imagens: (f?.images || []).length,
            };
        });
        expect(depois.mapa).toBe(mapaInicial);
        // The initial map never received the image: features are map-scoped.
        expect(depois.imagens).toBe(0);

        // The image is still there, on its own map, with a FINITE derived size. This is
        // the only place the hypothesis appears as an assertion, and deliberately so: if
        // it is wrong the test still fails on the four liveness checks above.
        await switchMapUI(page, MAPA_DA_IMAGEM);

        // POLLED, not read once, and the first version was read once: it failed 3 of 3
        // here while every liveness check above passed. `switchMapUI` returns when the
        // STORE says the map changed, and the drawing is rebuilt AFTER that
        // (`setupImageLayers` runs in the layer setup that follows), so a single read
        // lands on a source that has not been repopulated yet. The predicate is the
        // feature being PRESENT in the source, and the size is asserted separately, so
        // that "it never got drawn" and "it got drawn with a bad size" cannot collapse
        // into the same red: they have different causes and different fixes.
        let derivado = null;
        await expect.poll(async () => {
            derivado = await page.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                const img = (f?.images || [])[0];
                const fonte = globalThis.__ebgeoMap.getSource('images');
                const data = fonte ? await fonte.getData() : { features: [] };
                const desenhada = data.features.find((x) => x.properties?.id === img?.properties?.id);
                return {
                    naStore: (f?.images || []).length,
                    naFonte: data.features.length,
                    achou: !!desenhada,
                    tamanhoDesenhado: desenhada?.properties?.calculatedSize ?? null,
                };
            });
            return derivado.achou;
        }, {
            timeout: 15000,
            message: 'a imagem nunca apareceu na fonte `images` depois da troca de mapa',
        }).toBe(true);

        expect(derivado.naStore).toBe(1);
        // The whole point of the fix, measured on the DRAWN feature: the derived size is
        // a real number. Before the guard it was NaN, and NaN is what reached `icon-size`.
        expect(
            Number.isFinite(derivado.tamanhoDesenhado),
            `calculatedSize desenhado nao e finito: ${JSON.stringify(derivado)}`,
        ).toBe(true);
        expect(derivado.tamanhoDesenhado).toBeGreaterThan(0);
    });
});
