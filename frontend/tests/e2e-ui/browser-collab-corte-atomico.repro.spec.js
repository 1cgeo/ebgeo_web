// Path: e2e-ui/browser-collab-corte-atomico.repro.spec.js

/**
 * @fileoverview CORTAR UMA LINHA é um gesto só também no servidor: ou o corte inteiro vale, ou
 * nada dele.
 *
 * A HIPÓTESE (2026-09-24). `splitLineAtPoint` (`draw_tools/line_tool/line-split.js`) apaga a linha
 * original e cria as duas metades em TRÊS transações, cada uma com seu `batchId`, enquanto a
 * conversão linear já junta o composto num lote de gesto (`withGestureBatch`). O servidor aplica ou
 * recusa por lote: se ele recusar o DELETE do original (o colega editou a linha depois do último
 * recibo de quem corta: "alterado antes da exclusão"), as duas metades entram assim mesmo, e o
 * original também fica. Resultado: a linha e as suas duas metades, sobrepostas, no Postgres e nos
 * dois clientes.
 *
 * O CASO: A desenha a linha; A segura o envio automático (`pauseAutoFlush`, a mesma trava que o
 * diálogo de saída usa), corta a linha pelo menu de contexto, B renomeia a linha original, e A solta
 * o envio. O que se afirma é que o Postgres NUNCA termina com o original E as metades juntos, e que os
 * dois clientes convergem para o que o servidor guardou.
 */

import { collabTest, expect, drawLineUI, selectFeatureUI, renameViaPanelUI, readFeatures } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

async function linhasVivas(collab) {
    return collab.db.raw.any(
        `SELECT id, properties->>'nome' AS nome FROM features
         WHERE map_id = $1 AND feature_type = 'line' AND deleted_at IS NULL ORDER BY properties->>'nome'`,
        [collab.mapId],
    );
}

collabTest('o corte de uma linha que o colega editou nao deixa a linha e as metades juntas', async ({ collab }) => {
    collabTest.setTimeout(120000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
    await A.keyboard.press('Escape');
    await expect.poll(async () => (await linhasVivas(collab)).length, { timeout: 30000 }).toBe(1);
    await expect.poll(async () => (await readFeatures(B, 'lines')).some((f) => f.id === id), { timeout: 30000 }).toBe(true);

    // A segura o envio: o corte fica na fila, com a base de ANTES da edição de B.
    await A.evaluate(async () => {
        const { pauseAutoFlush } = await import('/src/js/store/sync/auto-flush-pause.js');
        window.__pausaDoCorte = pauseAutoFlush();
        await window.__pausaDoCorte.settled;
    });

    // A corta pelo menu de contexto: selecionar, botão direito, "Cortar Linha", clique no ponto.
    // O mesmo roteiro de `corte-da-divisa-pelo-menu.spec.js`: câmera no ponto do corte, botão
    // direito até o menu abrir, o item, e o aviso do modo antes do clique.
    const CORTE = [-43.175, -22.875];
    await selectFeatureUI(A, id);
    await A.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), CORTE);
    const menu = A.locator('.context-menu');
    await expect(async () => {
        const p = await clicarNoMapaUI(A, CORTE, { button: 'right' });
        expect(p.coberto, `pixel coberto por ${p.porQuem}`).toBe(false);
        await expect(menu).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await menu.locator('.context-menu-item', { hasText: /^Cortar Linha$/ }).click();
    await expect(A.getByText(/Clique na linha/)).toBeVisible({ timeout: 10000 });
    await clicarNoMapaUI(A, CORTE);
    await expect.poll(async () => {
        const linhas = await readFeatures(A, 'lines');
        return { original: linhas.some((f) => f.id === id), total: linhas.length };
    }, { timeout: 15000, message: 'o corte nao aconteceu em A' }).toEqual({ original: false, total: 2 });

    // B renomeia a linha original, que o servidor ainda tem.
    await selectFeatureUI(B, id);
    await renameViaPanelUI(B, 'Nome do B');
    await expect.poll(async () => (await linhasVivas(collab)).map((l) => l.nome), { timeout: 30000 }).toEqual(['Nome do B']);

    // A solta o envio e a fila assenta.
    await A.evaluate(() => window.__pausaDoCorte.resume());
    await expect.poll(async () => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 30000 }).toBe(0);
    await A.waitForTimeout(2000);

    const finais = await linhasVivas(collab);
    const originalVivo = finais.some((l) => l.id === id);
    const metades = finais.filter((l) => l.id !== id);
    console.log('[corte-atomico] linhas vivas no servidor:', JSON.stringify(finais));
    expect(
        originalVivo && metades.length > 0,
        `o servidor ficou com a linha E ${metades.length} metade(s) sobrepostas: ${JSON.stringify(finais)}`,
    ).toBe(false);

    // E os dois clientes convergem para o servidor: o gesto recusado inteiro some da tela de A.
    const vivos = finais.map((l) => l.id).sort();
    for (const [quem, page] of [['A', A], ['B', B]]) {
        await expect.poll(async () => (await readFeatures(page, 'lines')).map((f) => f.id).sort(), {
            timeout: 30000, message: `o cliente ${quem} nao convergiu para o servidor`,
        }).toEqual(vivos);
    }
});
