import { describe, it, expect } from 'vitest';
import {
    memberAddedByLabel,
    memberAdmissionTitle,
    groupDeletionWarning,
    groupsLoadFailureNotice,
    groupPickerEmptyNotice,
    groupPickerExhaustedNotice,
    newGroupEmptyHint,
    STALE_COUNTS_NOTICE,
} from '../../src/js/admin/group-phrases.js';

// AS FRASES QUE FALTAVAM NA ABA "GRUPOS" E NO SELETOR DE GRUPO DO CATÁLOGO.
//
// Três defeitos medidos em 2026-08-23, e os três eram de dado servido sem leitor ou de
// ausência sem causa declarada:
//
//   1. `LIST_MEMBERS` devolve `added_by` e `added_by_username` desde sempre, e o roster
//      desenhava só Pessoa/Posto/Entrou em: quem pôs alguém num grupo que decide acesso a
//      recurso privado chegava pela rede e morria sem leitor. As DUAS ausências possíveis
//      (`added_by` nulo, e `added_by` com a conta fora do `LEFT JOIN`) têm causas
//      diferentes e não podem colapsar numa frase só, nem virar "null" na tela.
//   2. O aviso de exclusão citava contagens da LISTAGEM, que é uma foto. A tela relê antes
//      de perguntar; quando a releitura falha, o número continua, com a ressalva. O que este
//      arquivo cobra é a DISCRIMINAÇÃO: a frase com ressalva é diferente da sem, em todo
//      ramo, senão um `countsStale` ignorado passaria verde em toda asserção de `toContain`.
//   3. O seletor de grupo sumia por falha de rede exatamente como sumia por não haver grupo,
//      e a dica de lista vazia mandava "crie um na página Grupos" — nome que só existe para
//      um dos quatro papéis globais. A porta agora é o rótulo de `adminAudience`.

describe('memberAddedByLabel — quem pôs a pessoa no grupo', () => {
    it('mostra o arroba quando o servidor mandou o usuário', () => {
        expect(memberAddedByLabel({ added_by: 'u1', added_by_username: 'ana' })).toBe('@ana');
    });

    it('DISCRIMINAÇÃO: sem registro nenhum e conta removida NÃO dizem a mesma coisa', () => {
        // Sem `added_by` é linha antiga (ou entrada por outro caminho): não houve registro.
        // COM `added_by` e sem nome de usuário houve alguém, e a conta é que saiu.
        const semRegistro = memberAddedByLabel({ added_at: '2026-01-01' });
        const contaRemovida = memberAddedByLabel({ added_by: 'u9' });
        expect(semRegistro).toBe('Não registrado');
        expect(contaRemovida).toBe('Conta removida');
        expect(semRegistro).not.toBe(contaRemovida);
    });

    it('nunca escreve "null" nem "undefined" na tela', () => {
        for (const membro of [null, undefined, {}, { added_by: null, added_by_username: null }]) {
            const texto = memberAddedByLabel(membro);
            expect(texto).not.toContain('null');
            expect(texto).not.toContain('undefined');
            expect(texto.length).toBeGreaterThan(0);
        }
    });

    it('usuário só de espaços conta como ausente, não vira "@   "', () => {
        expect(memberAddedByLabel({ added_by: 'u1', added_by_username: '   ' })).toBe('Conta removida');
    });
});

describe('memberAdmissionTitle — quem E quando, na mesma frase', () => {
    it('junta os dois quando existem os dois', () => {
        expect(memberAdmissionTitle({ added_by: 'u1', added_by_username: 'ana' }, '12/03/2026'))
            .toBe('Adicionado por @ana em 12/03/2026.');
    });

    it('o travessão da tela conta como data ausente, e não vira "em —"', () => {
        // `formatDate` escreve '—' para data ausente ou não parseável; a frase precisa
        // reconhecer esse valor, senão o `title` lê "Adicionado por @ana em —".
        const frase = memberAdmissionTitle({ added_by: 'u1', added_by_username: 'ana' }, '—');
        expect(frase).toBe('Adicionado por @ana, em data não registrada.');
        expect(frase).not.toContain('—');
        expect(memberAdmissionTitle({ added_by: 'u1', added_by_username: 'ana' }, ''))
            .toBe('Adicionado por @ana, em data não registrada.');
    });

    it('sem quem, a frase fala da data E diz que a autoria não foi registrada', () => {
        const frase = memberAdmissionTitle({}, '12/03/2026');
        expect(frase).toContain('12/03/2026');
        expect(frase).toContain('não ficou registrado');
    });

    it('sem nada, diz que não há registro de nenhum dos dois', () => {
        expect(memberAdmissionTitle(null, undefined))
            .toBe('Não há registro de quem adicionou nem de quando.');
    });

    it('a conta removida aparece na frase, em vez de sumir como "sem registro"', () => {
        const frase = memberAdmissionTitle({ added_by: 'u9' }, '12/03/2026');
        expect(frase).toContain('já removida');
        expect(frase).toContain('12/03/2026');
        expect(frase).not.toBe(memberAdmissionTitle({}, '12/03/2026'));
    });
});

