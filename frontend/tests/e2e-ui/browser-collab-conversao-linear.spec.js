// Path: e2e-ui/browser-collab-conversao-linear.spec.js

/**
 * CONVERTER LINHA <-> SETA <-> LIMITE, com DUAS browsers reais e o backend real.
 *
 * ================= O QUE SÓ AQUI SE MEDE =====================================
 *
 * `conversao-linear.test.js` mede a DECISÃO (quem vê o comando, o que atravessa) e
 * `conversao-linear-menu-fiacao.test.js` mede a FIAÇÃO por texto. Nenhum dos dois alcança as
 * três coisas que este arquivo existe para provar:
 *
 *   1. QUE A TRAVESSIA CHEGA AO PAR. Converter é um CREATE de um id novo mais um DELETE do id
 *      antigo. Do outro lado da rede isso tem de virar exatamente uma feição nova no balde
 *      certo e uma feição sumida no balde antigo — e não as duas vivas, que é o desfecho da
 *      recusa parcial.
 *   2. QUE O POSTO SOME. Um Leitor não recebe os comandos de conversão, com o menu montado ao
 *      redor deles para provar que a ausência não é uma tela vazia.
 *   3. QUE O ESTADO RECUSA O CLIQUE. Com a CAMADA travada o comando CONTINUA desenhado, sai
 *      com `aria-disabled` e SEM a propriedade `disabled` (um botão desabilitado não dispara
 *      clique, e o clique é o portador do motivo), o clique mostra a frase, e NADA é escrito
 *      dos dois lados. O toast sozinho não provaria isso: era justamente a combinação "toast
 *      de sucesso + escrita recusada" que motivou a mudança. É a camada, e não o mapa, por
 *      dois motivos medidos: com o MAPA travado o painel esconde a engrenagem inteira
 *      (`.feature-panel--locked`, anterior a este lote), então o ramo `mapLocked` do modelo
 *      não é alcançável por esta tela e fica com o teste de unidade; e a op de store
 *      `toggleMapLock` é estado LOCAL de quem a chamou (quem leva a trava ao servidor e ao
 *      par é `mapLockController`), então a primeira versão deste arquivo, que travava pela
 *      op crua e esperava a trava no Editor, falhava sempre.
 *
 * Rodar headed:  npx playwright test browser-collab-conversao-linear --headed
 */

import {
    collabTest, expect,
    drawLineUI, readFeatures, selectFeatureUI,
} from './helpers/collab.fixtures.js';
import { pollPeerFeature, pollPeerFeatureGone } from './helpers/collab-helpers.js';

/** Drives a store op through the app's REAL store facade (no-UI escape for the map lock). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Abre o menu de opções da feição já selecionada (a engrenagem do painel). */
async function openFeatureMenu(page) {
    const gear = page.locator('.feature-panel[data-expanded="true"] .feature-options-button').first();
    await expect(gear).toBeVisible({ timeout: 10000 });
    await gear.click();
    const menu = page.locator('.feature-dropdown-content');
    await expect(menu).toBeVisible({ timeout: 8000 });
    return menu;
}

/** A linha do menu que converte para aquele tipo. */
const conversionRow = (menu, label) =>
    menu.locator('.feature-menu-button', { hasText: new RegExp(`^${label}$`) });

/**
 * Dispara o clique numa linha do menu. O handler da linha começa por
 * `closeAllFeatureDropdowns`, que REMOVE o próprio botão: o `click()` do Playwright, ao ver o
 * alvo sair do DOM no meio do gesto, tenta de novo e espera para sempre por um botão que já
 * cumpriu o papel (medido: um caso em três rodadas ficou preso 60 s com a conversão já feita).
 * O evento direto entrega o mesmo `click` ao mesmo handler, sem a espera de estabilidade que
 * não faz sentido para um botão que se destrói. O gesto real de abrir o menu continua sendo
 * o `gear.click()` de `openFeatureMenu`.
 */
const clickRow = (row) => row.dispatchEvent('click');

/** O id da construção de conteúdo que o painel mostra agora (null sem painel). */
const renderIdDoPainel = (page) => page.evaluate(
    () => document.querySelector('.feature-panel-sections')?.dataset.renderId ?? null,
);

