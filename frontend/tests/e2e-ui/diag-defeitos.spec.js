// Path: e2e-ui/diag-defeitos.spec.js

/**
 * @fileoverview O CICLO DE VIDA DE UM DEFEITO NUM CHROMIUM DE VERDADE, contra o backend de
 * verdade, que é a única camada capaz de afirmar que a tela DESENHA e que o ato CHEGA.
 *
 * POR QUE ELE PRECISA EXISTIR. As suítes de vitest deste pacote rodam com `environment: 'node'` e
 * não há jsdom, então tudo que elas alcançam da seção "Defeitos" são as funções puras
 * (`defeito-frases.test.js`) e a FIAÇÃO lida da fonte (`diagnostico-secoes-de-log.test.js`). Isso
 * prende o vocabulário e prende os elos, e não prende nada do que importa aqui: se a linha
 * aparece, se o `PATCH` sai, se a tela relê o estado que o SERVIDOR devolveu, e se a regressão
 * automática do banco chega até o chip.
 *
 * O DEFEITO É SEMEADO PELA ROTA ANÔNIMA, e não por `INSERT` na tabela. É a diferença entre medir o
 * produto e medir uma fixture: `POST /diag/erro-cliente` é o caminho por onde todo erro de
 * navegador de verdade entra, e é ele que monta a assinatura, o upsert, a ocorrência e as
 * migalhas. Um insert direto pularia o CASE de `UPSERT_DEFEITO`, que é justamente a única
 * transição automática do produto e o sujeito do terceiro passo.
 *
 * A MARCA ÚNICA POR RODADA é o que torna as asserções afirmações sobre o que ESTE caso semeou. O
 * banco desta camada é UM só para a rodada inteira, e outras specs relatam erros nele; procurar a
 * linha pelo texto da mensagem (que carrega a marca) é o que impede o caso de medir o defeito de
 * outra pessoa. Uma RETENTATIVA (o `retries: 1` do `playwright.config.js`) gera marca nova, então
 * ela não herda o estado da tentativa anterior.
 *
 * A REGRESSÃO É POR RELEASE DIFERENTE, e o segundo relato usa uma release distinta de propósito:
 * a leitura ingênua ("chegou ocorrência depois de eu resolver, logo regrediu") acusaria todo
 * defeito consertado sempre que um navegador com o bundle velho em cache disparasse o erro de
 * novo. O caso mede a regra certa.
 *
 * O PASSO 5 AMARRA A SEÇÃO "RESUMO" À MESMA REGRESSÃO, e ele existe porque aquele cartão lê OUTRA
 * rota (`GET /diag/resumo`) e outra composição (`montarResumo`, no servidor): os dois números saem
 * da mesma tabela e nada obriga os dois caminhos a concordarem. Ele fica AQUI, e não num arquivo
 * próprio, porque o fato que ele conta é o que este caso acabou de provocar, e semeá-lo de novo
 * noutra spec custaria o dobro para medir menos.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Um sufixo único por rodada, para o caso poder afirmar sobre o que ELE semeou. */
const marca = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);

/**
 * Relata um erro de navegador pela rota ANÔNIMA, do lado Node.
 *
 * Ela responde 204 e sem corpo: um `res.ok` falso vira exceção aqui, porque um 422 precisa
 * aparecer como ele mesmo e não como um `toBeVisible` que falha vinte passos adiante.
 * @param {Object} corpo
 */
