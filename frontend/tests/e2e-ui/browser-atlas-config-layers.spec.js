// Path: e2e-ui/browser-atlas-config-layers.spec.js

/**
 * @fileoverview Atlas config — Dados/Análise restriction gates the CATALOG cross-client.
 *
 * A Gestor restricts a DATA layer in the atlas-settings modal; the backend broadcasts
 * `atlas_settings_updated`, every connected client re-applies the per-atlas overlay (which FILTERS
 * the backend-served `config.dataLayers.layers`), and the catalog (which reads that) no longer
 * lists the restricted layer. Proves the per-atlas overlay reaches the catalog on a PEER, and that
 * the catalog content comes from the backend (the seeded `resources` layers, served via /api/config).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** The catalog's data-/analysis-layer item ids (from the backend-served config). */
const catalogLayerIds = (page) => page.evaluate(async () => {
    const { CatalogService } = await import('/src/js/catalog/catalog.service.js');
    const items = await CatalogService.getAllItems();
    return items.filter((i) => i.id.startsWith('data-') || i.id.startsWith('analysis-')).map((i) => i.id);
});

describeOrSkip('Atlas config — Dados/Análise restriction gates the catalog', () => {
    test('restricting a data layer hides it from a peer catalog (others stay)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // The seeded data/analysis layers (backend `resources`) are in B's catalog to begin with.
            const before = await catalogLayerIds(B);
            expect(before).toContain('data-rodovias-federais');
            expect(before).toContain('data-limites-municipais');
            expect(before).toContain('analysis-declividade');

            // Owner restricts the "Rodovias Federais" data layer via the atlas-config "Catálogo" section.
            //
            // TRÊS coisas mudaram aqui em 2026-08-16 (7ac710cc), e as três são de gesto, não de
            // propriedade. (1) O modal deixou de ser alcançado pelo menu da conta: "Configurar atlas"
            // e o modal do exagero viraram UMA tela só, e o único caminho até ela é o botão
            // "Configurações" da aba Mapas (`.sidebar-settings-btn` → `showAtlasSettingsModal`);
            // `account-settings-btn` não existe mais em `src/`. (2) As abas viraram navegação
            // lateral, então `[data-tab="catalogo"]` deu lugar a `atlas-settings-nav-catalogo`.
            // (3) A classe do contêiner `.atlas-config--tabbed` sumiu; esperar pelo item de
            // navegação prova a mesma coisa que ela provava, que o corpo passou do "Carregando…".
            //
            // A propriedade sob teste é a de sempre: um Gestor restringe uma camada de dados e o
            // catálogo do PAR deixa de listá-la, com as outras intactas.
            await owner.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
            await owner.locator('.sidebar-settings-btn').click();
            const navCatalogo = owner.locator('[data-testid="atlas-settings-nav-catalogo"]');
            await expect(navCatalogo).toBeVisible({ timeout: 10000 });
            await navCatalogo.click();
            const card = owner.locator('[data-catalog-id="rodovias-federais"]');
            await expect(card).toBeVisible({ timeout: 5000 });
            // The card's toggle input is visually hidden (0-size) — flip it + fire change so onToggle runs.
            await card.locator('input[type="checkbox"]').evaluate((el) => {
                el.checked = false;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await owner.locator('[data-testid="atlas-settings-save"]').click();

            // The peer re-applies the overlay; the restricted layer leaves the catalog, the rest stay.
            await expect.poll(() => catalogLayerIds(B), { timeout: 15000 })
                .not.toContain('data-rodovias-federais');
            const after = await catalogLayerIds(B);
            expect(after).toContain('data-limites-municipais');
            expect(after).toContain('analysis-declividade');
        } finally {
            await owner.context().close();
            await B.context().close();
        }
    });
});
