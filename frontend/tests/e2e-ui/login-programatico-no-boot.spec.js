// Path: e2e-ui/login-programatico-no-boot.spec.js

/**
 * @fileoverview O LOGIN PROGRAMÁTICO NUMA PÁGINA QUE AINDA BOOTA, com a interleaving perdedora
 * tornada DETERMINÍSTICA. É a guarda das duas portas de `helpers/cliente-de-teste.js`.
 *
 * O DEFEITO. `ApiClient.login()` grava a sessão (`ebgeo_auth`) pelo único escritor dela,
 * `_persistTokens`, e o boot do mapa lê essa chave na Fase -1 (`hasStoredTokens`, e
 * `location.replace('./atlas.html')` numa URL nua) e na Fase 2.5 (`loadStoredTokens`). Um teste
 * que logava dentro de `page.evaluate` numa página `/` ainda bootando era sequestrado para
 * `atlas.html` quando a gravação chegava antes da Fase -1: medido em 2026-09-23, 10 de 10 no
 * Firefox, 1 de 10 no Chromium. Estatística de navegador não converge, então este arquivo não
 * mede taxa: ele SEGURA o boot antes da Fase -1 e solta depois da gravação.
 *
 * O INSTRUMENTO. O portão de migração (`runLegacyUpgradeGate`) é a primeira espera do boot, antes
 * da Fase -1, e toma a trava `TRANSITION_LOCK` (lida da fonte, abaixo). Uma página IRMÃ do mesmo
 * contexto segura essa trava, o boot da página sob teste fica parado nela, e a irmã confirma pelo
 * `navigator.locks.query()` que o pedido do boot está PENDENTE antes de o caso seguir. Sem essa
 * confirmação, "o boot estava parado" seria uma suposição.
 *
 * OS TRÊS CASOS:
 *   (i)   CONTROLE DO INSTRUMENTO: a forma crua (`new ApiClient()` + `login()`) com o boot parado
 *         leva a página para `atlas.html` quando a trava sai. Sem ele, os outros dois poderiam
 *         passar porque a trava não segurava nada. É a exceção declarada do censo
 *         `tests/unit/login-programatico-so-pelo-helper.test.js`.
 *   (ii)  `clienteNaPagina` na mesma janela: a página continua em `/` depois de a trava sair e o
 *         boot terminar, o global do teste continua vivo, a chave nunca foi escrita (testemunha
 *         no `Storage.prototype.setItem`, instalada antes do primeiro script) e o cliente fala
 *         com o servidor como a conta.
 *   (iii) `sessaoDoApp`: o app chega LOGADO ao destino pedido (`?atlas=`), com a sessão no disco
 *         ANTES de o boot do destino passar do portão. O login dele acontece em `atlas.html`, que
 *         também para no portão enquanto a trava está segura, e isso não o atrasa: o login não
 *         depende do boot da página, só da origem dela.
 *
 * `retries: 0`: um caso que só passa na segunda tentativa é um caso não verificado. Roda nos dois
 * navegadores (`--project=firefox` para o segundo).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { abrirPaginaDeProtocolo, clienteNaPagina, sessaoDoApp } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const RAIZ_DO_PACOTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * O nome da trava do portão, LIDO DA FONTE: se o produto a renomear, este arquivo reprova aqui,
 * e não com um boot que nunca parou.
 * @returns {string}
 */
function nomeDaTravaDoPortao() {
    const arquivo = path.join(RAIZ_DO_PACOTE, 'src/js/store/migration/transition-state.js');
    const achado = readFileSync(arquivo, 'utf8').match(/export const TRANSITION_LOCK = '([^']+)';/);
    if (!achado) throw new Error(`TRANSITION_LOCK não está mais declarado em ${arquivo}`);
    return achado[1];
}

const TRAVA = nomeDaTravaDoPortao();

/**
 * A testemunha da sessão: toda escrita de `ebgeo_auth` no documento, desde ANTES do primeiro
 * script da página. É o caminho independente da leitura final da chave, que só diria o estado do
 * fim e não o que aconteceu no meio.
 * @param {import('@playwright/test').Page} page
 */
async function instalarTestemunhaDaSessao(page) {
    await page.addInitScript(() => {
        const escritas = [];
        Object.defineProperty(window, '__escritasDaSessao', { value: escritas });
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItemComTestemunha(chave, valor) {
            if (chave === 'ebgeo_auth') escritas.push(Date.now());
            return original.call(this, chave, valor);
        };
    });
}

/**
 * Segura a trava do portão numa página IRMÃ do mesmo contexto (a trava é por origem, e as páginas
 * de um contexto dividem a origem). A irmã fica na página de protocolo, onde nada boota.
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<{esperarBootParado: () => Promise<void>, soltar: () => Promise<void>}>}
 */
async function segurarTravaDoPortao(context) {
    const irma = await context.newPage();
    await abrirPaginaDeProtocolo(irma);
    await irma.evaluate((nome) => new Promise((segurando) => {
        navigator.locks.request(nome, () => new Promise((soltar) => {
            window.__soltarTravaDoPortao = soltar;
            segurando();
        }));
    }), TRAVA);
    return {
        async esperarBootParado() {
            await expect.poll(() => irma.evaluate(async (nome) => {
                const { pending } = await navigator.locks.query();
                return pending.some((pedido) => pedido.name === nome);
            }, TRAVA), {
                timeout: 30000,
                message: `o boot do mapa não chegou a pedir a trava "${TRAVA}": o instrumento não segura nada`,
            }).toBe(true);
        },
        async soltar() {
            await irma.evaluate(() => window.__soltarTravaDoPortao());
            await irma.close();
        },
    };
}

