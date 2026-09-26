// Path: tests/unit/enquadramento-inclui-rota-e-desconta-painel.repro.test.js

/**
 * REPRO: o enquadramento da seleção (clique na árvore, resultado da busca, "Zoom para Seleção")
 * deixava fora da tela parte do que a seleção desenha (decisão do dono de 2026-09-26).
 *
 * DUAS CAUSAS, medidas pela campanha de desenho:
 *   1. o extent era só a pegada (caixa ou geometria), e a ROTA de uma feição temporal
 *      (`properties.trajetoria`) é desenhada com uma alça por ponto-chave: um símbolo enquadrado
 *      pela caixa dele, perto do zoom 17, deixava os pontos-chave 2 e 3 em x = 1784 e 2929 num
 *      canvas de 1280 (`alca-da-partida-anel.repro.spec.js`);
 *   2. a margem era a mesma nos quatro lados, e o canvas do mapa é a janela inteira, com a barra
 *      lateral e o painel POR CIMA dele à esquerda: a alça de rotação de um texto, que fica à
 *      esquerda dele, caía debaixo do painel aberto.
 *
 * O QUE ESTE VERDE PROVA: que o extent contém os pontos-chave, e que a margem esquerda soma o que
 * cobre o canvas sem nunca comer a faixa do enquadramento. O que ele NÃO prova é a MEDIDA do que
 * cobre (`leftCoverOf` lê o DOM) nem o pixel: isso é da captura, que mediu a alça de rotação de um
 * texto em x = 348 com o painel terminando em 456, antes do conserto.
 */

import { describe, it, expect, vi } from 'vitest';
import { selectionExtent } from '@utils/geometry-utils.js';
import { leftCoverOf, selectionFramePadding } from '@utils/selection-frame.js';

// `frameFeatures` reads the source type through the store barrel and nothing else from it.
vi.mock('@store', () => ({ getSourceTypeFromStorage: (t) => t }));
vi.mock('@js/map/maplibre.js', () => ({ maplibregl: {} }));
const { frameFeatures } = await import('@utils/feature_navigation_utils.js');

const simbolo = (coords, trajetoria) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: {
        source: 'military_symbol',
        selectionBox: {
            type: 'Polygon',
            coordinates: [[[coords[0] - 0.001, coords[1] - 0.001], [coords[0] + 0.001, coords[1] - 0.001],
                [coords[0] + 0.001, coords[1] + 0.001], [coords[0] - 0.001, coords[1] + 0.001],
                [coords[0] - 0.001, coords[1] - 0.001]]],
        },
        ...(trajetoria ? { trajetoria } : {}),
    },
});

describe('o extent inclui a rota', () => {
    it('REPRO: os pontos-chave de uma feição temporal entram no enquadramento', () => {
        const rota = [
            { t: 0, lng: -43.2, lat: -22.9 },
            { t: 1, lng: -43.1, lat: -22.8 },
            { t: 2, lng: -43.0, lat: -22.95 },
        ];
        const [[w, s], [e, n]] = selectionExtent([simbolo([-43.2, -22.9], rota)]);
        expect(w).toBeCloseTo(-43.201);
        expect(e).toBeCloseTo(-43.0);
        expect(s).toBeCloseTo(-22.95);
        expect(n).toBeCloseTo(-22.8);
    });

    it('ponto-chave inválido é ignorado, sem derrubar o resto', () => {
        const rota = [{ t: 0, lng: -43.2, lat: -22.9 }, { t: 1, lng: NaN, lat: 5 }, null, { t: 2, lng: -43.1, lat: -22.85 }];
        const [[, s], [e, n]] = selectionExtent([simbolo([-43.2, -22.9], rota)]);
        expect(e).toBeCloseTo(-43.1);
        expect(s).toBeCloseTo(-22.901);
        expect(n).toBeCloseTo(-22.85);
    });

    it('CONTROLE: sem rota, o extent é a caixa, como antes', () => {
        const [[w, s], [e, n]] = selectionExtent([simbolo([-43.2, -22.9])]);
        expect([w, s, e, n].map((v) => Number(v.toFixed(6)))).toEqual([-43.201, -22.901, -43.199, -22.899]);
    });

    it('rota que cruza o antimeridiano não vira o mundo espelhado', () => {
        const rota = [{ t: 0, lng: 179.9, lat: 0 }, { t: 1, lng: -179.9, lat: 0 }];
        const [[oeste], [leste]] = selectionExtent([simbolo([179.9, 0], rota)]);
        expect(oeste).toBeCloseTo(179.899);
        expect(leste).toBeCloseTo(180.1);
    });
});

