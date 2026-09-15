// Path: e2e-ui/edicao-pendente-sobrevive-a-op-remota.repro.spec.js

/**
 * @fileoverview A EDIÇÃO ABERTA NO PAINEL NÃO PODE EVAPORAR PORQUE UM PAR MEXEU NO MAPA.
 *
 * O defeito, medido em 2026-09-15 e reproduzido aqui uma vez em uma: o usuário escolhe uma cor no
 * painel de atributos (a prévia aparece no mapa), uma op remota QUALQUER chega, e o "Salvar"
 * grava o valor ANTIGO. Nenhum erro, nenhum aviso, nenhuma operação na fila de saída; para o
 * usuário, o clique em Salvar simplesmente não fez nada.
 *
 * A cadeia inteira, que é o motivo de este caso viver no navegador e não em node:
 *   1. `updateFeaturesProperty` escreve a prévia na FONTE do MapLibre e na cópia do painel, e de
 *      propósito NÃO escreve na store: é uma prévia.
 *   2. a op remota emite `feature:modified`, e `wireRemoteFeatureRender` redesenha TODAS as
 *      fontes a partir da store 80 ms depois, com `setData` cru. A prévia some da fonte.
 *   3. `saveFeatures` persiste a cópia DA FONTE, então grava de volta o que a store já tinha;
 *      `updateFeature` sai cedo em `isFeatureEqual` e não registra operação nenhuma.
 *
 * A INTERLEAVING PERDEDORA AQUI É DETERMINÍSTICA, e é por isso que este caso existe em vez de se
 * confiar no vermelho intermitente que o denunciou (`browser-collab-three-client-flow`, uma
 * reprovação em quatro): o sinal do passo 2 é o mesmo evento que o
 * `remote-operation-handler` emite ao aplicar um update vindo do servidor, e emiti-lo à mão põe
 * a op remota exatamente no instante do defeito. Estatística de navegador não converge; um
 * evento disparado no instante certo converge.
 *
 * O conserto é `mergePendingEdits` (`tool_manager/helpers/pending-edit.helpers.js`), chamado
 * pelos dezoito `saveFeatures`. Controle negativo: retirá-lo de
 * `draw_tools/line_tool/add_line_control.js` põe este caso vermelho com a cor original.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawLineUI, selectFeatureUI, readFeatures } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COR_ESCOLHIDA = '#00ff00';

/** A cor que a FONTE do MapLibre desenha para esta feição agora (a prévia mora aqui). */
const corNaFonte = (page, id) => page.evaluate(async (fid) => {
    const src = globalThis.__ebgeoMap?.getSource('lines');
    if (!src || typeof src.getData !== 'function') return null;
    const data = await src.getData();
    const f = (data.features || []).find((x) => x.properties?.id === fid);
    return f ? String(f.properties.lineColor).toLowerCase() : null;
}, id);

/** A cor que a STORE guarda, que é o que sobrevive ao F5 e o que vira op de saída. */
const corNaStore = async (page, id) =>
    String((await readFeatures(page, 'lines')).find((f) => f.id === id)?.props?.lineColor).toLowerCase();

describeOrSkip('edição pendente do painel contra op remota (Chromium real)', () => {
    test('o Salvar grava a cor escolhida mesmo depois de a op remota redesenhar a fonte', async ({ page }) => {
        test.setTimeout(120000);

        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });

        const id = await drawLineUI(page, COORDS);
        expect(id, 'a ferramenta de linha criou a feição').toBeTruthy();
        const corOriginal = await corNaStore(page, id);
        expect(corOriginal, 'a cor de partida não é a que o teste vai escolher').not.toBe(COR_ESCOLHIDA);

        await selectFeatureUI(page, id);
        const native = page.locator('.feature-panel[data-expanded="true"] .color-picker-native-hidden').first();
        await expect(native).toBeAttached({ timeout: 5000 });
        await native.evaluate((el, cor) => {
            el.value = cor;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, COR_ESCOLHIDA);

        // A prévia chegou à fonte: daqui em diante o gesto do usuário está em curso e não gravado.
        await expect.poll(() => corNaFonte(page, id), { timeout: 5000 }).toBe(COR_ESCOLHIDA);

        // A OP REMOTA, no instante exato: `feature:modified` é o que
        // `store/sync/remote-operation-handler.js` emite ao aplicar o update de um par, e é o
        // gatilho que `layers/remote-feature-render.js` escuta para redesenhar as fontes.
        await page.evaluate(async () => {
            const s = await import('/src/js/store/index.js');
            const { EventTypes } = await import('/src/js/events/event_types.js');
            s.getEventBus().emit(EventTypes.FEATURE_MODIFIED, { featureType: 'lines' });
        });

        // O REDESENHO É O SUJEITO, e ele é afirmado em vez de assumido: sem esta linha, um dia em
        // que o redesenho deixe de acontecer faria o caso passar verde sem medir nada.
        await expect
            .poll(() => corNaFonte(page, id), { timeout: 10000, message: 'o redesenho da fonte apagou a prévia' })
            .toBe(corOriginal);

        await page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first().click();

        await expect
            .poll(() => corNaStore(page, id), { timeout: 10000 })
            .toBe(COR_ESCOLHIDA);
    });
});
