// Path: e2e-ui/atlas-local-ebgeo-e-teardown.spec.js

/**
 * @fileoverview As duas metades do passo 3, medidas em Chromium de verdade porque nenhuma delas
 * existe dentro de UM processo.
 *
 * A. ABRIR UM `.ebgeo` PELA TELA, DESLOGADO. O produtor (`atlas.html`) e o consumidor (o boot do
 *    mapa) são DUAS PÁGINAS, e o que as liga é uma chave do banco global mais uma navegação. Um
 *    teste de nó pode provar `savePendingImport`/`takePendingImport` (e prova, em
 *    `tests/unit/atlas-namespace.test.js`), mas não pode provar que a tela grava, navega, e que o
 *    boot do OUTRO documento acha aquilo e importa. É a mesma razão pela qual a migração 2.2 tem um
 *    arquivo aqui além dos 22 casos de nó.
 *
 *    DESDE 2026-08-16 A TELA NÃO CRIA MAIS O ATLAS: ela entrega o arquivo e navega, e quem cria o
 *    slot é o consumidor do boot, imediatamente antes de importar. O contador de slots deste caso
 *    (`slotsAntes + 1`, cobrado ANTES e DEPOIS do reload) é o que prova que a mudança de lado não
 *    virou uma criação a mais nem uma a menos: era exatamente daquele lado que nascia o "slot
 *    órfão" de todo boot que recusava a entrega.
 *
 * B. EXCLUIR UM ATLAS LOCAL AVISA A ABA IRMÃ. O protocolo é medido em
 *    `tests/unit/tab-lock.test.js` e o freio em `tests/unit/tab-lock-sync-brake.test.js`, cada um
 *    com o outro lado dublado. Aqui são duas ABAS de verdade, com BroadcastChannel de verdade e
 *    IndexedDB de verdade, e o que se lê é o texto que o usuário lê.
 *
 * O TEXTO DO OVERLAY É ASSERIDO POR EXTENSO, e não por "existe um overlay": o defeito que o campo
 * `reason` corrigiu era exatamente um overlay presente com a frase errada (dizia que a SESSÃO tinha
 * acabado e que recarregar descartaria trabalho não enviado, ambas falsas para um atlas local que
 * alguém excluiu). Um caso que só contasse o overlay teria passado verde no defeito.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { fileURLToPath } from 'node:url';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Um `.ebgeo` real, o mesmo que a suíte de migração usa (11 mapas + imagens). */
const FIXTURE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/01-completo.ebgeo', import.meta.url));

/** Espera o mapa 2D estar de pé. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 30000 },
    );
}

/**
 * Abre a aba Mapas UMA vez. O botão é um TOGGLE: clicá-lo de novo com a aba aberta fecha a barra
 * lateral, e um poll que clicasse a cada rodada leria a lista em estados alternados.
 */
async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
        .toBeVisible({ timeout: 15000 });
}

/** As chaves de armazenamento dos cartões de mapa (a aba já tem de estar aberta). */
function chavesDeMapa(page) {
    return page.locator('.maps-tab .map-list-item[data-map-name]')
        .evaluateAll((els) => els.map((el) => el.dataset.mapName));
}