async function relatar(corpo) {
    const res = await fetch(`${state.baseUrl}/api/v1/diag/erro-cliente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
    });
    if (!res.ok) {
        const texto = await res.text();
        throw new Error(`POST /diag/erro-cliente → ${res.status}: ${texto.slice(0, 300)}`);
    }
}

/** Entra com as credenciais e para na aba Diagnóstico do painel. */
async function abrirDiagnostico(page, creds) {
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
    // A PORTA É A URL, e não o menu: `?aba=` já é o contrato do painel (`_initialTabId`), e passar
    // pelo mapa para clicar no menu da conta custaria o boot do mapa inteiro por nada.
    await page.goto('/admin.html?aba=diagnostico');
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    // A LISTA CHEGOU, e não só a seção: o "Carregando…" some quando a resposta volta, e afirmar
    // sobre a tabela antes disso mediria o esqueleto.
    await expect(page.locator('[data-testid="admin-diag-defeitos-tabela"]')).toBeVisible({ timeout: 20000 });
}

/** A linha da tabela de defeitos que carrega a marca deste caso. */
const linhaDe = (page, etiqueta) => page
    .locator('[data-testid="admin-diag-defeito-linha"]')
    .filter({ hasText: etiqueta });

describeOrSkip('Painel — aba Diagnóstico, o ciclo de vida de um defeito', () => {
    test('nasce aberto, resolve, regride numa release nova, e a gaveta mostra as migalhas', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'diagadm', nome: 'Diag Admin', role: 'admin' });
        const etiqueta = marca();
        const assinatura = `TypeError | /diag-e2e | boom-${etiqueta}`;
        const mensagem = `Cannot read properties of null (boom-${etiqueta})`;
        const relato = {
            assinatura,
            mensagem,
            pagina: 'index.html',
            url: 'https://exemplo/index.html?a=1',
            origem: 'nao-tratado',
            stack: `TypeError: boom-${etiqueta}\n    at algo (bundle.js:1:1)`,
            migalhas: [{ t: Date.now(), tipo: 'api', texto: 'GET /x 200 5ms' }],
        };

        // ----- 1. NASCE ABERTO -----------------------------------------------------
        await relatar({ ...relato, release: `v1-${etiqueta}` });
        await abrirDiagnostico(page, admin);

        const linha = linhaDe(page, etiqueta);
        await expect(linha).toHaveCount(1, { timeout: 15000 });
        await expect(linha.locator('[data-testid="admin-diag-estado"]')).toHaveText('Aberto');
        // A DISCRIMINAÇÃO DO PASSO SEGUINTE: o estado sai também como DADO, e é ele que uma
        // captura de tela consegue afirmar sem depender do texto.
        await expect(linha).toHaveAttribute('data-estado', 'aberto');
        // E a coluna de releases já mostra o percurso de uma build só.
        await expect(linha.locator('.admin-diag__releases')).toHaveText(`v1-${etiqueta}`);

        // ----- 2. RESOLVER, SEM COMMIT ---------------------------------------------
        // O campo de commit é OPCIONAL: resolver sem saber o hash é desfecho legítimo, e é este
        // caminho (confirmar com o campo em branco) que o caso mede.
        await linha.locator('[data-testid="admin-diag-acao"][data-acao="resolver"]').click();
        await expect(linha.locator('[data-testid="admin-diag-commit"]')).toBeVisible();
        await linha.locator('[data-testid="admin-diag-commit-confirmar"]').click();

        // A LINHA É RELIDA DA RESPOSTA DO `PATCH`, sem recarregar a aba: se ela só mudasse depois
        // de um `reload`, este `expect` falharia, que é exatamente a distinção que ele existe para
        // fazer.
        await expect(linhaDe(page, etiqueta).locator('[data-testid="admin-diag-estado"]'))
            .toHaveText('Resolvido', { timeout: 15000 });
        await expect(linhaDe(page, etiqueta)).toHaveAttribute('data-estado', 'resolvido');
        // O ato NÃO oferece mais "Resolver", e oferece o caminho de volta: a lista de atos é por
        // ESTADO, e não por papel.
        await expect(linhaDe(page, etiqueta)
            .locator('[data-testid="admin-diag-acao"][data-acao="resolver"]')).toHaveCount(0);
        await expect(linhaDe(page, etiqueta)
            .locator('[data-testid="admin-diag-acao"][data-acao="reabrir"]')).toHaveCount(1);

        // ----- 3. REGRIDE NUMA RELEASE NOVA ----------------------------------------
        // A transição é do BANCO (o CASE de `UPSERT_DEFEITO`), e a release do segundo relato é
        // diferente da primeira de propósito: build desconhecida não é build diferente.
        await relatar({ ...relato, release: `v2-${etiqueta}` });
        await page.reload();
        await expect(page.locator('[data-testid="admin-diag-defeitos-tabela"]')).toBeVisible({ timeout: 20000 });

        const regredida = linhaDe(page, etiqueta);
        await expect(regredida.locator('[data-testid="admin-diag-estado"]'))
            .toHaveText('Regrediu', { timeout: 15000 });
        await expect(regredida).toHaveAttribute('data-estado', 'regrediu');
        // O PERCURSO DAS DUAS BUILDS: nascido na primeira, ainda vivo na segunda.
        await expect(regredida.locator('.admin-diag__releases'))
            .toHaveText(`v1-${etiqueta} → v2-${etiqueta}`);

        // ----- 4. A GAVETA, E A TRILHA DA OCORRÊNCIA -------------------------------
        // Ela carrega na PRIMEIRA abertura, e não com a lista: por isso o clique é o que dispara
        // a segunda rota.
        await regredida.locator('[data-testid="admin-diag-gaveta-botao"]').click();
        const gaveta = page.locator('[data-testid="admin-diag-gaveta"]').filter({ hasText: etiqueta });
        await expect(gaveta.locator('[data-testid="admin-diag-ocorrencia"]').first())
            .toBeVisible({ timeout: 15000 });
        // Duas ocorrências, uma por relato, com a mais recente em cima.
        await expect(gaveta.locator('[data-testid="admin-diag-ocorrencia"]')).toHaveCount(2);
        // A MIGALHA É DA OCORRÊNCIA, e é ela que responde "o que a pessoa estava fazendo": nem a
        // mensagem nem a pilha respondem isso.
        await expect(gaveta.locator('[data-testid="admin-diag-migalha"]').first())
            .toContainText('GET /x 200 5ms', { timeout: 15000 });
        await expect(gaveta.locator('[data-testid="admin-diag-migalha"]').first())
            .toContainText('api');

        // ----- 5. O RESUMO CONTA A REGRESSÃO ---------------------------------------
        // O CARTÃO LÊ OUTRA ROTA (`GET /diag/resumo`) e outra composição (`montarResumo`, no
        // servidor), então ele pode divergir da tabela acima sem nada ficar vermelho: os dois
        // números vêm da mesma tabela do banco, mas por caminhos que ninguém obriga a concordar.
        // Este caso é o que os amarra, e ele é da MESMA rodada porque a regressão que ele conta é a
        // que o passo 3 acabou de provocar.
        const cartao = page.locator('[data-testid="admin-diag-resumo-cartao"][data-bloco="defeitos"]');
        // O DESFECHO PRIMEIRO, e não o número: um cartão sem fonte não desenha contagem nenhuma, e
        // sem esta linha um `toMatch` que não casasse nada seria indistinguível de "zero
        // regressões". É a mesma regra que o cartão impõe à tela.
        await expect(cartao).toHaveAttribute('data-desfecho', 'disponivel', { timeout: 15000 });
        const texto = await cartao.locator('[data-testid="admin-diag-resumo-corpo-defeitos"]').innerText();
        const regressoes = /(\d+) regress/.exec(texto);
        expect(regressoes, `o cartão não disse quantas regressões: ${texto.slice(0, 200)}`).toBeTruthy();
        // MAIOR OU IGUAL A UM, e não igual: o banco desta camada é UM só para a rodada inteira e
        // outras specs relatam erros nele, então afirmar o número exato mediria o trabalho alheio.
        // O que ESTE caso semeou é a regressão do passo 3, e é a existência dela que se cobra.
        expect(Number(regressoes[1])).toBeGreaterThanOrEqual(1);
        // E a premissa sai junto do número, que é a regra dos seis cartões: contagem sem
        // procedência é a frase tranquilizadora que já mentiu por meses no comando.
        await expect(cartao.locator('[data-testid="admin-diag-resumo-premissa"]'))
            .toContainText('Premissa:');
    });
});
