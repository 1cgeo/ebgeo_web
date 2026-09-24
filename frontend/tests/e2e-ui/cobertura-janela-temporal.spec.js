// Path: e2e-ui/cobertura-janela-temporal.spec.js

/**
 * @fileoverview COBERTURA da janela temporal de uma feição editada pelo PAINEL, com o colega e com
 * F5 nos dois. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela a janela só era posta pelo painel num atlas local (`browser-temporal-advanced` §29.20,
 * só o Início) e as demais provas de transporte eram por API; nenhum spec temporal recarregava a
 * página. Aqui: Início e Fim pelos campos reais da seção "Validade temporal" de um símbolo militar,
 * conferidos no Postgres, no store do colega, e depois do F5 nos dois; e o Fim APAGADO pelo painel
 * (campo vazio), que precisa sumir nos três lugares em vez de voltar do disco.
 */

import { collabTest, expect, selectFeatureUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const janela = (page, id) => page.evaluate(async (fid) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid);
    return f ? { inicio: f.properties.temporalInicio ?? null, fim: f.properties.temporalFim ?? null } : null;
}, id);

const janelaNoServidor = async (collab, id) => {
    const p = (await collab.db.queryFeatureRow(id))?.properties;
    return p ? { inicio: p.temporalInicio ?? null, fim: p.temporalFim ?? null } : null;
};

/** Seleciona a feição UMA vez e devolve os campos Início e Fim da seção "Validade temporal". */
async function camposDaJanela(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    const validade = painel.locator('.temporal-attr-section').filter({
        has: page.locator('.temporal-attr-section__title', { hasText: 'Validade temporal' }),
    });
    const linhas = validade.locator('.temporal-attr-row');
    await expect(linhas.nth(0).locator('.temporal-attr-row__label')).toHaveText('Início', { timeout: 10000 });
    await expect(linhas.nth(1).locator('.temporal-attr-row__label')).toHaveText('Fim');
    return { inicio: linhas.nth(0).locator('input').first(), fim: linhas.nth(1).locator('input').first() };
}

collabTest('janela temporal pelo painel: colega recebe, F5 nos dois, e o Fim apagado some', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');

    const campos = await camposDaJanela(A, id);
    await campos.inicio.fill('2024-03-01T08:00');
    await campos.inicio.dispatchEvent('change');
    await campos.fim.fill('2024-03-02T18:30');
    await campos.fim.dispatchEvent('change');

    await expect.poll(() => janela(A, id).then((j) => Boolean(j && Number.isFinite(j.inicio) && Number.isFinite(j.fim))), { timeout: 15000 }).toBe(true);
    const esperada = await janela(A, id);
    expect(esperada.fim - esperada.inicio).toBe((34 * 60 + 30) * 60 * 1000);
    await expect.poll(() => janelaNoServidor(collab, id), { timeout: 30000 }).toEqual(esperada);
    await expect.poll(() => janela(B, id), { timeout: 30000 }).toEqual(esperada);

    for (const page of [A, B]) {
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => janela(page, id), { timeout: 30000 }).toEqual(esperada);
    }

    // O Fim APAGADO pelo painel: a feição fica aberta no fim, nos três lugares, e segue assim no F5.
    const fimDepois = (await camposDaJanela(B, id)).fim;
    await fimDepois.fill('');
    await fimDepois.dispatchEvent('change');
    const semFim = { inicio: esperada.inicio, fim: null };
    await expect.poll(() => janela(B, id), { timeout: 15000 }).toEqual(semFim);
    await expect.poll(() => janelaNoServidor(collab, id), { timeout: 30000 }).toEqual(semFim);
    await expect.poll(() => janela(A, id), { timeout: 30000 }).toEqual(semFim);
    await A.reload();
    await A.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
    await expect.poll(() => janela(A, id), { timeout: 30000, message: 'o Fim apagado voltou do disco' }).toEqual(semFim);
});