describeOrSkip('atlas local: abrir .ebgeo pela tela', () => {
    test('o arquivo vira um atlas local novo, e a entrega é consumida UMA vez', async ({ page }) => {
        test.setTimeout(180000);

        // Deslogado: a metade local é o produto inteiro para quem não tem conta.
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('[data-testid="local-atlas-open-file"]')).toBeVisible();
        await expect(page.locator('[data-testid="server-invite"]')).toBeVisible();
        const slotsAntes = await page.locator('[data-testid="local-atlas-item"]').count();

        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(FIXTURE);

        // A tela NAVEGA; quem importa é o mapa.
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);
        await abrirAbaMapas(page);
        // O importador reconstrói a lista de mapas ao terminar. ONZE, não doze: a fixture traz
        // dez mapas MAIS um "Principal" próprio, que o slot novo também tem, e a lista de nomes é
        // de-duplicada por nome (`getAllMapNamesStore`).
        await expect
            .poll(() => chavesDeMapa(page).then((lista) => lista.length), { timeout: 30000 })
            .toBe(11);

        const mapas = await chavesDeMapa(page);
        // Por NOME, e absoluto: um "mais de um" passaria com um mapa só.
        expect(mapas).toContain('11 Bordas');
        expect(mapas).toContain('02 Estilos');
        expect(mapas).toContain('Principal');

        // O atlas nasceu com o nome do ARQUIVO, e é local.
        await expect(page.locator('.atlas-header__name')).toHaveValue('01-completo');
        await expect(page.locator('[data-testid="atlas-origin-chip"]')).toHaveText('Local');

        // A ENTREGA FOI CONSUMIDA. Nada neste repositório varre o banco global, então um registro
        // que sobrevivesse seria megabytes presos para sempre, reimportando a cada F5.
        const estado = await page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const slots = await ns.readLocalAtlasRegistry();
            const atual = await ns.getGlobalStore().getItem(ns.GlobalKey.CURRENT_LOCAL_ATLAS);
            return {
                pendente: await ns.getGlobalStore().getItem(ns.GlobalKey.PENDING_IMPORT),
                nomes: slots.map((slot) => slot.name),
                nomeDoAtual: slots.find((slot) => slot.id === atual)?.name ?? null,
                idsDeMapa: (await getRepository().getAllMapIds()).slice().sort(),
            };
        });
        expect(estado.pendente).toBeNull();
        expect(estado.nomes).toContain('01-completo');
        expect(estado.nomeDoAtual).toBe('01-completo');
        // ABSOLUTO, e é o que dá sentido à comparação de conjuntos lá embaixo: sem ele, dois
        // arrays VAZIOS satisfariam "o segundo boot não reimportou". As asserções acima provam
        // os onze mapas pela UI, que lê `getAllMapNamesStore`; esta prova a MESMA coisa pela
        // fonte que o controle realmente compara, e um repositório apontado para o slot errado
        // devolveria [] sem contradizer nenhuma delas.
        //
        // DOZE CHAVES PARA ONZE NOMES, e a diferença é a de-duplicação que o poll de cima já
        // explica: os onze mapas da fixture entram com CHAVE UUID (`addMap` keya por UUID sempre
        // que o log de operações está ligado, o que `initServices` faz no boot), e ao lado deles
        // fica o `Principal` em branco, keyado pelo NOME, que `initializeRepository` escreve no
        // slot recém-esvaziado. O `Principal` da fixture e o em branco colidem por NOME e somem
        // um no outro na lista da UI; por CHAVE são dois.
        //
        // (Esta linha dizia ONZE e estava vermelha ANTES desta mudança: medido em 2026-08-16
        // rodando este mesmo caso contra o fluxo antigo, que devolveu as mesmas doze chaves.
        // Não é regressão da criação do slot ter mudado de lado.)
        expect(estado.idsDeMapa.length).toBe(12);
        expect(estado.idsDeMapa).toContain('Principal');
        // O slot é NOVO: o atlas que o usuário tinha aberto não foi substituído. É a razão de o
        // boot criar um slot em vez de deixar o import não-aditivo cair no atlas corrente.
        expect(estado.nomes.length).toBe(slotsAntes + 1);

        // E UM SEGUNDO BOOT NÃO REIMPORTA — que é o controle de que `pendente: null` significa
        // "consumido" e não "nunca gravado". A prova são as CHAVES DE ARMAZENAMENTO: uma
        // reimportação esvazia o slot e recria os mapas com UUIDs novos, então o conjunto mudaria.
        // (A lista da UI não serve aqui: um slot local não-legado exibe os mapas por UUID depois de
        // um reload, defeito PRÉ-EXISTENTE do passo 1 — `mapResolver.initialize()` roda dentro de
        // `initServices()`, antes de `activateBootAtlasScope`, e fica preso aos bancos legados.)
        await page.reload();
        await esperarMapa(page);
        await abrirAbaMapas(page);
        const depois = await page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            return {
                pendente: await ns.getGlobalStore().getItem(ns.GlobalKey.PENDING_IMPORT),
                nomes: (await ns.readLocalAtlasRegistry()).map((slot) => slot.name),
                idsDeMapa: (await getRepository().getAllMapIds()).slice().sort(),
            };
        });
        expect(depois.pendente).toBeNull();
        expect(depois.idsDeMapa).toEqual(estado.idsDeMapa);
        // E O SEGUNDO BOOT NÃO CRIA UM SEGUNDO SLOT. O consumidor é quem cria agora, e o passo que
        // o impede de criar de novo é o mesmo que impede a reimportação (a entrega já não existe):
        // um consumidor que criasse ANTES de ler a entrega gastaria um dos dez atlas a cada F5.
        expect(depois.nomes.length).toBe(slotsAntes + 1);
    });
});

