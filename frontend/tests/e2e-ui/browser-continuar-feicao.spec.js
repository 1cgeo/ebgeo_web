// Path: e2e-ui/browser-continuar-feicao.spec.js

/**
 * CONTINUAR UMA FEIÇÃO LINEAR PELA ALÇA DE PONTA, com browser real e backend real.
 *
 * ================= O QUE SÓ AQUI SE MEDE =====================================
 *
 * `line-extension-model.test.js` mede a DECISÃO (onde os pontos novos entram, o que atravessa) e
 * `continuar-feicao-afordancia.test.js` mede QUEM VÊ a alça, com dublês de store e de MapLibre.
 * Nenhum dos dois alcança as três coisas que este arquivo existe para provar:
 *
 *   1. QUE A ALÇA EXISTE NA TELA E ABRE O MODO. Ela é um `maplibregl.Marker` pendurado no
 *      container do canvas, criado por `createEditHandles`; só um DOM real diz se ela chegou lá
 *      e se o clique nela troca a ferramenta ativa em vez de arrastar a feição.
 *   2. QUE CONCLUIR ATUALIZA A MESMA FEIÇÃO. O id, o nome e o estilo têm de sobreviver e NENHUMA
 *      feição nova pode nascer. Um `updateFeature` recusado é indistinguível de um aceito pelo
 *      retorno (ele devolve `undefined` nos dois casos), então a afirmação que vale é sobre a
 *      STORE relida, e é ela que o caso 1 faz.
 *   3. QUE O POSTO SOME. Um Leitor não recebe alça nenhuma, com o painel montado ao redor para
 *      provar que a ausência não é uma tela quebrada.
 *
 * ================= O QUE A MEDIÇÃO DE 2026-09-02 DECIDIU =====================
 *
 * RODOU, EM SÉRIE: três repetições dos três casos, com o retry DESLIGADO, e o resultado foi
 * 9 de 9. Um verde único num arquivo de browser não distingue determinístico de sortudo, e o
 * `retries: 1` do `playwright.config.js` fecharia a rodada em verde marcando `flaky` um caso que
 * na verdade não passou; por isso a série, e por isso a taxa fica escrita aqui.
 *
 * DUAS CORREÇÕES FORAM NECESSÁRIAS, e as DUAS eram do spec, nenhuma do produto: os dois vértices
 * novos tinham coordenadas fixas e caíam sob elementos de UI (a primeira escolha a 40 px do topo,
 * debaixo do chip de ferramenta ativa; a segunda, sob a barra da direita), então o clique
 * acertava o elemento de cima e o controle nunca via o ponto. Os dois passaram a ser derivados de
 * PIXELS do canvas, em `novosPontos`, com o motivo escrito lá.
 *
 * AS TRÊS HIPÓTESES COM QUE ESTE ARQUIVO NASCEU FORAM MEDIDAS, e as três se resolveram sem tocar
 * na lógica. Ficam registradas porque uma hipótese falsificada vale mais que uma não escrita:
 * quem for mexer aqui não precisa reinvestigá-las.
 *
 *   - A ALÇA NÃO CAIU SOB O PAINEL DE FEIÇÃO. Era o risco mais plausível: `selectFeatureUI` abre
 *     o painel de atributos, que cobre a faixa esquerda, e a alça fica 26 px ACIMA do vértice
 *     mais a oeste. Na prática o `dispatchEvent('click')` do passo 4 alcançou o botão nas nove
 *     rodadas. Repare que o `toHaveCount` NÃO teria acusado esse caso (o elemento existe no DOM
 *     coberto ou não), então é o passo 4 que responde por ele.
 *   - O `renderId` DO PAINEL ESTABILIZOU dentro do orçamento do laço (dez iterações de um
 *     segundo, copiado de `browser-collab-conversao-linear.spec.js`), nas nove rodadas.
 *   - A CONTAGEM DE `drawPoints` COMEÇA EM 1, NÃO EM 0, confirmado: a âncora é semeada por
 *     `startExtending` antes do primeiro clique. As esperas abaixo já contam assim, e é o erro
 *     fácil de escrever aqui, porque um `>= 1` esperando o primeiro clique passaria de graça.
 *
 * Rodar headed:  npx playwright test browser-continuar-feicao --headed
 * Rodar em série, sem retry:  npx playwright test browser-continuar-feicao --repeat-each=3 --retries=0
 */

import {
    collabTest, expect,
    drawLineUI, readFeatures, selectFeatureUI,
} from './helpers/collab.fixtures.js';
import { clicarNoMapaUI, pollPeerFeature } from './helpers/collab-helpers.js';

/** Os três vértices da linha de partida. */
const COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

