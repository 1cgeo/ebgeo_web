// Path: e2e-ui/cadastro-sob-demanda.spec.js

/**
 * @fileoverview O cadastro chega pela REDE, e este arquivo mede o que isso criou.
 *
 * Desde 2026-09-20 `modals/signup.modal.js` não viaja no boot: `modals/signup-launcher.js` o busca
 * no clique de "Criar conta". A economia é medida por `tests/unit/teto-de-peso-da-pagina-do-mapa.
 * test.js`; o que NÃO se mede em node é o gesto que passou a poder falhar, e são três desfechos
 * que só existem num navegador de verdade:
 *
 *   1. O CHUNK NÃO CHEGA. Rede caída, ou deploy que trocou o build sob uma sessão aberta e o nome
 *      com hash antigo responde 404. O navegador relata os dois como o MESMO `TypeError`, então a
 *      frase cobre os dois e oferece a ÚNICA saída que funciona, que é recarregar a página. Sem
 *      este caso, o defeito é um link que não faz nada, a forma mais silenciosa de quebrar tela.
 *
 *      E A SAÍDA É RECARREGAR, NÃO CLICAR DE NOVO, o que este arquivo mede em vez de supor: o
 *      navegador guarda o módulo que falhou como falho no MAPA DE MÓDULOS da página, então o
 *      `import()` seguinte do mesmo especificador é recusado sem pedido nenhum. Medido aqui em
 *      2026-09-20 (segundo clique: ZERO pedidos de rede), e é por isso que o caso abaixo afirma o
 *      pedido que NÃO acontece em vez de um formulário que abriria.
 *   2. A ESPERA É VISÍVEL. Numa rede lenta o botão fica 300 ms sem responder, e um botão em
 *      estilo de link que não responde lê-se como morto. O rótulo dele É o estado.
 *   3. A RESPOSTA TARDIA NÃO REABRE NADA. Quem desiste no meio da espera não pode ver um
 *      formulário de cadastro aparecer sozinho depois. É a mesma classe que
 *      `browser-account-recovery-audit.spec.js` já prende para o POST de registro, agora para o
 *      código do próprio diálogo.
 *
 * A ROTA INTERCEPTADA É A DO SERVIDOR DE DESENVOLVIMENTO, `/src/js/modals/signup.modal.js`, porque
 * é assim que o Vite serve o módulo na rodada do Playwright. No pacote de produção o nome carrega
 * hash, e é justamente por isso que o desfecho 1 existe.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const field = (page, id) => page.getByTestId(id);

/** O especificador que o `import()` do launcher pede ao Vite. */
const CHUNK_DO_CADASTRO = '**/src/js/modals/signup.modal.js*';

/** O rótulo em repouso do comando, e o rótulo dele enquanto o código vem. */
const ROTULO = 'Não tem conta? Criar conta';
const ROTULO_CARREGANDO = 'Abrindo o cadastro…';

