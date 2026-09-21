// Path: tests/unit/instante-do-slide-nos-tres-modos.repro.test.js
//
// V3 E V9 DA AUDITORIA DO SISTEMA TEMPORAL (2026-09-21).
//
// V3: SLIDE 3D OU 360 NUNCA FIXAVA UM INSTANTE. O interruptor temporal do slide sempre valeu para
// os três modos (os marcadores 3D e 360 filtram pela linha do tempo como o mapa 2D filtra), mas a
// captura escrevia `temporalCursor = null` nos dois ramos não 2D e a reposição saía cedo para
// tudo que não fosse 2D. Efeito: o conjunto de marcadores de um slide 3D era o do slide ANTERIOR.
// A causa era uma regra de MODO onde só cabia uma de finitude: modo decide o mapa BASE
// (`briefing/slide-view.js`), nunca o instante.
//
// V9: A CAPTURA LIA "O TEMPORAL ESTÁ LIGADO" DE DUAS FONTES. O instante vinha do CONTROLADOR
// (`TemporalControl.isEnabled()`, que o controlador reescreve quando re-sincroniza para o mapa
// ativo, uma volta assíncrona depois) e o campo do slide vinha da TELA
// (`isMapTemporalEnabledSync()`). Logo após uma troca de mapa as duas divergiam, e o slide nascia
// com o temporal LIGADO e SEM instante. A causa é a leitura dupla: agora `screen-view.js` lê o
// interruptor UMA vez e o mesmo valor decide os dois campos.
//
// O que este arquivo prende: a decisão PURA (`briefing/slide-temporal.js`), que é onde as duas
// regras passaram a morar, mais a fiação dos três chamadores, por leitura do texto, porque os três
// são impuros (DOM, MapLibre, Cesium) e o que errava neles era a AUSÊNCIA de uma linha.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { captureSlideTemporal, slideTemporalCursor } from '../../src/js/briefing/slide-temporal.js';

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

describe('captureSlideTemporal: o que a captura escreve no slide', () => {
    it('com o temporal LIGADO, guarda o instante da tela', () => {
        expect(captureSlideTemporal({ temporalEnabled: true, cursor: 1_700_000_000_000 }))
            .toEqual({ temporalEnabled: true, temporalCursor: 1_700_000_000_000 });
    });

    it('V9: ligado e sem instante finito nasce SEM instante, não com um inventado', () => {
        for (const cursor of [NaN, undefined, null, Infinity, -Infinity, '10', {}]) {
            expect(captureSlideTemporal({ temporalEnabled: true, cursor }))
                .toEqual({ temporalEnabled: true, temporalCursor: null });
        }
    });

    it('com o temporal DESLIGADO não sobra instante nenhum, mesmo com cursor finito na tela', () => {
        expect(captureSlideTemporal({ temporalEnabled: false, cursor: 1_700_000_000_000 }))
            .toEqual({ temporalEnabled: false, temporalCursor: null });
    });

    it('só `true` liga: string, número e ausência leem como desligado', () => {
        for (const bruto of [undefined, null, {}, { temporalEnabled: 'true' }, { temporalEnabled: 1 }]) {
            expect(captureSlideTemporal(bruto)).toEqual({ temporalEnabled: false, temporalCursor: null });
        }
    });

    it('BORDA: epoch 0 é instante legítimo, e um teste por verdade o perderia', () => {
        expect(captureSlideTemporal({ temporalEnabled: true, cursor: 0 }))
            .toEqual({ temporalEnabled: true, temporalCursor: 0 });
        expect(slideTemporalCursor({ temporalCursor: 0 })).toBe(0);
        // Negativo também: instante anterior a 1970 é data, não erro.
        expect(captureSlideTemporal({ temporalEnabled: true, cursor: -86_400_000 }).temporalCursor)
            .toBe(-86_400_000);
    });

    it('V3: a decisão NÃO tem modo nenhum, que é o que deixava 3D e 360 sem instante', () => {
        // A função nem recebe modo. A prova estrutural é a do arquivo: nenhuma menção a '3d'/'360'.
        const fonte = ler('../../src/js/briefing/slide-temporal.js');
        const corpo = fonte.slice(fonte.indexOf('export function captureSlideTemporal'));
        expect(corpo).not.toMatch(/'3d'|'360'|SlideMode|mode/);
        expect(captureSlideTemporal.length).toBe(1);
    });
});

