// Path: e2e-ui/browser-collab-analise-desfazer.repro.spec.js

/**
 * @fileoverview DESFAZER a edição de uma visada depois que o COLEGA a refez, com dois navegadores.
 *
 * O DEFEITO (medido em 2026-09-23). A entrada de desfazer de uma edição de visada ou de viewshed
 * (`updateWithProcessed`, gravada por `batchUpdateAnalysisFeatures`) guarda a feição de antes E as
 * metades de antes, e o desfazer (`_executeUndoAction`, `store/store-state-manager.js`) restaura a
 * feição e REINSERE aquelas metades guardadas. Desde que o desfazer só leva de volta o que a própria
 * edição mudou (`keepLaterEdits`), a geometria que o colega deu depois FICA, e as metades
 * reinseridas são as da geometria VELHA: a análise desenhada na tela do autor fica no lugar antigo,
 * incoerente com a feição, até um F5. A saída é derivada da entrada desde 2026-09-23
 * (`store/analysis-output.js`), então o certo é derivá-la da feição resultante, nunca reinserir
 * cópia.
 *
 * O CASO: A traça a visada e muda a Altura do Observador (a entrada de desfazer nasce aí); B muda a
 * altura de novo e arrasta a ponta do alvo; A desfaz pelo botão da barra. Afirma, no autor, que o
 * trabalho de B fica e que as metades são exatamente a derivação da feição que ficou.
 *
 * POR QUE B REFAZ TUDO: se o desfazer de A ainda leva algum campo de volta, sai uma op, e o RECIBO
 * dela re-deriva a saída pelo caminho de entrada um segundo depois. O controle negativo com só o
 * arraste de B passou verde por isso (medido): a incoerência existia e durava até o recibo.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import {
    prepararTerreno, desocupar, tracarVisada, balde, alturaNoStore, mudarAlturaDoObservador, LOS_B, LAT,
} from './helpers/analise-terreno.js';

collabTest.describe.configure({ retries: 0 });

/** Para onde B arrasta a ponta do alvo: fora do platô, ao norte. */
const ALVO_NOVO = [-43.14, LAT + 0.03];

/** Campos de escrituração que cada cliente carimba por conta própria. */
const ESCRITURACAO = ['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync'];

function semEscrituracao(f) {
    const props = { ...f.props };
    for (const chave of ESCRITURACAO) delete props[chave];
    return { id: f.id, geometry: f.geometry, props };
}

/**
 * As metades do balde de saída e a derivação da entrada, lidas no MESMO instante da página, pela
 * função pura que o produto usa. Coerência é as duas serem iguais.
 */
async function metadesEDerivacao(page, losId) {
    return page.evaluate(async (id) => {
        const s = await import('/src/js/store/index.js');
        const { deriveAnalysisOutput } = await import('/src/js/store/analysis-output.js');
        const f = await s.getCurrentMapFeatures();
        const entrada = (f.los ?? []).find((x) => x.properties.id === id);
        const vista = (lista) => JSON.parse(JSON.stringify(lista.map((x) => ({ id: x.properties.id, props: x.properties, geometry: x.geometry }))));
        return {
            metades: vista((f.processed_los ?? []).filter((x) => x.properties.id.startsWith(`${id}-`))),
            derivadas: vista(entrada ? deriveAnalysisOutput('los', entrada) : []),
            geometria: entrada?.geometry ?? null,
        };
    }, losId);
}

async function coerente(page, losId) {
    const { metades, derivadas } = await metadesEDerivacao(page, losId);
    const ordena = (l) => l.map(semEscrituracao).sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify(ordena(metades)) === JSON.stringify(ordena(derivadas)) && derivadas.length > 0;
}

/** Arrasta a alça de uma ponta da visada selecionada, com o ponteiro real. */
async function arrastarPonta(page, de, para) {
    await expect.poll(async () => page.evaluate(async () => {
        const src = globalThis.__ebgeoMap.getSource('los-edit-handles');
        const data = src ? await src.getData() : null;
        return data?.features?.length ?? 0;
    }), { timeout: 15000, message: 'as alcas da visada nao apareceram' }).toBeGreaterThanOrEqual(2);
    const px = (ll) => page.evaluate((p) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const pt = map.project(p);
        return { x: rect.left + pt.x, y: rect.top + pt.y };
    }, ll);
    // O painel do PERFIL da visada abre sobre a metade de baixo do mapa quando ela é selecionada, e
    // cobria a alça (medido: `DIV.profile-slope-info` sob o ponteiro). A câmera sobe a ponta para
    // o quarto de cima do canvas, e a espera é pelo pixel ser do canvas, não por tempo.
    await page.evaluate((p) => {
        const map = globalThis.__ebgeoMap;
        const canvas = map.getCanvas();
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const pt = map.project(p);
        map.jumpTo({ center: map.unproject([w / 2 + (pt.x - w / 2), h / 2 + (pt.y - h * 0.25)]) });
    }, de);
    await page.waitForFunction((p) => {
        const map = globalThis.__ebgeoMap;
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const pt = map.project(p);
        const topo = document.elementFromPoint(rect.left + pt.x, rect.top + pt.y);
        return !!topo && (topo === canvas || canvas.contains(topo));
    }, de, { timeout: 15000 });
    // A alça precisa estar DESENHADA, não só na fonte: o pointerdown da ferramenta a acha por
    // `queryRenderedFeatures`, e um clique antes do quadro que a pinta não pega nada.
    await expect.poll(async () => page.evaluate((p) => {
        const map = globalThis.__ebgeoMap;
        const pt = map.project(p);
        return map.queryRenderedFeatures([[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]], { layers: ['los-edit-handles-layer'] }).length;
    }, de), { timeout: 15000, message: 'a alca da ponta nao foi desenhada' }).toBeGreaterThan(0);
    const a = await px(de);
    const b = await px(para);

    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
    }
    await page.mouse.up();
}

