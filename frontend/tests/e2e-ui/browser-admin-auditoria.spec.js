// Path: e2e-ui/browser-admin-auditoria.spec.js

/**
 * @fileoverview A ABA "AUDITORIA" NUM CHROMIUM DE VERDADE, contra o backend de verdade — que
 * é a única camada capaz de afirmar que a tela DESENHA.
 *
 * POR QUE ELA PRECISA EXISTIR. As suítes de vitest deste pacote rodam com `environment: 'node'`
 * e não há jsdom, então tudo que elas alcançam da aba são as funções puras
 * (`audit-phrases.js`) e a FIAÇÃO lida da fonte. Isso prende o vocabulário e prende os elos, e
 * não prende nada do que o dono reclamou: se a tabela aparece, se o filtro recorta, se a
 * gaveta abre sem estourar a lista e se a paginação anda.
 *
 * A TRILHA É SEMEADA POR ATOS REAIS, e não por `INSERT` na tabela. É a diferença entre medir a
 * trilha e medir uma fixture: a linha precisa nascer do emissor (`createAudit`), com o
 * `target_org_id` que o emissor carimba, senão o recorte por OM do segundo caso estaria
 * medindo um carimbo escrito pelo próprio teste. As chamadas saem do lado NODE, com o token
 * que `createVerifiedUser` devolve, porque semear trinta grupos clicando no painel levaria
 * minutos e não mediria nada a mais.
 *
 * DUAS AUDIÊNCIAS, DOIS CASOS, e o segundo é o que prova o recorte da cláusula 9.2: o produtor
 * vê o ato dele sobre o acervo da OM dele, e NÃO vê os atos de grupo de acesso do
 * administrador. Um caso só de administrador passaria verde numa tela que ignorasse o recorte.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Um sufixo único por rodada, para o caso poder afirmar sobre o que ELE semeou. */
const marca = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);

/**
 * Uma chamada autenticada ao backend descartável, pelo lado Node.
 * Erro vira exceção com status e corpo: um 422 precisa aparecer como ele mesmo, e não como
 * um `toBeVisible` que falha vinte passos adiante.
 */