/**
 * Seleciona a feição e devolve a linha de conversão pedida.
 *
 * O conteúdo do painel é reconstruído de forma ASSÍNCRONA a cada seleção, e o conteúdo
 * anterior, engrenagem incluída, continua no DOM até o novo chegar: um clique nessa
 * engrenagem abre um menu que a troca de conteúdo descarta (medido em 1 de 3 rodadas na
 * seta recém-convertida, cujo painel já estava aberto). `renderId` muda a cada construção;
 * esperar por um novo é esperar pelo conteúdo certo.
 */
async function openConversionRow(page, featureId, label) {
    await selectAndSettle(page, featureId);
    const menu = await openFeatureMenu(page);
    return { menu, row: conversionRow(menu, label) };
}

/**
 * Seleciona a feição e espera o painel ASSENTAR antes de qualquer clique na engrenagem.
 *
 * Era o corpo de `openConversionRow`, e só ela esperava: o caso do Leitor selecionava e abria a
 * engrenagem em seguida, e a cascata de reconstruções do painel descartava o menu recém-aberto
 * (1 em 3 rodadas isoladas, 2 de 2 sob a carga da rodada inteira em 2026-09-04). A espera é a
 * mesma para todo caminho que vai clicar no painel depois de selecionar.
 */
async function selectAndSettle(page, featureId) {
    const antes = await renderIdDoPainel(page);
    await selectFeatureUI(page, featureId);
    await page.waitForFunction((id) => {
        const el = document.querySelector('.feature-panel[data-expanded="true"] .feature-panel-sections');
        return Boolean(el) && el.dataset.renderId !== id;
    }, antes, { timeout: 10000 });
    // E QUIETO POR UM SEGUNDO: uma seleção dispara mais de uma reconstrução (o painel abre, e a
    // ferramenta chama updatePanels ao selecionar; há reconstruções mais tardias que este
    // arquivo não mapeou), e cada uma descarta o menu aberto sobre a anterior. Medido: com 400 ms
    // de janela o menu do Leitor sumia em 2 de 3 rodadas; sem janela nenhuma, 1 em 3 na seta
    // recém-convertida. A janela de um segundo cobre a cascata inteira das rodadas medidas.
    let ultimo = await renderIdDoPainel(page);
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const atual = await renderIdDoPainel(page);
        if (atual === ultimo) break;
        ultimo = atual;
    }
}

/** O id da única feição daquele balde que ainda não estava lá. */
async function newFeatureId(page, storage, jaConhecidos) {
    const atuais = await readFeatures(page, storage);
    const novos = atuais.map((f) => f.id).filter((id) => !jaConhecidos.includes(id));
    expect(novos, `esperava exatamente uma feição nova em ${storage}`).toHaveLength(1);
    return novos[0];
}

// ============================================================================
// A TRAVESSIA, IDA E VOLTA, ATÉ O PAR
// ============================================================================

