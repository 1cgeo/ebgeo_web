// Path: e2e-ui/_captura-b9-indicadores.spec.js

/**
 * CAPTURA das DUAS superfícies visuais do bloco B9, para leitura da imagem.
 *
 * ELE NÃO ASSERE APARÊNCIA, e é por isso que o nome começa com `_`: o laço aprovado para UI é
 * dirigir o app e o backend reais com o Playwright e depois LER a imagem produzida, e é isso que
 * este arquivo entrega. As propriedades de lógica já estão presas em node
 * (`sync-status-pendencias`, `sync-status-control`, `pendencias-leitor-unico`, `resumo-frases`,
 * `diag-sonda`); o que só se vê na imagem é se o crachá cabe na barra com os rótulos novos e se a
 * segunda fonte do cartão de indisponibilidade se lê como segunda fonte e não como repetição.
 *
 * ELE É TEMPORÁRIO por contrato: quem rodar e ler as imagens APAGA este arquivo. A convenção da
 * casa é que o spec de captura não sobrevive à leitura, senão a suíte acumula casos que ninguém
 * olha e que só custam tempo de rodada.
 *
 * O QUE ELE PÕE NA TELA, e como, sem fabricar estado:
 *
 *   1. o crachá VERDE, num atlas de servidor recém-aberto e com a fila vazia;
 *   2. o crachá em `upload-pendente`, criado pela porta REAL (`enfileirarBlob`, o mesmo ajudante
 *      que o produto chama ao colar uma figura) com a rede do contexto desligada, de modo que a
 *      pendência é a mesma que um upload interrompido deixa. Nada é escrito à mão no IndexedDB;
 *   3. o cartão 4 do Resumo na aba Diagnóstico, com a linha da SONDA no desfecho "sem sonda", que
 *      é o desfecho normal de uma instalação que não a agendou e o que mais importa ler: ele não
 *      pode se parecer com uma boa notícia.
 *
 * O QUE ELE NÃO ALCANÇA, declarado: `conflito` e `recusa` exigem, respectivamente, um logout com
 * quarentena preservada e uma operação que o servidor recuse, e os dois são cenários de outros
 * blocos (B3 e B5). Quem quiser vê-los na imagem terá de montá-los lá.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const CRACHA = '[data-testid="sync-status-badge"]';

describeOrSkip('B9: captura dos indicadores', () => {
    test.afterAll(async () => { await closeDb(); });

    test('o crachá de sync, verde e com upload pendente', async ({ browser }) => {
        const { atlasId, userA } = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, atlasId, userA);

        // 1. VERDE. A fila está vazia e a conexão de pé, que é o único caso que autoriza a frase.
        await expect(page.locator(CRACHA)).toHaveAttribute('data-work', 'enviado', { timeout: 30000 });
        await page.locator(CRACHA).screenshot({ path: 'test-results/b9-cracha-verde.png' });

        // 2. UPLOAD PENDENTE, pela porta real. A rede desligada é o que impede a tentativa de
        // terminar sozinha, e é o estado que um upload interrompido de verdade deixa.
        await page.context().setOffline(true);
        await page.evaluate(async (id) => {
            const { enfileirarBlob } = await import('/src/js/store/sync/blob-upload-queue.js');
            const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
            await enfileirarBlob({
                imageId: '11111111-1111-4111-8111-111111111111',
                blob: new Blob([bytes], { type: 'image/png' }),
                atlasId: id,
            });
        }, atlasId);
        await expect(page.locator(CRACHA))
            .toHaveAttribute('data-work', 'upload-pendente', { timeout: 30000 });
        await page.locator(CRACHA).screenshot({ path: 'test-results/b9-cracha-upload.png' });
        // A barra inteira também, porque o que se quer ler é se o rótulo novo cabe ao lado do
        // avatar sem empurrar o resto.
        await page.screenshot({ path: 'test-results/b9-barra-superior.png', clip: { x: 0, y: 0, width: 1280, height: 120 } });

        await page.context().setOffline(false);
        await page.context().close();
    });

    test('o cartão de indisponibilidade, com a segunda fonte', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'b9diag', nome: 'B9 Diag', role: 'admin' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-username"]').fill(admin.username);
        await page.locator('[data-testid="login-password"]').fill(admin.password);
        await page.locator('[data-testid="login-submit"]').click();
        await page.waitForURL('**/atlas.html', { timeout: 20000 });
        // A URL é a porta do painel (`?aba=`), como em `diag-defeitos.spec.js`: passar pelo mapa
        // para clicar no menu da conta custaria o boot do mapa inteiro por nada.
        await page.goto('/admin.html?aba=diagnostico');
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });

        const cartao = page.locator('[data-testid="admin-diag-resumo-corpo-indisponivel"]');
        await expect(cartao).toBeVisible({ timeout: 30000 });
        await expect(page.locator('[data-testid="admin-diag-resumo-sonda"]')).toBeVisible();
        await cartao.screenshot({ path: 'test-results/b9-cartao-indisponibilidade.png' });
        // E a grade inteira do resumo, para conferir que o cartão não ficou desproporcional em
        // relação aos outros quatro agora que carrega duas fontes.
        await page.locator('[data-testid="admin-diag-resumo-grade"]')
            .screenshot({ path: 'test-results/b9-resumo-grade.png' });
    });
});
