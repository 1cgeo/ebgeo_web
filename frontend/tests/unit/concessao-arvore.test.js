import { describe, it, expect } from 'vitest';
import {
    alreadyGranted,
    descendantGrants,
    granteeCounts,
    granteeName,
    granteeSubject,
    groupMemberCount,
    isGroupGrant,
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

/**
 * Uma concessão a GRUPO, como o servidor a devolve: os três campos de pessoa vêm
 * NULOS (o CHECK do banco garante alvo único), e é justamente essa forma que fazia a
 * versão anterior de `granteeName` chamar um grupo de doze de "Usuário".
 */
const grp = (id, pai, nome, membros = 0) => ({
    id,
    parent_grant_id: pai,
    grantee_id: null,
    grantee_username: null,
    grantee_nome: null,
    grantee_group_id: `gid-${id}`,
    grantee_group_name: nome,
    grantee_group_member_count: membros,
    grant_level: 'view',
});

// Uma raiz de pessoa com três dependentes: uma pessoa e DOIS grupos. É a lista
// mista, que é onde toda frase escrita só com "pessoas" fica falsa.
const MISTA = [
    g('M', null, 'Marcos'),
    g('M1', 'M', 'Marta'),
    grp('M2', 'M', 'Equipe Alfa', 12),
    grp('M3', 'M', 'Equipe Bravo', 1),
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

    it('numa concessão a GRUPO devolve o nome do grupo, nunca "Usuário"', () => {
        // O defeito que este caso prende: os campos de pessoa vêm nulos por CHECK, e
        // a frase de revogação chamava um grupo de doze pessoas de "Usuário".
        expect(granteeName(grp('G', null, 'Equipe Alfa', 12))).toBe('Equipe Alfa');
        expect(granteeName(grp('G', null, 'Equipe Alfa', 12))).not.toBe('Usuário');
    });

    it('grupo sem nome cai em "Grupo", e não no rótulo de pessoa', () => {
        expect(granteeName(grp('G', null, null, 3))).toBe('Grupo');
        expect(granteeName(grp('G', null, '', 3))).toBe('Grupo');
    });
});

describe('isGroupGrant — qual dos dois alvos', () => {
    it('discrimina pelo campo de grupo, não pela falta de nome de pessoa', () => {
        expect(isGroupGrant(grp('G', null, 'Equipe Alfa', 2))).toBe(true);
        expect(isGroupGrant(g('A', null, 'Ana'))).toBe(false);
        // Pessoa sem nome NENHUM continua sendo pessoa: adivinhar por ausência de
        // nome classificaria como grupo toda linha de usuário apagado.
        expect(isGroupGrant({ id: 'A', grantee_id: 'uid' })).toBe(false);
        expect(isGroupGrant({})).toBe(false);
        expect(isGroupGrant(null)).toBe(false);
        // String vazia é ausência, como em todo o resto do arquivo.
        expect(isGroupGrant({ grantee_group_id: '' })).toBe(false);
    });
});

describe('groupMemberCount — o tamanho do grupo', () => {
    it('devolve a contagem do servidor e colapsa em 0 todo resto', () => {
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', 12))).toBe(12);
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', 1))).toBe(1);
        // Contagem nula (grupo vazio, ou campo que não veio) e não-grupo: 0.
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', null))).toBe(0);
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', 0))).toBe(0);
        expect(groupMemberCount({ grantee_group_id: 'gid' })).toBe(0);
        expect(groupMemberCount(g('A', null, 'Ana'))).toBe(0);
        expect(groupMemberCount(null)).toBe(0);
        // Lixo vindo da rede não vira "NaN pessoas" na tela.
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', 'doze'))).toBe(0);
        expect(groupMemberCount(grp('G', null, 'Equipe Alfa', -4))).toBe(0);
    });
});

describe('granteeSubject — o beneficiário dentro da frase', () => {
    it('preposiciona pessoa e grupo de formas diferentes', () => {
        expect(granteeSubject(g('A', null, 'Ana'))).toBe('de Ana');
        expect(granteeSubject(grp('G', null, 'Equipe Alfa', 12))).toBe('do grupo Equipe Alfa');
        expect(granteeSubject(undefined)).toBe('de Usuário');
    });
});