describeOrSkip('atlas local: excluir avisa a aba irmã', () => {
    test('a irmã congela com a frase do atlas local, não com a da sessão encerrada', async ({ browser }) => {
        test.setTimeout(180000);
        const context = await browser.newContext();

        // Aba 1: a tela, que cria um slot.
        const tela = await context.newPage();
        await tela.goto('/atlas.html');
        await expect(tela.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await tela.locator('[data-testid="local-atlas-create"]').click();
        await tela.locator('[data-testid="local-atlas-name-input"]').fill('Alvo do aviso');
        await tela.locator('[data-testid="local-atlas-name-confirm"]').click();
        await expect(tela.locator('[data-testid="local-atlas-item"]', { hasText: 'Alvo do aviso' }))
            .toBeVisible({ timeout: 10000 });

        // Aba 2: o mapa, DENTRO desse slot.
        const mapa = await context.newPage();
        await mapa.goto('/atlas.html');
        await mapa.locator('[data-testid="local-atlas-item"]', { hasText: 'Alvo do aviso' }).click();
        await esperarMapa(mapa);
        await abrirAbaMapas(mapa);
        await expect(mapa.locator('.atlas-header__name')).toHaveValue('Alvo do aviso', { timeout: 15000 });
        // Premissa asserida: nada de overlay antes do aviso, senão o caso passaria por um bloqueio
        // qualquer em vez de pelo aviso.
        await expect(mapa.locator('.tab-lock-overlay--visible')).toHaveCount(0);

        // De volta à tela: excluir o slot que a outra aba tem montado.
        await tela.reload();
        await expect(tela.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        const alvo = tela.locator('[data-testid="local-atlas-item"]', { hasText: 'Alvo do aviso' });
        await alvo.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await tela.locator('[data-testid="local-atlas-delete"]').click();
        await tela.locator('.confirm-modal-btn-confirm').click();

        // A irmã parou, e o texto é o do atlas local.
        const overlay = mapa.locator('.tab-lock-overlay--visible');
        await expect(overlay).toBeVisible({ timeout: 20000 });
        await expect(overlay).toContainText('Este atlas local foi excluído');
        await expect(overlay).toContainText('parou de gravar');
        // O CONTROLE que o campo `reason` existe para dar: a frase da sessão encerrada mentiria
        // duas vezes aqui (ninguém saiu da conta, e não há trabalho não enviado a descartar).
        await expect(overlay).not.toContainText('saiu da conta');
        await expect(overlay).not.toContainText('projeto do servidor');

        // E o slot sumiu da tela, que é o efeito que o usuário pediu.
        await expect(tela.locator('[data-testid="local-atlas-item"]', { hasText: 'Alvo do aviso' }))
            .toHaveCount(0, { timeout: 10000 });

        await context.close();
    });
});
