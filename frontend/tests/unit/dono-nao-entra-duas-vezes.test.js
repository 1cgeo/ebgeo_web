// Path: tests/unit/dono-nao-entra-duas-vezes.test.js
//
// A MESMA PESSOA NÃO ENTRA DUAS VEZES NUM ATLAS (defeito relatado pelo dono, 2026-09-20).
//
// A CAUSA. As duas telas do eixo de ATLAS (compartilhar e criar) filtravam a busca de pessoas só
// contra a lista de MEMBROS, e o DONO não está nela: no payload de `GET /sharing` ele é um bloco à
// parte (`owner`), e na criação ele é quem está com a sessão aberta. A busca do servidor não
// exclui quem pergunta. Bastava o dono digitar o próprio nome para se achar, se adicionar como
// Leitor e sair DUAS vezes na mesma lista. A unicidade de `atlas_shares` nunca esteve em jogo: a
// duplicata era entre o bloco do dono e a lista de shares, que são duas fontes.
//
// A OUTRA METADE é do servidor, que passou a recusar com 409 o share para o dono
// (`backend/tests/integration/sharing-owner-invariants.test.js`).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { peoplePickOutcome, alreadyHoldsAtlas } from '../../src/js/catalog/grant-tree.js';

const ler = (rel) => readFileSync(new URL(`../../src/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const DONO = { id: 'u-dono', username: 'diniz' };
const MEMBRO = { id: 'u-membro', username: 'marcel' };
const NOVO = { id: 'u-novo', username: 'ana' };

describe('peoplePickOutcome', () => {
    it('O DEFEITO: o dono que busca o próprio nome não se oferece a si mesmo', () => {
        const saida = peoplePickOutcome([DONO], { ownerId: 'u-dono', memberIds: [] });
        expect(saida.pickable).toEqual([]);
        // A frase nomeia o motivo: "todos já são membros" mandaria procurar o dono numa lista
        // de membros em que ele não está.
        expect(saida.notice).toBe('O dono do atlas já tem acesso total');
    });

    it('o dono sai, e quem ainda não tem o atlas fica', () => {
        const saida = peoplePickOutcome([DONO, MEMBRO, NOVO], { ownerId: 'u-dono', memberIds: ['u-membro'] });
        expect(saida.pickable).toEqual([NOVO]);
        expect(saida.notice).toBeNull();
    });

    it('sem resultado e todos já dentro são frases DIFERENTES', () => {
        expect(peoplePickOutcome([], { ownerId: 'u-dono' }).notice).toBe('Nenhum usuário encontrado');
        expect(peoplePickOutcome([MEMBRO], { ownerId: 'u-dono', memberIds: ['u-membro'] }).notice)
            .toBe('Todos já são membros');
        // Dono E membro fora: a frase geral, porque a do dono seria meia verdade.
        expect(peoplePickOutcome([DONO, MEMBRO], { ownerId: 'u-dono', memberIds: ['u-membro'] }).notice)
            .toBe('Todos já são membros');
    });

    it('cada tela traz a sua frase de lista tomada', () => {
        expect(peoplePickOutcome([MEMBRO], { memberIds: ['u-membro'], takenNotice: 'Todos já adicionados' }).notice)
            .toBe('Todos já adicionados');
    });

    it('compara por TEXTO: o id numérico de um payload casa com a string do outro', () => {
        expect(peoplePickOutcome([{ id: 7 }], { ownerId: '7' }).pickable).toEqual([]);
        expect(peoplePickOutcome([{ id: '8' }], { memberIds: [8] }).pickable).toEqual([]);
    });

    it.each([undefined, null, ''])('resultado com id %j não vira botão que o clique recusa calado', (id) => {
        expect(peoplePickOutcome([{ id, username: 'x' }, NOVO], {}).pickable).toEqual([NOVO]);
    });

    it.each([undefined, null, {}, 'abc', 42])('entrada %j não lança e não oferece ninguém', (bruto) => {
        expect(peoplePickOutcome(bruto, { ownerId: 'u-dono' }).pickable).toEqual([]);
    });

    it('sem dono declarado (servidor antigo, sessão anônima) o filtro de membros continua valendo', () => {
        const saida = peoplePickOutcome([DONO, MEMBRO], { ownerId: null, memberIds: ['u-membro'] });
        expect(saida.pickable).toEqual([DONO]);
    });

    it('PROPRIEDADE: ninguém escolhível é o dono nem membro, e a frase é nula se e só se há alguém', () => {
        const idArb = fc.constantFrom('a', 'b', 'c', 'd', 'e');
        fc.assert(fc.property(
            fc.array(fc.record({ id: idArb })), fc.option(idArb, { nil: null }), fc.array(idArb),
            (results, ownerId, memberIds) => {
                const { pickable, notice } = peoplePickOutcome(results, { ownerId, memberIds });
                for (const pessoa of pickable) {
                    expect(pessoa.id).not.toBe(ownerId);
                    expect(memberIds).not.toContain(pessoa.id);
                    expect(alreadyHoldsAtlas(pessoa.id, { ownerId, memberIds })).toBe(false);
                }
                expect(notice === null).toBe(pickable.length > 0);
            },
        ));
    });
});

describe('alreadyHoldsAtlas: o guarda do CLIQUE', () => {
    it('recusa o dono e o membro, e deixa passar quem não tem o atlas', () => {
        const quem = { ownerId: 'u-dono', memberIds: ['u-membro'] };
        expect(alreadyHoldsAtlas('u-dono', quem)).toBe(true);
        expect(alreadyHoldsAtlas('u-membro', quem)).toBe(true);
        expect(alreadyHoldsAtlas('u-novo', quem)).toBe(false);
    });

    it.each([undefined, null, ''])('id %j recusa: é o lado que falha fechado', (id) => {
        expect(alreadyHoldsAtlas(id, { ownerId: 'u-dono' })).toBe(true);
    });
});

describe('a fiação nas duas telas', () => {
    const TELAS = Object.freeze([
        ['compartilhar', 'modals/sharing.modal.core.js', 'ownerId: this._owner?.userId ?? null'],
        ['criar atlas', 'modals/create-atlas.modal.js', 'ownerId: sessionContext.userId ?? null'],
    ]);

    it.each(TELAS)('%s: a lista e o clique leem os MESMOS detentores, com o dono dentro', (_nome, rel, dono) => {
        const fonte = ler(rel);
        expect(fonte).toContain('peoplePickOutcome(results, this._holders())');
        expect(fonte).toContain('alreadyHoldsAtlas(userId, this._holders())');
        expect(fonte).toContain(dono);
    });

    it.each(TELAS)('%s: o filtro antigo, que só conhecia membros, não voltou', (_nome, rel) => {
        expect(ler(rel)).not.toMatch(/results\.filter\(\(u\) => !memberIds\.has/);
    });
});
