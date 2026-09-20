// Path: tests/unit/rotulo-de-pessoa-militar.test.js

/**
 * @fileoverview `militaryPersonLabel` — como uma pessoa é NOMEADA na tela de compartilhamento.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que cada bloco existe:
 *
 *   1. A ESCADA DE QUEDA, degrau por degrau. Toda coluna que ela lê é ANULÁVEL em `users`
 *      (`rank_id`, `nome_guerra`, `organization_id`), então nenhum degrau é hipotético: uma
 *      conta administrativa recém-criada não tem posto nem nome de guerra, e o auto-cadastro
 *      não pede nome de guerra nenhum. Uma implementação que só tratasse o caso completo
 *      desenharia "undefined Silva" ou uma linha em branco, e linha em branco na lista de quem
 *      tem acesso ao atlas é a forma silenciosa do defeito.
 *
 *   2. AS DUAS GRAFIAS. As duas rotas que alimentam a MESMA tela discordam por contrato:
 *      `GET /users/search` responde snake_case e `GET /atlas/:id/sharing` responde camelCase
 *      (o teste de integração dele assere que "snake_case must NOT leak"). Se a função só
 *      lesse uma, metade das linhas perderia posto e unidade em silêncio — e seria justamente
 *      a metade JÁ compartilhada, a que mais gente lê.
 *
 *   3. O CONTROLE NEGATIVO, que é o que separa este arquivo de uma tautologia: há um caso por
 *      degrau que afirma o que a função NÃO devolve (o nome completo quando existe nome de
 *      guerra; o `@login` duplicado; a palavra 'null' vinda de um JSON nulo).
 *
 * Node puro, sem DOM: a função é folha de ZERO imports, que é a propriedade que permite ao
 * modal de compartilhamento usá-la dentro de `atlas.html`, página que boota sem a store.
 */

import { describe, it, expect } from 'vitest';
import { militaryPersonLabel } from '@utils/person-label.js';

/** Uma linha de `GET /users/search`, completa. */
const BUSCA = Object.freeze({
    id: 'u1',
    username: 'jbsouza',
    nome: 'João Batista de Souza',
    nome_guerra: 'Silva',
    rank_id: 'r1',
    posto_graduacao: 'Cap',
    organization_id: 'o1',
    organizacao_militar: '1º Centro de Geoinformação',
    organizacao_militar_sigla: '1º CGEO',
});

/** A MESMA pessoa como `GET /atlas/:id/sharing` a devolve. */
const SHARE = Object.freeze({
    userId: 'u1',
    username: 'jbsouza',
    nome: 'João Batista de Souza',
    nomeGuerra: 'Silva',
    postoGraduacao: 'Cap',
    organizacaoMilitar: '1º Centro de Geoinformação',
    organizacaoMilitarSigla: '1º CGEO',
    permission: 'write',
});

describe('militaryPersonLabel — o rótulo completo', () => {
    it('compõe posto abreviado + nome de guerra, com a unidade ao lado', () => {
        const out = militaryPersonLabel(BUSCA);
        expect(out.label).toBe('Cap Silva');
        expect(out.unit).toBe('1º CGEO');
        expect(out.handle).toBe('@jbsouza');
        expect(out.detail).toBe('1º CGEO · @jbsouza');
        // O nome SEM o posto, que é de onde saem as iniciais do avatar: `Cap Silva` daria
        // "CS" para todo Capitão da lista, e um crachá que não distingue não é crachá.
        expect(out.name).toBe('Silva');
    });

    it('CONTROLE NEGATIVO: o nome civil completo NÃO aparece quando há nome de guerra', () => {
        // É a metade que a mudança inteira existe para produzir. Uma implementação que
        // concatenasse posto + `nome` passaria em tudo o que é ausência e falharia aqui.
        const out = militaryPersonLabel(BUSCA);
        expect(out.label).not.toContain('João');
        expect(out.label).not.toContain('Batista');
        expect(out.detail).not.toContain('João');
    });

    it('lê a grafia camelCase do envelope de compartilhamento e chega ao MESMO rótulo', () => {
        // Não é "parecido": é igual campo a campo, porque as duas linhas são a mesma pessoa em
        // duas rotas, e a tela as desenha uma embaixo da outra.
        expect(militaryPersonLabel(SHARE)).toEqual(militaryPersonLabel(BUSCA));
    });

    it('a SIGLA vence o nome por extenso, nas duas grafias', () => {
        expect(militaryPersonLabel(BUSCA).unit).toBe('1º CGEO');
        expect(militaryPersonLabel(SHARE).unit).toBe('1º CGEO');
        // DISCRIMINAÇÃO: sem a sigla, o nome por extenso é o que sobra — e não vazio.
        expect(militaryPersonLabel({ ...BUSCA, organizacao_militar_sigla: null }).unit)
            .toBe('1º Centro de Geoinformação');
        expect(militaryPersonLabel({ ...SHARE, organizacaoMilitarSigla: null }).unit)
            .toBe('1º Centro de Geoinformação');
    });
});

