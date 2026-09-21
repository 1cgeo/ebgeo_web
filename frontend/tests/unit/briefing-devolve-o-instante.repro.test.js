// Path: tests/unit/briefing-devolve-o-instante.repro.test.js
//
// V5 E V10 DA AUDITORIA DO SISTEMA TEMPORAL (2026-09-21).
//
// V5: SAIR DA APRESENTAÇÃO NÃO DEVOLVIA O INSTANTE. O serviço de transição guardava o mapa base e
// o interruptor temporal de cada mapa tocado e devolvia os dois em `resetTo2D`; o CURSOR não
// entrava na conta, então a pessoa voltava presa no instante do último slide, sem nada na tela
// dizendo que ele tinha sido movido. A reprodução também ficava por conta de um evento só do
// APRESENTADOR (`BRIEFING_PRESENT_STARTED`), que a prévia do editor e a exportação em PDF não
// emitem, embora as três dirijam as mesmas transições.
//
// A causa do V5 tem DUAS metades, e a segunda é de ORDEM: a lembrança da vista da pessoa era
// disparada de dentro de `_applySlideView`, que roda DEPOIS de `setCurrentMap`, de modo que o
// instante lido ali já seria o do mapa do primeiro slide. Por isso a chamada subiu para o topo de
// `_switchMapIfNeeded`, antes da troca.
//
// V10: O INSTANTE DO SLIDE ERA APARADO CONTRA OS LIMITES DO MAPA ANTERIOR. O controlador prende o
// cursor aos limites que ele já publicou, e numa transição entre slides de mapas DIFERENTES esses
// ainda são os do mapa que sai: o slide abria no começo da linha do tempo em vez do instante
// escolhido. O conserto é de contrato com o controlador (`setCursor(cursor, { mapName })`, que o
// guarda como PENDENTE até publicar os limites daquele mapa); aqui se prende o lado do briefing,
// que é passar o nome do mapa em TODA chamada de reposição.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');
// Normalizado: o arquivo é CRLF nesta árvore, e uma âncora escrita com \n nu não casaria nada,
// devolvendo verde por cobertura vazia em vez de vermelho.
const transicao = ler('../../src/js/briefing/presentation/transition.service.js').replace(/\r\n/g, '\n');

/** Corpo de um método, do nome dele até o fecho de chave no recuo da classe. */
function corpoDe(nome) {
    const inicio = transicao.search(new RegExp(`^ {4}(?:async )?${nome}\\(`, 'm'));
    expect(inicio, `não achei o método ${nome}`).toBeGreaterThan(-1);
    const fim = transicao.indexOf('\n    }\n', inicio);
    expect(fim, `não achei o fim de ${nome}`).toBeGreaterThan(inicio);
    return transicao.slice(inicio, fim);
}

describe('V10: o instante viaja com o NOME DO MAPA', () => {
    it('toda chamada de setCursor do briefing leva `{ mapName }`', () => {
        const chamadas = transicao.match(/setCursor\([^)]*\)/g) ?? [];
        expect(chamadas.length, 'nenhum setCursor: a varredura parou de casar').toBeGreaterThanOrEqual(2);
        for (const chamada of chamadas) {
            expect(chamada, `setCursor sem mapa: ${chamada}`).toContain('mapName');
        }
    });

    it('a reposição do SLIDE endereça o mapa do slide', () => {
        expect(corpoDe('_restoreTemporalCursor'))
            .toContain("setCursor(cursor, { mapName: slide.mapId || null })");
    });
});

describe('V5: a saída devolve o instante e para a reprodução', () => {
    it('a vista da pessoa é lembrada ANTES da troca de mapa, não depois', () => {
        const corpo = corpoDe('_switchMapIfNeeded');
        const lembra = corpo.indexOf('this._rememberPersonView(getCurrentMapNameSync())');
        const troca = corpo.indexOf('await setCurrentMap(slide.mapId)');
        expect(lembra, 'a lembrança saiu de _switchMapIfNeeded').toBeGreaterThan(-1);
        expect(troca).toBeGreaterThan(-1);
        expect(lembra, 'a lembrança voltou a acontecer depois da troca de mapa').toBeLessThan(troca);
    });

    it('o que se lembra inclui o CURSOR, carimbado com o mapa em que foi lido', () => {
        const corpo = corpoDe('_rememberPersonView');
        expect(corpo).toContain('getCursor');
        expect(corpo).toContain('Number.isFinite(cursor) ? cursor : null');
        expect(corpo).toMatch(/cursor:\s*\{[\s\S]*mapName/);
    });

    it('o que se devolve inclui o CURSOR, e não só o interruptor e o mapa base', () => {
        const corpo = corpoDe('_restorePersonView');
        expect(corpo).toContain('setMapTemporalView');       // o interruptor, que já voltava
        expect(corpo).toContain('applySharedBasemap');       // o mapa base, que já voltava
        expect(corpo).toContain('saved.cursor');             // o instante, que não voltava
        expect(corpo).toContain('setCursor(saved.cursor.value, { mapName: saved.cursor.mapName })');
    });

    it('BORDA: instante ausente não vira zero na volta', () => {
        // `value` é null quando a pessoa não tinha instante nenhum, e zero é instante legítimo:
        // a guarda tem de ser por null/undefined explícito, nunca por verdade.
        const corpo = corpoDe('_restorePersonView');
        expect(corpo).toMatch(/saved\.cursor\?\.value !== null/);
        expect(corpo).not.toMatch(/if\s*\(\s*saved\.cursor\?\.value\s*\)/);
    });

    it('a reprodução é parada nas DUAS pontas, pela porta pública do controlador', () => {
        for (const nome of ['_rememberPersonView', '_restorePersonView']) {
            const corpo = corpoDe(nome);
            expect(corpo, `${nome} não para a reprodução`)
                .toContain('if (temporalControl?.isPlaying?.()) temporalControl.togglePlay()');
        }
    });

    it('a devolução continua pendurada na saída (resetTo2D), que é o que as três telas chamam', () => {
        expect(corpoDe('resetTo2D')).toContain('await this._restorePersonView()');
    });
});