/**
 * Os dois vértices que a continuação acrescenta, saindo da ponta final.
 *
 * Eles são escolhidos em PIXELS do canvas, e só então convertidos para
 * lng/lat: à direita do meio e um pouco abaixo, longe da faixa esquerda (sidebar), do chip de
 * ferramenta ativa no topo, da barra de ferramentas da direita e dos controles do rodapé.
 * Coordenadas fixas falharam duas vezes em 2026-09-02 (6 de 6 rodadas cada): a primeira caía a
 * 40 px do topo, debaixo do chip; a segunda caía sob a barra da direita. O clique acertava o
 * elemento por cima, o controle nunca via o ponto, e o produto estava certo.
 */
const novosPontos = (page) => page.evaluate(() => {
    const map = globalThis.__ebgeoMap;
    const r = map.getCanvas().getBoundingClientRect();
    const em = (fx, fy) => { const p = map.unproject([r.width * fx, r.height * fy]); return [p.lng, p.lat]; };
    return [em(0.55, 0.55), em(0.64, 0.66)];
});

/** O id da construção de conteúdo que o painel mostra agora (null sem painel). */
const renderIdDoPainel = (page) => page.evaluate(
    () => document.querySelector('.feature-panel-sections')?.dataset.renderId ?? null,
);

/**
 * Seleciona a feição e espera o painel PARAR de se reconstruir.
 *
 * Copiado de `browser-collab-conversao-linear.spec.js`, e pelo mesmo motivo medido lá: o conteúdo
 * do painel é reconstruído de forma assíncrona a cada seleção, e cada reconstrução descarta o que
 * havia por cima da anterior. Aqui o que se descarta seriam as alças (`createEditHandles` corre
 * junto), então medir sem esperar é medir um DOM em trânsito.
 */
async function selecionarEEstabilizar(page, featureId) {
    const antes = await renderIdDoPainel(page);
    await selectFeatureUI(page, featureId);
    await page.waitForFunction((id) => {
        const el = document.querySelector('.feature-panel[data-expanded="true"] .feature-panel-sections');
        return Boolean(el) && el.dataset.renderId !== id;
    }, antes, { timeout: 10000 });

    let ultimo = await renderIdDoPainel(page);
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const atual = await renderIdDoPainel(page);
        if (atual === ultimo) break;
        ultimo = atual;
    }
}

/** O eixo persistido daquela feição, lido da STORE (nunca da fonte do MapLibre). */
const eixoNaStore = (page, storage, id) => page.evaluate(async ({ s, i }) => {
    const store = await import('/src/js/store/index.js');
    const f = await store.getFeatureById(s, i);
    if (!f) return null;
    let base = f.properties?.baseCoordinates;
    if (typeof base === 'string') base = JSON.parse(base);
    return { nome: f.properties?.nome ?? null, base: base ?? null };
}, { s: storage, i: id });

/** Quantos vértices o controle já coletou (a âncora inclusa). */
const pontosDoControle = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    const c = store.getControl?.('AddLineControl');
    return Array.isArray(c?.drawPoints) ? c.drawPoints.length : -1;
});

/** Espera o controle ter pelo menos `n` vértices, nomeando o que viu ao estourar. */
async function esperarPontos(page, n) {
    await expect.poll(() => pontosDoControle(page), {
        timeout: 10000,
        message: `AddLineControl nao chegou a ${n} vertices (a ancora conta como o primeiro)`,
    }).toBeGreaterThanOrEqual(n);
}

/** As alças de continuação na tela, as duas ou nenhuma. */
const alcas = (page) => page.locator('.line-extension-handle');

// ============================================================================
// O CAMINHO FELIZ: a alça continua a MESMA feição
// ============================================================================