describe('militaryPersonLabel — a escada de queda', () => {
    it('sem nome de guerra, cai para o nome completo, com o posto na frente', () => {
        const out = militaryPersonLabel({ ...BUSCA, nome_guerra: null });
        expect(out.label).toBe('Cap João Batista de Souza');
        expect(out.name).toBe('João Batista de Souza');
    });

    it('sem posto, o nome de guerra aparece sozinho (e não com um espaço sobrando)', () => {
        const out = militaryPersonLabel({ ...BUSCA, posto_graduacao: null });
        expect(out.label).toBe('Silva');
        expect(out.label).not.toMatch(/^\s|\s$/);
    });

    it('sem nome nenhum, o login VIRA o rótulo e não se repete na segunda linha', () => {
        const out = militaryPersonLabel({
            id: 'u2', username: 'jbsouza', nome: null, nome_guerra: null,
            posto_graduacao: null, organizacao_militar_sigla: '1º CGEO',
        });
        expect(out.label).toBe('@jbsouza');
        // A DUPLICAÇÃO É O DEFEITO QUE ESTE CASO FECHA: com `handle` preenchido, a linha
        // desenharia "@jbsouza" em cima e "1º CGEO · @jbsouza" embaixo.
        expect(out.handle).toBe('');
        expect(out.detail).toBe('1º CGEO');
        expect(out.name).toBe('');
    });

    it('sem nome e sem login, a palavra — porque a linha continua sendo uma pessoa com acesso', () => {
        expect(militaryPersonLabel({ id: 'u3' }).label).toBe('Alguém');
        expect(militaryPersonLabel(null).label).toBe('Alguém');
        expect(militaryPersonLabel(undefined).label).toBe('Alguém');
        expect(militaryPersonLabel({}).label).toBe('Alguém');
    });

    it('o posto SEM abreviatura aparece por extenso, como o servidor o entrega', () => {
        // `COALESCE(r.nome_abrev, r.nome)` já resolve isso no SQL; o cliente não pode
        // "melhorar" o que chega, porque um posto sem abreviatura existe de verdade.
        expect(militaryPersonLabel({ ...BUSCA, posto_graduacao: 'Posto Sem Abreviatura' }).label)
            .toBe('Posto Sem Abreviatura Silva');
    });
});

describe('militaryPersonLabel — bordas de valor', () => {
    const VAZIOS = [null, undefined, '', '   ', '\t\n'];

    it('string só de espaço conta como AUSENTE em todo campo', () => {
        for (const vazio of VAZIOS) {
            expect(militaryPersonLabel({ ...BUSCA, nome_guerra: vazio }).label)
                .toBe('Cap João Batista de Souza');
            expect(militaryPersonLabel({ ...BUSCA, posto_graduacao: vazio }).label).toBe('Silva');
            expect(militaryPersonLabel({ ...BUSCA, organizacao_militar_sigla: vazio }).unit)
                .toBe('1º Centro de Geoinformação');
        }
    });

    it('JSON nulo NUNCA vira a palavra "null" na tela', () => {
        // `String(null)` é 'null', e é assim que um campo anulável aparece escrito num rótulo
        // que concatena sem conferir o tipo.
        const out = militaryPersonLabel({
            username: 'x', nome: null, nome_guerra: null, posto_graduacao: null,
            organizacao_militar: null, organizacao_militar_sigla: null,
        });
        expect(out.label).not.toContain('null');
        expect(out.detail).not.toContain('null');
        expect(out.unit).toBe('');
    });

    it('valor NÃO-string é ignorado em vez de virar "[object Object]"', () => {
        const out = militaryPersonLabel({
            nome: { toString: () => 'Objeto' }, nome_guerra: ['Silva'],
            posto_graduacao: true, username: 'x',
        });
        expect(out.label).toBe('@x');
        expect(out.label).not.toContain('object');
    });

    it('o rótulo NUNCA é vazio, para nenhuma das bordas', () => {
        const entradas = [
            null, undefined, {}, { nome: '   ' }, { username: '  ' },
            { nome: null, username: null }, { posto_graduacao: 'Cap' },
            { organizacao_militar_sigla: '1º CGEO' },
        ];
        for (const entrada of entradas) {
            expect(militaryPersonLabel(entrada).label.trim()).not.toBe('');
        }
    });

    it('posto SEM nome nenhum não desenha um posto órfão', () => {
        // DISCRIMINAÇÃO: um `if (posto) label = posto + ' ' + nome` devolveria "Cap " aqui.
        const out = militaryPersonLabel({ posto_graduacao: 'Cap', username: 'x' });
        expect(out.label).toBe('@x');
        expect(out.label).not.toContain('Cap');
    });

    it('número é texto legítimo (um nome de guerra numérico não some)', () => {
        expect(militaryPersonLabel({ nome_guerra: 3, posto_graduacao: 'Sd' }).label).toBe('Sd 3');
    });
});