collabTest.describe('Conversão linear — a travessia chega ao par', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

    collabTest('linha -> seta -> linha: B ganha a nova e PERDE a antiga, nas duas direções', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // 1. A desenha uma linha com a ferramenta real e ela percorre a cadeia até B.
        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId, 'a ferramenta de linha criou a feição em A').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        // 2. A CONVERTE para seta, pelo menu real.
        const setasAntes = (await readFeatures(A, 'arrows')).map((f) => f.id);
        const { row } = await openConversionRow(A, lineId, 'Converter para Seta');
        await expect(row).toBeVisible();
        await expect(row).not.toHaveAttribute('aria-disabled', 'true');
        await clickRow(row);

        await expect(A.locator('.toast--success', { hasText: /convertida/i })).toBeVisible({ timeout: 10000 });

        // 3. Em A: a seta existe e a linha sumiu.
        await expect.poll(async () => (await readFeatures(A, 'arrows')).length, { timeout: 10000 })
            .toBe(setasAntes.length + 1);
        const arrowId = await newFeatureId(A, 'arrows', setasAntes);
        expect(await readFeatures(A, 'lines').then((l) => l.some((f) => f.id === lineId)),
            'a linha saiu da store de A').toBe(false);

        // 4. Em B: a seta chega e a linha some. As DUAS metades, porque só a primeira seria
        //    duplicação silenciosa e só a segunda seria perda de dado.
        await pollPeerFeature(B, 'arrows', arrowId);
        await pollPeerFeatureGone(B, 'lines', lineId);

        // 5. E o estilo autoral atravessou: a cor da linha virou o corpo E o contorno da seta.
        const setaEmB = (await readFeatures(B, 'arrows')).find((f) => f.id === arrowId);
        expect(setaEmB?.props?.fillColor).toBeTruthy();
        expect(String(setaEmB.props.fillColor).toLowerCase())
            .toBe(String(setaEmB.props.lineColor).toLowerCase());

        // 6. A VOLTA, pelo mesmo menu: seta -> linha.
        const linhasAntes = (await readFeatures(A, 'lines')).map((f) => f.id);
        const volta = await openConversionRow(A, arrowId, 'Converter para Linha');
        await expect(volta.row).toBeVisible();
        await clickRow(volta.row);
        await expect(A.locator('.toast--success', { hasText: /convertida/i })).toBeVisible({ timeout: 10000 });

        await expect.poll(async () => (await readFeatures(A, 'lines')).length, { timeout: 10000 })
            .toBe(linhasAntes.length + 1);
        const backLineId = await newFeatureId(A, 'lines', linhasAntes);

        await pollPeerFeature(B, 'lines', backLineId);
        await pollPeerFeatureGone(B, 'arrows', arrowId);
    });

    collabTest('linha -> limite: o par recebe o limite com a âncora de zoom', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const lineId = await drawLineUI(A, [[-43.4, -23.1], [-43.35, -23.05], [-43.3, -23.0]]);
        expect(lineId).toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        const limitesAntes = (await readFeatures(A, 'boundarys')).map((f) => f.id);
        const { row } = await openConversionRow(A, lineId, 'Converter para Linha de Limite');
        await clickRow(row);
        await expect(A.locator('.toast--success', { hasText: /convertida/i })).toBeVisible({ timeout: 12000 });

        await expect.poll(async () => (await readFeatures(A, 'boundarys')).length, { timeout: 12000 })
            .toBe(limitesAntes.length + 1);
        const boundaryId = await newFeatureId(A, 'boundarys', limitesAntes);

        await pollPeerFeature(B, 'boundarys', boundaryId);
        await pollPeerFeatureGone(B, 'lines', lineId);

        // A ÂNCORA DE ZOOM É O QUE PERMITE AO PAR REDESENHAR o limite no tamanho certo. Ela é
        // gravada na conversão, e não herdada dos padrões (que carregam o sentinela de "nunca
        // ancorado"): um limite sem âncora desenha como feição legada, sem correção nenhuma.
        const limiteEmB = (await readFeatures(B, 'boundarys')).find((f) => f.id === boundaryId);
        expect(limiteEmB?.props?.zoomCorrectionEnabled).toBe(true);
        expect(typeof limiteEmB.props.createdAtZoom).toBe('number');
        expect(limiteEmB.props.createdAtZoom).toBeGreaterThan(0);
    });
});

// ============================================================================
// POSTO: o comando SOME
// ============================================================================

collabTest.describe('Conversão linear — POSTO (Leitor)', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read' } });

    collabTest('um Leitor não recebe comando de conversão nenhum, e o menu continua montado', async ({ collab }) => {
        const A = collab.author;   // dono
        const B = collab.peers[0]; // Leitor

        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId).toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });
        await pollPeerFeature(B, 'lines', lineId);

        // A mesma espera dos outros caminhos: sem ela, a cascata de reconstruções do painel
        // descartava o menu do Leitor logo depois de aberto (o caso instável de 2026-09-04).
        await selectAndSettle(B, lineId);
        const menu = await openFeatureMenu(B);

        // AUSÊNCIA, nunca linha bloqueada: converter é um CREATE mais um DELETE, e um Leitor
        // não vira Editor a partir deste menu.
        await expect(conversionRow(menu, 'Converter para Seta')).toHaveCount(0);
        await expect(conversionRow(menu, 'Converter para Linha de Limite')).toHaveCount(0);

        // CONTROLE: o menu ESTÁ montado. Sem isto, uma tela quebrada passaria em toda asserção
        // de ausência acima.
        await expect(menu.locator('.feature-menu-button', { hasText: 'Selecionar todos com mesmo tipo' }))
            .toBeVisible();

        // E o dono, no mesmo atlas, RECEBE os dois: o par que prova que a ausência é do posto.
        const { menu: menuDoDono } = await openConversionRow(A, lineId, 'Converter para Seta');
        await expect(conversionRow(menuDoDono, 'Converter para Seta')).toBeVisible();
        await expect(conversionRow(menuDoDono, 'Converter para Linha de Limite')).toBeVisible();
    });
});

