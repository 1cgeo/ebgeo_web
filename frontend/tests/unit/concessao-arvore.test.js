import { describe, it, expect } from 'vitest';
import {
    descendantGrants,
    granteeName,
    revocationWarning,
    MAX_GRANT_DEPTH,
} from '../../src/js/catalog/grant-tree.js';

// A ÁRVORE DE CONCESSÕES, DO LADO DO CLIENTE.
//
// Revogar derruba a SUBÁRVORE (D2: poda recursiva, revogação soft), e essa é a
// consequência que o usuário não adivinha. O aviso do modal só vale se disser
// quantas pessoas caem e quem são, e é essa aritmética que este arquivo prende.
//
// A travessia aqui espelha `REVOKE_GRANT_SUBTREE` do servidor. Ela NÃO é a
// autoridade — quem poda é o SQL, e a contagem do toast vem da resposta dele —
// mas se as duas discordarem o usuário confirma uma coisa e recebe outra, que é
// pior do que não avisar.

/** Uma concessão mínima: id, pai e o nome de quem recebeu. */
const g = (id, pai, nome) => ({ id, parent_grant_id: pai, grantee_nome: nome, grant_level: 'view_share' });

// Raiz A (do admin) -> B -> C -> D, e um irmão E pendurado direto em A.
// Uma segunda raiz X -> Y, independente, que a poda de A NÃO pode alcançar (D3).
const ARVORE = [
    g('A', null, 'Ana'),
    g('B', 'A', 'Bruno'),
    g('C', 'B', 'Célia'),
    g('D', 'C', 'Davi'),
    g('E', 'A', 'Elza'),
    g('X', null, 'Xavier'),
    g('Y', 'X', 'Yara'),
];

const ids = (lista) => lista.map((x) => x.id).sort();

describe('descendantGrants — quem cai junto', () => {
    it('devolve toda a subárvore, em qualquer profundidade, SEM a própria raiz', () => {
        expect(ids(descendantGrants(ARVORE, 'A'))).toEqual(['B', 'C', 'D', 'E']);
        expect(descendantGrants(ARVORE, 'A').some((x) => x.id === 'A')).toBe(false);
    });

    it('a poda de um ramo não alcança o ramo irmão nem a outra raiz', () => {
        // É a metade que dá sentido à primeira: sem ela, "devolve tudo" também
        // passaria verde numa implementação que ignorasse o pai.
        expect(ids(descendantGrants(ARVORE, 'B'))).toEqual(['C', 'D']);
        expect(ids(descendantGrants(ARVORE, 'X'))).toEqual(['Y']);
        expect(descendantGrants(ARVORE, 'E')).toEqual([]);
    });

    it('folha, id inexistente, nulo e lista vazia devolvem lista vazia, nunca erro', () => {
        expect(descendantGrants(ARVORE, 'D')).toEqual([]);
        expect(descendantGrants(ARVORE, 'nao-existe')).toEqual([]);
        expect(descendantGrants(ARVORE, null)).toEqual([]);
        expect(descendantGrants(ARVORE, undefined)).toEqual([]);
        expect(descendantGrants([], 'A')).toEqual([]);
        expect(descendantGrants(null, 'A')).toEqual([]);
    });

    it('um ciclo forjado termina em vez de travar a aba', () => {
        // Impossível pelo servidor (o pai é fixado no INSERT e nenhuma rota o
        // atualiza), mas a entrada aqui é um JSON que veio pela rede.
        const ciclo = [g('P', 'Q', 'Pedro'), g('Q', 'P', 'Quim')];
        expect(ids(descendantGrants(ciclo, 'P'))).toEqual(['Q']);
        expect(ids(descendantGrants(ciclo, 'Q'))).toEqual(['P']);
    });

    it('conta cada concessão UMA vez quando dois caminhos chegam nela', () => {
        // Um DAG estreito: R -> S e R -> T, os dois apontando para U não é
        // possível (um pai só), mas o mesmo objeto listado duas vezes é.
        const duplicado = [g('R', null, 'Rui'), g('S', 'R', 'Sara'), g('S', 'R', 'Sara')];
        expect(descendantGrants(duplicado, 'R')).toHaveLength(1);
    });

    it('para no teto de profundidade em vez de percorrer uma corrente infinita', () => {
        // Corrente de 40 elos: além do teto, a travessia corta.
        const corrente = [g('n0', null, 'raiz')];
        for (let i = 1; i <= 40; i++) corrente.push(g(`n${i}`, `n${i - 1}`, `p${i}`));
        const caidos = descendantGrants(corrente, 'n0');
        expect(caidos.length).toBeLessThan(40);
        expect(caidos.length).toBe(MAX_GRANT_DEPTH - 1);
    });
});

describe('granteeName — o nome que a linha mostra', () => {
    it('prefere o nome, cai para o usuário, e nunca devolve vazio', () => {
        expect(granteeName({ grantee_nome: 'Ana', grantee_username: 'ana' })).toBe('Ana');
        expect(granteeName({ grantee_username: 'ana' })).toBe('ana');
        expect(granteeName({})).toBe('Usuário');
        expect(granteeName(null)).toBe('Usuário');
        // Vazio é ausência, não um nome: sem isto a linha ficaria em branco.
        expect(granteeName({ grantee_nome: '', grantee_username: '' })).toBe('Usuário');
    });
});

describe('revocationWarning — o aviso que o modal mostra', () => {
    it('sem dependentes, pergunta só pela pessoa', () => {
        const texto = revocationWarning(ARVORE, 'E');
        expect(texto).toContain('Elza');
        expect(texto).not.toContain('perde');
    });

    it('com dependentes, diz QUANTOS caem e NOMEIA os primeiros', () => {
        const texto = revocationWarning(ARVORE, 'A');
        expect(texto).toContain('Ana');
        expect(texto).toContain('4 pessoas perdem');
        expect(texto).toContain('Bruno');
        // Quatro caem e o padrão cita três: o resto vira contagem, senão o aviso
        // vira uma lista que ninguém lê.
        expect(texto).toContain('e mais 1');
    });

    it('um único dependente fala no singular', () => {
        expect(revocationWarning(ARVORE, 'X')).toContain('1 pessoa perde');
    });

    it('concessão desconhecida não quebra o aviso', () => {
        expect(revocationWarning(ARVORE, 'nao-existe')).toContain('Usuário');
    });
});
