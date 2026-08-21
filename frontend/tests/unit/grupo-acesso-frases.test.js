import { describe, it, expect } from 'vitest';
import {
    toCount,
    peopleLabel,
    resourceLabel,
    atlasLabel,
    reachPhrase,
    groupReach,
    groupDeletionWarning,
    groupDeletionSummary,
    memberRemovalWarning,
    memberRemovalSummary,
    groupOwnerLabel,
    memberDisplayName,
} from '../../src/js/admin/group-phrases.js';

// AS FRASES DA ABA "GRUPOS".
//
// Apagar um grupo REVOGA tudo o que ele concedia, e é a consequência que ninguém
// adivinha: a pessoa acha que está limpando uma lista e está tirando acesso. O aviso
// só vale se disser QUANTAS pessoas e QUANTO acesso caem, e essa aritmética é o
// que este arquivo prende.
//
// O ALCANCE TEM DOIS EIXOS desde D2 (2026-08-21): concessões de RECURSO e acesso a
// ATLAS (`atlas_shares.group_id`). O aviso contava só o primeiro, isto é, avisava de
// MENOS sobre um ato irreversível. A DISCRIMINAÇÃO que este arquivo cobra é que a frase
// COM atlas seja diferente da frase SEM, em cada ramo — sem isso, um `atlas_share_count`
// ignorado passaria verde em toda asserção de `toContain`.
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

describe('atlasLabel — o eixo que faltava', () => {
    it('"atlas" é invariável: o número muda, a palavra não', () => {
        expect(atlasLabel(1)).toBe('1 atlas');
        expect(atlasLabel('1')).toBe('1 atlas');
        expect(atlasLabel(4)).toBe('4 atlas');
        expect(atlasLabel(0)).toBe('0 atlas');
    });

    it('lixo da rede vira zero, como nos irmãos', () => {
        expect(atlasLabel(undefined)).toBe('0 atlas');
        expect(atlasLabel('abc')).toBe('0 atlas');
        expect(atlasLabel(-3)).toBe('0 atlas');
    });
});

describe('reachPhrase — os sintagmas não-vazios, compostos', () => {
    it('junta os dois eixos com "e" quando os dois existem', () => {
        expect(reachPhrase(2, 1)).toBe('2 recursos e 1 atlas');
        expect(reachPhrase('2', '1')).toBe('2 recursos e 1 atlas');
    });

    it('DISCRIMINAÇÃO: o eixo zerado SOME, em vez de virar "0 recursos"', () => {
        // É esta omissão que impede as oito combinações de virarem oito frases escritas
        // à mão em `groupDeletionWarning`.
        expect(reachPhrase(3, 0)).toBe('3 recursos');
        expect(reachPhrase(0, 3)).toBe('3 atlas');
        expect(reachPhrase(3, 0)).not.toContain('atlas');
        expect(reachPhrase(0, 3)).not.toContain('recurso');
    });

    it('sem alcance nenhum devolve string VAZIA, que é o sinal que o chamador testa', () => {
        expect(reachPhrase(0, 0)).toBe('');
        expect(reachPhrase(undefined, undefined)).toBe('');
        expect(reachPhrase(null, 'lixo')).toBe('');
    });
});

