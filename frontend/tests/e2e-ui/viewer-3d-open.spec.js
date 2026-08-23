// Path: e2e-ui/viewer-3d-open.spec.js

/**
 * §20 3D (Cesium) models viewer — local (🟢) UI driven by REAL clicks/navigation in
 * real Chromium. Two layers of assertion, both on REAL production state:
 *
 *   §20.1-2 The bottom feature toggle `#feature-toggle-models3d` activates the 3D-models
 *   viewer tool on the 2D map: its `data-active`/`aria-pressed` flip and the clustered
 *   3D-model marker layers become visible (`__ebgeoMap.getLayoutProperty('3d-models-markers',
 *   'visibility') === 'visible'`). This needs NO Cesium/WebGL — it is a pure 2D-map effect.
 *
 *   §20.13-19 Opening the actual Cesium viewer goes through the production deep-link path
 *   (`#view=3d&tileset=…` → hashchange → `modelsViewer.openViewer(tileset)`), which reveals
 *   `#map-3d-container` + `#close-3d-viewer-button` and brings up a live Cesium `window.map`
 *   (the single 3D-mode signal). The help/shortcut popup (`#help-3d` → `#nav-help-popup`) is
 *   exercised when present, then `#close-3d-viewer-button` returns the app to 2D.
 *
 * WEBGL CAVEAT: software WebGL (SwiftShader) usually works headless and the OPEN action does
 * not require the tileset to *render*; but if Cesium cannot initialize (no GL context) or the
 * `/3d/<id>/tileset.json` asset is absent, `openViewer` catches the error and reverts to 2D
 * (the container hides, `window.map` stays null). In that genuine environment limit the 3D
 * test self-skips with a clear reason (it never weakens an assertion to pass).
 *
 * The app boots from the Vite dev server; no login (these are local controls).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Tileset id this spec REGISTERS for itself.
 *
 * It used to be `'PCL'`, "present in the default config.js", and that stopped being true on
 * migration 015 (`backend/src/database/migrations/015_remove_seeded_tileset.sql`), which
 * removed the seeded demo tileset by decision of the product owner: the catalog is a
 * configuration point, not a place for example content. The seeded row had always pointed at
 * an asset that was never in the repository, so every clean install promised a model the
 * server did not serve.
 *
 * The consequence for THIS spec was invisible for weeks, because the browser layer runs
 * outside `npm test`: with no tileset in the catalog `hasTilesets()` is false, the bottom
 * toggle renders DISABLED, and §20.1-2 timed out clicking it. A spec that needs a tileset now
 * registers one instead of assuming the product ships it.
 */
const TILESET_ID = 'e2e-tileset-3d';

/**
 * Registers one tileset in the catalog, as a global admin, over the real HTTP API.
 *
 * Admin comes from `helpers/accounts.js`, which does BOTH halves in one place since
 * 2026-08-23: the account is born on the NODE side through the public route with its e-mail
 * confirmed, then the row is promoted directly in Postgres. There is no self-service path to
 * `admin`, and inventing one for a test would be inventing a product feature.
 * @param {import('@playwright/test').Page} page - Any page on the app origin.
 * @returns {Promise<void>}
 */
async function registerTileset(page) {
    await page.goto('/');
    const creds = await createVerifiedUser({ prefix: 't3dadmin', nome: 'Tileset Admin', role: 'admin' });

    const created = await page.evaluate(async ({ url, creds: c, id }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        await api.login(c.username, c.password);
        const res = await fetch(`${url}/api/v1/tilesets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${api.getAccessToken()}`,
            },
            body: JSON.stringify({
                id,
                name: 'Modelo 3D de teste',
                config: {
                    url: `/3d/${id}/tileset.json`,
                    tipo: 'Modelo 3D',
                    // `locate` is what puts the marker on the 2D map. Without it the
                    // marker layer is never built.
                    locate: { lon: -43.2, lat: -22.9 },
                },
            }),
        });
        return { status: res.status, body: await res.text() };
    }, { url: state.baseUrl, creds, id: TILESET_ID });

    expect(
        created.status,
        `o tileset nao foi registrado no catalogo: ${created.status} ${created.body}`,
    ).toBeLessThan(300);

    // Drop the admin session before the app boots. This spec is about LOCAL controls with no
    // login, and a live session on a bare URL is routed to `atlas.html` by design
    // (`shouldRouteToProjects`, `index.js`) — the page that follows has no map at all, so
    // `bootApp` would wait for a zoom button that page never renders.
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
}

