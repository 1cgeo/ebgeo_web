// Path: e2e-ui/calibracao-barra.spec.js

/**
 * @fileoverview A BARRA SUPERIOR DENTRO DA CALIBRAÇÃO 360, em Chromium real contra o backend real.
 *
 * Dois defeitos que o chefe apontou na captura de 2026-08-25, e os dois só se provam num
 * navegador de verdade:
 *
 * (1) A BARRA COBRIA A UI. Ela é `position: absolute; top: 0; z-index: 40`, e a sobreposição é
 *     deliberada: o canvas do WebGL precisa manter a razão de aspecto da viewport INTEIRA, porque
 *     é isso que faz a projeção e a posição dos marcadores baterem com o visualizador 360 do mapa,
 *     e a página existe para garantir essa fidelidade. Só que o motivo vale para o CANVAS, e valia
 *     para a página toda: o topo do painel da direita ficava debaixo da barra ("Mapa do projeto
 *     [M]" aparecia cortado), e com ele o seletor de projetos, o modo mapa e o painel de prévia.
 *     A regra que ficou: a barra sobrepõe o canvas, e todo painel de UI desce `--app-bar-height`.
 *
 * (2) "MINHA CONTA" NÃO É O DESTINO DESTA TELA. Desde a mesma data a calibração se alcança pela
 *     LINHA do projeto na aba Catálogo, e o que faltava aqui era o caminho de VOLTA.
 *
 * POR QUE A PROVA DE (1) É MEDIDA E NÃO OLHAR. Uma captura de tela responde "parece certo", e
 * quem a lê é quem escreveu o CSS. `boundingBox()` responde outra pergunta, e ela é binária: as
 * duas caixas se cruzam ou não se cruzam. É a única forma de a regressão ficar VERMELHA em vez de
 * ficar feia.
 *
 * O CONTROLE POSITIVO DE (2) É OBRIGATÓRIO, e é o que separa este spec de um verde mentiroso: um
 * `toHaveCount(0)` sobre "Minha conta" passa sozinho quando a barra simplesmente não carregou. Por
 * isso o caso mede as DUAS páginas: aqui o botão sumiu, e em `admin.html` ele CONTINUA.
 *
 * O QUE ESTE ARQUIVO NÃO PRENDE: a calibração em si. O estúdio precisa da pirâmide de tiles da
 * foto, que o semeador não escreve, então a página para no seletor de projetos. Isso não enfraquece
 * a medida: os painéis medidos são os mesmos elementos, com a mesma folha de estilo, e o que o
 * caso faz é desfazer o esconde-esconde INLINE que o modo atual aplica (nunca uma regra de estilo).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O valor de `--app-bar-height` em `design-tokens.css`. A medida abaixo o confirma no navegador. */
const ALTURA_DA_BARRA = 68;

/**
 * Entra como administrador e para no MAPA, que é onde o controle de conta monta.
 * Cópia deliberada de `admin-360-calibrar.spec.js`: as duas telas partem do mesmo lugar.
 */
