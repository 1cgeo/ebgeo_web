// Path: e2e-ui/browser-signup.spec.js

/**
 * Browser click-through of self-registration + e-mail confirmation (F1 + F2): the REAL
 * AccountControl → login modal → signup modal flow in real Chromium against the REAL
 * spawned backend (ALLOW_SELF_REGISTRATION=true).
 *
 * Because the signup form carries an e-mail, the account is created PENDING: login is
 * BLOCKED until the e-mail is confirmed. The test reads the verification token straight
 * from Postgres (the user can't open a real inbox), drives the ?verify boot branch, then
 * logs in — the end-to-end proof of "create a user from the login button, confirm by e-mail".
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';
// A OM deixou de ser `<select>` em 2026-09-20: é o combobox buscável de `ui/searchable-select.js`,
// e `selectOption` não o alcança. O posto continua `<select>` (lista curta, por hierarquia).
import { escolherNoCombobox } from './helpers/combobox.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Signup → create account + confirm e-mail (real browser + real backend)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('creates an account, is blocked until confirmation, then signs in', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        const username = `uisignup_${Math.random().toString(36).slice(2, 10)}`;
        const email = `${username}@example.mil`;
        const password = 'Sup3r-Secret-Pw!';
        // O NOME DE GUERRA NÃO É PEDAÇO DO NOME CIVIL, e a fixture é assim de propósito: no
        // Exército `João Batista de Souza` chamado `Silva` é o caso comum, e com um nome de
        // guerra que fosse substring do civil qualquer asserção de "chegou" passaria por
        // acidente. Único por rodada, para que a busca lá embaixo devolva UMA linha.
        const nomeGuerra = `Zurita${Math.random().toString(36).slice(2, 8)}`;
        const nomeCivil = 'Usuário de Teste';

        // Login modal → "Criar conta" → signup modal.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        await page.locator('[data-testid="signup-nome"]').fill(nomeCivil);
        // O CAMPO EXISTIA E NINGUÉM O DIGITAVA. A tela de compartilhamento identifica por
        // `posto + nome de guerra` desde 2026-09-20, e até aqui o único dado de nome de guerra
        // que alguma verificação viu foi VESTIDO por SQL: o caminho de INTAKE (o campo do
        // formulário → `POST /auth/register` → a coluna) nunca foi exercido de ponta a ponta.
        await page.locator('[data-testid="signup-nome-guerra"]').fill(nomeGuerra);
        await page.locator('[data-testid="signup-username"]').fill(username);
        await page.locator('[data-testid="signup-email"]').fill(email);
        await page.locator('[data-testid="signup-password"]').fill(password);
        await page.locator('[data-testid="signup-password-confirm"]').fill(password);
        // Posto/Graduação + Organização Militar are required (FK lists from /config). The unit is
        // reached by its ACRONYM, which is the filter the combobox added.
        await page.locator('[data-testid="signup-posto"]').selectOption({ index: 1 });
        const unidade = await escolherNoCombobox(page, 'signup-om', { termo: 'DSG' });
        expect(unidade).toContain('Diretoria de Serviço Geográfico');
        await page.locator('[data-testid="signup-submit"]').click();

        // The "verifique seu e-mail" dialog appears; dismiss it ("Entendi").
        await expect(page.locator('.confirm-modal-overlay')).toBeVisible({ timeout: 10000 });
        await page.locator('.confirm-modal-btn-cancel').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toHaveCount(0, { timeout: 5000 });

        // Login is blocked until the e-mail is confirmed.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-username"]').fill(username);
        await page.locator('[data-testid="login-password"]').fill(password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="login-error"]')).toContainText('Confirme seu e-mail', { timeout: 10000 });

        // A CONTA JÁ EXISTE (pendente), então o INTAKE pode ser medido AQUI, antes da
        // confirmação: o que se está provando é que o que foi DIGITADO chegou à coluna, e isso
        // não depende de e-mail nenhum. As outras duas verificações de identidade (posto e OM)
        // vêm de graça no mesmo SELECT e fecham o combobox junto: sem elas, um formulário que
        // mandasse `null` nos três passaria no caso do nome de guerra por si só.
        const conta = await createDb(state.dbName).raw.oneOrNone(
            `SELECT nome, nome_guerra, rank_id, organization_id, email
               FROM users WHERE LOWER(username) = LOWER($1)`,
            [username]
        );
        expect(conta, 'a conta recém-criada tem de existir na tabela').toBeTruthy();
        expect(conta.nome_guerra).toBe(nomeGuerra);
        // DISCRIMINAÇÃO: o civil NÃO é copiado para dentro do campo, e vice-versa. Um servidor
        // que fizesse `nome_guerra = nome` passaria numa asserção que só olhasse "não é nulo".
        expect(conta.nome).toBe(nomeCivil);
        expect(conta.nome_guerra).not.toBe(conta.nome);
        expect(conta.rank_id, 'o posto escolhido no <select> também chegou').toBeTruthy();
        expect(conta.organization_id, 'a OM escolhida no combobox também chegou').toBeTruthy();

        // Read the verification token from Postgres and confirm via the ?verify boot branch.
        const rows = await createDb(state.dbName).raw.any(
            `SELECT t.token FROM email_verification_tokens t
             JOIN users u ON u.id = t.user_id
             WHERE LOWER(u.email) = LOWER($1) AND t.consumed_at IS NULL
             ORDER BY t.created_at DESC LIMIT 1`,
            [email]
        );
        const token = rows[0]?.token;
        expect(token).toBeTruthy();

        await page.goto(`/?verify=${token}`);
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        // Now login succeeds → reaching the project picker proves the account is active.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-username"]').fill(username);
        await page.locator('[data-testid="login-password"]').fill(password);
        await page.locator('[data-testid="login-submit"]').click();
        // Login hands over to the project chooser PAGE — wait for the navigation, not just the element.
        await page.waitForURL('**/atlas.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 15000 });

        // A OUTRA METADE DO ELO, e ela é o que fecha a lacuna de verdade: não basta o valor
        // estar na coluna, ele precisa VOLTAR pela porta que as cinco telas de nomear pessoa
        // usam (`GET /users/search`), e precisa ser ACHÁVEL pelo próprio nome de guerra — que é
        // o texto que essas telas escrevem. Enquanto a busca casava só `nome` e `username`,
        // quem lesse "Cap Zurita" na tela e digitasse "Zurita" não achava ninguém.
        const api = `${state.baseUrl}/api/v1`;
        const entrada = await fetch(`${api}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        expect(entrada.ok, 'o login pela API precisa passar para a busca ter credencial').toBe(true);
        const { data: sessao } = await entrada.json();

        const achar = async (termo) => {
            const res = await fetch(`${api}/users/search?q=${encodeURIComponent(termo)}`, {
                headers: { Authorization: `Bearer ${sessao.accessToken}` },
            });
            expect(res.ok, `a busca por "${termo}" precisa responder 200`).toBe(true);
            return (await res.json()).data.results;
        };

        const porGuerra = await achar(nomeGuerra);
        const eu = porGuerra.find((u) => u.id === sessao.user.id);
        expect(eu, 'a busca pelo NOME DE GUERRA tem de achar a conta recém-criada').toBeTruthy();
        expect(eu.nome_guerra).toBe(nomeGuerra);
        // O posto vem ABREVIADO, que é o que a linha escreve na frente do nome de guerra: as
        // telas compõem `${posto} ${nome de guerra}` por `utilities/person-label.js`.
        expect(eu.posto_graduacao, 'o posto abreviado tem de vir na linha da busca').toBeTruthy();
        expect(eu.organizacao_militar_sigla, 'e a sigla da OM também').toBeTruthy();

        // CONTROLE NEGATIVO: sem ele, uma busca que devolvesse TODO MUNDO passaria no caso
        // acima. Um termo que não é de ninguém não pode devolver linha nenhuma.
        expect(await achar(`${nomeGuerra}zzz`)).toEqual([]);
    });

    test('rejects mismatched passwords inline without hitting the backend', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        const u = `uimismatch_${Math.random().toString(36).slice(2, 10)}`;
        await page.locator('[data-testid="signup-nome"]').fill('Mismatch');
        await page.locator('[data-testid="signup-username"]').fill(u);
        await page.locator('[data-testid="signup-email"]').fill(`${u}@example.mil`);
        await page.locator('[data-testid="signup-password"]').fill('abc123XYZ!');
        await page.locator('[data-testid="signup-password-confirm"]').fill('different456!');
        // posto/OM are required — fill them so native validation lets the submit through to the
        // custom password-match check (which still never hits the backend).
        await page.locator('[data-testid="signup-posto"]').selectOption({ index: 1 });
        await escolherNoCombobox(page, 'signup-om', { termo: 'DSG' });

        // O AVISO AO VIVO CHEGA ANTES DO BOTÃO, e é a metade nova desta tela: o desencontro já se
        // lê sob "Confirmar senha" sem ninguém ter clicado em nada.
        await expect(page.locator('[data-testid="signup-password-match"]'))
            .toContainText('não coincidem', { timeout: 5000 });

        await page.locator('[data-testid="signup-submit"]').click();

        await expect(page.locator('[data-testid="signup-error"]')).toContainText('senhas não coincidem', { timeout: 5000 });
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible();
    });

    /**
     * O COMBOBOX DA UNIDADE, na única camada que o exercita de verdade. O filtro puro já tem teste
     * de nó (`tests/unit/combobox-unidade-filtra.test.js`); o que só o navegador prova é o
     * TECLADO e as duas armadilhas que o desenho cria:
     *
     *   - Escape com a lista aberta NÃO pode fechar o diálogo. Todo modal desta casa fecha num
     *     `keydown` de Escape no `document`, então o primeiro Escape jogaria fora o formulário
     *     inteiro em vez do menu se a propagação não fosse cortada.
     *   - Enter com a lista aberta NÃO pode submeter. O input está dentro de um `<form>`, e Enter
     *     ali é submit por padrão.
     *
     * E a terceira propriedade é a razão de o controle existir com valor separado do texto: TEXTO
     * DIGITADO NÃO É ESCOLHA, então o que não resolveu para uma linha da lista é recusado aqui,
     * sem viagem ao servidor.
     */
    test('the unit combobox filters, obeys the keyboard and refuses free text', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        const om = page.locator('[data-testid="signup-om"]');
        const list = page.locator('[data-testid="signup-om-list"]');
        const options = list.locator('[role="option"]');

        // Fechado ao nascer, e o estado é o que o leitor de tela lê.
        await expect(om).toHaveAttribute('role', 'combobox');
        await expect(om).toHaveAttribute('aria-expanded', 'false');

        await om.click();
        await expect(list).toBeVisible();
        await expect(om).toHaveAttribute('aria-expanded', 'true');

        // Sigla, acento e caixa: os três casos que o `<select>` nativo não atendia.
        await om.fill('cgeo');
        await expect(options).toHaveCount(5);
        await om.fill('SERVICO');
        await expect(options).toHaveCount(1);
        await om.fill('marinha');
        await expect(page.locator('[data-testid="signup-om-empty"]')).toBeVisible();

        // Escape fecha SÓ a lista.
        await om.fill('cgeo');
        await om.press('Escape');
        await expect(list).toBeHidden();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible();

        // Seta reabre, seta desce, Enter escolhe — e Enter não submeteu nada.
        await om.press('ArrowDown');
        await expect(list).toBeVisible();
        await om.press('ArrowDown');
        await expect(om).toHaveAttribute('aria-activedescendant', 'signup-om-opt-1');
        await om.press('Enter');
        await expect(list).toBeHidden();
        await expect(om).toHaveValue('2º Centro de Geoinformação');
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible();

        // Texto livre por cima da escolha: o id morre com a primeira tecla, e o submit recusa.
        const u = `uicombo_${Math.random().toString(36).slice(2, 10)}`;
        await page.locator('[data-testid="signup-nome"]').fill('Combo');
        await page.locator('[data-testid="signup-username"]').fill(u);
        await page.locator('[data-testid="signup-email"]').fill(`${u}@example.mil`);
        await page.locator('[data-testid="signup-password"]').fill('abc123XYZ!');
        await page.locator('[data-testid="signup-password-confirm"]').fill('abc123XYZ!');
        await page.locator('[data-testid="signup-posto"]').selectOption({ index: 1 });
        await om.fill('unidade que não existe');
        await page.locator('[data-testid="signup-nome"]').click();

        let registros = 0;
        page.on('request', (r) => { if (r.url().endsWith('/auth/register')) registros += 1; });
        await page.locator('[data-testid="signup-submit"]').click();
        await expect(page.locator('[data-testid="signup-error"]'))
            .toContainText('não foi reconhecido', { timeout: 5000 });
        expect(registros).toBe(0);
    });

    /**
     * O OLHO DA SENHA (`ui/password-visibility.js`), nas três propriedades que só o navegador
     * prova: ele alterna o `type`, ele NÃO ROUBA O FOCO (sem isso o próximo caractere digitado
     * vai para o botão e não para o campo) e ele NÃO SUBMETE o formulário em que vive — um botão
     * sem `type="button"` dentro de um `<form>` é um submit, que aqui mandaria o cadastro embora
     * no primeiro clique.
     */
    test('the password eye reveals without stealing focus or submitting', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        const senha = page.locator('[data-testid="signup-password"]');
        const olho = page.locator('[data-testid="signup-password-reveal"]');
        await senha.click();
        await senha.fill('abc123XYZ!');

        await expect(senha).toHaveAttribute('type', 'password');
        await expect(olho).toHaveAttribute('aria-pressed', 'false');
        await expect(olho).toHaveAttribute('aria-label', 'Mostrar senha');

        let registros = 0;
        page.on('request', (r) => { if (r.url().endsWith('/auth/register')) registros += 1; });
        await olho.click();

        await expect(senha).toHaveAttribute('type', 'text');
        await expect(olho).toHaveAttribute('aria-pressed', 'true');
        await expect(olho).toHaveAttribute('aria-label', 'Ocultar senha');
        // O caret continua no campo: é isso que o `preventDefault` do mousedown compra.
        expect(await page.evaluate(() => document.activeElement?.dataset?.testid || null))
            .toBe('signup-password');
        // E nada foi enviado: o botão é `type="button"`.
        expect(registros).toBe(0);
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible();

        await olho.click();
        await expect(senha).toHaveAttribute('type', 'password');
        await expect(olho).toHaveAttribute('aria-pressed', 'false');
    });
});
