// Path: tests/unit/temporal-playback-model.test.js
//
// TRÊS DEFEITOS DO CONTROLADOR TEMPORAL, presos aqui na forma PURA que foi extraída dele
// (`src/js/temporal/temporal-playback.model.js`), porque o controlador depende de DOM e de rAF e
// essas três regras não dependem de nenhum dos dois.
//
// C5 — A VELOCIDADE ERA "UNIDADES POR SEGUNDO REAL" (`unitToMs(unidade) * speed * dt`), então a
//   duração da reprodução dependia da UNIDADE DE LEITURA que a pessoa escolheu. Com a aritmética
//   antiga, três dias em Minuto levavam 72 minutos no 1x e mais de sete no 10x, enquanto quatro
//   semanas em Semana acabavam em quatro segundos. A causa é a unidade entrar na conta: ela é
//   granularidade de LEITURA da barra, não duração de exibição. Agora o avanço é fração da JANELA
//   e a duração é fixa (`TEMPORAL_PLAYBACK_DURATION_S`), com os multiplicadores escalando ela.
//
// M10 — A JANELA DO INSTANTE FINAL COLAPSAVA PARA UM PONTO (`cursor >= fim` devolvia
//   `{fim, fim}`), e como a janela é o que decide mostrar/esconder, o ÚLTIMO quadro escondia toda
//   feição cuja validade terminava dentro da célula que o quadro anterior ainda mostrava. A causa
//   é o ramo especial do fim; a correção é não ter ramo especial nenhum: o instante final fica na
//   ÚLTIMA CÉLULA INTEIRA, que é a mesma célula do quadro imediatamente anterior.
//
// V10 — O CURSOR DE UM SLIDE ERA APARADO DUAS VEZES, contra os limites de DOIS mapas diferentes.
//   Na transição entre slides de mapas diferentes o cursor chegava antes do sync do mapa novo,
//   era aparado contra os limites do mapa ANTERIOR e depois de novo contra os do novo, de modo
//   que o slide abria no início da linha do tempo em vez do instante escolhido. A causa é aparar
//   sem saber de qual mapa é o instante; a correção é o pedido nomear o mapa, ficar PENDENTE
//   enquanto ele não for o publicado, e ser aparado UMA vez, no sync dele.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    playbackAdvanceMs,
    filterWindow,
    shouldDeferCursor,
    adoptSyncCursor,
} from '../../src/js/temporal/temporal-playback.model.js';
import { TEMPORAL_UNITS, TEMPORAL_PLAYBACK_DURATION_S } from '../../src/js/temporal/temporal.constants.js';

const MINUTO = TEMPORAL_UNITS.MINUTO.ms;
const DIA = TEMPORAL_UNITS.DIA.ms;
const SEMANA = TEMPORAL_UNITS.SEMANA.ms;

/**
 * Roda a reprodução quadro a quadro até o cursor alcançar `fim` e devolve quantos
 * SEGUNDOS REAIS isso custou. É a medida que a pessoa sente; nenhum outro número aqui
 * responde "quanto tempo dura a exibição".
 */
function secondsToTraverse({ inicio, fim, speed, durationS = TEMPORAL_PLAYBACK_DURATION_S, dt = 1 / 60 }) {
    let cursor = inicio;
    let seconds = 0;
    for (let frame = 0; frame < 5_000_000 && cursor < fim; frame += 1) {
        const advance = playbackAdvanceMs({ inicio, fim, speed, dtSeconds: dt, durationS });
        if (advance <= 0) return Infinity;
        cursor = Math.min(cursor + advance, fim);
        seconds += dt;
    }
    return cursor >= fim ? seconds : Infinity;
}

// ============================================================================
// C5 — a duração da reprodução não depende da unidade nem do tamanho da janela
// ============================================================================