describeOrSkip('Cadastro sob demanda (chunk no clique)', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    });

    test('o chunk que não chega é NOMEADO, e a saída oferecida é recarregar', async ({ page }, testInfo) => {
        // A recusa vale UMA vez: a rota é liberada depois, e é isso que torna o segundo clique um
        // controle de verdade. Se o `import()` voltasse a pedir a rede, ele encontraria o módulo
        // e o formulário abriria; o que se afirma abaixo é que ele NÃO pede, que é a razão de a
        // saída ser o recarregamento.
        await page.route(CHUNK_DO_CADASTRO, (route) => route.abort('failed'), { times: 1 });
        const pedidos = [];
        page.on('request', (r) => { if (r.url().includes('signup.modal')) pedidos.push(r.url()); });

        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();

        // O diálogo de login CONTINUA DE PÉ: fechar antes de ter o código deixaria a tela sem
        // diálogo nenhum, e sem nada em caso de falha.
        await expect(field(page, 'login-modal')).toBeVisible();
        await expect(field(page, 'signup-modal')).toHaveCount(0);

        const aviso = field(page, 'login-error');
        await expect(aviso).toBeVisible({ timeout: 15000 });
        await expect(aviso).toContainText('Não foi possível carregar o formulário de cadastro');
        await expect(aviso).toContainText('atualize a página');
        await expect(aviso).toHaveAttribute('role', 'alert');
        // A frase não pode prometer o que o mapa de módulos impede.
        await expect(aviso).not.toContainText('Tente de novo');

        // A SAÍDA É UM COMANDO, e não só uma frase.
        const recarregar = field(page, 'login-reload-app');
        await expect(recarregar).toBeVisible();
        await expect(recarregar).toHaveText('Atualizar a página');
        await page.screenshot({ path: testInfo.outputPath('cadastro-chunk-ausente.png') });

        // O COMANDO NÃO FICOU TRAVADO NEM MUDO: voltou ao rótulo de repouso, sem `aria-busy`, e
        // sem a propriedade `disabled`, que impediria o próprio clique (regra da casa: o estado
        // recusa o clique nomeando o estado, e nunca desenha um botão que não dispara evento).
        const botao = field(page, 'login-register');
        await expect(botao).toHaveText(ROTULO);
        await expect(botao).not.toHaveAttribute('aria-busy', 'true');
        expect(await botao.evaluate((el) => el.disabled === true)).toBe(false);

        // O SEGUNDO CLIQUE NÃO TOCA A REDE, e é essa medida que justifica o desenho: a rota já
        // está liberada, então um pedido novo abriria o formulário. Ele não acontece.
        const antes = pedidos.length;
        expect(antes).toBe(1);
        await botao.click();
        await expect(aviso).toBeVisible();
        await expect(aviso).toContainText('Não foi possível carregar o formulário de cadastro');
        await expect(field(page, 'signup-modal')).toHaveCount(0);
        expect(pedidos.length, 'o `import()` repetiu o pedido: o mapa de módulos mudou')
            .toBe(antes);

        // E O RECARREGAMENTO ABRE: a página nova tem o mapa de módulos limpo e a rota livre.
        await recarregar.click();
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();
        await expect(field(page, 'signup-modal')).toBeVisible({ timeout: 15000 });
        await expect(field(page, 'login-modal')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('cadastro-depois-de-recarregar.png') });
    });

    test('enquanto o código vem, o comando diz que está trabalhando e o clique duplo é um só', async ({ page }) => {
        let liberar;
        const segurado = new Promise((resolve) => { liberar = resolve; });
        let pedidos = 0;
        await page.route(CHUNK_DO_CADASTRO, async (route) => {
            pedidos += 1;
            await segurado;
            await route.continue();
        });

        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();

        const botao = field(page, 'login-register');
        await botao.click();
        await expect(botao).toHaveText(ROTULO_CARREGANDO);
        await expect(botao).toHaveAttribute('aria-busy', 'true');
        // `dispatchEvent` e não `click()`: o Playwright trata `aria-busy` como estado de espera em
        // alguns alvos, e o que se quer medir aqui é justamente o segundo clique CHEGANDO.
        await botao.dispatchEvent('click');
        await botao.dispatchEvent('click');

        liberar();
        await expect(field(page, 'signup-modal')).toBeVisible({ timeout: 15000 });
        // UM diálogo e UM download, apesar dos três cliques. O memo do launcher responde pelo
        // download; o sinalizador em voo do modal de login responde pelo diálogo.
        await expect(page.locator('[data-testid="signup-modal"]')).toHaveCount(1);
        expect(pedidos).toBe(1);
    });

    test('desistir durante a espera não deixa o cadastro aparecer sozinho depois', async ({ page }) => {
        let liberar;
        const segurado = new Promise((resolve) => { liberar = resolve; });
        await page.route(CHUNK_DO_CADASTRO, async (route) => {
            await segurado;
            await route.continue();
        });

        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();
        await expect(field(page, 'login-register')).toHaveText(ROTULO_CARREGANDO);

        // A saída no meio da espera. `Escape` na visão de login fecha o diálogo (é o que
        // `nextLoginView` decide), e a partir daí não há gesto pendente de ninguém.
        await page.keyboard.press('Escape');
        await expect(field(page, 'login-modal')).toHaveCount(0);

        liberar();
        // O módulo chega, e não abre nada. A espera é por TEMPO de propósito: o que se afirma é a
        // AUSÊNCIA de um diálogo, e não existe estado para esperar quando nada deve acontecer.
        await page.waitForTimeout(1500);
        await expect(field(page, 'signup-modal')).toHaveCount(0);
        await expect(field(page, 'login-modal')).toHaveCount(0);
    });

    test('trocar para "Esqueci minha senha" durante a espera também desiste do cadastro', async ({ page }) => {
        // O diálogo CONTINUA ABERTO nesta saída, e era isso que escapava: o portão perguntava só
        // "o login ainda está aberto?", então o cadastro abria por cima da visão de recuperação que
        // a pessoa tinha acabado de pedir. O portão pergunta hoje também pela VISÃO.
        let liberar;
        const segurado = new Promise((resolve) => { liberar = resolve; });
        await page.route(CHUNK_DO_CADASTRO, async (route) => {
            await segurado;
            await route.continue();
        });

        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();
        await expect(field(page, 'login-register')).toHaveText(ROTULO_CARREGANDO);

        await field(page, 'login-forgot-password').click();
        await expect(field(page, 'login-recovery-view')).toBeVisible();

        liberar();
        await page.waitForTimeout(1500);
        await expect(field(page, 'signup-modal')).toHaveCount(0);
        await expect(field(page, 'login-recovery-view')).toBeVisible();
    });

    test('aberto o cadastro, o fundo continua TRAVADO e o foco volta ao botão de conta ao fechar', async ({ page }) => {
        // A ORDEM dos dois diálogos é o sujeito. O login fechava DEPOIS de o cadastro aparecer, e o
        // `hide()` de quem fecha por último limpa `document.body.style.overflow`: o cadastro ficava
        // na tela com o fundo rolando atrás dele. E o cadastro tinha guardado, como elemento a
        // devolver o foco, o link "Criar conta" que aquele fechamento tira da página.
        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();
        await expect(field(page, 'signup-modal')).toBeVisible({ timeout: 15000 });
        await expect(field(page, 'login-modal')).toHaveCount(0);

        expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

        await page.keyboard.press('Escape');
        await expect(field(page, 'signup-modal')).toHaveCount(0);
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
        const foco = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
        expect(foco).toBe('account-login-btn');
    });
});