collabTest('desfazer a edicao da visada depois que o colega a refez deixa a saida coerente com a feicao', async ({ collab }) => {
    collabTest.setTimeout(300000);
    const A = collab.author;
    const B = collab.peers[0];

    await prepararTerreno(A);
    const losId = await tracarVisada(A);
    await desocupar(A);

    // A edição de A: a entrada de desfazer nasce aqui.
    await mudarAlturaDoObservador(A, 'los', losId, 50, 20000);
    await desocupar(A);
    await expect.poll(() => alturaNoStore(B, 'los', losId), { timeout: 30000 }).toBe(50);

    // B refaz TUDO o que A mudou: outra altura e outra ponta. Assim o desfazer de A não tem campo
    // nenhum a levar de volta na feição (`keepLaterEdits` mantém os de B), não sai op nenhuma, e
    // nenhum recibo do servidor chega depois para re-derivar a saída por outro caminho. É o caso em
    // que a metade reinserida da história fica na tela para sempre.
    await prepararTerreno(B);
    await mudarAlturaDoObservador(B, 'los', losId, 80, 20000);
    const geometriaAntes = (await metadesEDerivacao(B, losId)).geometria;
    await arrastarPonta(B, LOS_B, ALVO_NOVO);
    await expect.poll(async () => JSON.stringify((await metadesEDerivacao(B, losId)).geometria), {
        timeout: 30000, message: 'o arraste de B nao mudou a visada',
    }).not.toBe(JSON.stringify(geometriaAntes));
    const geometriaDoColega = (await metadesEDerivacao(B, losId)).geometria;
    await desocupar(B);

    // O trabalho de B chega a A, com a saída derivada da geometria nova.
    await expect.poll(async () => JSON.stringify((await metadesEDerivacao(A, losId)).geometria), {
        timeout: 30000, message: 'o movimento de B nao chegou a A',
    }).toBe(JSON.stringify(geometriaDoColega));
    await expect.poll(() => alturaNoStore(A, 'los', losId), { timeout: 15000 }).toBe(80);
    await expect.poll(() => coerente(A, losId), { timeout: 15000 }).toBe(true);

    // A desfaz (botão da barra, a mesma porta do Ctrl+Z). `dispatchEvent` e não `click()`: com o
    // painel do perfil da visada aberto, o `click()` do Playwright esperou a checagem de "recebe
    // eventos" até estourar o caso inteiro (10 min, medido). O botão e o handler são os mesmos.
    await desocupar(A);
    const pilha = () => A.evaluate(async () => {
        const { default: mm } = await import('/src/js/store/store-state-manager.js');
        return mm._getUndoStack().filter((a) => a.type === 'updateWithProcessed').length;
    });
    expect(await pilha(), 'uma entrada de desfazer da edicao de A, e so uma').toBe(1);
    await A.locator('.toolbar-standalone-btn[data-tool-id="undo"]').dispatchEvent('click');
    await expect.poll(pilha, { timeout: 15000, message: 'o desfazer de A nao aconteceu' }).toBe(0);

    // O trabalho de B fica na feição.
    expect(await alturaNoStore(A, 'los', losId), 'a altura de B fica').toBe(80);
    expect(JSON.stringify((await metadesEDerivacao(A, losId)).geometria), 'a geometria de B fica')
        .toBe(JSON.stringify(geometriaDoColega));

    // A SAÍDA DE A É A DERIVAÇÃO DA FEIÇÃO QUE FICOU, e não as metades guardadas da geometria velha.
    await expect.poll(() => coerente(A, losId), {
        timeout: 15000, message: 'o desfazer deixou no autor metades incoerentes com a feicao',
    }).toBe(true);
    expect((await balde(A, 'processed_los')).length, 'nenhuma metade duplicada ou orfa').toBe(2);
    await expect.poll(() => coerente(B, losId), { timeout: 15000 }).toBe(true);
});
