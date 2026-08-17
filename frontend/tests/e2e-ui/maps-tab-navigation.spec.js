// Path: e2e-ui/maps-tab-navigation.spec.js

/**
 * §1.15-16,18 + §2.9 Maps-tab navigation — local (🟢) pure-UI interactions driven by
 * REAL clicks in real Chromium. No backend: maps live in the local IndexedDB store and
 * every effect is asserted against the REAL 2D MapLibre state (globalThis.__ebgeoMap)
 * and the REAL DOM (active-map dataset/class, displayed name, recent-map active flag).
 *
 * A second map is seeded locally through the app's own UI (the "Novo mapa" header
 * button → prompt → confirm), so two real map cards exist for the switch assertions.
 *
 * Covered:
 *   §1.15 click a Maps-tab card → the active-map indicator (data-selected, the
 *         "map-list-badge--selected" class and "Mapa atual" meta) moves to that card;
 *   §1.16 the current-map card name input + badge reflect the newly active map;
 *   §1.18 the restore-saved-position icon flies the camera to the stored center/zoom;
 *   §2.9  clicking a collapsed-sidebar recent-map shortcut switches the active map
 *         (its data-active flips on, the other map's flips off).
 *
 * The app boots from the Vite dev server; no login needed (these are local controls).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

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

/** Opens the Maps sidebar tab and waits for the current-map card to render. */
async function openMapsTab(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const nameInput = page.locator('.maps-tab #current-map-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    // The current-map name populates asynchronously after the tab mounts — wait so
    // callers reading it (to build card/shortcut selectors) don't race an empty value.
    await expect(nameInput).not.toHaveValue('', { timeout: 10000 });
}

/**
 * Seeds a second local map through the real UI (header "+" → prompt → confirm) and
 * returns its name. After creation the new map becomes the active map.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function seedSecondMap(page, name) {
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    // The new card lands in the list (selected, since createMap sets it current).
    await expect(
        page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`),
    ).toBeVisible({ timeout: 5000 });
}

const center = (page) => page.evaluate(() => {
    const c = globalThis.__ebgeoMap.getCenter();
    return { lng: c.lng, lat: c.lat };
});
const zoom = (page) => page.evaluate(() => globalThis.__ebgeoMap.getZoom());

describeOrSkip('§1.15-16,18 + §2.9 Maps-tab navigation (real browser, local UI)', () => {
    test('§1.15-16 clicking a map card switches the active map (indicator + name + badge update)', async ({ page }) => {
        await bootApp(page);
        await openMapsTab(page);

        // The boot map is the only card and starts selected; capture its name.
        const firstName = await page.locator('.maps-tab #current-map-name-input').inputValue();
        expect(firstName.trim().length).toBeGreaterThan(0);

        const secondName = 'E2E Mapa 2';
        await seedSecondMap(page, secondName);

        const firstCard = page.locator(`.maps-tab .map-list-item[data-map-name="${firstName}"]`);
        const secondCard = page.locator(`.maps-tab .map-list-item[data-map-name="${secondName}"]`);

        // After seeding, the second map is active: its card carries the selected state.
        await expect(secondCard).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
        await expect(secondCard.locator('.map-list-meta')).toHaveText('Mapa atual');
        await expect(secondCard.locator('.map-list-badge')).toHaveClass(/map-list-badge--selected/);
        await expect(page.locator('.maps-tab #current-map-name-input')).toHaveValue(secondName);

        // Click the FIRST card → the active-map indicator moves back to it.
        await firstCard.click();
        await expect(firstCard).toHaveAttribute('data-selected', 'true', { timeout: 5000 });
        await expect(secondCard).toHaveAttribute('data-selected', 'false', { timeout: 5000 });
        await expect(firstCard.locator('.map-list-meta')).toHaveText('Mapa atual');
        await expect(secondCard.locator('.map-list-meta')).toHaveText('');

        // §1.16 the current-map card reflects the freshly activated map.
        await expect(page.locator('.maps-tab #current-map-name-input')).toHaveValue(firstName);
        await expect(page.locator('.maps-tab #current-map-badge')).toHaveText(
            firstName.charAt(0).toUpperCase(),
        );
    });

    test('§2.9 clicking a recent-map shortcut switches the active map', async ({ page }) => {
        await bootApp(page);
        await openMapsTab(page);

        // The name input populates asynchronously after the tab opens — wait for it so
        // the recent-map shortcut selector isn't built from an empty name (race).
        const nameInput = page.locator('.maps-tab #current-map-name-input');
        await expect(nameInput).not.toHaveValue('', { timeout: 5000 });
        const firstName = (await nameInput.inputValue()).trim();
        const secondName = 'E2E Recent 2';
        await seedSecondMap(page, secondName);

        // The collapsed sidebar mirrors every map as a recent-map shortcut. The second
        // (just-created) map is the active one, so its shortcut is the active one.
        const firstShortcut = page.locator(`.recent-map-btn[data-map-name="${firstName}"]`);
        const secondShortcut = page.locator(`.recent-map-btn[data-map-name="${secondName}"]`);
        await expect(secondShortcut).toBeAttached({ timeout: 5000 });
        await expect(secondShortcut).toHaveAttribute('data-active', 'true', { timeout: 5000 });

        // Click the FIRST map's recent shortcut → it becomes active, the second drops.
        // Dispatch the real listener (the shortcut sits in the collapsed rail and can be
        // overlapped by the expanded panel, so um clique de verdade do Playwright reprovaria na
        // checagem de hit-target).
        //
        // A BUSCA E O CLIQUE PRECISAM ACONTECER NA MESMA TAREFA DA PÁGINA. `updateRecentMaps`
        // reconstrói a trilha inteira com `innerHTML = ''`, criando botões NOVOS, e o handler é
        // delegado no contêiner com a guarda `container.contains(button)`. Um botão resolvido pelo
        // Playwright (no Node) e clicado depois pode já estar DESTACADO quando o clique chega, e aí
        // a guarda o descarta em SILÊNCIO: nada acontece, `data-active` nunca vira "true" e o caso
        // reprova a 5 s apontando para a troca de mapa, que está certa. Medido em série: 5/8 com
        // `firstShortcut.evaluate(el => el.click())`, que resolvia num tique e clicava noutro.
        // Fazendo `querySelector` + `click()` dentro do MESMO `evaluate`, a reconstrução não tem
        // como se interpor, e a interleaving perdedora deixa de existir em vez de ficar rara.
        await page.evaluate((name) => {
            document.querySelector(`.recent-map-btn[data-map-name="${name}"]`)?.click();
        }, firstName);
        await expect(firstShortcut).toHaveAttribute('data-active', 'true', { timeout: 5000 });
        await expect(secondShortcut).not.toHaveAttribute('data-active', 'true', { timeout: 5000 });

        // The Maps tab refreshes too: the current-map card now names the first map.
        await expect(page.locator('.maps-tab #current-map-name-input')).toHaveValue(firstName);
    });

    test('§1.18 the restore-saved-position icon flies the camera to the stored center/zoom', async ({ page }) => {
        await bootApp(page);
        await openMapsTab(page);

        const mapName = (await page.locator('.maps-tab #current-map-name-input').inputValue()).trim();
        const card = page.locator(`.maps-tab .map-list-item[data-map-name="${mapName}"]`);

        // Move the camera to a deliberate spot, then save THAT position via the card's
        // context menu ("Salvar posição"). saveMapPosition stores the live camera.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 9 }));
        const saved = await center(page);
        const savedZoom = await zoom(page);

        await card.locator('.menu-btn').click();
        const saveItem = page.locator('.map-context-menu-item', { hasText: 'Salvar posição' });
        await expect(saveItem).toBeVisible({ timeout: 5000 });
        await saveItem.click();

        // The card now exposes the clickable restore-position indicator.
        const posIndicator = card.locator('[data-testid="map-position-indicator"]');
        await expect(posIndicator).toBeVisible({ timeout: 5000 });

        // Fly the camera far away so the restore produces a measurable delta.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [10, 50], zoom: 3 }));
        const moved = await center(page);
        expect(Math.abs(moved.lng - saved.lng)).toBeGreaterThan(5);
        expect(Math.abs(await zoom(page) - savedZoom)).toBeGreaterThan(2);

        // Click the restore icon → the camera jumps back to the saved center + zoom.
        await posIndicator.evaluate((el) => el.click());
        await expect
            .poll(() => center(page).then((c) => Math.abs(c.lng - saved.lng)), { timeout: 6000 })
            .toBeLessThan(0.5);
        await expect
            .poll(() => center(page).then((c) => Math.abs(c.lat - saved.lat)), { timeout: 6000 })
            .toBeLessThan(0.5);
        await expect
            .poll(() => zoom(page).then((z) => Math.abs(z - savedZoom)), { timeout: 6000 })
            .toBeLessThan(0.5);
    });
});
