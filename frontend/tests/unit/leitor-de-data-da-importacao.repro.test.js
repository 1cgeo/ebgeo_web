// Path: tests/unit/leitor-de-data-da-importacao.repro.test.js

/**
 * @fileoverview REPRO dos achados M4 (= I1), M5, I2 e M11 da auditoria do
 * sistema temporal (2026-09-21).
 *
 * A CAUSA ERA UMA SÓ: `toEpoch` terminava em `Date.parse(str)`, e o parse do
 * motor é americano, é UTC e não tem teto.
 *
 *  - M4: `05/11/2024` voltava como 11 de MAIO e `25/12/2024` voltava nulo. Numa
 *    mesma coluna de CSV as linhas com dia até 12 entravam com dia e mês
 *    trocados e as demais entravam sem tempo nenhum, sem um aviso.
 *  - M5: `2024-01-01` entrava como meia-noite UTC enquanto todo formatador
 *    deste módulo e o `<input type="datetime-local">` do painel são LOCAIS, de
 *    modo que a data escrita aparecia na tela como o dia anterior.
 *  - I2: não havia faixa de plausibilidade. `010800MAR24`, o GDH que o PRÓPRIO
 *    produto escreve por `formatDTG`, virava o ano 10800, e com a janela do
 *    mapa em automático uma célula dessas estica a régua por milênios e colapsa
 *    as feições reais num pixel.
 *  - M11: `epochToDatetimeLocal` não preenchia o ano a quatro dígitos, então
 *    uma feição anterior ao ano 1000 saía como `999-01-15T03:04`, que o
 *    controle recusa e desenha vazio.
 *
 * TODA data esperada aqui é montada com `new Date(ano, mes, dia, ...)` ou com
 * `Date.UTC`, NUNCA com uma string: o fuso desta máquina é UTC-3 e um esperado
 * escrito como texto mediria o mesmo leitor que está sob teste.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    toEpoch,
    formatDTG,
    formatInstant,
    epochToDatetimeLocal,
    datetimeLocalToEpoch,
    EPOCH_PLAUSIBLE_MIN,
    EPOCH_PLAUSIBLE_MAX,
} from '../../src/js/temporal/temporal.utils.js';

// ============================================================================
// M4 — dia antes do mês
// ============================================================================

describe('M4: data brasileira é lida como brasileira', () => {
    it('05/11/2024 é 5 de NOVEMBRO, não 11 de maio', () => {
        const esperado = new Date(2024, 10, 5).getTime();
        const errado = new Date(2024, 4, 11).getTime();
        expect(toEpoch('05/11/2024')).toBe(esperado);
        expect(toEpoch('05/11/2024')).not.toBe(errado);
    });

    it('25/12/2024 é lido, e antes era nulo (dia acima de 12)', () => {
        expect(toEpoch('25/12/2024')).toBe(new Date(2024, 11, 25).getTime());
    });

    it('aceita o hífen como separador, com o ano na última posição', () => {
        expect(toEpoch('05-11-2024')).toBe(new Date(2024, 10, 5).getTime());
        expect(toEpoch('1-1-2024')).toBe(new Date(2024, 0, 1).getTime());
    });

    it('recusa separadores misturados em vez de adivinhar', () => {
        expect(toEpoch('05/11-2024')).toBeNull();
        expect(toEpoch('05-11/2024')).toBeNull();
    });

    it('lê a hora junto, no fuso LOCAL', () => {
        expect(toEpoch('05/11/2024 14:30')).toBe(new Date(2024, 10, 5, 14, 30).getTime());
        expect(toEpoch('05/11/2024 14:30:45')).toBe(new Date(2024, 10, 5, 14, 30, 45).getTime());
        expect(toEpoch('05/11/2024T14:30')).toBe(new Date(2024, 10, 5, 14, 30).getTime());
    });

    it('recusa data impossível em vez de rolar para o mês seguinte', () => {
        expect(toEpoch('31/02/2024')).toBeNull();
        expect(toEpoch('32/01/2024')).toBeNull();
        expect(toEpoch('05/13/2024')).toBeNull();
        expect(toEpoch('00/01/2024')).toBeNull();
        expect(toEpoch('05/11/2024 24:00')).toBeNull();
        expect(toEpoch('05/11/2024 12:60')).toBeNull();
    });

    it('29/02 vale em ano bissexto e não vale fora dele', () => {
        expect(toEpoch('29/02/2024')).toBe(new Date(2024, 1, 29).getTime());
        expect(toEpoch('29/02/2023')).toBeNull();
    });

    it('exige ano de quatro dígitos: dd/mm/aa é ambíguo e não se adivinha', () => {
        expect(toEpoch('05/11/24')).toBeNull();
    });
});

// ============================================================================
// M5 — só-data é meia-noite LOCAL
// ============================================================================

describe('M5: aaaa-mm-dd ancora na meia-noite LOCAL', () => {
    it('2024-01-01 é 1 de janeiro e é exibido como 1 de janeiro', () => {
        const epoch = toEpoch('2024-01-01');
        expect(epoch).toBe(new Date(2024, 0, 1).getTime());
        expect(formatInstant(epoch, 'DIA')).toBe('01/01/2024');
    });

    it('as duas grafias do mesmo dia caem no MESMO instante', () => {
        expect(toEpoch('2024-01-01')).toBe(toEpoch('01/01/2024'));
    });

    it('aceita a barra com o ano à frente (posição desambigua)', () => {
        expect(toEpoch('2024/01/01')).toBe(new Date(2024, 0, 1).getTime());
    });

    it('ISO com hora e SEM fuso é local', () => {
        expect(toEpoch('2024-01-01T08:00')).toBe(new Date(2024, 0, 1, 8, 0).getTime());
        expect(toEpoch('2024-01-01T08:00:30')).toBe(new Date(2024, 0, 1, 8, 0, 30).getTime());
        expect(toEpoch('2024-01-01 08:00')).toBe(new Date(2024, 0, 1, 8, 0).getTime());
    });

    it('ISO COM fuso respeita o fuso escrito', () => {
        expect(toEpoch('2024-01-01T00:00:00Z')).toBe(Date.UTC(2024, 0, 1, 0, 0));
        expect(toEpoch('2024-01-01T00:00:00-03:00')).toBe(Date.UTC(2024, 0, 1, 3, 0));
        expect(toEpoch('2024-01-01T00:00:00+0530')).toBe(Date.UTC(2023, 11, 31, 18, 30));
        expect(toEpoch('2024-01-01T00:00:00.250Z')).toBe(Date.UTC(2024, 0, 1, 0, 0, 0, 250));
    });
});

// ============================================================================
// I2 — faixa de plausibilidade e o GDH do próprio produto
// ============================================================================

describe('I2: teto de plausibilidade', () => {
    it('a faixa declarada é 1900-01-01Z a 2200-01-01Z', () => {
        expect(EPOCH_PLAUSIBLE_MIN).toBe(Date.UTC(1900, 0, 1));
        expect(EPOCH_PLAUSIBLE_MAX).toBe(Date.UTC(2200, 0, 1));
    });

    it('recusa instante fora da faixa, venha ele de número ou de texto', () => {
        expect(toEpoch(EPOCH_PLAUSIBLE_MIN)).toBe(EPOCH_PLAUSIBLE_MIN);
        expect(toEpoch(EPOCH_PLAUSIBLE_MAX)).toBe(EPOCH_PLAUSIBLE_MAX);
        expect(toEpoch(EPOCH_PLAUSIBLE_MIN - 1)).toBeNull();
        expect(toEpoch(EPOCH_PLAUSIBLE_MAX + 1)).toBeNull();
        expect(toEpoch('01/01/1899')).toBeNull();
        expect(toEpoch('01/01/2300')).toBeNull();
        expect(toEpoch(new Date(Date.UTC(2500, 0, 1)))).toBeNull();
        expect(toEpoch(String(Date.UTC(2500, 0, 1)))).toBeNull();
    });

    it('o GDH que o produto escreve vale 2024, não o ano 10800', () => {
        const epoch = toEpoch('010800MAR24');
        expect(epoch).toBe(Date.UTC(2024, 2, 1, 8, 0));
        expect(new Date(epoch).getUTCFullYear()).toBe(2024);
    });

    it('o GDH é Zulu e o mês é a abreviação pt-BR', () => {
        expect(toEpoch('201400NOV24')).toBe(Date.UTC(2024, 10, 20, 14, 0));
        expect(toEpoch('012330JAN24')).toBe(Date.UTC(2024, 0, 1, 23, 30));
        // FEV/MAI/SET/OUT/DEZ são as abreviações que `formatDTG` emite.
        expect(toEpoch('010000DEZ99')).toBe(Date.UTC(1999, 11, 1, 0, 0));
        // Mês que não existe no calendário pt-BR não vira instante.
        expect(toEpoch('010800XXX24')).toBeNull();
    });

    it('formatDTG -> toEpoch fecha o círculo para todo instante do pivô', () => {
        const casos = [
            Date.UTC(2024, 2, 1, 8, 0),
            Date.UTC(2024, 10, 20, 14, 0),
            Date.UTC(2005, 5, 12, 14, 0),
            Date.UTC(1999, 11, 31, 23, 59),
            Date.UTC(2069, 0, 1, 0, 0),
        ];
        for (const epoch of casos) {
            expect(toEpoch(formatDTG(epoch, 'military'))).toBe(epoch);
        }
    });

    it('o GDH de coordenação não tem ano, então não vira instante', () => {
        expect(formatDTG(Date.UTC(2024, 5, 12, 14, 0), 'coordination')).toBe('121400Z JUN');
        expect(toEpoch('121400Z JUN')).toBeNull();
    });

    it('DECISÃO DECLARADA: epoch em SEGUNDOS não é adivinhado, e cai dentro da faixa', () => {
        // 1726876800 é 2024-09-21 em segundos. Lido como milissegundos ele é
        // 20/01/1970, que está DENTRO da faixa e portanto é aceito como está.
        // Pegá-lo exigiria ou o palpite segundos-contra-milissegundos (que
        // corrompe todo carimbo legítimo anterior a 2001) ou um piso acima de
        // 1970, que recusaria as datas do século XX e os tempos relativos
        // ancorados em 1970 que as trajetórias usam.
        const segundos = 1726876800;
        expect(toEpoch(segundos)).toBe(segundos);
        expect(new Date(toEpoch(segundos)).getUTCFullYear()).toBe(1970);
    });

    it('epoch ms continua passando intacto, inclusive pré-2001 e negativo', () => {
        expect(toEpoch(1_700_000_000_000)).toBe(1_700_000_000_000);
        expect(toEpoch('1700000000000')).toBe(1_700_000_000_000);
        expect(toEpoch('500000000000')).toBe(500_000_000_000);
        expect(toEpoch('-700000000000')).toBe(-700_000_000_000);
        expect(toEpoch(0)).toBe(0);
    });
});

// ============================================================================
// O que NÃO casa devolve null, nunca um palpite
// ============================================================================

describe('toEpoch recusa em vez de palpitar', () => {
    it('devolve null para vazio, nulo e lixo', () => {
        for (const v of ['', '   ', null, undefined, 'garbage', 'not-a-date', NaN, Infinity]) {
            expect(toEpoch(v)).toBeNull();
        }
    });

    it('devolve null para booleano, objeto e array', () => {
        for (const v of [true, false, {}, [], [1, 2], { t: 1 }]) {
            expect(toEpoch(v)).toBeNull();
        }
    });

    it('devolve null para Date inválida', () => {
        expect(toEpoch(new Date('lixo'))).toBeNull();
    });

    it('aceita Date válida dentro da faixa', () => {
        const d = new Date(Date.UTC(2024, 5, 15, 12, 0));
        expect(toEpoch(d)).toBe(d.getTime());
    });
});

// ============================================================================
// M11 — o ano no campo de edição
// ============================================================================

describe('M11: epochToDatetimeLocal preenche o ano a quatro dígitos', () => {
    it('ano 999 sai como 0999, e volta pelo mesmo caminho', () => {
        const d = new Date(2000, 0, 15, 3, 4, 0, 0);
        d.setFullYear(999);
        const epoch = d.getTime();
        const texto = epochToDatetimeLocal(epoch);
        expect(texto).toBe('0999-01-15T03:04');
        expect(datetimeLocalToEpoch(texto)).toBe(epoch);
    });

    it('continua vazio para instante não finito', () => {
        expect(epochToDatetimeLocal(NaN)).toBe('');
        expect(epochToDatetimeLocal(undefined)).toBe('');
        expect(datetimeLocalToEpoch('')).toBeNull();
        expect(datetimeLocalToEpoch('not-a-date')).toBeNull();
    });

    it('propriedade: todo instante da faixa sai com a forma que o controle aceita', () => {
        fc.assert(
            fc.property(
                fc.integer({
                    min: Math.ceil(EPOCH_PLAUSIBLE_MIN / 60_000),
                    max: Math.floor(EPOCH_PLAUSIBLE_MAX / 60_000),
                }),
                (minutos) => {
                    const texto = epochToDatetimeLocal(minutos * 60_000);
                    expect(texto).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
                }
            ),
            { numRuns: 300 }
        );
    });

    it('propriedade: a ida e volta pelo texto é estável', () => {
        // Estável, e não igual ao instante de partida, porque na hora repetida
        // de um fim de horário de verão DUAS instantes têm o mesmo texto local.
        // O que precisa valer é que o texto sobreviva à volta.
        fc.assert(
            fc.property(
                fc.integer({
                    min: Math.ceil(EPOCH_PLAUSIBLE_MIN / 60_000),
                    max: Math.floor(EPOCH_PLAUSIBLE_MAX / 60_000),
                }),
                (minutos) => {
                    const texto = epochToDatetimeLocal(minutos * 60_000);
                    const volta = datetimeLocalToEpoch(texto);
                    expect(volta).not.toBeNull();
                    expect(epochToDatetimeLocal(volta)).toBe(texto);
                }
            ),
            { numRuns: 300 }
        );
    });

    it('a ida e volta é EXATA fora de hora ambígua', () => {
        const epoch = new Date(2024, 5, 15, 9, 45).getTime();
        expect(datetimeLocalToEpoch(epochToDatetimeLocal(epoch))).toBe(epoch);
    });
});
