// Path: e2e-ui/_captura-d8-recuperacao.spec.js

/**
 * @fileoverview CAPTURA da tela de recuperação com o comando de apagar a cópia antiga
 * (decisão D8 de 2026-09-13). NÃO É GUARDA DE REGRESSÃO: é o laço aprovado de verificação de
 * UI, uma captura dirigindo app e backend reais para ser LIDA como imagem.
 *
 * ESTE ARQUIVO FICOU PARA O COORDENADOR RODAR. A porta 3912 estava ocupada na sessão que o
 * escreveu, então ele nunca foi executado aqui, e nenhuma afirmação sobre o que as imagens
 * mostram foi feita. Rode com `npm run test:e2e:ui -- _captura-d8-recuperacao`, de dentro de
 * `frontend/`, LEIA as três imagens em `test-results/` e APAGUE este arquivo depois.
 *
 * As três imagens, na ordem em que o caso as tira:
 *   1. o comando desenhado e disponível, depois de uma atualização que terminou bem;
 *   2. a confirmação, que NOMEIA quantos registros vão sair do disco;
 *   3. a recusa por ESTADO: uma janela antiga gravou depois da atualização, o comando continua
 *      desenhado, o clique é recusado e a frase nomeia o estado.
 *
 * O terceiro passo é o que mais vale olhar, porque é onde a regra da casa se mede de fato: o
 * comando bloqueado por estado usa `aria-disabled` e NUNCA a propriedade `disabled`, e é por
 * isso que o clique aqui é `dispatchEvent` (o `click()` do Playwright espera o alvo ficar
 * "enabled" e trata `aria-disabled` como desabilitado, medido em 2026-09-02).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { buildLegacyEntries, LEGACY_STORE_IDS, loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
test.describe.configure({ retries: 0 });

/** Caminho servido como documento vazio da MESMA origem, para semear com o app não bootado. */
const BLANK_PATH = '/__seed-d8__';

/**
 * @param {import('@playwright/test').Page} page - Página nova.
 * @returns {Promise<void>}
 */
async function goToBlankSameOrigin(page) {
    await page.route(`**${BLANK_PATH}`, route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>seed d8</title>',
    }));
    await page.goto(BLANK_PATH);
}

/**
 * Escreve, dentro do navegador, a instalação que um usuário da versão anterior tem no disco.
 * @param {import('@playwright/test').Page} page - Página em branco da origem do app.
 * @param {Object<string, Object<string, *>>} entries - Saída de `buildLegacyEntries`.
 * @param {string[]} storeIds - Os `StoreName` que a versão anterior cria.
 * @returns {Promise<number>} Quantos registros foram semeados.
 */
function seedLegacyInstall(page, entries, storeIds) {
    return page.evaluate(async ({ entries: porStore, storeIds: ids }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const legado = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);
        let total = 0;
        for (const id of ids) {
            const store = ns.getStoreFor(id, legado);
            for (const [chave, valor] of Object.entries(porStore[id] ?? {})) {
                const gravar = id === 'images'
                    ? new Blob([new Uint8Array(valor)], { type: 'image/png' })
                    : valor;
                await store.setItem(chave, gravar);
            }
            total += await store.length();
        }
        return total;
    }, { entries, storeIds });
}

/**
 * Abre a tela de recuperação por cima do app já bootado.
 * @param {import('@playwright/test').Page} page - Página com o app de pé.
 * @returns {Promise<void>}
 */
function openRecoveryScreen(page) {
    return page.evaluate(async () => {
        const ui = await import('/src/js/ui/migration-recovery.js');
        ui.showMigrationRecovery({});
    });
}

describeOrSkip('Captura: apagar a cópia antiga na tela de recuperação', () => {
    test('o comando, a confirmação com o tamanho e a recusa por estado', async ({ browser }, testInfo) => {
        test.setTimeout(120000);
        const fixture = await loadEbgeoFixture('02-minimo.ebgeo');
        const entries = buildLegacyEntries(fixture, {
            imageValue: bytes => Array.from(bytes),
            now: 1755000000000,
        });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
            await goToBlankSameOrigin(page);
            const semeados = await seedLegacyInstall(page, entries, LEGACY_STORE_IDS);
            // A instalação semeada é o SUJEITO: vinda vazia, as três imagens seriam de outra coisa.
            expect(semeados).toBeGreaterThan(0);

            await page.goto('/');
            await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), { timeout: 60000 });

            await openRecoveryScreen(page);
            const comando = page.getByTestId('drop-legacy-source');
            await expect(comando).toBeVisible();
            await expect(comando).toHaveAttribute('aria-disabled', 'false');
            await page.screenshot({ path: testInfo.outputPath('d8-1-comando.png'), fullPage: true });

            await comando.dispatchEvent('click');
            const confirmacao = page.getByTestId('drop-legacy-source-confirm');
            await expect(confirmacao).toBeVisible();
            await expect(page.locator('.ebgeo-unavailable__msg')).toContainText('registro');
            await expect(page.locator('.ebgeo-unavailable__msg')).toContainText('não há como desfazer');
            await page.screenshot({ path: testInfo.outputPath('d8-2-confirmacao.png'), fullPage: true });

            await page.getByRole('button', { name: 'Manter a cópia antiga' }).dispatchEvent('click');
            await expect(confirmacao).toHaveCount(0);

            // Uma janela da versão anterior grava depois da atualização: estado reversível, o
            // comando continua desenhado e o clique recusa nomeando o estado.
            await page.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX))
                    .setItem('Depois da atualizacao', { features: { points: [] } });
            });
            await comando.dispatchEvent('click');
            await expect(page.locator('.ebgeo-unavailable__msg')).toContainText('Recupere essas alterações');
            await expect(comando).toHaveAttribute('aria-disabled', 'true');
            // A propriedade `disabled` NUNCA: é ela que impediria o clique de existir.
            expect(await comando.evaluate(el => el.disabled === true)).toBe(false);
            await page.screenshot({ path: testInfo.outputPath('d8-3-recusa.png'), fullPage: true });

            console.info('Capturas em', testInfo.outputDir);
        } finally {
            await ctx.close();
        }
    });
});