describe('playbackAdvanceMs (C5: velocidade como fração da janela)', () => {
    it('os dois exercícios do achado passam a levar o MESMO tempo', () => {
        // Os dois casos citados na auditoria: três dias lidos em Minuto (que levava mais de
        // sete minutos no máximo) e quatro semanas lidas em Semana (que acabava em dois quadros).
        const tresDias = secondsToTraverse({ inicio: 0, fim: 3 * DIA, speed: 1 });
        const quatroSemanas = secondsToTraverse({ inicio: 0, fim: 4 * SEMANA, speed: 1 });

        expect(tresDias).toBeCloseTo(TEMPORAL_PLAYBACK_DURATION_S, 0);
        expect(quatroSemanas).toBeCloseTo(TEMPORAL_PLAYBACK_DURATION_S, 0);
        expect(Math.abs(tresDias - quatroSemanas)).toBeLessThan(0.5);
    });

    it('os multiplicadores escalam a duração-alvo, e só ela', () => {
        expect(secondsToTraverse({ inicio: 0, fim: 3 * DIA, speed: 2 }))
            .toBeCloseTo(TEMPORAL_PLAYBACK_DURATION_S / 2, 0);
        expect(secondsToTraverse({ inicio: 0, fim: 3 * DIA, speed: 10 }))
            .toBeCloseTo(TEMPORAL_PLAYBACK_DURATION_S / 10, 1);
        expect(secondsToTraverse({ inicio: 0, fim: 40 * MINUTO, speed: 0.5 }))
            .toBeCloseTo(TEMPORAL_PLAYBACK_DURATION_S * 2, 0);
    });

    it('a duração independe do tamanho da janela, para qualquer janela e velocidade', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100_000 }),   // janela em minutos: de 1 min a ~10 semanas
                fc.constantFrom(0.5, 1, 2, 5, 10),
                (minutos, speed) => {
                    const seconds = secondsToTraverse({ inicio: 1_700_000_000_000, fim: 1_700_000_000_000 + minutos * MINUTO, speed });
                    const alvo = TEMPORAL_PLAYBACK_DURATION_S / speed;
                    // A folga é UM quadro: o último passo é aparado em `fim`.
                    expect(Math.abs(seconds - alvo)).toBeLessThanOrEqual(1 / 60 + 1e-9);
                }
            ),
            { numRuns: 60 }
        );
    });

    it('devolve zero para entrada não numérica, janela degenerada ou velocidade não positiva', () => {
        const base = { inicio: 0, fim: DIA, speed: 1, dtSeconds: 0.016, durationS: 60 };
        expect(playbackAdvanceMs({ ...base, inicio: NaN })).toBe(0);
        expect(playbackAdvanceMs({ ...base, fim: Infinity })).toBe(0);
        expect(playbackAdvanceMs({ ...base, speed: NaN })).toBe(0);
        expect(playbackAdvanceMs({ ...base, dtSeconds: undefined })).toBe(0);
        expect(playbackAdvanceMs({ ...base, durationS: 0 })).toBe(0);
        expect(playbackAdvanceMs({ ...base, fim: 0 })).toBe(0);          // janela vazia
        expect(playbackAdvanceMs({ ...base, fim: -DIA })).toBe(0);       // janela invertida
        expect(playbackAdvanceMs({ ...base, speed: -1 })).toBe(0);
        expect(playbackAdvanceMs({ ...base, dtSeconds: 0 })).toBe(0);
    });
});

// ============================================================================
// M10 — o instante final mantém a última célula inteira
// ============================================================================

describe('filterWindow (M10: a última célula não colapsa)', () => {
    const grid = { inicio: 0, fim: 10 * MINUTO, unitMs: MINUTO, substeps: 1 };

    it('no instante final entrega a MESMA janela do quadro anterior, não um ponto', () => {
        const ultimoQuadro = filterWindow({ ...grid, cursor: grid.fim - 1 });
        const instanteFinal = filterWindow({ ...grid, cursor: grid.fim });

        expect(instanteFinal).toEqual(ultimoQuadro);
        expect(instanteFinal.end).toBeGreaterThan(instanteFinal.start);
        // `fim` cai exatamente na grade: a última célula é a que TERMINA nele.
        expect(instanteFinal).toEqual({ start: 9 * MINUTO, end: 10 * MINUTO });
    });

    it('com o fim no meio de uma célula, a última célula é a que CONTÉM o fim', () => {
        const meio = { inicio: 0, fim: 9 * MINUTO + 30_000, unitMs: MINUTO, substeps: 1 };
        expect(filterWindow({ ...meio, cursor: meio.fim })).toEqual({ start: 9 * MINUTO, end: 10 * MINUTO });
        expect(filterWindow({ ...meio, cursor: meio.fim })).toEqual(filterWindow({ ...meio, cursor: meio.fim - 1 }));
    });

    it('um cursor além do fim (quadro atrasado) não abre uma célula fora da linha do tempo', () => {
        expect(filterWindow({ ...grid, cursor: grid.fim + 5 * MINUTO }))
            .toEqual({ start: 9 * MINUTO, end: 10 * MINUTO });
    });

    it('uma feição visível no quadro anterior continua visível no instante final', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 500 }),        // células na linha do tempo
                fc.constantFrom(1, 2, 4),                // subdivisões por unidade
                fc.integer({ min: 0, max: 120 }),        // desalinhamento do fim dentro da célula
                (celulas, substeps, resto) => {
                    const unitMs = MINUTO;
                    const step = unitMs / substeps;
                    const inicio = 1_700_000_000_000;
                    const fim = inicio + celulas * step + resto * 1000;
                    const antes = filterWindow({ cursor: fim - 1, inicio, fim, unitMs, substeps });
                    const final = filterWindow({ cursor: fim, inicio, fim, unitMs, substeps });

                    // A janela nunca é vazia, e o instante final não estreita a do quadro anterior:
                    // é exatamente ela, que é o que impede o sumiço do último quadro.
                    expect(final.end).toBeGreaterThan(final.start);
                    expect(final).toEqual(antes);
                    expect(final.start).toBeLessThanOrEqual(fim);
                    expect(final.end).toBeGreaterThanOrEqual(fim);
                    expect(final.start).toBeGreaterThanOrEqual(inicio);
                }
            ),
            { numRuns: 200 }
        );
    });

    it('degrada para o cursor cru quando não há grade a construir', () => {
        expect(filterWindow({ cursor: NaN, ...grid })).toEqual({ start: NaN, end: NaN });
        expect(filterWindow({ cursor: 5, inicio: NaN, fim: 10, unitMs: MINUTO })).toEqual({ start: 5, end: 5 });
        expect(filterWindow({ cursor: 5, inicio: 0, fim: Infinity, unitMs: MINUTO })).toEqual({ start: 5, end: 5 });
        expect(filterWindow({ cursor: 5, inicio: 0, fim: 10, unitMs: 0 })).toEqual({ start: 5, end: 5 });
    });

    it('substeps inválido vale 1 (célula de uma unidade inteira)', () => {
        const umaCelula = { start: 9 * MINUTO, end: 10 * MINUTO };
        expect(filterWindow({ ...grid, substeps: 0, cursor: grid.fim })).toEqual(umaCelula);
        expect(filterWindow({ ...grid, substeps: -3, cursor: grid.fim })).toEqual(umaCelula);
        expect(filterWindow({ ...grid, substeps: NaN, cursor: grid.fim })).toEqual(umaCelula);
    });
});