describe('slideTemporalCursor: o que a reposição lê do slide', () => {
    it('devolve o instante finito e null para todo o resto', () => {
        expect(slideTemporalCursor({ temporalCursor: 1_700_000_000_000 })).toBe(1_700_000_000_000);
        for (const bruto of [undefined, null, {}, { temporalCursor: null }, { temporalCursor: NaN },
            { temporalCursor: '1700000000000' }, { temporalCursor: Infinity }]) {
            expect(slideTemporalCursor(bruto)).toBeNull();
        }
    });

    it('IDA E VOLTA: o que a captura escreveu é o que a reposição lê, e o nada é o mesmo nada', () => {
        fc.assert(fc.property(fc.boolean(), fc.oneof(fc.double(), fc.constant(NaN), fc.constant(undefined)),
            (temporalEnabled, cursor) => {
                const guardado = captureSlideTemporal({ temporalEnabled, cursor });
                const relido = slideTemporalCursor(guardado);
                expect(relido).toBe(guardado.temporalCursor);
                // Desligado na captura nunca deixa instante para a reposição encontrar.
                if (!temporalEnabled) expect(relido).toBeNull();
            }));
    });
});

describe('a fiação dos três chamadores', () => {
    const editor = ler('../../src/js/briefing/editor/briefing-editor.control.js');
    const tela = ler('../../src/js/briefing/screen-view.js');
    const transicao = ler('../../src/js/briefing/presentation/transition.service.js');

    it('V3: a captura do editor não zera mais o instante nos ramos 3D e 360', () => {
        expect(editor).not.toMatch(/slide\.temporalCursor\s*=\s*null/);
        // E nenhum ramo escreve o campo à mão: quem o escreve é a leitura única da tela.
        expect(editor).not.toMatch(/slide\.temporalCursor\s*=/);
        expect(editor).toContain('Object.assign(slide, slideViewFromScreen(slide.mode))');
    });

    it('V3: a reposição da transição não tem mais porta de modo', () => {
        const corpo = transicao.slice(
            transicao.indexOf('_restoreTemporalCursor(slide) {'),
            transicao.indexOf('_ensureViewerMarkersActive'),
        );
        expect(corpo.length, 'não achei o corpo de _restoreTemporalCursor').toBeGreaterThan(0);
        expect(corpo).not.toContain('SlideMode.MAP_2D');
        expect(corpo).toContain('slideTemporalCursor(slide)');
    });

    it('V9: a leitura da tela pergunta o interruptor UMA vez, e a mesma resposta decide os dois campos', () => {
        // Só o CORPO: o cabeçalho cita o nome em prosa, e contar prosa é cobertura vazia.
        const corpoDaTela = tela.slice(tela.indexOf('export function slideViewFromScreen'));
        expect(corpoDaTela.match(/isMapTemporalEnabledSync\(/g) ?? []).toHaveLength(1);
        expect(tela).toContain('const temporalEnabled = isMapTemporalEnabledSync();');
        expect(tela).toContain('captureSlideTemporal({');
        // A fonte antiga do instante (o próprio controlador dizendo se está ligado) saiu do laço:
        // nenhum dos dois arquivos volta a perguntar `isEnabled()` para decidir captura.
        expect(corpoDaTela).not.toContain('isEnabled()');
        expect(editor).not.toContain("getControl('TemporalControl').isEnabled()");
        expect(editor).not.toMatch(/temporalControl\s*&&\s*temporalControl\.isEnabled\(\)/);
    });
});
