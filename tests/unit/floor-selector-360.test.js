// Path: tests/unit/floor-selector-360.test.js
/**
 * @fileoverview Decisions of the 360 floor picker that do not need a DOM:
 * which floor opens, and how a level is labelled on the strip.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveInitialLevel,
    shortLabel
} from '@js/street_view_tool/components/floor-selector-360.js';

/** Beira-Rio's real shape: six floors plus ground, top level first. */
const ANDARES = [
    { level: 6, label: '6º andar' },
    { level: 5, label: '5º andar' },
    { level: 4, label: '4º andar' },
    { level: 3, label: '3º andar' },
    { level: 2, label: '2º andar' },
    { level: 1, label: '1º andar' },
    { level: 0, label: 'Térreo' }
];

describe('resolveInitialLevel', () => {
    it('abre no andar da foto quando o projeto o tem', () => {
        expect(resolveInitialLevel(ANDARES, 5)).toBe(5);
        expect(resolveInitialLevel(ANDARES, 0)).toBe(0);
    });

    it('cai no andar mais BAIXO, nao no primeiro da lista', () => {
        // A lista chega de cima para baixo. Pegar o primeiro abriria o predio
        // no sexto andar, que e onde ninguem entra.
        expect(resolveInitialLevel(ANDARES, undefined)).toBe(0);
        expect(resolveInitialLevel(ANDARES, null)).toBe(0);
    });

    it('ignora um andar que o projeto nao tem', () => {
        expect(resolveInitialLevel(ANDARES, 99)).toBe(0);
    });

    it('devolve null sem andares, que e o que desliga o seletor', () => {
        expect(resolveInitialLevel([], 1)).toBeNull();
        expect(resolveInitialLevel(null, 1)).toBeNull();
        expect(resolveInitialLevel(undefined, 1)).toBeNull();
    });

    it('respeita o subsolo como andar valido', () => {
        const comSubsolo = [...ANDARES, { level: -1, label: '1º subsolo' }];
        expect(resolveInitialLevel(comSubsolo, -1)).toBe(-1);
        // E o "mais baixo" passa a ser o subsolo.
        expect(resolveInitialLevel(comSubsolo, 99)).toBe(-1);
    });
});

describe('shortLabel', () => {
    it('marca o nivel do chao como externo', () => {
        expect(shortLabel({ level: 0 })).toBe('Ext');
    });

    it('usa o numero puro nos andares', () => {
        expect(shortLabel({ level: 1 })).toBe('1');
        expect(shortLabel({ level: 6 })).toBe('6');
        expect(shortLabel({ level: 12 })).toBe('12');
    });

    it('prefixa o subsolo com S', () => {
        expect(shortLabel({ level: -1 })).toBe('S1');
        expect(shortLabel({ level: -2 })).toBe('S2');
    });
});
