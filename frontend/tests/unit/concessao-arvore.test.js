import { describe, it, expect } from 'vitest';
import {
    alreadyGranted,
    descendantGrants,
    fallenGrants,
    granteeCounts,
    granteeGroupOwnerLabel,
    granteeName,
    granteeSubject,
    groupMemberCount,
    groupOptionLabel,
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
// A travessia aqui espelha `REVOKE_SUBTREE_PRESERVING_REACH` do servidor, e o
// espelhamento é PARCIAL por construção: o cliente não recebe a composição dos grupos
// nem o estado da conta de quem concedeu, então o braço coletivo do resgate é invisível
// deste lado. Ela NÃO é a autoridade — quem poda é o SQL, e a contagem do toast vem da
// resposta dele — mas se as duas discordarem o usuário confirma uma coisa e recebe
// outra, que é pior do que não avisar. `descendantGrants` continua sendo o fecho
// INGÊNUO (é dele que sai o conjunto de exclusão) e `fallenGrants` é o que o servidor
// derruba de fato.

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

// ---------------------------------------------------------------------------
// A DELEGAÇÃO PRECISA APARECER EM ALGUMA TELA.
//
// Conceder um recurso privado a um GRUPO entrega ao dono daquele grupo o poder de
// acrescentar beneficiários sem passar por quem concedeu: ele põe mais gente dentro
// e o acesso segue junto, sem linha nova em `resource_grants`. A lista "quem tem
// acesso" é a única superfície onde isso é visível, e o servidor passou a mandar
// `grantee_group_owner_*` por causa disso. Enquanto o cliente não lia o campo, a
// mitigação existia só no SQL.
//
// O PISO destes casos é: concessão a grupo produz um rótulo com o nome e o @ do dono.
// A DISCRIMINAÇÃO é a concessão a PESSOA, que não pode ganhar rótulo nenhum: sem ela,
// uma implementação que carimbasse toda linha passaria verde e a tela deixaria de
// distinguir o coletivo do individual, que é a informação inteira.
describe('granteeGroupOwnerLabel — de quem é o coletivo que recebeu', () => {
    /** @param {Object} extra */
    const comDono = (extra) => ({ ...grp('Z', null, 'Equipe Zulu', 3), ...extra });

    it('PISO: concessão a grupo nomeia o dono com nome e @', () => {
        expect(granteeGroupOwnerLabel(comDono({
            grantee_group_owner_id: 'u1',
            grantee_group_owner_nome: 'Ana Lima',
            grantee_group_owner_username: 'ana',
        }))).toBe('Dono: Ana Lima (@ana)');
    });

    it('DISCRIMINAÇÃO: concessão a PESSOA não ganha rótulo de dono', () => {
        expect(granteeGroupOwnerLabel(g('P', null, 'Pedro'))).toBe('');
        // E o vizinho que não pode mudar: o nome do beneficiário continua saindo, senão
        // este teste passaria com a linha inteira trocada por um rótulo de dono.
        expect(granteeName(g('P', null, 'Pedro'))).toBe('Pedro');
    });

    it('só nome, ou só @, cada um sozinho', () => {
        expect(granteeGroupOwnerLabel(comDono({ grantee_group_owner_nome: 'Ana Lima' })))
            .toBe('Dono: Ana Lima');
        expect(granteeGroupOwnerLabel(comDono({ grantee_group_owner_username: 'ana' })))
            .toBe('Dono: @ana');
    });

    it('grupo ÓRFÃO diz isso por extenso, e não com um travessão', () => {
        // Estado real: o backfill da migração adota `created_by`, que pode ser nulo em
        // linha antiga. Órfão não entrega acesso a ninguém (o predicado exige dono vivo).
        expect(granteeGroupOwnerLabel(grp('O', null, 'Equipe Órfã', 2))).toBe('Sem dono definido');
        expect(granteeGroupOwnerLabel(comDono({
            grantee_group_owner_nome: '   ', grantee_group_owner_username: '  ',
        }))).toBe('Sem dono definido');
    });
});

// ---------------------------------------------------------------------------
// DOIS GRUPOS HOMÔNIMOS DE DONOS DIFERENTES SÃO ESTADO LEGAL desde que a unicidade
// de nome saiu de global para `(owner_id, LOWER(name))`. Quem vê grupo alheio no
// seletor é só o administrador (a listagem é recortada por posse), e para ele duas
// `<option>` idênticas significam conceder um recurso privado ao coletivo errado.
describe('groupOptionLabel — a opção do seletor de grupo', () => {
    const alfaDaAna = {
        id: 'g1', name: 'Equipe Alfa', member_count: 3,
        owner_id: 'u-ana', owner_nome: 'Ana Lima', owner_username: 'ana',
    };
    const alfaDoBruno = {
        id: 'g2', name: 'Equipe Alfa', member_count: 3,
        owner_id: 'u-bruno', owner_nome: 'Bruno Sá', owner_username: 'bruno',
    };

    it('PISO: dois homônimos de donos diferentes produzem rótulos DISTINTOS', () => {
        const a = groupOptionLabel(alfaDaAna, 'u-admin');
        const b = groupOptionLabel(alfaDoBruno, 'u-admin');
        expect(a).not.toBe(b);
        expect(a).toBe('Equipe Alfa (3 pessoas) · de Ana Lima');
        expect(b).toBe('Equipe Alfa (3 pessoas) · de Bruno Sá');
    });

    it('DISCRIMINAÇÃO: o grupo PRÓPRIO não ganha sufixo, e a contagem continua', () => {
        // Se toda linha dissesse de quem é, a linha alheia deixaria de saltar.
        expect(groupOptionLabel(alfaDaAna, 'u-ana')).toBe('Equipe Alfa (3 pessoas)');
        // Id vindo da rede como número e da sessão como string: comparação por String().
        expect(groupOptionLabel({ ...alfaDaAna, owner_id: 7 }, 7)).toBe('Equipe Alfa (3 pessoas)');
    });

    it('sem sessão lida, TODO grupo é tratado como alheio (falha para o lado do ruído)', () => {
        expect(groupOptionLabel(alfaDaAna, null)).toContain('· de Ana Lima');
    });

    it('grupo vazio, grupo sem nome e grupo órfão continuam legíveis', () => {
        expect(groupOptionLabel({ id: 'g3', name: 'Equipe Beta', member_count: 0 }, null))
            .toBe('Equipe Beta (sem membros) · sem dono definido');
        expect(groupOptionLabel({ id: 'g4', member_count: 1, owner_id: 'u-x', owner_username: 'xis' }, null))
            .toBe('Grupo (1 pessoa) · de @xis');
        expect(groupOptionLabel({ id: 'g5', name: 'Equipe Gama', member_count: 2, owner_id: 'u-x' }, 'u-x'))
            .toBe('Equipe Gama (2 pessoas)');
    });
});

// ---------------------------------------------------------------------------
// fallenGrants — o fecho ingênuo MENOS quem o servidor resgata
// ---------------------------------------------------------------------------
//
// Desde 2026-08-21 revogar deixou de derrubar todo descendente: um filho cujo
// CONCEDENTE ainda tenha `view_share` vivo sobre o mesmo recurso, FORA do alcance da
// poda, é re-pendurado nesse outro pai ("se B não caiu, D não deve cair"). O aviso do
// modal precisa contar a mesma coisa, senão promete uma queda que não acontece.
//
// O RECORTE É ESTREITO E O ERRO PRECISA SUPERESTIMAR: avisar a mais custa menos que
// avisar a menos, porque revogar é irreversível. O braço COLETIVO do servidor é invisível
// aqui (o cliente não recebe a composição dos grupos), então o descendente que só se
// salvaria por grupo continua contado como caído — erro seguro, com caso próprio.
//
// A VIDA DO CONCEDENTE ERA A EXCEÇÃO, e ela apontava para o lado errado: o servidor exige
// `fn_principal_vivo(granted_by)` no pai alternativo e a listagem não mandava esse fato,
// então o cliente resgatava por uma linha que o servidor recusa e o aviso SUBESTIMAVA.
// Corrigido em 2026-08-21 com `granted_by_vivo` na listagem. Sobra um subestimador
// conhecido: o teto de profundidade (o servidor desliga o resgate inteiro quando a
// travessia trunca em 32, o cliente não), fora do alcance de qualquer árvore medida.

/** Concessão com concedente explícito: é o `granted_by` que decide o resgate. */
const gp = (id, pai, nome, por, nivel = 'view_share', paraId = null) => ({
    id,
    parent_grant_id: pai,
    grantee_nome: nome,
    grantee_id: paraId ?? `u-${nome}`,
    granted_by: por,
    grant_level: nivel,
});

describe('fallenGrants — quem cai DEPOIS da preservação de alcançabilidade', () => {
    it('PISO: sem nenhum view_share alternativo, devolve exatamente o fecho ingênuo', () => {
        // A árvore compartilhada não tem `granted_by` em lugar nenhum, então nada pode
        // ser resgatado e as duas travessias precisam coincidir. Sem este caso, um
        // `fallenGrants` que resgatasse demais passaria despercebido nos casos abaixo.
        expect(ids(fallenGrants(ARVORE, 'A'))).toEqual(ids(descendantGrants(ARVORE, 'A')));
        expect(ids(fallenGrants(ARVORE, 'A'))).toEqual(['B', 'C', 'D', 'E']);
        expect(ids(fallenGrants(ARVORE, 'B'))).toEqual(['C', 'D']);
        expect(fallenGrants(ARVORE, 'D')).toEqual([]);

        // E o fecho ingênuo continua INTACTO: ele é o conjunto de exclusão de que
        // `fallenGrants` se alimenta, então uma "simplificação" que fizesse os dois
        // convergirem apagaria a própria pergunta.
        expect(ids(descendantGrants(ARVORE, 'A'))).toEqual(['B', 'C', 'D', 'E']);
    });

    // O caso do dono, na forma mínima: `admin` deu view_share a Bruno (AB) e Célia
    // também (CB, fora da poda). Bruno repassou a Davi (BD). Revogar AB não pode
    // derrubar BD, porque Bruno continua autorizado por CB.
    const RESGATE = [
        gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
        gp('CB', null, 'Bruno', 'u-Celia', 'view_share', 'u-Bruno'),
        gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        gp('DE', 'BD', 'Elza', 'u-Davi', 'view', 'u-Elza'),
    ];

    it('o descendente cujo concedente tem OUTRO view_share fora do fecho sai da lista, e a subárvore dele sai junto', () => {
        // Piso medido, não suposto: o fecho ingênuo continua vendo os dois.
        expect(ids(descendantGrants(RESGATE, 'AB'))).toEqual(['BD', 'DE']);
        // E o resgate tira os dois: BD porque Bruno tem CB, DE porque o servidor não
        // desce por um nó resgatado.
        expect(fallenGrants(RESGATE, 'AB')).toEqual([]);
    });

    it('se o outro view_share está DENTRO do fecho, o descendente CONTINUA na lista', () => {
        // Célia recebeu de Bruno (CB2 pendurado em AB), então o "outro caminho" cai
        // junto e não salva ninguém. Sem este caso, um filtro que removesse por
        // "existe outra linha do mesmo concedente" passaria verde.
        const DENTRO = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            gp('BC', 'AB', 'Celia', 'u-Bruno', 'view_share', 'u-Celia'),
            gp('CB2', 'BC', 'Bruno', 'u-Celia', 'view_share', 'u-Bruno'),
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(ids(fallenGrants(DENTRO, 'AB'))).toEqual(['BC', 'BD', 'CB2']);
        expect(ids(fallenGrants(DENTRO, 'AB'))).toEqual(ids(descendantGrants(DENTRO, 'AB')));
    });

    it('se o outro é `view` e não `view_share`, o descendente CONTINUA na lista', () => {
        // `view` não autoriza repassar, então ele não sustenta o repasse que já existe.
        // É o mesmo predicado que `grantResource` cobra para ACEITAR uma concessão.
        const SOVIEW = RESGATE.map((x) => (x.id === 'CB' ? { ...x, grant_level: 'view' } : x));
        expect(ids(fallenGrants(SOVIEW, 'AB'))).toEqual(['BD', 'DE']);
    });

    it('a própria RAIZ nunca serve de pai alternativo: ela também está caindo', () => {
        // Bruno recebeu duas vezes do admin, e uma delas É a raiz revogada. Se a raiz
        // entrasse no conjunto de "fora do alcance", revogá-la viraria um no-op — o
        // espelho da decisão (1) do servidor ("a âncora nunca é resgatada").
        const SOARAIZ = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(ids(fallenGrants(SOARAIZ, 'AB'))).toEqual(['BD']);
    });

    it('o resgate por GRUPO é invisível aqui, e o erro é para o lado seguro', () => {
        // O segundo view_share de Bruno chegou a um GRUPO de que ele participa. O
        // servidor resgata; o cliente NÃO tem a composição do grupo e conta como caído.
        // Este caso existe para que a limitação seja uma decisão registrada, e não uma
        // surpresa: se alguém um dia mandar o roster no payload, ele fica vermelho.
        const PORGRUPO = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            {
                id: 'XG', parent_grant_id: null, granted_by: 'u-Xavier', grant_level: 'view_share',
                grantee_id: null, grantee_group_id: 'g1', grantee_group_name: 'Equipe',
            },
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(ids(fallenGrants(PORGRUPO, 'AB'))).toEqual(['BD']);
    });

    it('o view_share de CONCEDENTE MORTO não resgata ninguém', () => {
        // O SERVIDOR EXIGE `fn_principal_vivo(granted_by)` NO PAI ALTERNATIVO (D8(b)), e
        // enquanto a listagem não mandava esse fato o cliente resgatava por uma linha que
        // o servidor recusa. O erro ia para o lado PERIGOSO num ato irreversível: o aviso
        // dizia "ninguém cai" e o toast seguinte contava uma queda. A listagem passou a
        // devolver `granted_by_vivo` e o resgate passou a exigi-lo.
        //
        // A LINHA MORTA CONTINUA NA LISTA de propósito — ela é revogável, e sumir da tela
        // seria pior. O que ela deixou de ser é caminho de acesso.
        const MORTO = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            { ...gp('ZB', null, 'Bruno', 'u-Zeca', 'view_share', 'u-Bruno'), granted_by_vivo: false },
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(ids(fallenGrants(MORTO, 'AB'))).toEqual(['BD']);

        // A DISCRIMINAÇÃO, mesma árvore e um campo de diferença: com o concedente VIVO o
        // mesmo Davi é resgatado. Sem esta metade, um `fallenGrants` que tivesse parado de
        // resgatar por completo passaria verde no caso acima.
        const VIVO = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            { ...gp('ZB', null, 'Bruno', 'u-Zeca', 'view_share', 'u-Bruno'), granted_by_vivo: true },
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(fallenGrants(VIVO, 'AB')).toEqual([]);
    });

    it('sem o campo `granted_by_vivo`, o comportamento é o de antes (servidor antigo)', () => {
        // A comparação é com `false`, e não um booleano nu: `undefined` significa "a
        // listagem não mandou o campo", e ali o certo é resgatar como antes em vez de
        // tratar toda linha como morta. Um `if (!g.granted_by_vivo)` faria o aviso
        // superestimar TUDO contra um servidor antigo, e este caso é o que o pega.
        const SEMCAMPO = [
            gp('AB', null, 'Bruno', 'u-admin', 'view_share', 'u-Bruno'),
            gp('ZB', null, 'Bruno', 'u-Zeca', 'view_share', 'u-Bruno'),
            gp('BD', 'AB', 'Davi', 'u-Bruno', 'view_share', 'u-Davi'),
        ];
        expect(SEMCAMPO[1].granted_by_vivo).toBeUndefined();
        expect(fallenGrants(SEMCAMPO, 'AB')).toEqual([]);
    });

    it('entrada degenerada devolve lista vazia, nunca erro', () => {
        expect(fallenGrants(RESGATE, null)).toEqual([]);
        expect(fallenGrants(RESGATE, 'nao-existe')).toEqual([]);
        expect(fallenGrants(null, 'AB')).toEqual([]);
        expect(fallenGrants([], 'AB')).toEqual([]);
    });

    it('o aviso do modal conta o RESGATADO fora: é a razão de a função existir', () => {
        // O elo entre a aritmética e a frase. Sem `fallenGrants` aqui, o modal diria
        // "2 pessoas perdem o acesso" sobre uma poda que não derruba ninguém.
        const texto = revocationWarning(RESGATE, 'AB');
        expect(texto).not.toContain('perde');
        expect(texto).toContain('Bruno');
        // E a discriminação, no mesmo par: com o outro caminho em `view`, a frase volta.
        const SOVIEW = RESGATE.map((x) => (x.id === 'CB' ? { ...x, grant_level: 'view' } : x));
        expect(revocationWarning(SOVIEW, 'AB')).toContain('2 pessoas perdem o acesso');
    });
});
