// Path: tests/unit/opacidade-de-camada-nao-escreve-a-toa.test.js
//
// `layers/layer-opacity-applier.js` NAO TINHA TESTE NENHUM, e ele escreve direto no estilo vivo
// do MapLibre. Este arquivo cobre as duas coisas que uma medicao de boot mudou ali, e a terceira
// que nao pode cair por causa delas.
//
// O QUE FOI MEDIDO, no pacote de producao servido de `dist/`, boot de visitante com IndexedDB
// vazio: `applyLayerOpacities` fazia 252 chamadas de `getPaintProperty`, das quais 209 LANCAVAM,
// e 43 chamadas de `setPaintProperty` cujo efeito era multiplicar tudo por 1. As duas sao
// desperdicio de naturezas diferentes:
//
//   1. o lance vinha de perguntar `fill-opacity` a uma camada de circulo. A propriedade de tinta
//      pertence ao TIPO da camada, e o tipo esta em `map.getLayer(id).type`, entao a pergunta
//      certa nunca lanca;
//   2. com toda opacidade valendo 1 o multiplicador e a identidade. Escrever `['*', X, 1]` troca a
//      expressao de tinta por outra equivalente, mais cara de avaliar por feicao a cada quadro.
//
// A TERCEIRA COISA E A QUE FAZ O ATALHO SER SEGURO, e e o unico jeito de ele estar errado: depois
// que UMA opacidade saiu de 1, voltar todas para 1 e uma RESTAURACAO, e restaurar exige escrever.
// Um atalho que so olhasse "todas em 1" engoliria essa volta e deixaria o mapa esmaecido para
// sempre. O ultimo caso deste arquivo e exatamente esse, e ele REPROVA a versao ingenua do atalho.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const camadasDaStore = { valor: [] };

vi.mock('../../src/js/store', () => ({
    getLayers: () => camadasDaStore.valor,
}));

const { applyLayerOpacities, invalidateOpacityCache } = await import('../../src/js/layers/layer-opacity-applier.js');
const { FEATURE_LAYER_IDS } = await import('../../src/js/layers/layer.constants.js');

/** As propriedades de tinta que cada tipo REALMENTE aceita, para o dublê lançar como o MapLibre. */
const VALIDAS_POR_TIPO = {
    fill: new Set(['fill-opacity', 'fill-color', 'fill-pattern']),
    line: new Set(['line-opacity', 'line-color', 'line-width']),
    circle: new Set(['circle-opacity', 'circle-stroke-opacity', 'circle-color', 'circle-radius']),
    symbol: new Set(['text-opacity', 'icon-opacity', 'text-color']),
};

/**
 * Um mapa de mentira que se comporta como o MapLibre no ponto que importa: `getPaintProperty`
 * LANCA quando a propriedade nao pertence ao tipo da camada. Um dublê que devolvesse `undefined`
 * ali nao reprovaria a versao antiga, e o teste nao mediria nada.
 */
function mapaDublê(tipoPorId) {
    const chamadas = { getPaint: [], setPaint: [], lancou: 0 };
    return {
        chamadas,
        getLayer(id) {
            const type = tipoPorId[id];
            return type ? { id, type } : undefined;
        },
        getPaintProperty(id, prop) {
            chamadas.getPaint.push(`${id}:${prop}`);
            const type = tipoPorId[id];
            if (!VALIDAS_POR_TIPO[type]?.has(prop)) {
                chamadas.lancou += 1;
                throw new Error(`layer ${id} does not have paint property ${prop}`);
            }
            return prop.endsWith('-opacity') ? ['get', 'opacity'] : '#000';
        },
        setPaintProperty(id, prop, valor) {
            chamadas.setPaint.push({ id, prop, valor });
        },
    };
}

/** Um tipo plausivel para cada id real de `FEATURE_LAYER_IDS`, deduzido do sufixo. */
function tiposReais() {
    const out = {};
    for (const id of FEATURE_LAYER_IDS) {
        if (id.includes('-fill')) out[id] = 'fill';
        else if (id.includes('-label') || id.includes('text-layer') || id.includes('symbols') || id.includes('measures') || id.includes('declinations') || id === 'image-layer') out[id] = 'symbol';
        else if (id === 'point-layer' || id === 'boundary-circles-layer') out[id] = 'circle';
        else out[id] = 'line';
    }
    return out;
}

describe('applyLayerOpacities', () => {
    beforeEach(() => {
        invalidateOpacityCache();
        camadasDaStore.valor = [];
    });

    it('nunca pergunta uma propriedade de tinta que o tipo da camada nao tem', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        expect(mapa.chamadas.lancou).toBe(0);
        // CONTROLE DE VACUO: um caminhador que nao perguntasse nada tambem daria zero lances.
        expect(mapa.chamadas.getPaint.length).toBeGreaterThan(FEATURE_LAYER_IDS.length / 2);
        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(FEATURE_LAYER_IDS.length / 2);
    });

    it('nao escreve tinta nenhuma quando toda opacidade vale 1', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 1 }, { id: 'b' }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        expect(mapa.chamadas.setPaint).toEqual([]);
    });

    it('multiplica pelo match quando alguma opacidade sai de 1', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.25 }, { id: 'b', opacity: 1 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);

        const escrita = mapa.chamadas.setPaint.find((c) => c.prop === 'fill-opacity');
        expect(escrita).toBeDefined();
        expect(escrita.valor[0]).toBe('*');
        expect(escrita.valor[1]).toEqual(['get', 'opacity']);
        expect(escrita.valor[2]).toContain('a');
        expect(escrita.valor[2]).toContain(0.25);
    });

    it('RESTAURA quando a opacidade volta de 0.25 para 1, em vez de pular a escrita', () => {
        const mapa = mapaDublê(tiposReais());

        camadasDaStore.valor = [{ id: 'a', opacity: 0.25 }];
        applyLayerOpacities(mapa);
        const depoisDoPrimeiro = mapa.chamadas.setPaint.length;
        expect(depoisDoPrimeiro).toBeGreaterThan(0);

        camadasDaStore.valor = [{ id: 'a', opacity: 1 }];
        applyLayerOpacities(mapa);

        // A verificacao REPROVA o estado anterior: se o atalho de identidade nao olhasse a
        // bandeira, esta segunda passada nao escreveria nada e o mapa ficaria em 0.25.
        expect(mapa.chamadas.setPaint.length).toBeGreaterThan(depoisDoPrimeiro);
        const ultima = mapa.chamadas.setPaint[mapa.chamadas.setPaint.length - 1];
        expect(ultima.valor[2]).toContain(1);
    });

    it('nao repete trabalho quando a assinatura de opacidades nao mudou', () => {
        camadasDaStore.valor = [{ id: 'a', opacity: 0.5 }];
        const mapa = mapaDublê(tiposReais());

        applyLayerOpacities(mapa);
        const n = mapa.chamadas.setPaint.length;
        applyLayerOpacities(mapa);

        expect(mapa.chamadas.setPaint.length).toBe(n);
    });
});
