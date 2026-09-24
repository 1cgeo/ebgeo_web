// Path: e2e-ui/medicao-salvar-por-papel.repro.spec.js

/**
 * @fileoverview "Salvar como feição" da régua segue a regra da casa para afordância negada: o
 * POSTO some (`.claude/rules/architecture.md`, §UI Architecture).
 *
 * HIPÓTESE da campanha de cobertura (2026-09-24), lida no código: o painel de resultado de Medir
 * Distância e de Medir Área só escondia o botão com o mapa travado (`isCurrentMapLockedSync`);
 * o papel não era perguntado. Um Leitor medindo num atlas de servidor via "Salvar como feição",
 * clicava, e só a guarda do store recusava a escrita.
 *
 * A régua em si continua para o Leitor (medir não escreve nada); o que some é o comando de
 * salvar. O CONTROLE é o Editor na mesma cena, que vê o botão.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });
collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

/** Mede uma distância e devolve quantos botões "Salvar como feição" o painel desenhou. */
async function medirEContarSalvar(page) {
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
    await page.waitForFunction(() => !globalThis.__ebgeoMap.isMoving());
    await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
    await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="measureDistance"]').click();
    await esperarFerramentaPronta(page, 'measureDistance');
    await clicarNoMapaUI(page, [-43.21, -22.9]);
    await clicarNoMapaUI(page, [-43.19, -22.9], { button: 'right' });
    await expect(page.locator('.measurement-results-panel__total')).toBeVisible({ timeout: 10000 });
    return page.locator('.measurement-results-panel__save-btn').count();
}

collabTest('o Leitor mede, mas não vê "Salvar como feição"; o Editor vê', async ({ collab }) => {
    collabTest.setTimeout(180000);
    // CONTROLE: o dono (autor) mede e vê o botão.
    expect(await medirEContarSalvar(collab.author)).toBe(1);
    // O Leitor mede (a régua não escreve) e o comando de salvar não é desenhado.
    expect(await medirEContarSalvar(collab.peers[0])).toBe(0);
});
