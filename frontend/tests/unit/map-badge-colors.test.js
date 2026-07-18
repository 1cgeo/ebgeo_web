import { describe, it, expect } from 'vitest';
import { MAP_BADGE_COLORS, mapBadgeColorForName } from '../../src/js/store/map-badge-colors.js';

/** Mirrors getOrderedMapBadgeColors: maps each name (in list order) to its stable color. */
function colorsFor(names) {
    const out = {};
    for (const n of names) out[n] = mapBadgeColorForName(n);
    return out;
}

describe('mapBadgeColorForName', () => {
    it('is deterministic — the same name always yields the same color', () => {
        expect(mapBadgeColorForName('Principal')).toBe(mapBadgeColorForName('Principal'));
        expect(mapBadgeColorForName('Operação Alfa')).toBe(mapBadgeColorForName('Operação Alfa'));
    });

    it('always returns a color from the palette', () => {
        for (const name of ['A', 'Principal', 'Mapa 2', 'x'.repeat(200), '', '🛰️ zona']) {
            expect(MAP_BADGE_COLORS).toContain(mapBadgeColorForName(name));
        }
    });

    it('does NOT depend on list position — reordering keeps every map its color (the bug fix)', () => {
        const ordered = ['Principal', 'Operação Alfa', 'Bravo', 'Charlie', 'Delta'];
        const before = colorsFor(ordered);

        // Reverse + a couple of shuffles: each name must keep the SAME color regardless of order.
        const reversed = [...ordered].reverse();
        const shuffled = ['Charlie', 'Delta', 'Principal', 'Bravo', 'Operação Alfa'];
        for (const arrangement of [reversed, shuffled]) {
            const after = colorsFor(arrangement);
            for (const name of ordered) {
                expect(after[name], `color of "${name}" is unchanged by reorder`).toBe(before[name]);
            }
        }
    });

    it('the color tracks the NAME, not the slot — swapping two names swaps their colors', () => {
        // Two maps with different colors; after a reorder the color follows the name, not the index.
        const a = mapBadgeColorForName('Alpha');
        const b = mapBadgeColorForName('Zulu');
        const list1 = colorsFor(['Alpha', 'Zulu']);
        const list2 = colorsFor(['Zulu', 'Alpha']);
        expect(list1.Alpha).toBe(a);
        expect(list1.Zulu).toBe(b);
        expect(list2.Alpha).toBe(a); // still 'a' even though Alpha moved to index 1
        expect(list2.Zulu).toBe(b);
    });
});
