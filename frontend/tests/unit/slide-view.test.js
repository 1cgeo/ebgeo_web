// Path: tests/unit/slide-view.test.js
//
// A VISTA DE UM SLIDE DE BRIEFING: qual mapa base ele mostra e se a linha do tempo está ligada.
//
// Desde 2026-09-20 os dois são estado de vista de cada pessoa, então o slide é o único lugar que
// pode dizer o que a plateia vê. `briefing/slide-view.js` é puro e decide três coisas que não
// podem ser decididas errado em silêncio:
//
//   - NULO HERDA O QUE FOI SALVO COM O MAPA, e `undefined` lê como nulo. É o que faz todo slide
//     escrito antes destes campos apresentar exatamente como apresentava;
//   - BASE QUE ESTE ESPECTADOR NÃO DESENHA cai para a base salva do MAPA, nunca para "a primeira
//     oferecida". Uma base privada escolhida pelo autor não está no catálogo de quem não tem a
//     concessão, e a degradação honesta é a base que o mapa mostraria de qualquer forma;
//   - A BASE É ASSUNTO DO 2D. Slide 3D ou 360 cobre o mapa e não pede base; o interruptor temporal
//     vale nos três modos, porque os marcadores do 3D e do 360 também filtram por ele.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveSlideView, captureSlideView } from '../../src/js/briefing/slide-view.js';

const SALVO = { baseLayer: 'carta-topografica', temporalEnabled: false };

describe('resolveSlideView', () => {
    it('slide com base e interruptor próprios: valem os dele', () => {
        expect(resolveSlideView({ mode: '2d', baseLayer: 'imagens', temporalEnabled: true }, SALVO))
            .toEqual({ baseLayer: 'imagens', temporalEnabled: true });
    });

    it('slide ANTIGO (sem os campos) herda a vista salva do mapa', () => {
        expect(resolveSlideView({ mode: '2d' }, { baseLayer: 'osm', temporalEnabled: true }))
            .toEqual({ baseLayer: 'osm', temporalEnabled: true });
    });

    it.each([null, undefined, '', 0, 42, {}, []])('base %j não é um pedido: herda a do mapa', (baseLayer) => {
        expect(resolveSlideView({ mode: '2d', baseLayer }, SALVO).baseLayer).toBe('carta-topografica');
    });

    it.each([null, undefined, 'true', 1, 0, NaN])('interruptor %j não é booleano: herda o do mapa', (temporalEnabled) => {
        expect(resolveSlideView({ mode: '2d', temporalEnabled }, { ...SALVO, temporalEnabled: true }).temporalEnabled).toBe(true);
        expect(resolveSlideView({ mode: '2d', temporalEnabled }, SALVO).temporalEnabled).toBe(false);
    });

    it('`false` explícito DESLIGA mesmo com o mapa salvo ligado: falso não é ausência', () => {
        expect(resolveSlideView({ mode: '2d', temporalEnabled: false }, { ...SALVO, temporalEnabled: true }).temporalEnabled)
            .toBe(false);
    });

    it('base que este espectador não desenha cai para a SALVA do mapa, não para a primeira oferecida', () => {
        const disponiveis = ['osm', 'carta-topografica'];
        expect(resolveSlideView({ mode: '2d', baseLayer: 'base-privada' }, SALVO, disponiveis).baseLayer)
            .toBe('carta-topografica');
    });

    it('sem lista de disponíveis não há o que conferir: o pedido passa', () => {
        expect(resolveSlideView({ mode: '2d', baseLayer: 'base-privada' }, SALVO).baseLayer).toBe('base-privada');
    });

    it.each(['3d', '360'])('slide %s não pede base (o mapa está coberto), e o interruptor continua valendo', (mode) => {
        expect(resolveSlideView({ mode, baseLayer: 'imagens', temporalEnabled: true }, SALVO))
            .toEqual({ baseLayer: null, temporalEnabled: true });
    });

    it('slide sem `mode` é 2D, que é como `createEmptySlide` nasce e como o servidor lê', () => {
        expect(resolveSlideView({ baseLayer: 'imagens' }, SALVO).baseLayer).toBe('imagens');
    });

    it.each([null, undefined])('slide %j e salvo ausente não lançam: nada a pedir', (slide) => {
        expect(resolveSlideView(slide, undefined)).toEqual({ baseLayer: null, temporalEnabled: false });
    });

    it('PROPRIEDADE: a resposta sempre tem a forma certa, para qualquer entrada', () => {
        fc.assert(fc.property(
            fc.record({ mode: fc.anything(), baseLayer: fc.anything(), temporalEnabled: fc.anything() }, { requiredKeys: [] }),
            fc.record({ baseLayer: fc.option(fc.string()), temporalEnabled: fc.anything() }),
            fc.option(fc.array(fc.string()), { nil: undefined }),
            (slide, salvo, disponiveis) => {
                const vista = resolveSlideView(slide, salvo, disponiveis);
                expect(typeof vista.temporalEnabled).toBe('boolean');
                expect(vista.baseLayer === null || (typeof vista.baseLayer === 'string' && vista.baseLayer !== '')).toBe(true);
            },
        ));
    });

    it('PROPRIEDADE: a base respondida é a PEDIDA, a SALVA ou nenhuma, nunca uma terceira', () => {
        fc.assert(fc.property(
            fc.option(fc.string({ minLength: 1 })), fc.option(fc.string({ minLength: 1 })), fc.array(fc.string({ minLength: 1 })),
            (pedida, salva, disponiveis) => {
                const { baseLayer } = resolveSlideView({ mode: '2d', baseLayer: pedida }, { baseLayer: salva, temporalEnabled: false }, disponiveis);
                expect([pedida, salva, null]).toContain(baseLayer);
                // E a pedida só sai quando este espectador a desenha.
                if (baseLayer === pedida && pedida !== salva && pedida !== null) expect(disponiveis).toContain(pedida);
            },
        ));
    });
});

describe('captureSlideView', () => {
    it('captura 2D grava a base e o interruptor da TELA do autor', () => {
        expect(captureSlideView('2d', { baseLayer: 'imagens', temporalEnabled: true }))
            .toEqual({ baseLayer: 'imagens', temporalEnabled: true });
    });

    it.each(['3d', '360'])('captura %s não grava base, só o interruptor', (mode) => {
        expect(captureSlideView(mode, { baseLayer: 'imagens', temporalEnabled: true }))
            .toEqual({ baseLayer: null, temporalEnabled: true });
    });

    it.each([undefined, null, {}, { baseLayer: '', temporalEnabled: 'sim' }])('tela %j: base nula e interruptor desligado', (tela) => {
        expect(captureSlideView('2d', tela)).toEqual({ baseLayer: null, temporalEnabled: false });
    });

    it('IDA E VOLTA: o que a captura grava é o que a apresentação mostra a quem tem a mesma base', () => {
        fc.assert(fc.property(fc.string({ minLength: 1 }), fc.boolean(), (base, temporal) => {
            const gravado = captureSlideView('2d', { baseLayer: base, temporalEnabled: temporal });
            expect(resolveSlideView({ mode: '2d', ...gravado }, { baseLayer: 'outra', temporalEnabled: !temporal }, [base]))
                .toEqual({ baseLayer: base, temporalEnabled: temporal });
        }));
    });
});