collabTest.describe('Continuar feição — a alça de ponta', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

    collabTest('a ponta final continua a linha: mesmo id, cinco vértices, nenhuma feição nova', async ({ collab }) => {
        const A = collab.author;

        // 1. Uma linha de TRÊS vértices, desenhada com a ferramenta real.
        const lineId = await drawLineUI(A, COORDS);
        expect(lineId, 'a ferramenta de linha criou a feição').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        const antes = await eixoNaStore(A, 'lines', lineId);
        expect(antes.base).toHaveLength(3);
        const idsAntes = (await readFeatures(A, 'lines')).map((f) => f.id);

        // 2. Selecionar, e esperar o painel parar de se reconstruir.
        await selecionarEEstabilizar(A, lineId);

        // 3. DUAS alças, uma por ponta. A contagem é a afirmação: uma só significaria que o
        //    `resolveEndpoints` devolveu meia resposta.
        await expect(alcas(A)).toHaveCount(2, { timeout: 10000 });
        await expect(A.locator('.line-extension-handle--start')).toHaveCount(1);
        await expect(A.locator('.line-extension-handle--end')).toHaveCount(1);

        // 4. Abrir o modo pela ponta FINAL.
        //
        //    `dispatchEvent`, NUNCA `click()`: `startExtending` chama `setActiveTool`, que
        //    DESSELECIONA a feição, e a desseleção remove este mesmo marcador do DOM. O `click()`
        //    do Playwright, ao ver o alvo sair no meio do gesto, tenta de novo e espera para
        //    sempre por um botão que já cumpriu o papel. É a mesma lição do `clickRow` de
        //    `browser-collab-conversao-linear.spec.js`.
        await A.locator('.line-extension-handle--end').dispatchEvent('click');
        const novos = await novosPontos(A);

        // A âncora entra em `drawPoints` como PRIMEIRO ponto, então o modo aberto já vale 1.
        await esperarPontos(A, 1);
        await expect(A.locator('.toast', { hasText: /continuar a linha/i })).toBeVisible({ timeout: 8000 });

        // 5. Dois cliques novos no mapa, cada um confirmado antes do próximo.
        await clicarNoMapaUI(A, novos[0]);
        await esperarPontos(A, 2);
        await clicarNoMapaUI(A, novos[1]);
        await esperarPontos(A, 3);

        // 6. Botão direito conclui, no ponto projetado do último vértice. O clique-direito
        //    contribui com o PRÓPRIO vértice, como em todo desenho desta ferramenta, então
        //    fecha-se sobre o mesmo ponto do último clique, que `isPointTooClose` descarta: os
        //    dois pontos novos são os de `novos`.
        const alvo = await A.evaluate((ll) => {
            const map = globalThis.__ebgeoMap;
            const r = map.getCanvas().getBoundingClientRect();
            const p = map.project(ll);
            return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
        }, novos[1]);
        await A.mouse.click(alvo.x, alvo.y, { button: 'right' });

        // 7. A STORE, e não a fonte do MapLibre: a fonte só mostra o que a store confirmou, e
        //    perguntar a ela seria perguntar ao eco.
        await expect.poll(async () => (await eixoNaStore(A, 'lines', lineId))?.base?.length ?? 0, {
            timeout: 15000,
            message: 'o eixo da linha nao chegou a 5 vertices na store',
        }).toBe(5);

        const depois = await eixoNaStore(A, 'lines', lineId);
        // O eixo antigo sobrevive CONTÍGUO, no começo, porque a ponta continuada foi a final.
        expect(depois.base.slice(0, 3)).toEqual(antes.base);
        // Identidade preservada: continuar é um UPDATE, nunca um CREATE mais um DELETE.
        expect(depois.nome).toBe(antes.nome);

        const idsDepois = (await readFeatures(A, 'lines')).map((f) => f.id);
        expect(idsDepois.sort()).toEqual(idsAntes.sort());
    });

    collabTest('Esc cancela sem gravar: a linha volta a ter três vértices', async ({ collab }) => {
        const A = collab.author;

        const lineId = await drawLineUI(A, COORDS);
        expect(lineId).toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        await selecionarEEstabilizar(A, lineId);
        await expect(alcas(A)).toHaveCount(2, { timeout: 10000 });
        await A.locator('.line-extension-handle--end').dispatchEvent('click');
        const novos = await novosPontos(A);
        await esperarPontos(A, 1);

        await clicarNoMapaUI(A, novos[0]);
        await esperarPontos(A, 2);
        await clicarNoMapaUI(A, novos[1]);
        await esperarPontos(A, 3);

        // Cancelar. Uma continuação não escreve NADA antes de ser concluída, então esquecer a
        // sessão deixa a feição original intocada por construção.
        await A.keyboard.press('Escape');
        await expect.poll(() => pontosDoControle(A), { timeout: 8000 }).toBeLessThanOrEqual(0);

        // E o eixo continua o de três. A espera é por ESTABILIDADE, não por prazo: se algo
        // gravasse, gravaria logo depois do Esc.
        await A.waitForTimeout(1500);
        const depois = await eixoNaStore(A, 'lines', lineId);
        expect(depois.base).toHaveLength(3);
    });
});

// ============================================================================
// POSTO: o Leitor não recebe a alça
// ============================================================================

collabTest.describe('Continuar feição — POSTO', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read' } });

    collabTest('um Leitor não ganha alça nenhuma, e o painel dele continua montado', async ({ collab }) => {
        const A = collab.author;   // dono
        const B = collab.peers[0]; // Leitor

        const lineId = await drawLineUI(A, COORDS);
        expect(lineId).toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });
        await pollPeerFeature(B, 'lines', lineId);

        await selecionarEEstabilizar(B, lineId);

        // AUSÊNCIA, nunca alça inerte: continuar é um `UPDATE_FEATURE`, e um Leitor não vira
        // Editor a partir da ponta de uma linha.
        await expect(alcas(B)).toHaveCount(0);

        // CONTROLE POSITIVO: o painel ESTÁ montado. Sem esta linha, uma tela quebrada passaria
        // na asserção de ausência acima, que é exatamente a cobertura vazia da constituição.
        await expect(B.locator('.feature-panel[data-expanded="true"] .feature-panel-sections'))
            .toBeVisible();

        // E o dono, no MESMO atlas e na MESMA feição, recebe as duas: é este par que prova que a
        // ausência é do posto, e não da feição nem da tela.
        await selecionarEEstabilizar(A, lineId);
        await expect(alcas(A)).toHaveCount(2, { timeout: 10000 });
    });
});