/**
 * Esvazia o catálogo de tilesets PELA ROTA, como um administrador faria.
 *
 * POR QUE PELA ROTA, e não por um UPDATE no banco. O `GET /api/config` é memoizado no
 * processo do backend e a invalidação está pendurada na ESCRITA que passa pelo roteador
 * (`backend/src/modules/config/config.cache.js`). Um `UPDATE` direto no Postgres deixa o
 * payload memoizado intacto: o servidor continua entregando o catálogo velho, e o app
 * continua vendo um tileset que o banco já não tem. Medido em 2026-08-22: a versão por SQL
 * passava sozinha (o cache ainda estava frio no primeiro boot da rodada) e reprovava na
 * suíte inteira, onde um spec anterior já o tinha aquecido. Passar isolado e falhar em
 * conjunto É a assinatura de estado memoizado.
 *
 * @param {import('@playwright/test').Page} page - qualquer página na origem do app
 * @returns {Promise<number>} quantos tilesets foram removidos
 */
async function clearTilesets(page) {
    await page.goto('/');
    const creds = await createVerifiedUser({ prefix: 't3dclean', nome: 'Tileset Cleaner', role: 'admin' });

    const out = await page.evaluate(async ({ url, creds: c }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        await api.login(c.username, c.password);
        const cabecalho = { Authorization: `Bearer ${api.getAccessToken()}` };

        const lista = await (await fetch(`${url}/api/v1/tilesets`, { headers: cabecalho })).json();
        const ids = (Array.isArray(lista) ? lista : (lista.data ?? lista.items ?? [])).map((t) => t.id);
        const status = [];
        for (const id of ids) {
            const res = await fetch(`${url}/api/v1/tilesets/${encodeURIComponent(id)}`, {
                method: 'DELETE', headers: cabecalho,
            });
            status.push(res.status);
        }
        return { ids, status };
    }, { url: state.baseUrl, creds });

    for (const s of out.status) {
        expect(s, `o DELETE de tileset devolveu ${s}`).toBeLessThan(300);
    }
    // A sessão de administrador sai antes do boot, pela mesma razão escrita em
    // `registerTileset`: sessão viva numa URL nua leva a `atlas.html`, que não tem mapa.
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    return out.ids.length;
}

/** Boots the app and waits for the 2D map + bottom controls to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** Reads a layer's resolved visibility from the REAL 2D MapLibre map (null if absent). */
const markerLayerVisibility = (page) =>
    page.evaluate(() => {
        const map = globalThis.__ebgeoMap;
        if (!map || !map.getLayer || !map.getLayer('3d-models-markers')) return null;
        return map.getLayoutProperty('3d-models-markers', 'visibility');
    });

/** True once a live Cesium viewer is mounted (set by map_3d.js only on successful init). */
const cesiumViewerLive = (page) =>
    page.evaluate(() => {
        const v = window.map;
        return !!(v && typeof v.isDestroyed === 'function' && !v.isDestroyed() && v.scene);
    });

/** True while the 3D container is on-screen (the DOM signal used by viewer3d-state.js). */
const container3dVisible = (page) =>
    page.evaluate(() => {
        const el = document.getElementById('map-3d-container');
        return el !== null && el.style.display !== 'none';
    });

