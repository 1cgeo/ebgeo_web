// Path: tests/integration/escalao-seletor-vazio.repro.test.js

/**
 * @fileoverview Repro for the empty echelon selector, and for its mirror image.
 *
 * ROOT CAUSE. `getEchelonData` and `isEchelonApplicable` were two INDEPENDENT hand-kept
 * lists over the same question, and they disagreed in BOTH directions:
 *
 *   - '15' (Equipamentos e Viaturas) and '27' (Indivíduos Desembarcados) had a populated
 *     option list and a label from `getEchelonData`, while the predicate refused them. A
 *     panel gated on the predicate hid a control the data was ready to fill.
 *   - '30' (Marítimos de Superfície) and '35' (Submarinos) passed the predicate while
 *     `getEchelonData` handed back `{ data: [], label: '', applicable: false }`. A panel
 *     gated on the predicate alone drew an echelon selector with NO OPTIONS and NO LABEL,
 *     which is the visible defect: a control the operator cannot use and cannot explain.
 *
 * The only code where the two agreed on "yes" was '10'.
 *
 * FIX. `getEchelonData` is the source of truth and `isEchelonApplicable` derives from it.
 * `getEchelonData` wins on two counts: it is the one with production callers (the symbol
 * form reads its `data`, `label` and `applicable` at
 * `military_symbol_tool/attributes/symbol-form.section.js`), and it is the one carrying what
 * the screen needs. A predicate that disagrees with the data it gates is the half with
 * nothing behind it.
 *
 * The invariant this file exists to hold is the one the empty selector broke: EVERY code the
 * predicate allows must hand back a non-empty option list.
 */

import { describe, it, expect } from 'vitest';

import {
    MILITARY_DATA,
    getEchelonData,
    isEchelonApplicable,
} from '../../src/js/military_tools/military_symbol_tool/military_constants.js';

describe('REPRO: um escalao "aplicavel" com lista VAZIA desenhava um seletor sem opcoes', () => {
    it('todo codigo permitido pelo predicado tem opcao e rotulo', () => {
        const permitidos = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter(isEchelonApplicable);

        // Size asserted first: an empty list would make the loop below vacuous.
        expect(permitidos).toEqual(['10', '15', '27']);
        for (const code of permitidos) {
            const { data, label, applicable } = getEchelonData(code);
            expect(applicable, code).toBe(true);
            expect(data.length, code).toBeGreaterThan(0);
            expect(label, code).not.toBe('');
        }
    });

    it('os quatro codigos que divergiam, nomeados um a um e nos dois sentidos', () => {
        // 15 and 27 had data and were refused; 30 and 35 were allowed and had none.
        expect(isEchelonApplicable('15')).toBe(true);
        expect(getEchelonData('15').data.length).toBeGreaterThan(0);
        expect(isEchelonApplicable('27')).toBe(true);
        expect(getEchelonData('27').data.length).toBeGreaterThan(0);

        expect(isEchelonApplicable('30')).toBe(false);
        expect(getEchelonData('30').data).toEqual([]);
        expect(isEchelonApplicable('35')).toBe(false);
        expect(getEchelonData('35').data).toEqual([]);
    });

    it('os dois concordam sobre TODOS os onze conjuntos declarados', () => {
        expect(MILITARY_DATA.symbolSets).toHaveLength(11);
        let conferidos = 0;
        for (const entry of MILITARY_DATA.symbolSets) {
            expect(isEchelonApplicable(entry.value), entry.value)
                .toBe(getEchelonData(entry.value).applicable);
            conferidos += 1;
        }
        expect(conferidos).toBe(11);
    });

    it('CONTROLE: o predicado ainda discrimina, e ainda recusa o desconhecido', () => {
        // Without this, a predicate hard-wired to `true` would satisfy the agreement above
        // for the three allowed codes and quietly open the selector everywhere else.
        expect(isEchelonApplicable('20')).toBe(false);
        expect(isEchelonApplicable('40')).toBe(false);
        expect(isEchelonApplicable('zzz')).toBe(false);
        expect(isEchelonApplicable('constructor')).toBe(false);
        expect(isEchelonApplicable(null)).toBe(false);
    });
});
