// Path: e2e-ui/cobertura-viewshed.spec.js

/**
 * @fileoverview COBERTURA da Análise de Visibilidade (viewshed 2D), dois usuários num atlas de
 * servidor, terreno sintético. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela só a Altura do Observador era editada em spec de navegador (`browser-collab-analise-
 * edicao`), e sem conferir a saída derivada do colega depois da edição. Raio, Abertura, Opacidade,
 * excluir e desfazer a exclusão não tinham spec.
 *
 * A SAÍDA DERIVADA É CONFERIDA POR COERÊNCIA: as metades `processed_visibility` que a página tem
 * precisam ser iguais, campo a campo (menos a escrituração de sync), ao que `deriveAnalysisOutput`
 * produz da entrada que a MESMA página tem, no mesmo instante. É a forma de
 * `browser-collab-analise-desfazer.repro.spec.js`, porque a saída nunca viaja (5378da27).
 */

import { collabTest, expect, selectFeatureUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { prepararTerreno, tracarViewshed, desocupar, balde } from './helpers/analise-terreno.js';

collabTest.describe.configure({ retries: 0 });

const ESCRITURACAO = ['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync'];

/** As metades que a página guarda e as que a derivação produz da entrada que ela guarda. */
async function coerente(page, id) {
    const r = await page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const { deriveAnalysisOutput } = await import('/src/js/store/analysis-output.js');
        const f = await s.getCurrentMapFeatures();
        const entrada = (f.visibility ?? []).find((x) => x.properties.id === fid);
        const vista = (l) => JSON.parse(JSON.stringify(l.map((x) => ({ id: x.properties.id, props: x.properties, geometry: x.geometry }))));
        return {
            metades: vista((f.processed_visibility ?? []).filter((x) => x.properties.id.startsWith(`${fid}-`))),
            derivadas: vista(entrada ? deriveAnalysisOutput('visibility', entrada) : []),
        };
    }, id);
    const limpa = (l) => l.map((x) => {
        const props = { ...x.props };
        for (const k of ESCRITURACAO) delete props[k];
        return { id: x.id, geometry: x.geometry, props };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return r.derivadas.length > 0 && JSON.stringify(limpa(r.metades)) === JSON.stringify(limpa(r.derivadas));
}

const propDe = async (page, id, chave) => (await balde(page, 'visibility')).find((f) => f.id === id)?.props?.[chave] ?? null;

/** Um parâmetro da aba Parâmetros, confirmado no blur, esperando o recálculo gravar. */
async function mudarParametro(page, id, rotulo, chave, valor) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="parametros"]').click();
    const campo = painel.locator('.feature-tab-content[data-tab-id="parametros"] .attr-modern-slider')
        .filter({ hasText: rotulo }).locator('.attr-modern-slider-input');
    await expect(campo).toBeEnabled({ timeout: 10000 });
    await campo.fill(String(valor));
    await campo.press('Tab');
    await expect.poll(() => propDe(page, id, chave), { timeout: 180000, intervals: [500, 1000], message: `${rotulo} nao gravou` }).toBe(valor);
    await expect(page.locator('.visibility-progress-modal--visible')).toHaveCount(0, { timeout: 120000 });
    await desocupar(page);
}

collabTest('viewshed: Raio, Abertura, Opacidade, excluir e desfazer, com a saída do colega coerente', async ({ collab }) => {
    collabTest.setTimeout(900000);
    const A = collab.author;
    const B = collab.peers[0];
    await prepararTerreno(A);
    await prepararTerreno(B);

    const id = await tracarViewshed(A);
    await desocupar(A);
    await expect.poll(() => coerente(B, id), { timeout: 60000, message: 'o colega nao derivou a saida' }).toBe(true);

    for (const [rotulo, chave, valor] of [['Raio', 'radius', 2000], ['Abertura', 'aperture', 90]]) {
        await mudarParametro(A, id, rotulo, chave, valor);
        await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.[chave] ?? null, { timeout: 30000 }).toBe(valor);
        await expect.poll(() => propDe(B, id, chave), { timeout: 30000 }).toBe(valor);
        await expect.poll(() => coerente(B, id), { timeout: 30000, message: `a saida do colega nao acompanhou ${rotulo}` }).toBe(true);
        expect(await coerente(A, id)).toBe(true);
    }

    // Opacidade (Estilo), confirmada pelo Salvar do painel.
    await selectFeatureUI(A, id);
    const painel = A.locator('.feature-panel[data-expanded="true"]');
    const abaEstilo = painel.locator('.feature-tab-btn[data-tab-id="estilo"]');
    if (await abaEstilo.count()) await abaEstilo.click();
    const opacidade = painel.locator('.attr-modern-slider').filter({ hasText: 'Opacidade' }).locator('.attr-modern-slider-input').first();
    await opacidade.fill('30');
    await opacidade.press('Tab');
    const salvar = painel.locator('.attr-modern-btn-save').first();
    if (await salvar.isVisible().catch(() => false)) await salvar.click();
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.opacity ?? null, { timeout: 30000 }).toBe(0.3);
    await expect.poll(() => propDe(B, id, 'opacity'), { timeout: 30000 }).toBe(0.3);
    await expect.poll(() => coerente(B, id), { timeout: 30000 }).toBe(true);
    await desocupar(A);

    // Excluir pela interface: a entrada e as metades somem do colega; o servidor marca apagada.
    await deleteFeatureUI(A, id);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.deleted_at ?? null, { timeout: 30000 }).not.toBeNull();
    await expect.poll(async () => ({
        entrada: (await balde(B, 'visibility')).some((f) => f.id === id),
        metades: (await balde(B, 'processed_visibility')).filter((f) => f.id.startsWith(`${id}-`)).length,
    }), { timeout: 30000 }).toEqual({ entrada: false, metades: 0 });

    // Ctrl+Z da exclusão: volta no autor, no servidor e no colega, com a saída coerente.
    await A.locator('#map-sig .maplibregl-canvas').focus().catch(() => {});
    await A.keyboard.press('Control+z');
    await expect.poll(async () => (await balde(A, 'visibility')).some((f) => f.id === id), { timeout: 30000, message: 'Ctrl+Z nao desfez a exclusao' }).toBe(true);
    // A linha REVIVE: existe e não tem mais `deleted_at` (o `??` confundiria null com ausente).
    await expect.poll(async () => {
        const row = await collab.db.queryFeatureRow(id);
        return row ? row.deleted_at === null : 'sem linha';
    }, { timeout: 30000, message: 'o servidor nao reviveu a feicao' }).toBe(true);
    await expect.poll(() => coerente(B, id), { timeout: 60000, message: 'o colega nao recebeu a restauracao' }).toBe(true);
    expect(await propDe(B, id, 'radius')).toBe(2000);
});