// ============================================================================
// ESTADO: o comando é desenhado e o CLIQUE recusa
// ============================================================================

collabTest.describe('Conversão linear — ESTADO (camada travada)', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

    collabTest('camada travada: o comando continua desenhado, o clique recusa, e nada é escrito', async ({ collab }) => {
        const A = collab.author;   // dono, e é ele quem trava
        const B = collab.peers[0]; // Editor: testemunha do que NÃO chegou

        const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        expect(lineId).toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });
        const layerId = (await readFeatures(A, 'lines')).find((f) => f.id === lineId)?.props?.layerId;
        expect(layerId, 'a linha tem camada').toBeTruthy();

        // CONTROLE POSITIVO, ANTES da trava: destravado, o comando está vivo. Sem este passo,
        // toda asserção de recusa abaixo passaria para um comando simplesmente quebrado.
        const livre = await openConversionRow(A, lineId, 'Converter para Seta');
        await expect(livre.row).toBeVisible();
        await expect(livre.row).not.toHaveAttribute('aria-disabled', 'true');
        await A.keyboard.press('Escape');

        // A TRAVA QUE ESTE MENU ALCANÇA É A DA CAMADA. Com o MAPA travado o painel esconde a
        // engrenagem inteira (`.feature-panel--locked`), então o ramo `mapLocked` do modelo
        // fica com o teste de unidade; a camada travada deixa o menu visível e é o ESTADO
        // reversível que a regra manda desenhar e recusar.
        expect(await applyStoreOp(A, 'setLayerLocked', [layerId, true]), 'a camada travou').toBeTruthy();

        const linhasAntes = (await readFeatures(A, 'lines')).length;
        const setasAntesIds = (await readFeatures(A, 'arrows')).map((f) => f.id);
        const setasNoPar = (await readFeatures(B, 'arrows')).length;

        const { row } = await openConversionRow(A, lineId, 'Converter para Seta');

        // O comando CONTINUA desenhado...
        await expect(row).toBeVisible();
        // ...e diz que está recusado por `aria-disabled`, NUNCA pela propriedade `disabled`,
        // que mataria o clique que carrega o motivo.
        await expect(row).toHaveAttribute('aria-disabled', 'true');
        expect(await row.evaluate((el) => el.disabled)).toBe(false);

        // O CLIQUE é o portador: ele dispara e nomeia o ESTADO (não o papel).
        await clickRow(row);
        await expect(A.locator('.toast--warning', { hasText: /bloquead/i })).toBeVisible({ timeout: 8000 });
        await expect(A.locator('.toast--success', { hasText: /convertida/i })).toHaveCount(0);

        // E NADA foi escrito, nem aqui nem no par. O toast sozinho não provaria isso.
        await A.waitForTimeout(2000);
        expect((await readFeatures(A, 'lines')).length, 'a linha continua lá').toBe(linhasAntes);
        expect((await readFeatures(A, 'arrows')).length, 'nenhuma seta nasceu').toBe(setasAntesIds.length);
        expect((await readFeatures(B, 'arrows')).length, 'e nada chegou ao par').toBe(setasNoPar);

        // CONTROLE: destravada de novo, o MESMO comando converte, e a seta atravessa até o par.
        expect(await applyStoreOp(A, 'setLayerLocked', [layerId, false]), 'a camada destravou').toBeTruthy();

        const final = await openConversionRow(A, lineId, 'Converter para Seta');
        await expect(final.row).not.toHaveAttribute('aria-disabled', 'true');
        await clickRow(final.row);
        await expect.poll(async () => (await readFeatures(A, 'arrows')).length, { timeout: 12000 })
            .toBe(setasAntesIds.length + 1);
        const arrowId = await newFeatureId(A, 'arrows', setasAntesIds);
        await pollPeerFeature(B, 'arrows', arrowId);
    });
});
