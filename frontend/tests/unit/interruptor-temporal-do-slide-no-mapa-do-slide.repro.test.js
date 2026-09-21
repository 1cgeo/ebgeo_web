// Path: tests/unit/interruptor-temporal-do-slide-no-mapa-do-slide.repro.test.js
//
// V11 DA AUDITORIA DO SISTEMA TEMPORAL (2026-09-21).
//
// NO EDITOR DE BRIEFING, A CAIXA DO INTERRUPTOR TEMPORAL ERA MONTADA CONTRA O MAPA DO SLIDE E O
// EFEITO DELA ERA APLICADO AO MAPA CORRENTE. `_createSlideViewGroup` pergunta
// `isMapTemporalSavedEnabled(slide.mapId)` para decidir o estado da caixa; ao mudar a caixa, o
// editor chamava `_applySlideViewToScreen`, que lia o salvo do mapa CORRENTE e escrevia
// `setMapTemporalView(null, ...)`, que resolve para o mapa corrente. Enquanto os dois são o mesmo
// mapa nada aparece; eles deixam de ser o mesmo no intervalo em que o editor ainda está trocando
// de mapa (a troca é assíncrona e `_applySlideViewToScreen` é chamada do `change` da caixa e do
// seletor de mapa base), e aí o autor marca a caixa de um mapa e liga a linha do tempo de outro.
//
// A causa é um argumento OMITIDO: `null` não quer dizer "o mapa do slide", quer dizer "o corrente"
// (`resolveMapName` em `store/temporal.operations.js`, e o mesmo para `getCurrentBaseLayer`).
// Prende-se por leitura do texto porque o método é impuro de ponta a ponta (controles do MapLibre,
// store, DOM) e o defeito era a AUSÊNCIA do argumento.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');
const editor = ler('../../src/js/briefing/editor/briefing-editor.control.js').replace(/\r\n/g, '\n');

const corpo = (() => {
    const inicio = editor.search(/^ {4}async _applySlideViewToScreen\(slide\) \{/m);
    expect(inicio, 'não achei _applySlideViewToScreen').toBeGreaterThan(-1);
    const fim = editor.indexOf('\n    }\n', inicio);
    expect(fim).toBeGreaterThan(inicio);
    return editor.slice(inicio, fim);
})();

describe('V11: a vista do slide é aplicada ao mapa DO SLIDE', () => {
    it('o mapa do slide é resolvido uma vez e usado nas três leituras/escritas', () => {
        expect(corpo).toContain("const mapName = slide?.mapId || null;");
        expect(corpo).toContain('getCurrentBaseLayer(mapName)');
        expect(corpo).toContain('isMapTemporalSavedEnabled(mapName)');
        expect(corpo).toContain('setMapTemporalView(mapName, view.temporalEnabled, { automatico: true })');
    });

    it('o `null` que significava "o mapa corrente" saiu das três', () => {
        expect(corpo).not.toContain('setMapTemporalView(null,');
        expect(corpo).not.toMatch(/getCurrentBaseLayer\(\s*\)/);
        expect(corpo).not.toMatch(/isMapTemporalSavedEnabled\(\s*\)/);
    });

    it('a caixa continua sendo MONTADA contra o mesmo mapa que agora recebe o efeito', () => {
        // Se as duas metades voltarem a divergir, o defeito volta inteiro: é o par que importa,
        // não cada lado.
        const grupo = (() => {
            const inicio = editor.search(/^ {4}async _createSlideViewGroup\(slide\) \{/m);
            expect(inicio, 'não achei _createSlideViewGroup').toBeGreaterThan(-1);
            return editor.slice(inicio, editor.indexOf('\n    }\n', inicio));
        })();
        expect(grupo).toContain('isMapTemporalSavedEnabled(slide.mapId || null)');
        expect(grupo).toContain('getCurrentBaseLayer(slide.mapId || null)');
    });

    it('BORDA: slide sem mapa não vira string vazia, vira null (= o corrente)', () => {
        // `slide.mapId` é null num slide recém-criado sem mapa escolhido, e `'' || null` tem de
        // resolver para null, não para `''`, que nenhum resolvedor da store entende.
        expect(corpo).toMatch(/slide\?\.mapId \|\| null/);
    });
});
