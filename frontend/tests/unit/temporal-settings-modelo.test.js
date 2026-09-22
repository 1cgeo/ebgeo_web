// Path: tests/unit/temporal-settings-modelo.test.js
//
// AS DUAS DECISÕES PURAS DA ENGRENAGEM TEMPORAL, que até 2026-09-21 moravam dentro do modal e por
// isso não tinham teste nenhum (alcançar aquele arquivo exige DOM e o barril da store).
//
// DEFEITO C4 — a janela invertida. `_save` corrigia `fim <= inicio` em SILÊNCIO no modo relativo
// (empurrando o fim para `inicio + unidade`, um valor que a pessoa nunca pediu) e gravava CRU no
// modo absoluto, fechando o modal como se tivesse salvo nos dois casos. A causa: dois ramos
// escritos separadamente, um com conserto e outro sem validação nenhuma. Uma janela invertida
// gravada some a feição do 3D, do 360 e da legenda do PDF, porque nenhum cursor satisfaz o
// predicado de visibilidade. A regra agora é RECUSAR nos dois modos, nomeando o campo.
//
// DEFEITO S2 — o Dia D que andava sozinho. "Reagendar" pedia o deslocamento das feições,
// IGNORAVA o retorno e gravava a nova origem na linha seguinte. Num mapa travado nenhuma feição
// andava, a origem andava, e todo rótulo D+N passava a mentir pelo delta, enquanto o aviso na
// tela dizia que a escrita tinha sido recusada. A causa: zero feições deslocadas tem DUAS
// origens (mapa sem nada cronometrado, ou escrita recusada) e o código não distinguia nenhuma
// das duas de um sucesso.

import { describe, it, expect } from 'vitest';
import {
    resolverPatchDaConfig,
    decisaoDoReagendamento,
    avisoDoReagendamento,
    MOTIVO_REAGENDAMENTO,
} from '../../src/js/temporal/temporal-settings.model.js';
import { TEMPORAL_MODES } from '../../src/js/temporal/temporal.constants.js';

const DIA_MS = 86400000;
const D = Date.UTC(2026, 0, 10);

describe('C4 — a janela invertida é recusada nos DOIS modos, nomeando o campo', () => {
    it('absoluto: fim anterior ao início é recusado e nomeia "Fim do mapa"', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA', inicio: D + DIA_MS, fim: D },
            { origemFallback: D, unitMs: DIA_MS }
        );

        expect(veredito.ok).toBe(false);
        expect(veredito.campo).toBe('fim');
        expect(veredito.mensagem).toContain('Fim do mapa');
        // E nada de patch: o chamador não tem o que gravar.
        expect(veredito.patch).toBeUndefined();
    });

    it('absoluto: fim IGUAL ao início também é recusado (janela degenerada)', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA', inicio: D, fim: D },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(false);
        expect(veredito.campo).toBe('fim');
    });

    it('absoluto: campo em branco continua legítimo (significa automático)', () => {
        const so_fim = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA', inicio: null, fim: D },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(so_fim.ok).toBe(true);
        expect(so_fim.patch).toEqual({ modo: 'absoluto', unidade: 'DIA', inicio: null, fim: D });

        const vazio = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'HORA', inicio: null, fim: null },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(vazio.ok).toBe(true);
        expect(vazio.patch).toEqual({ modo: 'absoluto', unidade: 'HORA', inicio: null, fim: null });
    });

    it('absoluto: NaN e Infinity viram ausência, não um instante impossível', () => {
        // `x ?? null` NÃO protege de NaN, e NaN gravado é uma janela que nenhum predicado aceita.
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA', inicio: NaN, fim: Infinity },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(true);
        expect(veredito.patch.inicio).toBeNull();
        expect(veredito.patch.fim).toBeNull();
    });

    it('absoluto: janela válida passa intacta', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA', inicio: D, fim: D + 5 * DIA_MS },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(veredito).toEqual({
            ok: true,
            patch: { modo: 'absoluto', unidade: 'DIA', inicio: D, fim: D + 5 * DIA_MS },
        });
    });

    it('relativo: a inversão deixou de ser consertada em silêncio e passou a ser recusada', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.RELATIVO, unidade: 'DIA', inicio: D + 10 * DIA_MS, fim: D, dDate: D },
            { origemFallback: D, unitMs: DIA_MS }
        );

        expect(veredito.ok).toBe(false);
        expect(veredito.campo).toBe('fim');
        expect(veredito.mensagem).toContain('"Fim"');
        // A prova de que o conserto silencioso morreu: nenhum patch com `fim = inicio + unidade`.
        expect(veredito.patch).toBeUndefined();
    });

    it('relativo: bordas em branco ganham a janela padrão de 30 unidades a partir de D', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.RELATIVO, unidade: 'DIA', inicio: null, fim: null, dDate: D },
            { origemFallback: null, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(true);
        expect(veredito.patch).toEqual({
            modo: 'relativo', unidade: 'DIA', inicio: D, fim: D + 30 * DIA_MS, origem: D,
        });
    });

    it('relativo: sem "Data de D" a origem cai no fallback do chamador', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.RELATIVO, unidade: 'DIA', inicio: D, fim: D + DIA_MS, dDate: null },
            { origemFallback: D - DIA_MS, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(true);
        expect(veredito.patch.origem).toBe(D - DIA_MS);
    });

    it('relativo: sem origem nenhuma o modo é recusado (o eixo D+N não tem zero)', () => {
        const veredito = resolverPatchDaConfig(
            { modo: TEMPORAL_MODES.RELATIVO, unidade: 'DIA', inicio: D, fim: D + DIA_MS, dDate: NaN },
            { origemFallback: null, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(false);
        expect(veredito.campo).toBe('origem');
    });

    it('modo desconhecido cai no absoluto, e não num terceiro comportamento', () => {
        const veredito = resolverPatchDaConfig(
            { modo: 'inventado', unidade: 'DIA', inicio: D, fim: D + DIA_MS },
            { origemFallback: D, unitMs: DIA_MS }
        );
        expect(veredito.ok).toBe(true);
        expect(veredito.patch.modo).toBe('absoluto');
        expect(veredito.patch.origem).toBeUndefined();
    });

    it('entrada ausente não lança: o modal pode ser salvo antes de qualquer edição', () => {
        expect(resolverPatchDaConfig(undefined).ok).toBe(true);
        expect(resolverPatchDaConfig(null, {}).patch.modo).toBe('absoluto');
    });
});