describe('groupReach — a linha de alcance', () => {
    it('junta as TRÊS contagens', () => {
        expect(groupReach({ member_count: 3, grant_count: 1, atlas_share_count: 2 }))
            .toBe('3 pessoas · 1 recurso · 2 atlas');
    });

    it('DISCRIMINAÇÃO: o eixo de atlas muda a linha, e ele não some quando é zero', () => {
        // Aqui, ao contrário de `reachPhrase`, o zero APARECE: é o painel de estado de um
        // grupo aberto, e "0 atlas" responde a pergunta que a pessoa está fazendo.
        const com = groupReach({ member_count: 3, grant_count: 1, atlas_share_count: 2 });
        const sem = groupReach({ member_count: 3, grant_count: 1 });
        expect(com).not.toBe(sem);
        expect(sem).toBe('3 pessoas · 1 recurso · 0 atlas');
    });

    it('grupo sem nenhum dos três não quebra', () => {
        expect(groupReach({})).toBe('0 pessoas · 0 recursos · 0 atlas');
        expect(groupReach(null)).toBe('0 pessoas · 0 recursos · 0 atlas');
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

    it('o ramo alto GANHA a menção aos repasses derivados, que não têm número', () => {
        // A cascata é a metade da consequência que a listagem não sabe contar: ela conhece as
        // concessões DIRETAS, e apagar derruba também o que os membros repassaram a partir
        // delas. Sem esta frase, o número anunciado seria menor que o efeito.
        const frase = groupDeletionWarning({ name: 'G', member_count: 4, grant_count: 2 });
        expect(frase).toContain('repasses');
        // E não inventa uma contagem para a subárvore, que só o servidor conhece depois do ato.
        expect(frase).not.toMatch(/\d+ repasses/);
    });

    it('DISCRIMINAÇÃO: os ramos sem concessão viva NÃO anunciam cascata', () => {
        // Sem concessão ao grupo não existe repasse pendurado nele, e prometer uma queda
        // impossível gasta a credibilidade da frase alta no caso em que ela é alta.
        expect(groupDeletionWarning({ name: 'Vazio', member_count: 0, grant_count: 0 }))
            .not.toContain('repasses');
        expect(groupDeletionWarning({ name: 'A', member_count: 5, grant_count: 0 }))
            .not.toContain('repasses');
        // O ramo sem membros também não: quem repassa é membro.
        expect(groupDeletionWarning({ name: 'B', member_count: 0, grant_count: 3 }))
            .not.toContain('repasses');
    });

    it('as contagens em string produzem a MESMA frase que as numéricas', () => {
        // O controle negativo do módulo inteiro: sem `toCount`, esta é a asserção que cai.
        expect(groupDeletionWarning({ name: 'G', member_count: '1', grant_count: '1' }))
            .toBe(groupDeletionWarning({ name: 'G', member_count: 1, grant_count: 1 }));
        expect(groupDeletionWarning({ name: 'G', member_count: '1', grant_count: '1' }))
            .toContain('1 pessoa a 1 recurso');
    });

    it('grupo vazio diz que é inócuo, em vez de "0 pessoas a 0 recursos"', () => {
        const frase = groupDeletionWarning({
            name: 'Vazio', member_count: 0, grant_count: 0, atlas_share_count: 0,
        });
        expect(frase).toContain('não tem membros, concessões nem atlas');
        expect(frase).not.toContain('0 pessoas');
        expect(frase).not.toContain('0 atlas');
    });

    it('sem alcance, o aviso fala só das pessoas; sem membros, só do alcance', () => {
        const semAlcance = groupDeletionWarning({ name: 'A', member_count: 5, grant_count: 0 });
        expect(semAlcance).toContain('5 pessoas');
        expect(semAlcance).toContain('não dá acesso a nenhum recurso nem atlas');

        const semGente = groupDeletionWarning({ name: 'B', member_count: 0, grant_count: 3 });
        expect(semGente).toContain('3 recursos');
        expect(semGente).toContain('não tem membros');
    });

    it('O EIXO DE ATLAS entra no aviso, e a frase COM atlas difere da SEM', () => {
        // O piso desta tarefa: enquanto `atlas_share_count` era ignorado, as duas frases
        // eram idênticas e toda asserção de `toContain` passava verde sobre um aviso que
        // omitia metade do ato.
        const com = groupDeletionWarning({
            name: 'G', member_count: 4, grant_count: 2, atlas_share_count: 3,
        });
        const sem = groupDeletionWarning({ name: 'G', member_count: 4, grant_count: 2 });
        expect(com).not.toBe(sem);
        expect(com).toContain('2 recursos e 3 atlas');
        expect(sem).not.toContain('atlas');
    });

    it('grupo que SÓ alcança atlas: o aviso é alto e NÃO fala de recurso', () => {
        // A combinação que a versão anterior lia como grupo inócuo ("não concede acesso a
        // nenhum recurso hoje"), enquanto apagá-lo tirava N atlas de todo o coletivo.
        const frase = groupDeletionWarning({
            name: 'Só atlas', member_count: 4, grant_count: 0, atlas_share_count: 2,
        });
        expect(frase).toContain('4 pessoas');
        expect(frase).toContain('2 atlas');
        expect(frase).not.toContain('recurso');
        expect(frase).not.toContain('nada muda');
        // E a cascata NÃO aparece: repasse é a aresta de `resource_grants`, e um grupo sem
        // concessão viva não tem subárvore pendurada nele.
        expect(frase).not.toContain('repasses');
    });

    it('grupo SEM membros que alcança atlas continua no ramo de alcance', () => {
        const frase = groupDeletionWarning({
            name: 'B', member_count: 0, grant_count: 0, atlas_share_count: 5,
        });
        expect(frase).toContain('5 atlas');
        expect(frase).toContain('não tem membros');
        expect(frase).not.toContain('não tem membros, concessões nem atlas');
    });

    it('CONCORDÂNCIA: a cascata acompanha o número de pessoas', () => {
        // "1 pessoa (...) os repasses que elas fizeram" era a mesma classe de deslize que
        // `toCount` existe para impedir do outro lado.
        expect(groupDeletionWarning({ name: 'G', member_count: 1, grant_count: 1 }))
            .toContain('que ela fez a partir dele');
        expect(groupDeletionWarning({ name: 'G', member_count: 2, grant_count: 1 }))
            .toContain('que elas fizeram a partir dele');
    });

    it('as contagens de atlas em string produzem a MESMA frase que as numéricas', () => {
        expect(groupDeletionWarning({ name: 'G', member_count: 2, grant_count: 1, atlas_share_count: '1' }))
            .toBe(groupDeletionWarning({ name: 'G', member_count: 2, grant_count: 1, atlas_share_count: 1 }));
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

    it('os atlas saem em frase PRÓPRIA, porque não são linhas revogadas', () => {
        // Somar os dois daria um total que não corresponde a nada no banco: a concessão
        // cai por escrita, o atlas cai por predicado, sem linha alterada.
        expect(groupDeletionSummary({ name: 'X', grantsAffected: 7, atlasShares: 2 }))
            .toBe('Grupo "X" apagado. Concessões revogadas: 7. Atlas fora do alcance: 2.');
        expect(groupDeletionSummary({ name: 'X', grantsAffected: 0, atlasShares: '2' }))
            .toBe('Grupo "X" apagado. Atlas fora do alcance: 2.');
    });

    it('DISCRIMINAÇÃO: zero atlas não vira frase, como o zero de concessões', () => {
        expect(groupDeletionSummary({ name: 'X', grantsAffected: 7, atlasShares: 0 }))
            .toBe('Grupo "X" apagado. Concessões revogadas: 7.');
        expect(groupDeletionSummary({ name: 'X', atlasShares: 0 })).toBe('Grupo "X" apagado.');
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

describe('memberRemovalWarning — o aviso antes de tirar alguém', () => {
    it('nomeia o que ela perde E que os repasses dela por este grupo caem', () => {
        const frase = memberRemovalWarning({ name: 'G', grant_count: 2 });
        expect(frase).toContain('2 recursos');
        expect(frase).toContain('repassou');
    });

    it('DISCRIMINAÇÃO: grupo sem alcance nenhum diz que nada muda, e não anuncia cascata', () => {
        const frase = memberRemovalWarning({ name: 'G', grant_count: 0, atlas_share_count: 0 });
        expect(frase).toContain('nada muda');
        expect(frase).not.toContain('repassou');
    });

    it('o eixo de ATLAS também sai daqui: tirar a pessoa tira o atlas do grupo', () => {
        const so = memberRemovalWarning({ name: 'G', grant_count: 0, atlas_share_count: 2 });
        expect(so).toContain('2 atlas');
        expect(so).not.toContain('nada muda');
        // Sem concessão viva não há repasse pendurado: a cascata continua presa ao eixo
        // de recurso, e prometê-la aqui descreveria uma queda impossível.
        expect(so).not.toContain('repassou');

        const ambos = memberRemovalWarning({ name: 'G', grant_count: 2, atlas_share_count: 1 });
        expect(ambos).toContain('2 recursos e 1 atlas');
        expect(ambos).toContain('repassou');
        expect(ambos).not.toBe(memberRemovalWarning({ name: 'G', grant_count: 2 }));
    });

    it('a contagem em string produz a MESMA frase que a numérica', () => {
        expect(memberRemovalWarning({ grant_count: '1' })).toBe(memberRemovalWarning({ grant_count: 1 }));
        expect(memberRemovalWarning({ grant_count: '1' })).toContain('1 recurso ');
    });

    it('grupo ausente não vira "undefined" nem promete cascata', () => {
        expect(memberRemovalWarning(null)).toContain('nada muda');
        expect(memberRemovalWarning(null)).not.toContain('undefined');
    });
});

describe('memberRemovalSummary — o que o servidor disse que caiu ao tirar a pessoa', () => {
    it('reporta o grantsAffected do servidor, inclusive em string', () => {
        expect(memberRemovalSummary({ name: 'Cap Ana', grantsAffected: 3 }))
            .toBe('Cap Ana saiu do grupo. Concessões revogadas: 3.');
        expect(memberRemovalSummary({ name: 'Cap Ana', grantsAffected: '3' }))
            .toBe('Cap Ana saiu do grupo. Concessões revogadas: 3.');
    });

    it('DISCRIMINAÇÃO: zero não anuncia revogação nenhuma (é o caso comum)', () => {
        expect(memberRemovalSummary({ name: 'Cap Ana', grantsAffected: 0 })).toBe('Cap Ana saiu do grupo.');
        expect(memberRemovalSummary({ name: 'Cap Ana' })).toBe('Cap Ana saiu do grupo.');
    });
});

describe('groupOwnerLabel — a única pessoa nomeada na seção "grupos de que participo"', () => {
    it('nome e usuário juntos quando há os dois', () => {
        expect(groupOwnerLabel({ owner_id: 'u1', owner_nome: 'Ana Lima', owner_username: 'ana' }))
            .toBe('Dono: Ana Lima (@ana)');
    });

    it('cai para o que existir, sem deixar parênteses vazios nem arroba solta', () => {
        expect(groupOwnerLabel({ owner_id: 'u1', owner_nome: 'Ana Lima' })).toBe('Dono: Ana Lima');
        expect(groupOwnerLabel({ owner_id: 'u1', owner_username: 'ana' })).toBe('Dono: @ana');
        expect(groupOwnerLabel({ owner_id: 'u1', owner_nome: '   ', owner_username: 'ana' }))
            .toBe('Dono: @ana');
    });

    it('grupo órfão diz que não tem dono, em vez de um travessão', () => {
        // Estado real: o backfill adotou `created_by`, que pode ser nulo em linha antiga. Quem
        // lê "sem dono definido" sabe que só o administrador do sistema administra aquele grupo.
        expect(groupOwnerLabel({ owner_id: null })).toBe('Sem dono definido');
        expect(groupOwnerLabel(null)).toBe('Sem dono definido');
        expect(groupOwnerLabel({})).not.toContain('undefined');
    });
});
