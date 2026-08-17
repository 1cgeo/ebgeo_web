// Path: e2e-ui/static-modals.spec.js

/**
 * §24.1-2,8 Static modals — local (🟢) pure-UI modals driven by REAL clicks in real
 * Chromium. No backend: each modal is opened from its real trigger (sidebar chips for
 * the keyboard-shortcuts + info/about modals; the maps-tab "Configurações" button for
 * the settings modal), asserted visible, then closed via the close (X) button or the
 * Escape key. For settings, the terrain-exaggeration slider is moved with the keyboard
 * and the mirrored displayed value is asserted to update. The app boots from the Vite
 * dev server; no login needed (the chips + sidebar render on boot).
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

describeOrSkip('§24.1-2,8 Static modals (real browser, local pure-UI)', () => {
    test('§24.2 keyboard-shortcuts modal opens from its chip and closes via X', async ({ page }) => {
        await bootApp(page);

        const chip = page.locator('#chip-shortcuts');
        await expect(chip).toBeVisible({ timeout: 20000 });

        const overlay = page.locator('#shortcuts-modal-new-overlay');
        // The overlay is rendered hidden on boot (data-visible="false").
        await expect(overlay).toHaveAttribute('data-visible', 'false');

        await chip.click();
        await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
        await expect(overlay).toBeVisible();
        // Real content rendered: the shortcuts list with at least one key.
        await expect(overlay.locator('.shortcut-key').first()).toBeVisible();

        // Close via the X button.
        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });

    test('§24.2 keyboard-shortcuts modal closes via Escape', async ({ page }) => {
        await bootApp(page);

        const overlay = page.locator('#shortcuts-modal-new-overlay');
        await page.locator('#chip-shortcuts').click();
        await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });

    test('§24.1 info/about modal opens from its chip and closes via X then Escape', async ({ page }) => {
        await bootApp(page);

        const chip = page.locator('#chip-info');
        await expect(chip).toBeVisible({ timeout: 20000 });

        const overlay = page.locator('#info-modal-new-overlay');
        await expect(overlay).toHaveAttribute('data-visible', 'false');

        await chip.click();
        await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
        await expect(overlay).toBeVisible();
        // Real content rendered: the support-centers cards.
        await expect(overlay.locator('.cgeo-card').first()).toBeVisible();

        // Close via X.
        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });

        // Re-open and close via Escape.
        await chip.click();
        await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
        await page.keyboard.press('Escape');
        await expect(overlay).toHaveAttribute('data-visible', 'false', { timeout: 5000 });
    });

    test('§24.8 settings modal opens, the exaggeration slider updates the displayed value, and closes', async ({ page }) => {
        await bootApp(page);

        // Open the Maps tab in the sidebar to reveal the "Configurações" button.
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const settingsBtn = page.locator('.sidebar-settings-btn');
        await expect(settingsBtn).toBeVisible({ timeout: 10000 });

        await settingsBtn.click();

        // O modal exclusivo do exagero (`modals/settings.modal.js`) foi APAGADO em 2026-08-16
        // (7ac710cc) e fundido na tela única de configurações do atlas. Os três `data-testid` que
        // este caso usava não existem mais em `src/`. A propriedade continua a mesma, e é dela que o
        // caso vive: o controle de exagero abre, o número espelhado acompanha o slider, e o modal
        // fecha. Duas diferenças de forma valem o comentário: o overlay agora é
        // `atlas-settings-modal`, e o número espelhado virou um `<output>` (texto "1.5x"), não um
        // input, então lê-se por texto e não por `inputValue()`.
        const overlay = page.locator('[data-testid="atlas-settings-modal"]');
        await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
        await expect(overlay).toBeVisible();

        // O corpo é montado depois de um carregamento assíncrono: esperar pelo slider é o que
        // separa "o modal abriu" de "o modal terminou de se desenhar".
        const slider = page.locator('[data-testid="atlas-settings-exaggeration"]');
        const valueOutput = page.locator('[data-testid="atlas-settings-exaggeration-value"]');
        await expect(slider).toBeVisible({ timeout: 10000 });
        await expect(valueOutput).toBeVisible();

        // Move the slider with the keyboard (ArrowRight steps it up) and assert the
        // mirrored numeric display reflects the new, higher value.
        const before = parseFloat(await valueOutput.innerText());
        expect(Number.isFinite(before), 'o valor espelhado é um número').toBe(true);
        await slider.focus();
        await slider.press('ArrowRight');
        await slider.press('ArrowRight');
        await expect
            .poll(async () => parseFloat(await valueOutput.innerText()), { timeout: 5000 })
            .toBeGreaterThan(before);
        // The slider's own value moved in lockstep with the mirrored display.
        expect(parseFloat(await slider.inputValue())).toBe(
            parseFloat(await valueOutput.innerText()),
        );

        // Close via the X button. A tela de configurações do atlas é `destroyOnHide: true` (instância
        // nova a cada abertura), então fechar REMOVE o overlay do DOM em vez de deixá-lo em
        // `data-visible="false"`, que é o que o modal antigo, persistente, fazia. Asserir o atributo
        // aqui reprova por "element not found": vermelho verdadeiro, pela razão errada.
        await overlay.locator('.modal-close-btn').click();
        await expect(overlay).toHaveCount(0, { timeout: 5000 });
    });
});