describe('groupDeletionWarning — contador fresco contra contador defasado', () => {
    it('sem a opção, a frase é EXATAMENTE a de antes (releitura bem-sucedida)', () => {
        const grupo = { name: 'G', member_count: 4, grant_count: 2, atlas_share_count: 1 };
        expect(groupDeletionWarning(grupo)).toBe(groupDeletionWarning(grupo, {}));
        expect(groupDeletionWarning(grupo)).not.toContain('defasados');
        expect(groupDeletionWarning(grupo, { countsStale: false })).not.toContain('defasados');
    });

    it('DISCRIMINAÇÃO: a releitura falhada acrescenta a ressalva, sem apagar o número', () => {
        // O número continua sendo a melhor estimativa; escondê-lo deixaria o aviso mudo sobre
        // o alcance, que é a única coisa que ele existe para dizer.
        const grupo = { name: 'G', member_count: 4, grant_count: 2, atlas_share_count: 1 };
        const defasado = groupDeletionWarning(grupo, { countsStale: true });
        expect(defasado).not.toBe(groupDeletionWarning(grupo));
        expect(defasado).toContain('2 recursos e 1 atlas');
        expect(defasado).toContain(STALE_COUNTS_NOTICE);
    });

    it('a ressalva alcança TODOS os ramos, o do grupo inócuo inclusive', () => {
        // É o ramo mais perigoso da combinação: "não tem membros, concessões nem atlas" lido
        // sobre número não confirmado convida a apagar um grupo que talvez conceda alguma coisa.
        const ramos = [
            { name: 'Vazio', member_count: 0, grant_count: 0, atlas_share_count: 0 },
            { name: 'A', member_count: 5, grant_count: 0, atlas_share_count: 0 },
            { name: 'B', member_count: 0, grant_count: 3, atlas_share_count: 0 },
            { name: 'C', member_count: 4, grant_count: 2, atlas_share_count: 3 },
        ];
        for (const grupo of ramos) {
            const frase = groupDeletionWarning(grupo, { countsStale: true });
            expect(frase).toContain(STALE_COUNTS_NOTICE);
            expect(frase).not.toBe(groupDeletionWarning(grupo));
            expect(frase).not.toContain('undefined');
        }
    });

    it('a ressalva não inventa número nenhum', () => {
        expect(STALE_COUNTS_NOTICE).not.toMatch(/\d/);
    });
});

describe('groupsLoadFailureNotice — falha de rede não é lista vazia', () => {
    it('nomeia a causa como consulta ao servidor, e não como ausência de grupos', () => {
        const frase = groupsLoadFailureNotice();
        expect(frase).toContain('servidor');
        expect(frase).toContain('não ausência de grupos');
    });

    it('DISCRIMINAÇÃO: ela é diferente da frase de lista vazia, em toda porta', () => {
        // O defeito era as duas ausências terem a MESMA aparência (o seletor sumia). Duas
        // frases iguais aqui reproduziriam o defeito com mais código.
        for (const porta of ['Administração', 'Catálogo', 'Grupos', null]) {
            expect(groupsLoadFailureNotice()).not.toBe(groupPickerEmptyNotice(porta));
        }
    });
});

describe('groupPickerEmptyNotice / groupPickerExhaustedNotice — a porta é o rótulo, não um nome fixo', () => {
    it('nomeia a porta que aquele principal de fato vê', () => {
        expect(groupPickerEmptyNotice('Administração')).toContain('em Administração');
        expect(groupPickerEmptyNotice('Catálogo')).toContain('em Catálogo');
        expect(groupPickerExhaustedNotice('Grupos')).toContain('em Grupos');
    });

    it('NENHUMA delas manda para a "página Grupos" fixa, que era o rótulo errado para dois papéis', () => {
        // O texto anterior dizia "crie um na página Grupos" para todo mundo, e a porta se chama
        // "Administração" para o administrador e "Catálogo" para o produtor.
        expect(groupPickerEmptyNotice('Administração')).not.toContain('página Grupos');
        expect(groupPickerExhaustedNotice('Catálogo')).not.toContain('página Grupos');
    });

    it('sem porta, a remissão some em vez de virar "em null"', () => {
        for (const frase of [groupPickerEmptyNotice(null), groupPickerExhaustedNotice(undefined)]) {
            expect(frase).not.toContain('null');
            expect(frase).not.toContain('undefined');
            expect(frase).not.toContain(' em .');
        }
        expect(groupPickerEmptyNotice(null)).toContain('Crie um aqui mesmo');
    });

    it('DISCRIMINAÇÃO: vazio e esgotado dizem coisas diferentes', () => {
        // "não tenho grupo" e "todos os meus grupos já receberam" levam a ações diferentes.
        expect(groupPickerEmptyNotice('Grupos')).not.toBe(groupPickerExhaustedNotice('Grupos'));
        expect(groupPickerExhaustedNotice('Grupos')).toContain('já receberam este recurso');
    });
});

describe('newGroupEmptyHint — o grupo novo não alcança ninguém ainda', () => {
    it('diz que o grupo nasce vazio e onde se põem pessoas nele', () => {
        const frase = newGroupEmptyHint('Administração');
        expect(frase).toContain('nasce vazio');
        expect(frase).toContain('em Administração');
    });

    it('sem porta, continua avisando do vazio e não cita porta nenhuma', () => {
        const frase = newGroupEmptyHint(null);
        expect(frase).toContain('nasce vazio');
        expect(frase).not.toContain('null');
        expect(frase).not.toContain('Ponha pessoas nele em');
    });
});
