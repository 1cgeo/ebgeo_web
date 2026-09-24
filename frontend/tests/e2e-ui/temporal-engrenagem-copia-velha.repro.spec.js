// Path: e2e-ui/temporal-engrenagem-copia-velha.repro.spec.js

/**
 * @fileoverview A ENGRENAGEM DA LINHA DO TEMPO NAO DESFAZ O QUE O COLEGA SALVOU ENQUANTO ELA ESTAVA
 * ABERTA.
 *
 * A HIPOTESE. `TemporalSettingsModal.show` le a config UMA vez, e o Salvar grava o patch INTEIRO
 * (`resolverPatchDaConfig`: modo, unidade, inicio, fim e, no relativo, origem) com os valores
 * daquela leitura para todo campo que a pessoa nao tocou. Se o colega mudou a unidade enquanto a
 * engrenagem estava aberta, o Salvar de quem so' corrigiu o inicio devolve a unidade antiga, no
 * servidor e em todos.
 *
 * O GESTO, todo pela tela: o relogio da aba Mapas liga a linha do tempo nos dois; a engrenagem da
 * barra abre as configuracoes; unidade e inicio pelos campos do modal; Salvar.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test temporal-engrenagem-copia-velha --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const configNoServidor = (db, mapId) => db.raw.oneOrNone('SELECT temporal_config FROM maps WHERE id = $1', [mapId])
    .then((r) => r?.temporal_config ?? null);

const configNoDisco = (page, mapName) => page.evaluate(async (mn) => {
    const store = await import('/src/js/store/index.js');
    return store.getMapTemporalConfig(mn);
}, mapName);

async function ligarLinhaDoTempoUI(page) {
    if (!(await page.locator('#current-map-temporal-btn').isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    const relogio = page.locator('#current-map-temporal-btn');
    await expect(relogio).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.maps-tab #current-map-name-input')).not.toHaveValue('', { timeout: 15000 });
    await relogio.click();
    await expect(relogio).toHaveAttribute('data-temporal', 'true', { timeout: 15000 });
    await expect(page.locator('.temporal-bar__settings')).toBeVisible({ timeout: 10000 });
}

async function abrirEngrenagemUI(page) {
    await page.locator('.temporal-bar__settings').click();
    await expect(page.locator('.temporal-settings-container')).toBeVisible({ timeout: 10000 });
}

const salvarUI = (page) => page.locator('.temporal-settings-btn--save', { hasText: 'Salvar' }).click();
const unidadeUI = (page) => page.locator('.temporal-settings-container .temporal-settings__select').nth(1);
const inicioUI = (page) => page.locator('.temporal-settings-container .temporal-settings__datetime').first();

collabTest.describe('Engrenagem temporal aberta e a edicao do colega', () => {
    collabTest('A corrige so o inicio depois que B mudou a unidade: a unidade de B fica', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        const B = collab.peers[0];
        await ligarLinhaDoTempoUI(A);
        await ligarLinhaDoTempoUI(B);

        // A abre a engrenagem e a deixa aberta.
        await abrirEngrenagemUI(A);
        const unidadeInicial = await unidadeUI(A).inputValue();

        // B troca a unidade e salva.
        const outraUnidade = unidadeInicial === 'SEMANA' ? 'HORA' : 'SEMANA';
        await abrirEngrenagemUI(B);
        await unidadeUI(B).selectOption(outraUnidade);
        await salvarUI(B);
        await expect(B.locator('.temporal-settings-container')).toHaveCount(0, { timeout: 10000 });
        await expect.poll(async () => (await configNoServidor(collab.db, collab.mapId))?.unidade, { timeout: 20000 }).toBe(outraUnidade);
        await expect.poll(async () => (await configNoDisco(A, collab.mapName))?.unidade, { timeout: 20000 }).toBe(outraUnidade);

        // A, com a engrenagem aberta desde antes, corrige SO o inicio.
        await inicioUI(A).fill('2026-01-02T08:00');
        await salvarUI(A);
        await expect(A.locator('.temporal-settings-container')).toHaveCount(0, { timeout: 10000 });
        await expect.poll(async () => (await configNoServidor(collab.db, collab.mapId))?.inicio, { timeout: 20000 })
            .toBe(new Date(2026, 0, 2, 8, 0).getTime());

        const retrato = { servidor: await configNoServidor(collab.db, collab.mapId), A: await configNoDisco(A, collab.mapName) };
        console.log(`\n===== RETRATO =====\n${JSON.stringify({ unidadeInicial, outraUnidade, ...retrato }, null, 2)}\n`);
        expect.soft(retrato.servidor?.unidade, 'a unidade de B continua no servidor').toBe(outraUnidade);
        expect.soft(retrato.A?.unidade, 'a unidade de B continua no disco de A').toBe(outraUnidade);
        await expect.poll(async () => (await configNoDisco(B, collab.mapName))?.inicio, { timeout: 20000 })
            .toBe(new Date(2026, 0, 2, 8, 0).getTime());
        expect.soft((await configNoDisco(B, collab.mapName))?.unidade, 'a unidade continua a de B no disco de B').toBe(outraUnidade);
    });
});