async function entrarNoMapa(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

/**
 * Do mapa até `calibracao.html`, com a barra montada.
 *
 * A ida é por URL e não pelo botão do catálogo (que `admin-360-calibrar.spec.js` já prende):
 * a sessão vive no `localStorage`, então a página rebusca os tokens sozinha, e o que este spec
 * mede é a TELA, não o caminho até ela.
 */
async function entrarNaCalibracao(page, creds) {
    await entrarNoMapa(page, creds);
    await page.goto('/calibracao.html');
    // O gate de admin decide entre montar e redirecionar, então a barra é o sinal de que passou.
    await expect(page.locator('[data-testid="app-bar-user"]')).toBeVisible({ timeout: 20000 });
}

/** As duas caixas se cruzam? Retângulos de `boundingBox()`, em pixels da viewport. */
function seCruzam(a, b) {
    return a.x < b.x + b.width
        && b.x < a.x + a.width
        && a.y < b.y + b.height
        && b.y < a.y + a.height;
}

describeOrSkip('Calibração 360 — a barra superior', () => {
    test.afterAll(async () => { await closeDb(); });

    test('a porta desta tela é o Catálogo, e "Minha conta" continua em admin.html', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'calbar', nome: 'Cal Barra', role: 'admin' });
        await entrarNaCalibracao(page, admin);

        // O botão que ENTROU, com o rótulo que o chefe pediu.
        const catalogo = page.locator('[data-testid="calibracao-catalogo"]');
        await expect(catalogo).toBeVisible();
        await expect(catalogo).toContainText('Catálogo');

        // E o que SAIU, mas só desta tela.
        await expect(page.locator('[data-testid="app-bar-account"]')).toHaveCount(0);

        // O destino é o contrato, e não o rótulo: a aba Catálogo do painel.
        await catalogo.click();
        await page.waitForURL('**/admin.html?aba=catalog', { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
        // A URL sozinha não prova que a aba abriu: `?aba=` casa com a aba MONTADA ou cai na
        // primeira. Este seletor só existe dentro do catálogo.
        await expect(page.locator('[data-testid="admin-cat-sv360"]')).toBeVisible({ timeout: 15000 });

        // O CONTROLE POSITIVO. Sem ele, o `toHaveCount(0)` de cima passaria numa barra que não
        // carregou, e o spec ficaria verde justamente no defeito que ele existe para pegar.
        await expect(page.locator('[data-testid="app-bar-account"]')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="calibracao-catalogo"]')).toHaveCount(0);
    });

    test('a barra não cruza painel de UI nenhum, medido caixa a caixa', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'calbox', nome: 'Cal Caixa', role: 'admin' });
        await entrarNaCalibracao(page, admin);

        const barra = await page.locator('header.app-bar').boundingBox();
        expect(barra).not.toBeNull();

        // A ALTURA MEDIDA É O TOKEN. Se as duas divergirem, todo afastamento calculado a partir
        // de `--app-bar-height` está errado por essa diferença, e as asserções abaixo passariam
        // por sorte. Esta é a única linha que liga o número declarado ao número real.
        expect(barra.y).toBe(0);
        expect(barra.height).toBe(ALTURA_DA_BARRA);

        // O SELETOR DE PROJETOS está genuinamente visível (a página sem `?photo=` abre nele), e
        // era o segundo elemento cortado: o título ficava debaixo da barra.
        const seletor = page.locator('#project-selector');
        await expect(seletor).toBeVisible({ timeout: 20000 });

        // OS OUTROS TRÊS existem na página e carregam a folha real; o que os esconde é o MODO
        // (o seletor de projetos desmonta o estúdio). O que segue desfaz o esconde-esconde
        // INLINE, e nunca uma regra de estilo: `display` volta a '' para a folha decidir, e o
        // `hidden` sai do modo mapa. A prévia não existe fora de uma foto carregada, então entra
        // como SONDA: um elemento com a classe real, na página real, medido contra a folha real.
        await page.evaluate(() => {
            document.getElementById('calibration-panel').style.display = '';
            document.getElementById('viewer-container').style.display = '';
            document.getElementById('project-map').removeAttribute('hidden');
            const sonda = document.createElement('div');
            sonda.className = 'cal-preview';
            sonda.id = 'sonda-preview';
            sonda.style.width = '200px';
            sonda.style.height = '120px';
            document.querySelector('.app-layout').appendChild(sonda);
        });

        const alvos = {
            'painel da direita (#calibration-panel)': '#calibration-panel',
            'seletor de projetos (#project-selector)': '#project-selector',
            'modo mapa do projeto (#project-map)': '#project-map',
            'painel de prévia (.cal-preview)': '#sonda-preview',
        };

        for (const [nome, seletorCss] of Object.entries(alvos)) {
            const caixa = await page.locator(seletorCss).boundingBox();
            expect(caixa, `${nome} não tem caixa`).not.toBeNull();
            // A mensagem nomeia o elemento: um vermelho aqui precisa dizer QUAL painel voltou
            // para debaixo da barra, sem obrigar quem lê a contar seletores.
            expect(seCruzam(barra, caixa), `${nome} cruza a barra`).toBe(false);
            // E o afastamento é exatamente a altura dela, nunca "algum lugar abaixo": um painel
            // que descesse 200px também não cruzaria, e estaria errado.
            expect(caixa.y).toBeGreaterThanOrEqual(ALTURA_DA_BARRA);
        }

        // OS CONTROLES DO MODO MAPA (zoom do MapLibre no topo esquerdo, legenda no topo direito,
        // seletor de andar) descem porque o BLOCO desce: eles são filhos posicionados dentro de
        // `#project-map`, e a asserção acima sobre o bloco os cobre por construção.
        //
        // O CANVAS É O CONTROLE NEGATIVO, e ele fecha o outro lado da regra: se ele TAMBÉM
        // tivesse descido, a página teria perdido a razão de aspecto que é a razão de ela
        // existir, e todas as asserções acima continuariam verdes.
        const canvas = await page.locator('#viewer-container').boundingBox();
        expect(canvas.y).toBe(0);
        expect(seCruzam(barra, canvas)).toBe(true);
    });
});
