// Path: tests/unit/estilo-de-camada-nao-apaga-o-colega.repro.test.js

/**
 * @fileoverview O editor de estilo de uma camada de catálogo grava SÓ o que a pessoa mexeu.
 *
 * O DEFEITO (2026-09-24, lido no código e provado aqui). `LayerStylePanel`
 * (`features_tab/layer-style-panel.component.js`) guarda uma CÓPIA de `styleOverrides` tirada ao
 * abrir e, a cada ajuste, grava a cópia INTEIRA (`updateCatalogLayer(id, { styleOverrides })`). Se
 * o colega mudou outra propriedade do estilo da mesma camada com o painel aberto, o próximo ajuste
 * de quem está com o painel aberto apaga a mudança do colega, e a op sai com a base atual.
 *
 * O que se mede é o que chega a `updateCatalogLayer`, com um duplo que aplica o contrato da store
 * sobre um registro guardado: um objeto é espalhado; uma FUNÇÃO recebe o registro guardado NAQUELE
 * instante (sob a trava, na store real) e devolve o que espalhar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ stored: null, writes: 0 }));

vi.mock('@store', () => ({
    getCurrentMapNameSync: () => 'Mapa',
    updateCatalogLayer: vi.fn(async (id, updates) => {
        const clone = (v) => JSON.parse(JSON.stringify(v));
        const patch = typeof updates === 'function' ? updates(clone(h.stored)) : updates;
        h.stored = { ...h.stored, ...clone(patch), id };
        h.writes += 1;
        return true;
    }),
}));
vi.mock('@store/atlas-namespace.js', () => ({ getActiveScope: () => null }));
vi.mock('@utils/toast_service.js', () => ({ showWarning: vi.fn() }));

globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { LayerStylePanel } = await import('../../src/js/features_tab/layer-style-panel.component.js');

const CAMADA = {
    id: 'cat-1', type: 'data_layer', name: 'Rios',
    styleOverrides: { line: { 'line-color': '#0000ff' } },
};

function abrirPainel() {
    return new LayerStylePanel({ layer: JSON.parse(JSON.stringify(CAMADA)), host: null });
}

async function gravar(painel) {
    await painel._persist.flush('layer-style');
}

beforeEach(() => {
    h.stored = JSON.parse(JSON.stringify(CAMADA));
    h.writes = 0;
});

describe('editor de estilo de camada com o colega editando a mesma camada', () => {
    it('o ajuste de quem esta com o painel aberto nao apaga a propriedade que o colega mudou', async () => {
        const painel = abrirPainel();
        // O colega muda a LARGURA da linha depois que o painel abriu.
        h.stored = { ...h.stored, styleOverrides: { line: { 'line-color': '#0000ff', 'line-width': 5 } } };
        // Eu mudo a COR.
        painel._setOverride('line', 'line-color', '#ff0000');
        await gravar(painel);
        expect(h.writes).toBe(1);
        expect(h.stored.styleOverrides).toEqual({ line: { 'line-color': '#ff0000', 'line-width': 5 } });
    });

    it('o ajuste de OUTRA subcamada tambem nao apaga a do colega', async () => {
        const painel = abrirPainel();
        h.stored = { ...h.stored, styleOverrides: { line: { 'line-color': '#00ff00' } } };
        painel._setOverride('fill', 'fill-opacity', 0.4);
        await gravar(painel);
        expect(h.stored.styleOverrides).toEqual({ line: { 'line-color': '#00ff00' }, fill: { 'fill-opacity': 0.4 } });
    });

    it('CONTROLE: restaurar o padrao continua limpando tudo, e o ajuste depois dele entra sozinho', async () => {
        const painel = abrirPainel();
        painel._fillBody = () => {};
        h.stored = { ...h.stored, styleOverrides: { line: { 'line-color': '#00ff00', 'line-width': 5 } } };
        painel._resetToDefault();
        painel._setOverride('fill', 'fill-color', '#123456');
        await gravar(painel);
        expect(h.stored.styleOverrides).toEqual({ fill: { 'fill-color': '#123456' } });
    });

    it('o que ja foi salvo nao volta no proximo ajuste: salvar vermelho, o colega poe azul, eu mudo a espessura', async () => {
        const painel = abrirPainel();
        painel._setOverride('line', 'line-color', '#ff0000');
        await gravar(painel);
        expect(h.stored.styleOverrides.line['line-color']).toBe('#ff0000');
        // O colega troca a cor para azul.
        h.stored = { ...h.stored, styleOverrides: { line: { ...h.stored.styleOverrides.line, 'line-color': '#0000ff' } } };
        // Eu mexo so na espessura.
        painel._setOverride('line', 'line-width', 7);
        await gravar(painel);
        expect(h.stored.styleOverrides).toEqual({ line: { 'line-color': '#0000ff', 'line-width': 7 } });
    });

    it('restaurar o padrao salvo nao volta a limpar o que o colega fez depois', async () => {
        const painel = abrirPainel();
        painel._fillBody = () => {};
        painel._resetToDefault();
        await gravar(painel);
        expect(h.stored.styleOverrides).toEqual({});
        h.stored = { ...h.stored, styleOverrides: { line: { 'line-color': '#00ff00' } } };
        painel._setOverride('fill', 'fill-opacity', 0.3);
        await gravar(painel);
        expect(h.stored.styleOverrides).toEqual({ line: { 'line-color': '#00ff00' }, fill: { 'fill-opacity': 0.3 } });
    });
});