/**
 * Espera o fim do roteamento do boot NO MAPA, e reprova NA HORA, nomeando o destino, se a página
 * sair de `/` antes disso. O fim é a cortina saindo do DOM, no `finally` da cadeia, DEPOIS de
 * `openAtlasChooserOnBoot`, que é o segundo ponto em que uma sessão gravada navegaria; o mapa
 * (`__ebgeoMap`, Fase 3) é exigido junto porque ele só existe depois da Fase 2.5. Sem a corrida
 * contra a navegação, o sequestro apareceria como um tempo esgotado sem nome.
 * @param {import('@playwright/test').Page} page
 */
async function esperarBootTerminarNoMapa(page) {
    const saida = page.waitForURL((url) => url.pathname !== '/', { timeout: 0 })
        .then(() => page.url(), () => null);
    const pronto = page.waitForFunction(
        () => Boolean(globalThis.__ebgeoMap) && !document.querySelector('.loading-background'),
        null,
        { timeout: 60000 },
    ).then(() => null);
    const saiuPara = await Promise.race([saida, pronto]);
    expect(saiuPara, `a página saiu do mapa durante o boot, para ${saiuPara}`).toBeNull();
}

describeOrSkip('login programático numa página que ainda boota', () => {
    test.describe.configure({ retries: 0 });

    test('(i) controle do instrumento: a forma crua, com o boot parado, leva a página para atlas.html', async ({ browser }) => {
        const conta = await createVerifiedUser({ prefix: 'bootcru', nome: 'Login cru no boot' });
        const ctx = await browser.newContext();
        try {
            const page = await ctx.newPage();
            await instalarTestemunhaDaSessao(page);
            const trava = await segurarTravaDoPortao(ctx);
            await page.goto('/');
            await trava.esperarBootParado();

            // A FORMA QUE O CENSO PROÍBE, e aqui ela é o sujeito.
            await page.evaluate(async ({ base, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: base });
                await api.login(u.username, u.password);
            }, { base: `${state.baseUrl}/api/v1`, u: { username: conta.username, password: conta.password } });
            // CONTROLE DA TESTEMUNHA: a escrita existiu e foi vista. Sem isto, o zero do caso (ii)
            // poderia ser uma testemunha que não enxerga nada.
            expect(await page.evaluate(() => window.__escritasDaSessao.length)).toBeGreaterThan(0);
            expect(new URL(page.url()).pathname, 'o boot andou antes de a trava sair').toBe('/');

            await trava.soltar();
            await page.waitForURL('**/atlas.html', { timeout: 60000 });
        } finally {
            await ctx.close();
        }
    });

    test('(ii) clienteNaPagina: a página fica no mapa, o global vive e a sessão não é escrita', async ({ browser }) => {
        const conta = await createVerifiedUser({ prefix: 'bootcli', nome: 'Cliente no boot' });
        const ctx = await browser.newContext();
        try {
            const page = await ctx.newPage();
            await instalarTestemunhaDaSessao(page);
            const trava = await segurarTravaDoPortao(ctx);
            await page.goto('/');
            await trava.esperarBootParado();

            await page.evaluate(() => { window.__marcaDoTeste = 'viva'; });
            const api = await clienteNaPagina(page, conta);
            await trava.soltar();
            await esperarBootTerminarNoMapa(page);

            expect(new URL(page.url()).pathname, 'a página foi levada para fora do mapa').toBe('/');
            const leitura = await page.evaluate(async ({ cliente }) => ({
                marca: window.__marcaDoTeste ?? null,
                escritas: window.__escritasDaSessao.length,
                chave: localStorage.getItem('ebgeo_auth'),
                quem: (await cliente.getMe())?.username ?? null,
            }), { cliente: api });
            expect(leitura).toEqual({ marca: 'viva', escritas: 0, chave: null, quem: conta.username });
        } finally {
            await ctx.close();
        }
    });

    test('(iii) sessaoDoApp: o app chega logado ao destino pedido', async ({ browser }) => {
        const conta = await createVerifiedUser({ prefix: 'bootses', nome: 'Sessão do app' });
        const ctx = await browser.newContext();
        try {
            const page = await ctx.newPage();
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            // O atlas do destino nasce pelo cliente de transporte, que não grava sessão.
            await page.goto('/atlas.html');
            const atlasId = await page.evaluate(
                async ({ api }) => (await api.createAtlas({ name: 'Destino da sessão' })).id,
                { api: await clienteNaPagina(page, conta) },
            );
            expect(await page.evaluate(() => localStorage.getItem('ebgeo_auth'))).toBeNull();

            const trava = await segurarTravaDoPortao(ctx);
            const destino = `/?atlas=${atlasId}`;
            await sessaoDoApp(page, conta, destino);
            await trava.esperarBootParado();
            // A SESSÃO JÁ ESTÁ NO DISCO com o boot do destino parado antes da Fase -1: não há
            // janela em que ela possa chegar no meio dele.
            expect(await page.evaluate(() => localStorage.getItem('ebgeo_auth'))).not.toBeNull();

            await trava.soltar();
            await expect(page.locator('[data-testid="sync-status-badge"]'))
                .toHaveAttribute('data-state', 'online', { timeout: 60000 });
            const url = new URL(page.url());
            expect(url.pathname).toBe('/');
            expect(url.searchParams.get('atlas')).toBe(atlasId);
        } finally {
            await ctx.close();
        }
    });
});