async function api(token, metodo, caminho, corpo) {
    const res = await fetch(`${state.baseUrl}/api/v1${caminho}`, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(`${metodo} ${caminho} → ${res.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto)?.data : null;
}

/** Entra com as credenciais e para na aba Auditoria do painel. */
async function abrirAuditoria(page, creds) {
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
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="admin-tab-audit"]').click();
    await expect(page.locator('[data-testid="admin-audit-list"]')).toBeVisible({ timeout: 15000 });
    // A LISTA CHEGOU, e não só o cartão: o "Carregando a trilha…" some quando a resposta
    // volta, e afirmar sobre a tabela antes disso mediria o esqueleto.
    await expect(page.locator('[data-testid="admin-audit-pager"]')).toBeVisible({ timeout: 15000 });
}

describeOrSkip('Painel — aba Auditoria (navegador real + backend real)', () => {
    test.afterEach(async ({ page }, testInfo) => {
        await page.screenshot({ path: testInfo.outputPath('auditoria.png'), fullPage: true });
    });

    test('o administrador: a tabela desenha, o filtro recorta, a gaveta abre e a página anda', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'audadm', nome: 'Aud Admin', role: 'admin' });

        // SEMEADURA POR ATOS REAIS. Trinta criações mais duas exclusões: passa de uma página
        // de 25 (a menor que a tela oferece), então a paginação tem para onde andar. Sem isto
        // o caso da paginação mediria um botão desabilitado.
        const etiqueta = marca();
        // QUANTAS EXCLUSÕES DE GRUPO JÁ EXISTEM ANTES DESTE CASO. O passo 3 afirma sobre o
        // recorte de `ACCESS_GROUP_DELETE`, e o caso semeia exatamente DUAS — mas o banco
        // desta camada é UM só para a rodada inteira, e uma RETENTATIVA (o `retries: 1` do
        // `playwright.config.js`) roda por cima da semeadura da tentativa anterior.
        // OBSERVADO em 2026-08-25: a tentativa 1 falhou adiante, e na retentativa o passo 3
        // recebeu "1 a 4 de 4 eventos" contra um `toContainText('2 eventos')` fixo. O
        // segundo veredito era do BANCO SUJO, não do produto, e escondia o defeito real.
        // Medir a linha de base torna a afirmação "este caso acrescentou duas", que é o que
        // ele de fato sabe, sem afrouxar nada: um filtro ignorado continua devolvendo o todo.
        const antesDeExcluir = Number(
            (await api(admin.accessToken, 'GET', '/audit?action=ACCESS_GROUP_DELETE&limit=1'))?.total ?? 0,
        );
        const criados = [];
        for (let i = 0; i < 30; i += 1) {
            const grupo = await api(admin.accessToken, 'POST', '/access-groups', {
                name: `Trilha ${etiqueta} ${i}`,
            });
            criados.push(grupo.id);
        }
        await api(admin.accessToken, 'DELETE', `/access-groups/${criados[0]}`);
        await api(admin.accessToken, 'DELETE', `/access-groups/${criados[1]}`);

        await abrirAuditoria(page, admin);

        // ----- 0. A BARRA CABE NUMA FILEIRA ---------------------------------------
        // MEDIDO ANTES E DEPOIS do redesenho de 2026-08-25, no mesmo viewport de 1280x720:
        // a barra ocupava 293px e a lista começava a 479px, isto é, sob a dobra. Numa tela de
        // consulta o assunto é a trilha, e a barra estava entre a pergunta e a resposta.
        // O teto é frouxo de propósito (o valor medido depois é ~92px): ele reprova o retorno
        // de uma segunda fileira, e não uma diferença de tipografia.
        const barra = await page.locator('[data-testid="admin-audit-toolbar"]').boundingBox();
        expect(barra.height, 'a barra de filtros voltou a comer a tela').toBeLessThan(140);
        // E A PROVA DO QUE ISSO COMPRA: a lista começa acima da metade da janela.
        const topoDaLista = (await page.locator('[data-testid="admin-audit-list"]').boundingBox()).y;
        expect(topoDaLista, 'a lista voltou para baixo da dobra')
            .toBeLessThan(page.viewportSize().height / 2);

        // ----- 1. A TABELA DESENHA, com cabeçalho de coluna -----------------------
        const tabela = page.locator('[data-testid="admin-audit-list"] table');
        await expect(tabela).toBeVisible();
        for (const coluna of ['Hora', 'Ator', 'Ação', 'Alvo', 'OM do acervo']) {
            await expect(tabela.locator('thead th', { hasText: coluna })).toHaveCount(1);
        }
        // O agrupamento por dia sobreviveu à tabela: um `<tbody>` por dia, com o cabeçalho
        // dentro dele.
        await expect(page.locator('[data-testid="admin-audit-day"]').first()).toBeVisible();
        const linhas = page.locator('[data-testid="admin-audit-row"]');
        expect(await linhas.count()).toBeGreaterThan(0);

        // ----- 2. A PAGINAÇÃO ANDA -------------------------------------------------
        await page.locator('[data-testid="admin-audit-limite"]').selectOption('25');
        const rodape = page.locator('[data-testid="admin-audit-pager"]');
        await expect(rodape).toContainText(/^1 a 25 de \d+ eventos · página 1 de \d+/);
        await expect(linhas).toHaveCount(25);
        await page.locator('[data-testid="admin-audit-next"]').click();
        await expect(rodape).toContainText(/^26 a \d+ de \d+ eventos · página 2 de \d+/);
        // E VOLTA. Uma paginação que só anda para frente esconde metade do defeito.
        await page.locator('[data-testid="admin-audit-first"]').click();
        await expect(rodape).toContainText(/página 1 de \d+/);

        // ----- 3. O FILTRO RECORTA -------------------------------------------------
        const totalAntes = Number((await rodape.textContent()).match(/de (\d+) eventos/)[1]);
        // AS DUAS EXCLUSÕES DESTE CASO, MAIS AS QUE JÁ ESTAVAM LÁ. Ver `antesDeExcluir`.
        const excluidos = antesDeExcluir + 2;
        await page.locator('[data-testid="admin-audit-acao"]').selectOption('ACCESS_GROUP_DELETE');
        await expect(rodape).toContainText(`${excluidos} eventos`);
        // A DISCRIMINAÇÃO: o recorte precisa ser MENOR que o todo, senão um filtro ignorado
        // passaria verde nas duas asserções acima.
        expect(totalAntes).toBeGreaterThan(excluidos);
        await expect(page.locator('[data-testid="admin-audit-row"]')).toHaveCount(excluidos);
        await expect(page.locator('.admin-audit__chip').first()).toHaveText('Grupo de acesso apagado');

        // O botão "Limpar filtros" só existe com filtro aplicado, e ele desfaz.
        await page.locator('[data-testid="admin-audit-limpar"]').click();
        await expect(rodape).toContainText(`de ${totalAntes} eventos`);

        // ----- 4. O NOME DO ALVO É TEXTO, E NÃO CONTROLE ---------------------------
        // Ele preenchia o filtro de alvo por id, que saiu da tela em 2026-09-20 junto com o
        // recolhimento "Apuração". A asserção aqui é a do estado NOVO, e não a ausência da
        // antiga: um botão que continuasse vivo escreveria num filtro sem controle na barra,
        // isto é, encolheria a lista sem nada dizer por quê.
        // A CLASSE, E NÃO O TESTID, e a diferença importa. O guarda
        // `frontend/tests/unit/e2e-testids-existem.test.js` varre os specs atrás de testid
        // que não existe mais em `src/`, e não sabe distinguir uma asserção de AUSÊNCIA de
        // uma mira quebrada: citar aqui o testid removido reprovava aquele guarda. A classe
        // cobre a mesma ausência e não mente para ele.
        await expect(page.locator('.admin-audit__filtro-rapido')).toHaveCount(0);

        // ----- 5. A GAVETA ABRE E NÃO ESTOURA --------------------------------------
        const primeira = page.locator('[data-testid="admin-audit-row"]').first();
        const botao = primeira.locator('[data-testid="admin-audit-details"]');
        await expect(botao).toHaveAttribute('aria-expanded', 'false');
        const alturaAntes = await page.locator('[data-testid="admin-audit-list"]')
            .evaluate((el) => el.scrollHeight);
        await botao.click();
        await expect(botao).toHaveAttribute('aria-expanded', 'true');
        const gaveta = page.locator('.admin-audit__details').first();
        await expect(gaveta).toBeVisible();
        // OS CAMPOS QUE O SERVIDOR MANDAVA E A TELA JOGAVA FORA. São eles a razão de toda
        // linha ter gaveta agora, e a de `LOGIN` (sem `details`) é a que mais precisa deles.
        await expect(gaveta).toContainText('Identificador da linha');
        await expect(gaveta).toContainText('Origem da requisição');
        await expect(gaveta).toContainText('Carimbo gravado');
        // O TETO, medido: a gaveta rola dentro de si em vez de empurrar a lista. Sem altura
        // máxima, uma linha com `details` grande tirava a paginação da tela.
        const teto = await gaveta.evaluate((el) => getComputedStyle(el).maxHeight);
        expect(teto, 'a gaveta voltou a crescer sem limite').not.toBe('none');
        const alturaDepois = await page.locator('[data-testid="admin-audit-list"]')
            .evaluate((el) => el.scrollHeight);
        expect(alturaDepois - alturaAntes,
            'a gaveta empurrou a lista mais do que o próprio teto dela').toBeLessThan(400);
        // E FECHA.
        await botao.click();
        await expect(botao).toHaveAttribute('aria-expanded', 'false');
        await expect(gaveta).not.toBeVisible();

        // ----- 6. O EIXO DE TEMPO É UM SÓ, E FECHA O INTERVALO --------------------
        // MUDOU EM 2026-08-25: os quatro botões de atalho e os dois campos de data viraram um
        // seletor com cinco valores. As duas datas só existem no modo "Datas exatas", e é isso
        // que impede o atalho e o intervalo de discordarem na tela.
        await expect(page.locator('[data-testid="admin-audit-de"]')).toHaveCount(0);
        await page.locator('[data-testid="admin-audit-periodo"]').selectOption('datas');
        // A TROCA DE MODO É CONTÍNUA: os campos nascem com a janela que estava em vigor, em vez
        // de vazios. Vazios eles seriam "tudo", e a lista mudaria debaixo de quem só trocou de
        // forma de perguntar.
        await expect(page.locator('[data-testid="admin-audit-de"]')).not.toHaveValue('');

        // A suite compartilha o banco e pode atravessar meia-noite: "ontem" pode
        // conter eventos dos casos anteriores. Uma janela anterior a todas as
        // fixtures prova o limite superior sem depender da hora da execucao.
        await page.locator('[data-testid="admin-audit-de"]').fill('2000-01-01');
        await page.locator('[data-testid="admin-audit-ate"]').fill('2000-01-01');
        await expect(page.locator('[data-testid="admin-audit-pager"]'))
            .toContainText('Nenhum evento');
        await expect(page.locator('.admin-empty__message'))
            .toContainText('Nenhum evento corresponde ao período e aos filtros.');

        // E VOLTAR PARA UM ATALHO LIMPA AS DATAS, que é o invariante do eixo único.
        await page.locator('[data-testid="admin-audit-periodo"]').selectOption('7');
        await expect(page.locator('[data-testid="admin-audit-ate"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="admin-audit-pager"]')).not.toContainText('Nenhum evento');
    });

    test('o produtor: vê o ato sobre o acervo da OM dele, e nada além dele', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'audadm2', nome: 'Aud Admin 2', role: 'admin' });
        const produtor = await createVerifiedUser({
            prefix: 'audprod', nome: 'Aud Produtor', role: 'producer', producerOrgSlug: '1-cgeo',
        });

        const etiqueta = marca();
        // O ATO DO ADMINISTRADOR que o produtor NÃO pode ver: grupo de acesso não carimba OM
        // (decisão do dono, 2026-08-24), então ele fica fora do recorte por construção.
        await api(admin.accessToken, 'POST', '/access-groups', { name: `Invisivel ${etiqueta}` });
        // O ATO DO PRODUTOR sobre o acervo da OM dele: `CATALOG_CREATE` carimba
        // `target_org_id`, que é o eixo do recorte da cláusula 9.2.
        const camada = `dl_${etiqueta}`;
        await api(produtor.accessToken, 'POST', '/data-layers', {
            id: camada,
            name: `Camada ${etiqueta}`,
            config: { source: { type: 'vector', url: '/cms/martin/x' }, sourceLayer: 'x' },
        });

        await abrirAuditoria(page, produtor);

        // A NOTA DIZ O RECORTE. Ela é o que impede o produtor de ler ausência como "não
        // aconteceu", e `escopoOrgId` chegava na resposta sem leitor nenhum no cliente.
        await expect(page.locator('[data-testid="admin-audit-nota"]'))
            .toContainText('apenas os atos sobre recursos da OM para a qual você produz');

        // A COLUNA DE OM NÃO EXISTE para ele: a resposta inteira já é de uma OM só.
        await expect(page.locator('[data-testid="admin-audit-list"] thead th', { hasText: 'OM do acervo' }))
            .toHaveCount(0);
        await expect(page.locator('[data-testid="admin-audit-om"]')).toHaveCount(0);

        // O ATO DELE ESTÁ LÁ.
        await expect(page.locator('[data-testid="admin-audit-list"]'))
            .toContainText(`Camada ${etiqueta}`);
        await expect(page.locator('.admin-audit__chip', { hasText: 'Item de catálogo criado' }).first())
            .toBeVisible();

        // E O DO ADMINISTRADOR NÃO. É a discriminação do caso: sem ela, uma tela que
        // ignorasse o recorte passaria em tudo acima.
        await expect(page.locator('[data-testid="admin-audit-list"]'))
            .not.toContainText(`Invisivel ${etiqueta}`);

        // O FILTRO NÃO OFERECE O QUE NUNCA DEVOLVE. Os cinco tipos sem OM (conta,
        // organização, atlas, grupo de acesso, configuração) e o posto ficam de fora: um
        // seletor que só produz lista vazia ensina a desconfiar da trilha inteira.
        const tipos = page.locator('[data-testid="admin-audit-tipo"] option');
        const valores = await tipos.evaluateAll((os) => os.map((o) => o.value));
        for (const semOm of ['USER', 'ORG', 'ATLAS', 'ACCESS_GROUP', 'CONFIG', 'RANK']) {
            expect(valores, `${semOm} não devolve linha para o produtor`).not.toContain(semOm);
        }
        // PISO: sobrou o que ele de fato alcança. Um seletor vazio passaria em toda ausência.
        expect(valores).toContain('DATA_LAYER');
        expect(valores).toContain('SV360_PROJECT');

        // A APURAÇÃO INTEIRA SAIU EM 2026-09-20 (decisão do dono): o botão, o recolhimento,
        // o selo de contagem e os três campos de dentro (alvo por id, ator por id e OM do
        // acervo). A asserção é de AUSÊNCIA dos quatro, e ela vale por um motivo que não é de
        // arrumação: o campo de ator era o único controle daquele filtro, e uma volta parcial
        // (o filtro sem o campo) é recorte invisível numa trilha.
        for (const testid of [
            'admin-audit-apuracao', 'admin-audit-apuracao-painel',
            'admin-audit-apuracao-contagem', 'admin-audit-ator', 'admin-audit-om',
        ]) {
            await expect(page.locator(`[data-testid="${testid}"]`), testid).toHaveCount(0);
        }

        // PISO: a barra continua com os dois filtros da consulta do dia a dia. Sem ele, as
        // ausências acima passariam numa aba que não desenhou barra nenhuma.
        await expect(page.locator('[data-testid="admin-audit-acao"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-audit-tipo"]')).toBeVisible();
    });
});