describe('S2 — a origem só anda se as feições andaram', () => {
    it('sem controle temporal: nada andou e a origem NÃO é gravada', () => {
        for (const vazio of [undefined, null, 0, 'x']) {
            const d = decisaoDoReagendamento(vazio);
            expect(d).toEqual({
                gravarOrigem: false, motivo: MOTIVO_REAGENDAMENTO.SEM_CONTROLE, reagendadas: 0,
            });
        }
    });

    it('ESCRITA RECUSADA (havia candidata e nenhuma andou): a origem NÃO é gravada', () => {
        // Este é o caso do mapa travado, que é o defeito inteiro: antes, a origem andava aqui.
        const d = decisaoDoReagendamento({ changed: 0, hadCandidates: true });
        expect(d.gravarOrigem).toBe(false);
        expect(d.motivo).toBe(MOTIVO_REAGENDAMENTO.RECUSADO);
    });

    it('mapa sem nada cronometrado: mover o Dia D é só lente, então a origem É gravada', () => {
        const d = decisaoDoReagendamento({ changed: 0, hadCandidates: false });
        expect(d.gravarOrigem).toBe(true);
        expect(d.motivo).toBe(MOTIVO_REAGENDAMENTO.NADA_A_DESLOCAR);
    });

    it('feições deslocadas: a origem é gravada e a contagem é preservada', () => {
        const d = decisaoDoReagendamento({ changed: 7, hadCandidates: true });
        expect(d).toEqual({
            gravarOrigem: true, motivo: MOTIVO_REAGENDAMENTO.DESLOCADAS, reagendadas: 7,
        });
    });

    it('contagem não numérica é tratada como zero, nunca como sucesso', () => {
        expect(decisaoDoReagendamento({ changed: NaN, hadCandidates: true }).gravarOrigem).toBe(false);
        expect(decisaoDoReagendamento({ changed: -3, hadCandidates: true }).motivo)
            .toBe(MOTIVO_REAGENDAMENTO.RECUSADO);
        expect(decisaoDoReagendamento({ hadCandidates: true }).gravarOrigem).toBe(false);
    });
});

describe('S2 — a frase nomeia o desfecho REAL, incluindo a metade que não aconteceu', () => {
    const deslocadas = (n) => decisaoDoReagendamento({ changed: n, hadCandidates: true });

    it('deslocadas e gravadas: sucesso, com plural certo', () => {
        expect(avisoDoReagendamento(deslocadas(1), { gravou: true }))
            .toEqual({ tipo: 'success', texto: '1 feição reagendada para o novo Dia D.' });
        expect(avisoDoReagendamento(deslocadas(4), { gravou: true }).texto)
            .toBe('4 feições reagendadas para o novo Dia D.');
    });

    it('deslocadas mas o Dia D não gravou: aviso, não sucesso', () => {
        // Possível desde que a config ganhou gate de trava própria: alguém trava o mapa entre as
        // duas metades. A frase anterior era escrita ANTES da gravação, então não tinha como dizer.
        const aviso = avisoDoReagendamento(deslocadas(2), { gravou: false });
        expect(aviso.tipo).toBe('warning');
        expect(aviso.texto).toContain('não pôde ser salvo');
    });

    it('recusado: avisa e diz que o Dia D ficou onde estava', () => {
        const aviso = avisoDoReagendamento(decisaoDoReagendamento({ changed: 0, hadCandidates: true }));
        expect(aviso.tipo).toBe('warning');
        expect(aviso.texto).toContain('Nenhuma feição foi reagendada');
        expect(aviso.texto).toContain('o Dia D não mudou');
        expect(aviso.texto).toContain('bloqueado');
    });

    it('sem controle: avisa', () => {
        expect(avisoDoReagendamento(decisaoDoReagendamento(null)).tipo).toBe('warning');
    });

    it('nada a deslocar: informativo quando gravou, aviso quando não gravou', () => {
        const nada = decisaoDoReagendamento({ changed: 0, hadCandidates: false });
        expect(avisoDoReagendamento(nada, { gravou: true }).tipo).toBe('info');
        expect(avisoDoReagendamento(nada, { gravou: false }).tipo).toBe('warning');
    });
});
