// Path: tests/unit/coordination-points-options.test.js

/**
 * getPointsGroupedOptions must EXPOSE every catalogued coordination point.
 *
 * Regression: the category list was used as a filter and its seven accented
 * categories were written without accents, so 61 of the 77 point types were
 * unreachable from the only UI that writes `pointCode`.
 */

import { describe, it, expect } from 'vitest';

import { getPointsGroupedOptions } from '@js/military_tools/coordination_measure_tool/attributes/ui-components.helpers.js';
import { UI_DATA } from '@js/military_tools/coordination_measure_tool/coordination_measure_constants.js';

// UMA desde 2026-09-03: o Escalao e o Escalao Forca-Tarefa viraram a MESMA opcao de
// Nucleo, e quem separa as duas familias e a caixa Forca-Tarefa ao lado do escalao.
const ECHELON_OPTIONS = 1;

describe('getPointsGroupedOptions', () => {
    it('emits every point of UI_DATA.pointsList plus the nucleus entry', () => {
        const options = getPointsGroupedOptions();

        expect(UI_DATA.pointsList.length).toBeGreaterThan(0);
        expect(options).toHaveLength(UI_DATA.pointsList.length + ECHELON_OPTIONS);

        const values = new Set(options.map(o => o.value));
        const missing = UI_DATA.pointsList
            .map(p => p.code)
            .filter(code => !values.has(code));

        expect(missing).toEqual([]);
    });

    it('never emits the same point twice (ordered pass + leftover pass)', () => {
        const options = getPointsGroupedOptions();
        const values = options.map(o => o.value);

        expect(new Set(values).size).toBe(values.length);
    });

    it('keeps the accented categories reachable', () => {
        const options = getPointsGroupedOptions();
        const labels = options.map(o => o.label).join('\n');

        for (const category of ['Proteção - Obstáculos', 'Logística', 'Controle Marítimo']) {
            expect(labels).toContain(`(${category})`);
        }
    });

    it('põe o Núcleo em primeiro, porque ele não pertence a categoria nenhuma', () => {
        // Ele entrava no FIM da lista, atras de oitenta itens, e nao pertence a nenhuma das
        // categorias que a ordem preferida enumera: nao ha onde encaixa-lo, entao ele abre.
        const options = getPointsGroupedOptions();

        expect(options[0].value).toBe('ECHELON');
        expect(options[0].isEchelon).toBe(true);
        expect(options.filter(o => o.isEchelon)).toHaveLength(1);
    });

    it('emits the preferred categories before the leftovers', () => {
        const options = getPointsGroupedOptions();
        // O primeiro ponto de CATALOGO, depois do Nucleo, que nao esta em `pointsList`.
        const firstCode = options.find(o => !o.isEchelon).value;
        const firstPoint = UI_DATA.pointsList.find(p => p.code === firstCode);

        expect(firstPoint.category).toBe('Gerais');
    });

    // Edge case: a category the ordered list does not know about (typo, rename or a
    // brand-new one) must still reach the combo box. Simulated on a copy of the real
    // data, because the defect was exactly a silent drop of unknown categories.
    it('exposes points whose category is absent from the preferred order', () => {
        const known = new Set(getPointsGroupedOptions().map(o => o.value));
        const original = UI_DATA.pointsList;

        try {
            UI_DATA.pointsList = [
                ...original,
                { code: 'CATEGORIA_NOVA_TESTE', label: 'Ponto de categoria nova', category: 'Categoria Inexistente' }
            ];

            const values = new Set(getPointsGroupedOptions().map(o => o.value));

            expect(values.has('CATEGORIA_NOVA_TESTE')).toBe(true);
            expect(values.size).toBe(known.size + 1);
        } finally {
            UI_DATA.pointsList = original;
        }
    });
});
