// Path: e2e-ui/cobertura-visada.spec.js

/**
 * @fileoverview COBERTURA da Linha de Visada, dois usuários num atlas de servidor, terreno
 * sintético. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela só a Altura do Observador e a Largura eram editadas em spec de navegador, e o
 * desfazer só cobria a edição da altura. Altura do Alvo, Pontos de Amostragem, e o desfazer e o
 * refazer da EXCLUSÃO não tinham spec. A saída derivada é conferida por coerência com
 * `deriveAnalysisOutput`, como em `cobertura-viewshed.spec.js`.
 */

import { collabTest, expect, selectFeatureUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { prepararTerreno, tracarVisada, desocupar, balde } from './helpers/analise-terreno.js';

collabTest.describe.configure({ retries: 0 });

const ESCRITURACAO = ['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync'];

async function coerente(page, id) {
    const r = await page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const { deriveAnalysisOutput } = await import('/src/js/store/analysis-output.js');
        const f = await s.getCurrentMapFeatures();
        const entrada = (f.los ?? []).find((x) => x.properties.id === fid);
        const vista = (l) => JSON.parse(JSON.stringify(l.map((x) => ({ id: x.properties.id, props: x.properties, geometry: x.geometry }))));
        return {
            metades: vista((f.processed_los ?? []).filter((x) => x.properties.id.startsWith(`${fid}-`))),
            derivadas: vista(entrada ? deriveAnalysisOutput('los', entrada) : []),
        };
    }, id);
    const limpa = (l) => l.map((x) => {
        const props = { ...x.props };
        for (const k of ESCRITURACAO) delete props[k];
        return { id: x.id, geometry: x.geometry, props };
    }).sort((a, b) => a.id.localeCompare(b.id));
    return r.derivadas.length > 0 && JSON.stringify(limpa(r.metades)) === JSON.stringify(limpa(r.derivadas));
}

const propDe = async (page, id, chave) => (await balde(page, 'los')).find((f) => f.id === id)?.props?.[chave] ?? null;
const existe = async (page, id) => (await balde(page, 'los')).some((f) => f.id === id);
const linhaViva = async (collab, id) => {
    const row = await collab.db.queryFeatureRow(id);
    return row ? row.deleted_at === null : 'sem linha';
};

async function mudarParametro(page, id, rotulo, chave, valor) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="parametros"]').click();
    const campo = painel.locator('.feature-tab-content[data-tab-id="parametros"] .attr-modern-slider')
        .filter({ hasText: rotulo }).locator('.attr-modern-slider-input');
    await expect(campo).toBeEnabled({ timeout: 10000 });
    await campo.fill(String(valor));
    await campo.press('Tab');
    await expect.poll(() => propDe(page, id, chave), { timeout: 60000, message: `${rotulo} nao gravou` }).toBe(valor);
    await desocupar(page);
}

collabTest('visada: Altura do Alvo, Amostragem, excluir, desfazer e refazer, com a saída do colega coerente', async ({ collab }) => {
    collabTest.setTimeout(600000);
    const A = collab.author;
    const B = collab.peers[0];
    await prepararTerreno(A);
    await prepararTerreno(B);

    const id = await tracarVisada(A);
    await desocupar(A);
    await expect.poll(() => coerente(B, id), { timeout: 60000, message: 'o colega nao derivou a saida' }).toBe(true);

    for (const [rotulo, chave, valor] of [['Altura do Alvo', 'targetHeight', 30], ['Pontos de Amostragem', 'samplePoints', 200]]) {
        await mudarParametro(A, id, rotulo, chave, valor);
        await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.[chave] ?? null, { timeout: 30000 }).toBe(valor);
        await expect.poll(() => propDe(B, id, chave), { timeout: 30000 }).toBe(valor);
        await expect.poll(() => coerente(B, id), { timeout: 30000, message: `a saida do colega nao acompanhou ${rotulo}` }).toBe(true);
        expect(await coerente(A, id)).toBe(true);
    }

    await deleteFeatureUI(A, id);
    await expect.poll(() => linhaViva(collab, id), { timeout: 30000 }).toBe(false);
    await expect.poll(async () => ({ entrada: await existe(B, id), metades: (await balde(B, 'processed_los')).filter((f) => f.id.startsWith(`${id}-`)).length }),
        { timeout: 30000 }).toEqual({ entrada: false, metades: 0 });

    await A.locator('#map-sig .maplibregl-canvas').focus().catch(() => {});
    await A.keyboard.press('Control+z');
    await expect.poll(() => existe(A, id), { timeout: 30000, message: 'Ctrl+Z nao desfez a exclusao' }).toBe(true);
    await expect.poll(() => linhaViva(collab, id), { timeout: 30000 }).toBe(true);
    await expect.poll(() => coerente(B, id), { timeout: 60000 }).toBe(true);
    expect(await propDe(B, id, 'targetHeight')).toBe(30);

    await A.keyboard.press('Control+y');
    await expect.poll(() => existe(A, id), { timeout: 30000, message: 'Ctrl+Y nao refez a exclusao' }).toBe(false);
    await expect.poll(() => linhaViva(collab, id), { timeout: 30000 }).toBe(false);
    await expect.poll(() => existe(B, id), { timeout: 30000 }).toBe(false);
});
