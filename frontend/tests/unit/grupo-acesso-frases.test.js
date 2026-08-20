import { describe, it, expect } from 'vitest';
import {
    toCount,
    peopleLabel,
    resourceLabel,
    groupReach,
    groupDeletionWarning,
    groupDeletionSummary,
    memberDisplayName,
} from '../../src/js/admin/group-phrases.js';

// AS FRASES DA ABA "GRUPOS".
//
// Apagar um grupo REVOGA tudo o que ele concedia, e é a consequência que ninguém
// adivinha: a pessoa acha que está limpando uma lista e está tirando acesso. O aviso
// só vale se disser QUANTAS pessoas e QUANTOS recursos caem, e essa aritmética é o
// que este arquivo prende.
//
// A armadilha que motivou o módulo: as duas contagens vêm de um `COUNT` do SQL, e o
// node-postgres devolve bigint como STRING. Um plural escolhido com `n === 1` lê
// "1 pessoas" no instante em que o valor chega como '1'.

describe('toCount — a contagem que chegou pela rede', () => {
    it('aceita número e string, que é a forma em que o COUNT do Postgres chega', () => {
        expect(toCount(3)).toBe(3);
        expect(toCount('3')).toBe(3);
        expect(toCount('1')).toBe(1);
    });

    it('ausente, lixo e negativo viram zero, nunca NaN na tela', () => {
        expect(toCount(undefined)).toBe(0);
        expect(toCount(null)).toBe(0);
        expect(toCount('')).toBe(0);
        expect(toCount('abc')).toBe(0);
        expect(toCount(NaN)).toBe(0);
        expect(toCount(Infinity)).toBe(0);
        expect(toCount(-5)).toBe(0);
        expect(toCount(2.7)).toBe(2);
    });
});

describe('peopleLabel / resourceLabel — concordância', () => {
    it('singular só no 1, e o 1 em string também é singular', () => {
        expect(peopleLabel(1)).toBe('1 pessoa');
        expect(peopleLabel('1')).toBe('1 pessoa');
        expect(resourceLabel(1)).toBe('1 recurso');
        expect(resourceLabel('1')).toBe('1 recurso');
    });

    it('zero e plural usam a forma plural', () => {
        expect(peopleLabel(0)).toBe('0 pessoas');
        expect(peopleLabel(2)).toBe('2 pessoas');
        expect(resourceLabel(0)).toBe('0 recursos');
        expect(resourceLabel(9)).toBe('9 recursos');
    });
});

describe('groupReach — a linha de alcance', () => {
    it('junta as duas contagens', () => {
        expect(groupReach({ member_count: 3, grant_count: 1 })).toBe('3 pessoas · 1 recurso');
    });

    it('grupo sem nenhum dos dois não quebra', () => {
        expect(groupReach({})).toBe('0 pessoas · 0 recursos');
        expect(groupReach(null)).toBe('0 pessoas · 0 recursos');
    });
});

describe('groupDeletionWarning — o aviso que precede o clique', () => {
    it('nomeia o grupo, quantas pessoas e quantos recursos caem', () => {
        const frase = groupDeletionWarning({ name: 'Célula de Inteligência', member_count: 4, grant_count: 2 });
        expect(frase).toContain('"Célula de Inteligência"');
        expect(frase).toContain('4 pessoas');
        expect(frase).toContain('2 recursos');
        expect(frase).toContain('não se desfaz');
    });

    it('as contagens em string produzem a MESMA frase que as numéricas', () => {
        // O controle negativo do módulo inteiro: sem `toCount`, esta é a asserção que cai.
        expect(groupDeletionWarning({ name: 'G', member_count: '1', grant_count: '1' }))
            .toBe(groupDeletionWarning({ name: 'G', member_count: 1, grant_count: 1 }));
        expect(groupDeletionWarning({ name: 'G', member_count: '1', grant_count: '1' }))
            .toContain('1 pessoa a 1 recurso');
    });

    it('grupo vazio diz que é inócuo, em vez de "0 pessoas a 0 recursos"', () => {
        const frase = groupDeletionWarning({ name: 'Vazio', member_count: 0, grant_count: 0 });
        expect(frase).toContain('não tem membros nem concessões');
        expect(frase).not.toContain('0 pessoas');
    });

    it('sem concessões, o aviso fala só das pessoas; sem membros, só das concessões', () => {
        const semRecurso = groupDeletionWarning({ name: 'A', member_count: 5, grant_count: 0 });
        expect(semRecurso).toContain('5 pessoas');
        expect(semRecurso).toContain('não concede acesso a nenhum recurso');

        const semGente = groupDeletionWarning({ name: 'B', member_count: 0, grant_count: 3 });
        expect(semGente).toContain('3 recursos');
        expect(semGente).toContain('não tem membros');
    });

    it('grupo sem nome ou nulo não vira "undefined" na frase', () => {
        expect(groupDeletionWarning({ member_count: 2, grant_count: 1 })).not.toContain('undefined');
        expect(groupDeletionWarning(null)).not.toContain('undefined');
    });
});

describe('groupDeletionSummary — o que o servidor disse que caiu', () => {
    it('reporta o número do servidor, não o da listagem', () => {
        expect(groupDeletionSummary({ name: 'X', grantsAffected: 7 }))
            .toBe('Grupo "X" apagado. Concessões revogadas: 7.');
        expect(groupDeletionSummary({ name: 'X', grantsAffected: '7' }))
            .toBe('Grupo "X" apagado. Concessões revogadas: 7.');
    });

    it('sem concessões afetadas, não anuncia uma revogação que não houve', () => {
        expect(groupDeletionSummary({ name: 'X', grantsAffected: 0 })).toBe('Grupo "X" apagado.');
        expect(groupDeletionSummary({ name: 'X' })).toBe('Grupo "X" apagado.');
    });
});

describe('memberDisplayName — como a pessoa aparece', () => {
    it('põe o posto na frente do nome quando há os dois', () => {
        expect(memberDisplayName({ nome: 'Ana Lima', posto_graduacao: 'Cap', username: 'ana' }))
            .toBe('Cap Ana Lima');
    });

    it('sem nome cai no usuário, e o posto não se cola ao usuário', () => {
        // Posto + login ("Cap ana") lê como nome de guerra e não é: o posto só acompanha o nome.
        expect(memberDisplayName({ username: 'ana', posto_graduacao: 'Cap' })).toBe('ana');
        expect(memberDisplayName({ nome: '   ', username: 'ana' })).toBe('ana');
    });

    it('sem nada devolve um rótulo, nunca vazio', () => {
        expect(memberDisplayName({})).toBe('Usuário');
        expect(memberDisplayName(null)).toBe('Usuário');
    });
});