describe('a margem desconta o que cobre o canvas', () => {
    it('REPRO: com o painel por cima do mapa, a margem esquerda soma o que ele cobre', () => {
        expect(selectionFramePadding({ margem: 80, cobertoAEsquerda: 456 }))
            .toEqual({ top: 80, right: 80, bottom: 80, left: 536 });
    });

    it('com tudo fechado, só a trilha cobre o canvas', () => {
        expect(selectionFramePadding({ margem: 80, cobertoAEsquerda: 56 }).left).toBe(136);
    });

    it('nada coberto (tablet, que empurra o mapa; telefone): a margem é a de sempre', () => {
        expect(selectionFramePadding({ margem: 80, cobertoAEsquerda: 0 }))
            .toEqual({ top: 80, right: 80, bottom: 80, left: 80 });
    });

    it('numa janela estreita o desconto encolhe e deixa uma faixa para enquadrar', () => {
        const { left, right } = selectionFramePadding({ margem: 80, cobertoAEsquerda: 456, larguraDoCanvas: 600 });
        expect(600 - left - right).toBe(64);
        // Janela menor que as duas margens: nada é descontado, e a margem fica como era.
        expect(selectionFramePadding({ margem: 80, cobertoAEsquerda: 456, larguraDoCanvas: 150 }).left).toBe(80);
    });

    it('janela larga: o desconto inteiro cabe', () => {
        expect(selectionFramePadding({ margem: 80, cobertoAEsquerda: 456, larguraDoCanvas: 1280 }).left).toBe(536);
    });

    it('uma cobertura que não é número vira zero, nunca NaN na câmera', () => {
        for (const cobertoAEsquerda of [undefined, null, NaN, -10, 'x']) {
            expect(selectionFramePadding({ margem: 80, cobertoAEsquerda }).left, String(cobertoAEsquerda)).toBe(80);
        }
    });

    it('sem DOM (node), nada cobre', () => {
        expect(leftCoverOf(null)).toBe(0);
    });
});

describe('o quadro inclui as alças que a seleção desenhou', () => {
    /** Um mapa com uma fonte de alças de texto e outra fonte qualquer. */
    function mapaCom(alcas) {
        return {
            getLayersOrder: () => ['points-layer', 'text-edit-handles-layer'],
            getLayer: (id) => ({ source: id === 'text-edit-handles-layer' ? 'text-edit-handles' : 'points' }),
            getSource: (id) => ({
                serialize: () => ({ type: 'geojson', data: { type: 'FeatureCollection', features: id === 'text-edit-handles' ? alcas : [] } }),
            }),
            getContainer: () => null,
            fitBounds: vi.fn(),
        };
    }
    const alca = (coords, featureId) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { featureId } });
    const texto = {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id: 't1', source: 'text', selectionBox: { type: 'Polygon', coordinates: [[[-43.21, -22.91], [-43.19, -22.91], [-43.19, -22.89], [-43.21, -22.89], [-43.21, -22.91]]] } },
    };

    it('REPRO: a alça de rotação à esquerda da caixa entra no extent; a de outra feição não', () => {
        const mapa = mapaCom([alca([-43.25, -22.9], 't1'), alca([10, 10], 'outra')]);
        expect(frameFeatures([texto], mapa)).toBe(true);
        // No mesmo instante da seleção: um quadro adiado deixaria a câmera parada por um momento, e
        // quem espera "câmera parada" como fim do quadro leria o instante errado.
        expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
        const [[w, s], [e, n]] = mapa.fitBounds.mock.calls[0][0];
        expect(w, 'a alça puxou o oeste').toBeCloseTo(-43.25);
        expect([s, e, n].map((v) => Number(v.toFixed(6)))).toEqual([-22.91, -43.19, -22.89]);
    });

    it('CONTROLE: sem fonte de alça no mapa, o quadro sai na hora, pela caixa', () => {
        const mapa = { getContainer: () => null, fitBounds: vi.fn() };
        frameFeatures([texto], mapa);
        expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
        expect(mapa.fitBounds.mock.calls[0][0][0][0]).toBeCloseTo(-43.21);
    });

    it('uma fonte que falha ao ler não impede o quadro', () => {
        const mapa = mapaCom([]);
        mapa.getSource = () => ({ serialize: () => { throw new Error('fonte'); } });
        frameFeatures([texto], mapa);
        expect(mapa.fitBounds).toHaveBeenCalledTimes(1);
        expect(mapa.fitBounds.mock.calls[0][0][0][0]).toBeCloseTo(-43.21);
    });
});