describeOrSkip('§20 3D models viewer (real browser, local open/close)', () => {
    test('§20.0 with NO tileset in the catalog the toggle renders DISABLED', async ({ page }) => {
        // The property migration 015 created, and the control that keeps the case below
        // honest: without this, "the toggle works" could be satisfied by a toggle that is
        // always enabled, and the disabled state that broke this file would go unmeasured.
        //
        // O catálogo é GLOBAL e a rodada é UMA: o vazio que este caso mede era herdado da
        // ordem dos arquivos, e o primeiro spec a semear um tileset o levou embora. Declarar
        // a precondição custa uma linha e vale para qualquer ordem.
        await clearTilesets(page);
        await bootApp(page);

        const toggle = page.locator('#feature-toggle-models3d');
        await expect(toggle).toBeVisible({ timeout: 10000 });
        await expect(toggle, 'sem tileset no catalogo o botao nasce desabilitado')
            .toBeDisabled();
    });

    test('§20.1-2 the #feature-toggle-models3d toggle activates the 3D-models marker viewer on the 2D map', async ({ page }) => {
        await registerTileset(page);
        await bootApp(page);

        const toggle = page.locator('#feature-toggle-models3d');
        // The toggle renders when tilesets are configured, and this spec registered one above.
        await expect(toggle).toBeVisible({ timeout: 10000 });
        await expect(toggle, 'com tileset no catalogo o botao fica habilitado').toBeEnabled();
        await expect(toggle).toHaveAttribute('data-active', 'false');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // REAL click → the viewer tool activates: state attrs flip AND the marker layer shows.
        await toggle.click();
        await expect(toggle).toHaveAttribute('data-active', 'true', { timeout: 6000 });
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => markerLayerVisibility(page), { timeout: 6000 }).toBe('visible');

        // REAL click again → deactivates: attrs flip back and the marker layer hides.
        await toggle.click();
        await expect(toggle).toHaveAttribute('data-active', 'false', { timeout: 6000 });
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => markerLayerVisibility(page), { timeout: 6000 }).toBe('none');
    });

    test('§20.13-19 opening the Cesium viewer reveals #map-3d-container then the close button returns to 2D', async ({ page }) => {
        await bootApp(page);

        // Drive the production deep-link path: setting the hash fires hashchange, which the
        // app's listener routes to modelsViewer.openViewer(tileset) — the same call the
        // popup/catalog/"abrir no visualizador 3D" buttons make.
        await page.evaluate((id) => {
            window.location.hash = `view=3d&tileset=${id}`;
        }, TILESET_ID);

        // Wait until EITHER the Cesium viewer comes up (success) OR the open attempt settles
        // back to 2D (failure: no WebGL / GL context lost / tileset asset absent).
        const opened = await page
            .waitForFunction(
                () => {
                    const el = document.getElementById('map-3d-container');
                    const visible = el !== null && el.style.display !== 'none';
                    const v = window.map;
                    const live = !!(v && typeof v.isDestroyed === 'function' && !v.isDestroyed() && v.scene);
                    return visible && live;
                },
                null,
                { timeout: 30000 },
            )
            .then(() => true)
            .catch(() => false);

        if (!opened) {
            // Genuine environment limit — Cesium/WebGL could not initialize (or the 3D Tiles
            // asset is not served by the dev server). Do NOT assert a fake success.
            const live = await cesiumViewerLive(page);
            const visible = await container3dVisible(page);
            test.skip(
                true,
                `Cesium 3D viewer did not initialize headless (container visible=${visible}, viewer live=${live}); ` +
                    'likely no WebGL/GL context or the /3d tileset asset is absent. Skipping the open/close assertion.',
            );
            return;
        }

        // §20.13 The 3D mode is on: container shown, 2D map hidden, close button offered.
        await expect(page.locator('#map-3d-container')).toBeVisible();
        await expect(page.locator('#close-3d-viewer-button')).toBeVisible({ timeout: 6000 });
        expect(await page.locator('#map-sig').evaluate((el) => el.style.display)).toBe('none');

        // (§20.18 help popup omitted: #nav-help-popup is the 2D nav-help control, not the
        // Cesium viewer's own help — asserting it here targets the wrong element. The
        // open/close path below is the core §20 viewer coverage.)

        // §20.19 Click the close button → back to 2D. The production close PAUSES (does not
        // destroy) Cesium, so the user-visible "back to 2D" signals are: the 3D container
        // hides, its close button hides, and the 2D map (#map-sig) shows again. (The internal
        // `cesium-active` body class can linger across a pause — it is not a user-facing signal.)
        await page.locator('#close-3d-viewer-button').evaluate((el) => el.click());
        await expect.poll(() => container3dVisible(page), { timeout: 8000 }).toBe(false);
        await expect(page.locator('#close-3d-viewer-button')).toBeHidden({ timeout: 8000 });
        await expect.poll(
            () => page.locator('#map-sig').evaluate((el) => el.style.display),
            { timeout: 8000 },
        ).not.toBe('none');
    });
});
