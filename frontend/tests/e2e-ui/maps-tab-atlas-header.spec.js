// Path: e2e-ui/maps-tab-atlas-header.spec.js

/**
 * @fileoverview The Maps tab redesigned BY STATE: the atlas header (name + origin chip) and the
 * three-state action grid.
 *
 * WHY THIS IS AN E2E SPEC AND NOT A UNIT TEST. Both subjects are decided from live singletons
 * (`sessionContext` for the session, `isRemoteStoreSync()` for the store origin, `syncEngine` for
 * the connected atlas), and `maps.tab.js` boots the whole store barrel on import. Stubbing that
 * would produce a test of the stubs. Here the states are REACHED, not simulated: anonymous, signed
 * in on a local atlas, and connected to a real server atlas.
 *
 * WHAT WOULD BREAK SILENTLY WITHOUT IT:
 *   - the visibility table (4 / 5 / 4 actions). It was six buttons in one state and four in
 *     another, grown by accretion; a new action added without a table row is invisible here;
 *   - "Limpar tudo" reappearing on a server atlas, where clearing would empty only THIS client's
 *     copy of a shared project;
 *   - the rename gate collapsing into a closed list of role names. A `write` collaborator must
 *     see the real atlas name READ-ONLY: the gate is the manage rung of the ladder, and the
 *     `perm === 'write' || perm === 'owner'` shape that drops `manage` shipped twice in this repo.
 *
 * The action row is asserted as the FULL visible list, never as "contains": an assertion that only
 * names what should be there passes just as green when a removed button comes back.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, loginUI, goToLocalMapUI, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Opens the Maps tab and waits for the atlas header to have resolved its origin. */
async function openMapsTab(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.maps-tab [data-testid="atlas-origin-chip"]')).not.toHaveText('', { timeout: 10000 });
}

/** The labels of the actions actually offered, in DOM order. */
function actionLabels(page) {
    return page.locator('.maps-tab .sidebar-actions-grid button:visible').allTextContents();
}

describeOrSkip('Maps tab — atlas header and the three-state action grid', () => {
    test('deslogado: 4 ações, chip Local, e o nome do atlas é editável', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await openMapsTab(page);

        expect(await actionLabels(page)).toEqual(['Abrir', 'Importar', 'Exportar', 'Limpar tudo']);
        await expect(page.locator('[data-testid="atlas-origin-chip"]')).toHaveText('Local');

        const nameInput = page.locator('[data-testid="atlas-name-input"]');
        await expect(nameInput).not.toHaveValue('');
        await expect(nameInput).toHaveJSProperty('readOnly', false);

        // Renaming through the header field is the ONLY rename affordance for a local atlas, and
        // it must survive a reload: the registry is the source of truth for the name, not the DOM.
        await nameInput.fill('Operação Serra');
        await nameInput.press('Enter');
        await expect(nameInput).toHaveValue('Operação Serra');

        // ESPERE A GRAVAÇÃO ANTES DE RECARREGAR, e não pelo valor do input, que mostra o que foi
        // DIGITADO e valeria o mesmo com a persistência quebrada. `Enter` só chama `blur`, e o
        // commit é assíncrono (`renameLocalAtlas` grava o registro e só então atualiza a memória),
        // então um `reload()` logo em seguida corre contra a escrita: medido, este caso reprovava
        // de forma intermitente exatamente aqui, lendo "Meu Atlas" depois do F5.
        //
        // O toast é o sinal certo porque é estritamente POSTERIOR ao `await renameLocalAtlas(...)`,
        // isto é, ao `await persistRegistryEntry(...)` lá dentro. Esperar por ele é esperar pelo
        // disco, sem `waitForTimeout` e sem ler estado por `import()` (que no dev server pode
        // devolver outra instância do módulo).
        await expect(page.locator('.toast', { hasText: 'Atlas renomeado' }))
            .toBeVisible({ timeout: 10000 });

        await page.reload();
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await openMapsTab(page);
        await expect(page.locator('[data-testid="atlas-name-input"]')).toHaveValue('Operação Serra');
    });

    test('"Limpar tudo" nomeia o atlas e diz que os outros não são afetados', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await openMapsTab(page);

        const atlasName = await page.locator('[data-testid="atlas-name-input"]').inputValue();
        await page.locator('#maps-action-clear').click();

        const dialog = page.locator('.confirm-modal-container').first();
        await expect(dialog).toBeVisible({ timeout: 5000 });
        // The old copy said "TODO o projeto", from when local and remote shared one set of
        // databases. With several named local atlases that reads as "everything on this machine",
        // while `clearAllDataStore` only ever empties the MOUNTED atlas.
        await expect(dialog).toContainText(atlasName);
        await expect(dialog).toContainText('outros atlas não são afetados');
    });

    test('logado no local: 5 ações; conectado ao servidor: 5, com "Compartilhar" e sem "Limpar tudo"', async ({ browser, page }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await loginUI(page, seed.userA.username, seed.userA.password);
        await goToLocalMapUI(page);
        await openMapsTab(page);

        // Signed in but still LOCAL: "Enviar ao servidor" appears (there is somewhere to send to)
        // and "Limpar tudo" STAYS — it used to vanish the moment you signed in, stranding a
        // signed-in user working locally with no way to wipe their own workspace.
        expect(await actionLabels(page)).toEqual([
            'Abrir', 'Enviar ao servidor', 'Importar', 'Exportar', 'Limpar tudo'
        ]);
        await expect(page.locator('[data-testid="atlas-origin-chip"]')).toHaveText('Local');

        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        await openMapsTab(owner);
        // "Compartilhar" entrou NESTA linha em 2026-08-16 (7ac710cc): antes ele morava no cabeçalho
        // do atlas, e a linha remota tinha três botões. O estado remoto é o único que o oferece, e a
        // tela deliberadamente NÃO o esconde por papel (quem não tem `manage` é recusado pelo
        // backend), então ele aparece também para o colaborador `write` logo abaixo.
        // "Salvar como local" entrou NESTA linha depois, e é o SIMÉTRICO de "Enviar ao servidor":
        // cada estado oferece a travessia que falta. A ordem vem da tabela por estado em
        // `maps.tab.js`, não da ordem em que os botões foram criados.
        expect(await actionLabels(owner)).toEqual(['Abrir', 'Importar', 'Exportar', 'Salvar como local', 'Compartilhar']);
        await expect(owner.locator('[data-testid="atlas-origin-chip"]')).toHaveText('Servidor');

        // The owner reaches the manage rung, so the field is writable and the rename goes to the
        // SERVER (asserted below by a second client reading it back, not by the input's own value).
        const ownerName = owner.locator('[data-testid="atlas-name-input"]');
        await expect(ownerName).toHaveValue('Atlas Colaborativo');
        await expect(ownerName).toHaveJSProperty('readOnly', false);
        await ownerName.fill('Atlas Renomeado');
        await ownerName.press('Enter');
        await expect(ownerName).toHaveValue('Atlas Renomeado');

        // A `write` collaborator sits BELOW manage: same name, read-only. Not hidden — hiding it
        // would take away the one place that says which atlas they are in.
        const collaborator = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        await openMapsTab(collaborator);
        const collaboratorName = collaborator.locator('[data-testid="atlas-name-input"]');
        await expect(collaboratorName).toHaveValue('Atlas Renomeado');
        await expect(collaboratorName).toHaveJSProperty('readOnly', true);

        await owner.context().close();
        await collaborator.context().close();
    });
});
