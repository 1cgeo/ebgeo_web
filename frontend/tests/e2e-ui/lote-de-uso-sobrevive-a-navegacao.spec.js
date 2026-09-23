// Path: e2e-ui/lote-de-uso-sobrevive-a-navegacao.spec.js

/**
 * O LOTE DE USO DO `pagehide` SOBREVIVE À NAVEGAÇÃO DE QUEM ESTÁ LOGADO, e a contagem é por SQL.
 *
 * O DEFEITO (medido em 2026-09-23 nos dois navegadores). As quatro páginas instalam a telemetria
 * antes de restaurar a sessão, então a página nova de quem está logado começa com identidade
 * `null`. O primeiro lote dela passava por `coletar()`, que APAGAVA todo lote guardado de outra
 * identidade, e o lote que a página anterior escreveu no `pagehide` é da conta. Quando ele não
 * chegava na primeira tentativa, sumia: 0 de 3 depois de 40 s, contra 3 de 3 do anônimo, cuja
 * identidade é `null` nas duas páginas. E cada navegação logada mandava `falhasColeta = 2` no
 * pulso de presença.
 *
 * O INSTRUMENTO. A rota do contexto (que intercepta também o pedido `keepalive` da página que sai)
 * recusa com 503 as primeiras tentativas do lote que leva a ativação da ferramenta de ponto, e
 * depois deixa passar; ver `recusarTentativas` sobre por que são duas no caso logado. O que chegou
 * é lido no banco do harness: o `loteId` em `uso_lotes` e a contagem de `ferramenta.ativada` em
 * `uso_eventos_dia`. O app fala com o backend pelo proxy de MESMA origem do Vite (sem
 * `__EBGEO_BACKEND_URL__`), para que a resposta forjada não precise de cabeçalho de CORS.
 *
 * O ZERO DE FALHAS se cobra só na navegação SEM recusa: no caso com 503 a página nova conta, com
 * razão, a tentativa dela que o instrumento recusou.
 *
 * O CONTROLE é o anônimo, que já recuperava pelo reenvio de 30 s: se ele reprovar, o instrumento
 * está quebrado, não o produto.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { pgPromise, appDbUrl } from './backend.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Uma consulta de uma linha no banco do harness, com conexão própria. */
async function consultar(sql, params = []) {
    const pgp = pgPromise({ noWarnings: true });
    const conn = pgp(appDbUrl(state.dbName));
    try {
        return await conn.one(sql, params);
    } finally {
        await conn.$pool.end();
    }
}

/** Quantas ativações de ferramenta o servidor já contou, em qualquer dia e página. */
async function ativacoesContadas() {
    const { n } = await consultar(
        "SELECT COALESCE(SUM(contagem), 0)::int AS n FROM uso_eventos_dia WHERE evento = 'ferramenta.ativada'"
    );
    return n;
}

/** Quantos destes lotes o servidor registrou. */
async function lotesRegistrados(ids) {
    if (ids.length === 0) return 0;
    const { n } = await consultar('SELECT COUNT(*)::int AS n FROM uso_lotes WHERE id = ANY($1::uuid[])', [ids]);
    return n;
}

/** Ativa a ferramenta de ponto pela barra, que conta `ferramenta.ativada`. */
async function ativarPonto(page) {
    const grupo = page.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    const botao = grupo.locator('.toolbar-tool-btn[data-tool-id="point"]');
    await botao.click();
    await expect(botao).toHaveAttribute('data-active', 'true', { timeout: 15000 });
}

async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
}

/** Login pela interface, no mapa anônimo, e volta ao mapa local já logado. */
async function entrarPelaInterface(page, conta) {
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 30000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(conta.username);
    await page.locator('[data-testid="login-password"]').fill(conta.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 30000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await esperarMapa(page);
    await expect(page.locator('[data-testid="account-control"] .account-control__identity'))
        .toBeVisible({ timeout: 30000 });
}

/**
 * Recusa com 503 as `vezes` primeiras tentativas de cada lote de `identidade` que leve uma
 * ativação de ferramenta, e deixa passar as seguintes. Devolve o registro vivo: `tentativas`
 * (loteId para quantas vezes passou pela rota) e `lotes` (os `loteId`, na ordem em que surgiram).
 *
 * POR QUE DUAS NO CASO LOGADO, e não uma: o pedido `keepalive` da página que sai pode chegar à
 * rota DEPOIS do reenvio da página nova (medido no Chromium, 1 de 3). Recusando só a primeira, a
 * recusa caía no reenvio, o lote chegava pelo pedido atrasado da página velha e o caso passava sem
 * ter medido o reenvio. Com duas, as duas tentativas (a da saída e a do assentamento) são recusadas
 * em qualquer ordem, e o que entrega é o reenvio periódico, que só existe se o lote sobreviveu.
 */
async function recusarTentativas(context, identidade, vezes) {
    const tentativas = new Map();
    const lotes = [];
    await context.route('**/api/v1/uso/eventos', async (route) => {
        let corpo = null;
        try { corpo = JSON.parse(route.request().postData() ?? 'null'); } catch { corpo = null; }
        const leva = corpo?.identidade === identidade
            && Array.isArray(corpo.eventos)
            && corpo.eventos.some((e) => e.evento === 'ferramenta.ativada');
        if (leva) {
            const n = (tentativas.get(corpo.loteId) ?? 0) + 1;
            tentativas.set(corpo.loteId, n);
            if (n === 1) lotes.push(corpo.loteId);
            if (n <= vezes) {
                await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{}}' });
                return;
            }
        }
        await route.continue();
    });
    return { tentativas, lotes };
}

