// Path: tests/unit/migracao-frases-de-apagar-origem.test.js

/**
 * @fileoverview As frases do único ato destrutivo da tela de recuperação (decisão D8).
 *
 * O módulo é folha e sem imports, então isto roda em node puro. O que vale medir aqui é o que
 * o navegador não mede: a contagem que a confirmação diz, o plural, e a leitura da tabela de
 * recusas por chave vinda de fora.
 */

import { describe, it, expect } from 'vitest';
import {
    DROP_SOURCE_LABEL, dropSourceConfirmation, dropSourceDenial, dropSourceDone
} from '@js/ui/migration-recovery-phrases.js';

describe('a confirmação nomeia o tamanho', () => {
    it('diz o número e o singular, e avisa que não há como desfazer', () => {
        expect(dropSourceConfirmation(198)).toContain('198 registros');
        expect(dropSourceConfirmation(198)).toContain('não há como desfazer');
        expect(dropSourceConfirmation(1)).toContain('1 registro');
        expect(dropSourceConfirmation(1)).not.toContain('1 registros');
    });

    it('zero registro é frase própria, não "0 registros"', () => {
        expect(dropSourceConfirmation(0)).not.toContain('0 registros');
        expect(dropSourceConfirmation(0)).toContain('bancos');
    });

    it('contagem que não é número não vira texto de contagem', () => {
        for (const invalida of [null, undefined, NaN, Infinity, -3]) {
            const frase = dropSourceConfirmation(invalida);
            expect(frase).not.toMatch(/null|undefined|NaN|Infinity|-3/);
            expect(frase).toContain('não há como desfazer');
        }
    });

    it('o aviso do fim repete o MESMO número que a confirmação disse', () => {
        expect(dropSourceDone(198)).toContain('198 registros');
        expect(dropSourceDone(1)).toContain('1 registro');
        expect(dropSourceDone(0)).not.toContain('0 registros');
    });
});

describe('a recusa nomeia o estado', () => {
    const estados = ['no_transition', 'not_committed', 'legacy_changes', 'claimed',
        'already_dropped', 'unreadable', 'drop_blocked'];

    it('cada estado tem frase própria, e nenhuma delas se repete', () => {
        const frases = estados.map(dropSourceDenial);
        for (const frase of frases) expect(typeof frase).toBe('string');
        expect(new Set(frases).size).toBe(estados.length);
    });

    it('a frase de quem pode destravar nomeia a saída', () => {
        expect(dropSourceDenial('not_committed')).toContain('Conclua a atualização');
        expect(dropSourceDenial('legacy_changes')).toContain('Recupere');
        expect(dropSourceDenial('drop_blocked')).toContain('Feche as outras janelas');
    });

    it('estado desconhecido devolve null, e a tabela não entrega herdado', () => {
        expect(dropSourceDenial('inventado')).toBeNull();
        expect(dropSourceDenial('toString')).toBeNull();
        expect(dropSourceDenial('constructor')).toBeNull();
        expect(dropSourceDenial(undefined)).toBeNull();
    });

    it('o rótulo do comando diz o que ele apaga', () => {
        expect(DROP_SOURCE_LABEL).toContain('Apagar');
        expect(DROP_SOURCE_LABEL).toContain('versão anterior');
    });
});
