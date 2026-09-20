// Path: e2e-ui/recuperacao-sem-email.spec.js

/**
 * @fileoverview "Esqueci minha senha" numa implantação SEM entrega de e-mail.
 *
 * `features.password_reset_email` do `GET /api/config` é o predicado do servidor para "esta
 * instalação consegue entregar correio de conta" (`canDeliverAccountMail`), e onde ele é falso as
 * rotas `/auth/forgot-password` e `/auth/reset-password` NÃO existem. A visão de recuperação então
 * encolhe para uma frase só, `ADMIN_ONLY_RECOVERY_TEXT`: o caminho do administrador, que é o único
 * que existe em toda implantação.
 *
 * POR QUE ISTO PRECISA DE NAVEGADOR. A decisão é pura e já tem teste de nó (`nextLoginView` e
 * `emailRecoveryEnabled`, em `tests/unit/password-recovery-model.test.js`), mas o backend do
 * harness ENTREGA e-mail, então nenhuma prova em navegador jamais passou por este ramo: a metade
 * que faltava não é a decisão, é o DESENHO dela. Uma visão de um parágrafo dentro de um diálogo
 * dimensionado para dois formulários é exatamente o tipo de tela que ninguém vê até um usuário
 * sem SMTP abrir.
 *
 * COMO A BANDEIRA É VIRADA: interceptando a resposta REAL do servidor e trocando UM campo
 * (`route.fetch()` e depois `route.fulfill({ response, json })`). Inventar o documento inteiro
 * mediria um `/api/config` que este produto não serve, e o boot do mapa é fail-fast nele, então um
 * documento pela metade daria "EBGeo indisponível" em vez da tela sob exame.
 *
 * A RESPOSTA VEM ENVELOPADA EM `data`, e escrever `json.features` direto é um erro MUDO: ele cria
 * uma chave irmã do envelope, o `apiClient` desembrulha `data` e entrega o documento ORIGINAL, de
 * modo que o spec mede a implantação normal e chama de verde. Custou uma rodada aqui em
 * 2026-09-20; daí o `json.data ?? json` abaixo e, sobretudo, daí o controle positivo do primeiro
 * caso, que afirma a frase do administrador em vez de só contar campos ausentes.
 *
 * A ROTA É DERIVADA e nunca escrita à mão (`state.baseUrl`, que sai do arquivo de estado do
 * harness e carrega a porta de backend desta rodada): uma origem escrita no spec engole o próprio
 * `/api/config` quando as portas são isoladas por ambiente, e o app não boota, com cara de defeito
 * de produto.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const field = (page, id) => page.getByTestId(id);

/** A frase que É a visão inteira onde o e-mail não está montado. */
const FRASE_DO_ADMINISTRADOR = 'A sua senha é redefinida pelo administrador do EBGeo. '
    + 'Peça a ele para criar uma senha nova para você.';

/** Os campos das duas etapas de e-mail: nenhum deles pode existir aqui. */
const CAMPOS_DE_EMAIL = [
    'login-recovery-email',
    'login-recovery-request',
    'login-recovery-have-code',
    'login-recovery-step-reset',
    'login-recovery-code',
    'login-recovery-password',
    'login-recovery-confirm',
    'login-recovery-reset',
    'login-recovery-ask-again',
    // A frase "não recebeu o código?" também sai: ela fala com quem espera um código que esta
    // implantação nunca ofereceu.
    'login-recovery-fallback',
];

/**
 * Sobe a página do mapa com a bandeira de e-mail DESLIGADA e abre a visão de recuperação.
 * @param {import('@playwright/test').Page} page
 */
async function abrirRecuperacaoSemEmail(page) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    // O padrão é de CAMINHO e não de origem: a porta do backend muda por ambiente
    // (`EBGEO_UI_E2E_BACKEND_PORT`), e uma origem escrita à mão aqui deixaria de casar e o spec
    // mediria a configuração real sem avisar.
    await page.route('**/api/v1/config', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        const documento = json?.data ?? json;
        documento.features = { ...documento.features, password_reset_email: false };
        await route.fulfill({ response, json });
    });
    await page.goto('/');
    await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
    await field(page, 'account-login-btn').click();
    await expect(field(page, 'login-modal')).toBeVisible();
    await field(page, 'login-forgot-password').click();
    await expect(field(page, 'login-recovery-view')).toBeVisible();
}