describe('granteeCounts — quantos de cada tipo', () => {
    it('separa pessoa de grupo numa lista mista', () => {
        expect(granteeCounts(MISTA)).toEqual({ pessoas: 2, grupos: 2 });
        expect(granteeCounts(ARVORE)).toEqual({ pessoas: 7, grupos: 0 });
        expect(granteeCounts([])).toEqual({ pessoas: 0, grupos: 0 });
        expect(granteeCounts(null)).toEqual({ pessoas: 0, grupos: 0 });
    });
});

describe('alreadyGranted — quem o seletor não pode oferecer de novo', () => {
    it('devolve os dois eixos separados, porque os ids moram em colunas diferentes', () => {
        const lista = [
            { id: '1', grantee_id: 'u1' },
            { id: '2', grantee_id: 'u2' },
            grp('3', null, 'Equipe Alfa', 4),
        ];
        const { userIds, groupIds } = alreadyGranted(lista);
        expect([...userIds].sort()).toEqual(['u1', 'u2']);
        expect([...groupIds]).toEqual(['gid-3']);
        // O grupo NÃO entra no conjunto de pessoas: sem esta metade, o filtro de
        // pessoa passaria a esconder um id que nunca esteve na busca de pessoas.
        expect(userIds.has('gid-3')).toBe(false);
        expect(groupIds.has('u1')).toBe(false);
    });

    it('lista vazia, nula e linha sem alvo nenhum não sujam os conjuntos', () => {
        expect(alreadyGranted([]).userIds.size).toBe(0);
        expect(alreadyGranted(null).groupIds.size).toBe(0);
        // Linha hostil (o CHECK do banco a impede, mas o JSON chega pela rede):
        // sem alvo, ela não pode virar um `undefined` dentro do conjunto, senão
        // um resultado de busca sem id casaria com ela e sumiria da lista.
        const { userIds, groupIds } = alreadyGranted([{ id: '9' }]);
        expect(userIds.size).toBe(0);
        expect(groupIds.size).toBe(0);
    });

    it('compara como STRING, porque o id do resultado de busca chega como texto', () => {
        const { userIds } = alreadyGranted([{ id: '1', grantee_id: 7 }]);
        expect(userIds.has('7')).toBe(true);
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

    it('com um GRUPO no meio da poda, não diz "pessoas" sobre o que não é pessoa', () => {
        const texto = revocationWarning(MISTA, 'M');
        // A afirmação que vale: o total é contado POR TIPO. A frase antiga diria
        // "3 pessoas perdem o acesso" com dois grupos entre os três.
        expect(texto).toContain('1 pessoa e 2 grupos perdem o acesso');
        expect(texto).not.toContain('3 pessoas perdem');
        // O tamanho de cada grupo vai na CITAÇÃO dele, nunca somado ao total: somar
        // membros contaria duas vezes quem está em dois grupos.
        expect(texto).toContain('Equipe Alfa (12 pessoas)');
        expect(texto).toContain('Equipe Bravo (1 pessoa)');
        expect(texto).not.toContain('13 pessoas');
    });

    it('o alvo que é grupo aparece preposicionado como grupo, não como pessoa', () => {
        const soGrupo = [grp('G', null, 'Equipe Charlie', 5), g('H', 'G', 'Helena')];
        const texto = revocationWarning(soGrupo, 'G');
        expect(texto).toContain('Remover o acesso do grupo Equipe Charlie a este recurso?');
        expect(texto).toContain('ATRAVÉS do grupo Equipe Charlie');
        expect(texto).toContain('1 pessoa perde o acesso');
        expect(texto).not.toContain('Usuário');
    });

    it('só grupos caindo fala de grupos, e grupo sem contagem não ganha parêntese', () => {
        const soGrupos = [
            g('R', null, 'Rui'),
            grp('R1', 'R', 'Equipe Delta', 2),
            grp('R2', 'R', 'Equipe Echo', null),
        ];
        const texto = revocationWarning(soGrupos, 'R');
        expect(texto).toContain('2 grupos perdem o acesso');
        expect(texto).not.toContain('pessoas perdem');
        expect(texto).toContain('Equipe Delta (2 pessoas)');
        // Contagem ausente: o nome sai sozinho, sem "(0 pessoas)".
        expect(texto).toContain('Equipe Echo');
        expect(texto).not.toContain('Equipe Echo (');
    });

    it('um grupo sozinho, sem dependente, pergunta só pelo grupo', () => {
        const texto = revocationWarning(MISTA, 'M2');
        expect(texto).toBe('Remover o acesso do grupo Equipe Alfa a este recurso?');
    });
});