// ============================================================================
// V10 — o cursor pedido para outro mapa espera o sync DELE
// ============================================================================

describe('shouldDeferCursor (V10: de quem é o instante)', () => {
    it('sem nome de mapa, o pedido é do mapa publicado e vale agora', () => {
        expect(shouldDeferCursor(undefined, 'A')).toBe(false);
        expect(shouldDeferCursor(null, 'A')).toBe(false);
        expect(shouldDeferCursor('', 'A')).toBe(false);
    });

    it('nomeando o mapa publicado, vale agora', () => {
        expect(shouldDeferCursor('A', 'A')).toBe(false);
    });

    it('nomeando outro mapa, ou nenhum publicado ainda, espera', () => {
        expect(shouldDeferCursor('B', 'A')).toBe(true);
        expect(shouldDeferCursor('B', null)).toBe(true);
        expect(shouldDeferCursor('B', undefined)).toBe(true);
    });
});

describe('adoptSyncCursor (V10: aparado uma vez, contra os limites certos)', () => {
    const B = { inicio: 5000, fim: 9000 };

    it('consome o pedido pendente do próprio mapa e apara UMA vez', () => {
        const r = adoptSyncCursor({ pending: { mapName: 'B', cursor: 7000 }, mapName: 'B', current: NaN, ...B });
        expect(r).toEqual({ cursor: 7000, usedPending: true });
    });

    it('não consome pedido pendente de OUTRO mapa', () => {
        const r = adoptSyncCursor({ pending: { mapName: 'C', cursor: 7000 }, mapName: 'B', current: NaN, ...B });
        expect(r.usedPending).toBe(false);
        expect(r.cursor).toBe(B.inicio);
    });

    it('ordem de precedência: pendente, cursor na tela, cursor lembrado, início', () => {
        expect(adoptSyncCursor({ pending: { mapName: 'B', cursor: 6000 }, mapName: 'B', current: 8000, remembered: 8500, ...B }).cursor).toBe(6000);
        expect(adoptSyncCursor({ pending: null, mapName: 'B', current: 8000, remembered: 8500, ...B }).cursor).toBe(8000);
        expect(adoptSyncCursor({ pending: null, mapName: 'B', current: NaN, remembered: 8500, ...B }).cursor).toBe(8500);
        expect(adoptSyncCursor({ pending: null, mapName: 'B', current: NaN, remembered: undefined, ...B }).cursor).toBe(5000);
    });

    it('pedido pendente com cursor não numérico é ignorado, não adotado', () => {
        const r = adoptSyncCursor({ pending: { mapName: 'B', cursor: NaN }, mapName: 'B', current: 8000, ...B });
        expect(r).toEqual({ cursor: 8000, usedPending: false });
    });

    it('o instante pedido nunca passa pelos limites de outro mapa', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 100_000 }),
                fc.integer({ min: 0, max: 100_000 }),
                fc.integer({ min: 1, max: 100_000 }),
                (pedido, inicio, largura) => {
                    const fim = inicio + largura;
                    // Os limites do mapa ANTERIOR, que o defeito fazia o pedido atravessar primeiro.
                    const outro = { inicio: inicio + largura * 2, fim: inicio + largura * 3 };
                    const umaVez = adoptSyncCursor({ pending: { mapName: 'B', cursor: pedido }, mapName: 'B', current: NaN, inicio, fim }).cursor;

                    const duasVezes = Math.min(Math.max(Math.min(Math.max(pedido, outro.inicio), outro.fim), inicio), fim);
                    expect(umaVez).toBe(Math.min(Math.max(pedido, inicio), fim));
                    // E o duplo aparo, quando difere, é sempre o defeito: o pedido colapsa no fim
                    // da linha do tempo do mapa certo em vez de no instante pedido.
                    if (duasVezes !== umaVez) expect(umaVez).not.toBe(duasVezes);
                }
            ),
            { numRuns: 200 }
        );
    });
});