describeOrSkip('Recuperar senha sem entrega de e-mail', () => {
    test('a visão é UMA frase, sem formulário nenhum, e as duas saídas funcionam', async ({ page }) => {
        await abrirRecuperacaoSemEmail(page);

        // CONTROLE POSITIVO da interceptação: sem ela o backend do harness entrega e-mail, e esta
        // linha veria o formulário. É o que separa "a bandeira foi virada" de "o spec mediu a
        // implantação normal e chamou de verde".
        await expect(field(page, 'login-recovery-view')).toContainText(FRASE_DO_ADMINISTRADOR);

        for (const testid of CAMPOS_DE_EMAIL) {
            await expect(field(page, testid), `${testid} não pode existir sem e-mail`)
                .toHaveCount(0);
        }
        // E a visão de login saiu de cena: as duas são mutuamente exclusivas.
        await expect(field(page, 'login-username')).toBeHidden();
        await expect(field(page, 'login-submit')).toBeHidden();

        // A PRIMEIRA SAÍDA: o comando de voltar, que é o primeiro elemento da visão.
        await field(page, 'login-recovery-back').click();
        await expect(field(page, 'login-recovery-view')).toBeHidden();
        await expect(field(page, 'login-username')).toBeVisible();

        // A SEGUNDA: `Escape` VOLTA em vez de fechar, e o diálogo continua de pé. Esta metade é a
        // que mais depende da bandeira: `nextLoginView` normaliza a etapa de resgate para fora
        // onde o e-mail está desligado, e um `Escape` mal roteado fecharia o diálogo inteiro.
        await field(page, 'login-forgot-password').click();
        await expect(field(page, 'login-recovery-view')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(field(page, 'login-modal')).toBeVisible();
        await expect(field(page, 'login-recovery-view')).toBeHidden();
        await expect(field(page, 'login-username')).toBeVisible();

        // E o segundo `Escape`, já na visão de login, fecha: quem chegou aqui por engano sai.
        await page.keyboard.press('Escape');
        await expect(field(page, 'login-modal')).toHaveCount(0);
    });

    for (const { nome, width, height } of [
        { nome: 'desktop-1366x768', width: 1366, height: 768 },
        { nome: 'celular-390x844', width: 390, height: 844 },
        // A FAIXA DO MEIO, que a primeira versão da correção não cobria: a regra que dá altura de
        // tela cheia ao diálogo vale até 768px, e a exceção tinha sido escrita para até 480px. Tablet
        // em retrato e celular em paisagem ficavam com a tela branca inteira.
        { nome: 'tablet-700x900', width: 700, height: 900 },
    ]) {
        test(`não rola e cabe na tela (${nome})`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height });
            await abrirRecuperacaoSemEmail(page);

            // O elemento que rola é `.modal-body` (`overflow-y: auto` em `modals-redesign.css`,
            // sob um contêiner de `max-height: 85vh`). Uma visão de uma frase só que ainda assim
            // rolasse seria o sintoma de altura reservada para formulários que não existem.
            const corpo = page.locator('[data-testid="login-modal"] .modal-body');
            const medida = await corpo.evaluate((el) => ({
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
            }));
            expect(medida.scrollHeight, `rolagem de ${medida.scrollHeight - medida.clientHeight}px`)
                .toBeLessThanOrEqual(medida.clientHeight + 1);

            // E O DIÁLOGO NÃO PODE SER UMA TELA INTEIRA PARA DIZER UMA FRASE. "Cabe na janela"
            // não bastaria: a primeira captura deste caso, em 390x844, cabia EXATAMENTE, porque
            // `responsive.css` dá `height: 100vh` a todo `.modal-container` abaixo de 480px, e o
            // que se via era o parágrafo no alto de uma tela branca inteira, que se lê como tela
            // que não carregou. O teto relativo é o que separa um cartão de uma tela em branco.
            const caixa = await page.locator('[data-testid="login-modal"] .modal-container')
                .boundingBox();
            expect(caixa.height, `diálogo com ${Math.round(caixa.height)}px de ${height}`)
                .toBeLessThanOrEqual(height * 0.6);
            expect(caixa.y).toBeGreaterThanOrEqual(0);
            expect(caixa.y + caixa.height).toBeLessThanOrEqual(height + 1);

            await page.screenshot({ path: testInfo.outputPath(`recuperacao-sem-email-${nome}.png`) });
        });
    }
});
