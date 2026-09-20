// Path: e2e-ui/painel-de-pendencias-volta-com-a-rede.spec.js

/**
 * DUAS COISAS QUE SÓ O NAVEGADOR DE VERDADE RESPONDE sobre carregar código sob demanda, e sobre as
 * quais três telas do produto estão desenhadas: o painel de pendências
 * (`src/js/account/sync-status.control.js`), o cadastro (`src/js/modals/signup-launcher.js`) e toda
 * ferramenta carregada por `import()`.
 *
 * 1. A PREMISSA. Um `import()` cuja busca falha fica gravado como FALHO no mapa de módulos da
 *    página, e a tentativa seguinte do MESMO módulo é recusada sem tocar a rede. Medido em
 *    2026-09-20 no Chromium e no Firefox, por pedido abortado, por 404 e por rede desligada e
 *    religada. É por isso que nenhuma tela promete mais "tente de novo" (a saída é recarregar), e é
 *    por isso que o painel de pendências NÃO TENTA a carga sem conexão: uma tentativa offline
 *    tornaria falsa, pelo resto da vida da página, a promessa "será carregado quando a rede voltar".
 *    SE ESTE BLOCO FICAR VERMELHO, a notícia é boa: o navegador passou a permitir a nova tentativa
 *    (a especificação do HTML discute isso), e as frases de "atualize a página" podem afrouxar.
 *
 * 2. O CAMINHO POSITIVO. O painel é pré-carregado durante a abertura de um atlas de servidor
 *    (medido: o pedido sai cerca de dois segundos ANTES de a luz chegar a "online"), justamente para
 *    abrir SEM rede, que é quando a pessoa mais precisa dele. O dublê de `import()` do unitário não
 *    prova isso; aqui a rede é desligada de verdade e o clique tem de abrir o painel.
 *
 * O QUE ESTE ARQUIVO NÃO ENCENA, e por quê: "a rede cai ANTES de o painel estar carregado". Só
 * acontece se a própria abertura do atlas ocorrer com rede ruim, e a única forma de forçá-lo num
 * teste é fazer a busca falhar, o que envenena o módulo e mede a premissa 1, não o portão. O portão
 * (`semConexaoParaCarregar`) fica preso pelo unitário `tests/unit/sync-status-control.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const PAINEL = '/src/js/account/pendencias/pendencias-panel.js';

describeOrSkip('a premissa: um import() que falhou não pode ser tentado de novo na mesma página', () => {
    test.describe.configure({ retries: 0 });

    for (const modo of ['pedido abortado', 'resposta 404', 'rede desligada e religada']) {
        test(`falha por ${modo}; liberado o caminho, o MESMO módulo continua falhando sem ir à rede`, async ({ page, context }) => {
            // Visitante anônimo: o crachá de sincronização fica escondido e nada pré-carrega o painel,
            // então o módulo chega virgem a esta página. Com ele já carregado a sonda mediria nada, e
            // é o que a primeira asserção abaixo confere.
            await page.goto('/');
            await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });

            let pedidos = 0;
            page.on('request', (r) => { if (r.url().includes('pendencias-panel.js')) pedidos += 1; });
            const importar = (alvo) => page.evaluate(
                (a) => import(a).then(() => 'carregou', (e) => `falhou: ${e.name}`), alvo,
            );

            if (modo === 'rede desligada e religada') {
                await context.setOffline(true);
            } else {
                await page.route(`**${PAINEL}*`, (route) => (modo === 'pedido abortado'
                    ? route.abort('failed')
                    : route.fulfill({ status: 404, body: 'nao achei' })));
            }
            expect(await importar(PAINEL)).toBe('falhou: TypeError');
            expect(pedidos, 'o módulo já estava carregado: a sonda não mediria nada').toBe(1);

            if (modo === 'rede desligada e religada') await context.setOffline(false);
            else await page.unroute(`**${PAINEL}*`);

            // A PREMISSA: caminho livre, e mesmo assim nem um pedido novo sai.
            expect(await importar(PAINEL)).toBe('falhou: TypeError');
            expect(pedidos, 'o navegador voltou a tentar o mesmo módulo').toBe(1);

            // CONTROLE: o caminho está de fato livre, e o arquivo de fato carrega, por outro endereço.
            expect(await importar(`${PAINEL}?outra-tentativa=1`)).toBe('carregou');
            expect(pedidos).toBe(2);
        });
    }
});

describeOrSkip('o caminho positivo: o painel pré-carregado abre com a rede fora', () => {
    test.describe.configure({ retries: 0 });

    test('rede desligada depois de aberto o atlas: o clique abre o painel, sem aviso de falha', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 30000 });

        await page.context().setOffline(true);
        // O sinal é `navigator.onLine`, e não o crachá: `setOffline` do Playwright corta pedido novo
        // e deixa de pé o WebSocket já aberto, então a luz de conexão continua "online".
        await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 10000 }).toBe(false);

        // Trabalho que não consegue subir: é o momento em que a pessoa procura o painel.
        await drawPointUI(page, [-51.2, -30.03]);
        const comando = page.locator('[data-abre-pendencias="true"]');
        await expect(comando).toBeVisible({ timeout: 15000 });
        await comando.dispatchEvent('click');

        await expect(page.locator('[data-testid="pendencias-painel"]')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.toast', { hasText: 'painel de pendências' })).toHaveCount(0);
        await page.context().close();
    });
});