/** Os pulsos de presença que a página manda, com o cabeçalho e o corpo. */
function gravarPulsos(page) {
    const pulsos = [];
    page.on('request', (req) => {
        if (req.method() !== 'POST' || !req.url().endsWith('/uso/presenca')) return;
        let corpo = null;
        try { corpo = JSON.parse(req.postData() ?? 'null'); } catch { corpo = null; }
        pulsos.push({ quando: Date.now(), autenticado: Boolean(req.headers().authorization), corpo });
    });
    return pulsos;
}

/** Os pedidos de telemetria que o navegador deu por falhos (o `net::ERR_ABORTED` do Chromium). */
function gravarFalhos(page) {
    const falhos = [];
    page.on('requestfailed', (req) => {
        if (req.url().includes('/uso/')) falhos.push(`${req.url().split('/api/v1')[1]} ${req.failure()?.errorText}`);
    });
    return falhos;
}

describeOrSkip('O lote de uso atravessa a troca de página', () => {
    test('logado: o lote do `pagehide` recusado com 503 sobrevive, é reenviado e chega', async ({ page, browserName }) => {
        test.setTimeout(180000);
        const conta = await createVerifiedUser({ prefix: 'usofila', nome: 'Uso Fila' });
        const falhos = gravarFalhos(page);
        await entrarPelaInterface(page, conta);

        const antes = await ativacoesContadas();
        const { tentativas, lotes } = await recusarTentativas(page.context(), conta.id, 2);
        await ativarPonto(page);
        await page.goto('/atlas.html');

        await expect.poll(() => lotes.length, {
            message: 'o instrumento não recusou nada: o lote da conta com a ativação nunca passou pela rota',
            timeout: 15000,
        }).toBe(1);
        // A SEGUNDA TENTATIVA é a prova de que o lote sobreviveu à página nova e foi reenviado
        // quando a sessão assentou; o código anterior o apagava ali, e ela nunca acontecia.
        await expect.poll(() => tentativas.get(lotes[0]) ?? 0, {
            message: 'a página nova não reenviou o lote da conta ao assentar a sessão',
            timeout: 20000,
        }).toBeGreaterThanOrEqual(2);

        let chegou = 0;
        let delta = 0;
        try {
            await expect.poll(async () => {
                chegou = await lotesRegistrados(lotes);
                delta = (await ativacoesContadas()) - antes;
                return chegou;
            }, { timeout: 45000, intervals: [1000] }).toBe(1);
        } finally {
            console.log(`[repro ${browserName}] logado: lote ${lotes[0]} tentativas=${tentativas.get(lotes[0])} `
                + `chegou=${chegou} deltaAtivacoes=${delta}; pedidos de uso dados por falhos ${JSON.stringify(falhos)}`);
        }
        expect(delta).toBe(1);
    });

    test('logado, sem recusa: a navegação normal não conta falha de coleta', async ({ page, browserName }) => {
        test.setTimeout(180000);
        const conta = await createVerifiedUser({ prefix: 'usonav', nome: 'Uso Nav' });
        const falhos = gravarFalhos(page);
        await entrarPelaInterface(page, conta);
        await ativarPonto(page);
        const pulsos = gravarPulsos(page);
        const saida = Date.now();
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="account-control"], .app-bar').first()).toBeAttached({ timeout: 30000 });

        await expect.poll(() => pulsos.filter((p) => p.quando > saida && p.autenticado && !p.corpo?.saindo).length,
            { timeout: 40000 }).toBeGreaterThanOrEqual(1);
        // Um instante a mais, para o pulso repetido depois do assentamento também entrar.
        await page.waitForTimeout(1500);
        const falhas = pulsos.filter((p) => p.quando > saida && !p.corpo?.saindo).map((p) => p.corpo?.falhasColeta);
        console.log(`[repro ${browserName}] navegação normal: falhasColeta ${JSON.stringify(falhas)}; `
            + `pedidos de uso dados por falhos ${JSON.stringify(falhos)}`);
        expect(falhas.length).toBeGreaterThanOrEqual(1);
        expect(falhas.every((n) => n === 0)).toBe(true);
    });

    test('CONTROLE anônimo: o mesmo 503 é recuperado pelo reenvio de 30 s', async ({ page, browserName }) => {
        test.setTimeout(180000);
        await page.goto('/');
        await esperarMapa(page);

        const antes = await ativacoesContadas();
        // UMA recusa basta aqui: a página nova do anônimo não reenvia ao assentar (a identidade
        // dele não muda), então a primeira tentativa é sempre a da página que saiu.
        const { tentativas, lotes } = await recusarTentativas(page.context(), null, 1);
        await ativarPonto(page);
        await page.goto('/atlas.html');

        await expect.poll(() => lotes.length, {
            message: 'o instrumento não recusou nada: o lote anônimo com a ativação nunca passou pela rota',
            timeout: 15000,
        }).toBe(1);

        let chegou = 0;
        let delta = 0;
        try {
            await expect.poll(async () => {
                chegou = await lotesRegistrados(lotes);
                delta = (await ativacoesContadas()) - antes;
                return chegou;
            }, { timeout: 45000, intervals: [1000] }).toBe(1);
        } finally {
            console.log(`[repro ${browserName}] anônimo: lote ${lotes[0]} tentativas=${tentativas.get(lotes[0])} `
                + `chegou=${chegou} deltaAtivacoes=${delta}`);
        }
        expect(delta).toBe(1);
    });
});
