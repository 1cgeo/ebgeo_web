// Path: tests/unit/grupo-acesso-alcance-ao-adicionar.test.js

/**
 * @fileoverview O LOTE DE 2026-08-24 NA ABA "GRUPOS": as bordas que a tela desenhava como nada, e
 * o ato que não relatava.
 *
 * A SIMETRIA ESTAVA INVERTIDA, e é isso que a primeira seção prende. Apagar o grupo e tirar um
 * membro tinham confirmação com o alcance e toast com o número do servidor; ADICIONAR alguém dizia
 * só "Fulano entrou no grupo". Do ponto de vista do eixo de acesso é o contrário: pôr alguém num
 * grupo que já recebeu sete recursos privados é conceder sete acessos de uma vez, sem passar pelo
 * gate de repasse e sem uma linha nova em `resource_grants` para alguém revisar depois. A tabela ao
 * lado mostrava esse número na coluna "Recursos" e a frase de sucesso não o mencionava.
 *
 * SEM CONFIRMAÇÃO PRÉVIA, e o teste NÃO cobra uma: adicionar é reversível (o botão "Remover" está
 * na linha seguinte), e confirmar tudo treina a pessoa a atravessar confirmação sem ler, o que
 * gasta a credibilidade das duas confirmações destrutivas irmãs.
 *
 * AS BORDAS SÃO A SEGUNDA METADE. Três desfechos de `leaveGroupAvailability` e dois desenhados; a
 * recusa ao dono só no `title` (que não existe no toque); e uma coluna que responde "eu" em toda
 * linha para quem não é administrador. As três têm a mesma raiz, que é a lição mais repetida desta
 * aba: espaço vazio, e informação constante, se leem como tela quebrada.
 */

import { describe, it, expect } from 'vitest';
import {
    STALE_COUNTS_NOTICE,
    groupOwnerCannotLeaveNotice,
    groupOwnerCannotLeaveShort,
    groupTableColumns,
    leaveAvailabilityUnknownNotice,
    memberAdditionSummary,
    memberRemovalWarning,
} from '../../src/js/admin/group-phrases.js';

describe('memberAdditionSummary — adicionar é conceder, e agora relata', () => {
    it('cita os DOIS eixos de alcance do grupo', () => {
        expect(memberAdditionSummary({ name: 'Ana' }, { grant_count: 7, atlas_share_count: 2 }))
            .toBe('Ana entrou no grupo, e com isso passa a ver 7 recursos e 2 atlas.');
    });

    it('o eixo zerado não aparece: o alcance é composto, não enumerado', () => {
        expect(memberAdditionSummary({ name: 'Ana' }, { grant_count: 3, atlas_share_count: 0 }))
            .toBe('Ana entrou no grupo, e com isso passa a ver 3 recursos.');
        expect(memberAdditionSummary({ name: 'Ana' }, { grant_count: 0, atlas_share_count: 1 }))
            .toBe('Ana entrou no grupo, e com isso passa a ver 1 atlas.');
    });

    it('concorda em número, inclusive vindo o COUNT como string do node-postgres', () => {
        // A classe de bug que `toCount` existe para impedir: "1 recursos" no instante em que o
        // valor chega como '1'. Esta frase é nova, então é agora que ela paga ou não paga.
        expect(memberAdditionSummary({ name: 'Ana' }, { grant_count: '1', atlas_share_count: '0' }))
            .toBe('Ana entrou no grupo, e com isso passa a ver 1 recurso.');
    });

    it('grupo que não alcança nada DIZ isso, em vez de omitir a metade', () => {
        // Omitir deixaria a frase idêntica à de antes do conserto, e "Ana entrou no grupo" sozinho
        // é justamente o que se está corrigindo: a pessoa não saberia se o grupo alcança algo.
        expect(memberAdditionSummary({ name: 'Ana' }, { grant_count: 0, atlas_share_count: 0 }))
            .toBe('Ana entrou no grupo. Ele não dá acesso a nenhum recurso nem atlas hoje.');
        expect(memberAdditionSummary({ name: 'Ana' }, undefined))
            .toBe('Ana entrou no grupo. Ele não dá acesso a nenhum recurso nem atlas hoje.');
    });

    it('a resposta IDEMPOTENTE não anuncia alcance nenhum', () => {
        // `added: false` é "já estava lá": este clique não concedeu nada, e dizer que ela "passa a
        // ver 7 recursos" afirmaria uma mudança que não houve.
        const frase = memberAdditionSummary(
            { name: 'Ana', added: false }, { grant_count: 7, atlas_share_count: 2 },
        );
        expect(frase).toBe('Ana já estava no grupo.');
        expect(frase).not.toMatch(/\d/);
    });

    it('`added` ausente cai no ramo do ato realizado, não no da negativa', () => {
        // Comparação com `=== false` e não `!added`: um servidor que não mande o campo tem de cair
        // no caminho normal. É a mesma regra de `leaveGroupSummary`.
        expect(memberAdditionSummary({ name: 'Ana', added: undefined }, { grant_count: 1 }))
            .toMatch(/entrou no grupo/);
        expect(memberAdditionSummary({ name: 'Ana', added: true }, { grant_count: 1 }))
            .toMatch(/entrou no grupo/);
    });

    it('sem nome nenhum a frase não vira "undefined entrou no grupo"', () => {
        expect(memberAdditionSummary({}, {})).toBe(' entrou no grupo. Ele não dá acesso a nenhum recurso nem atlas hoje.');
        expect(memberAdditionSummary(null, null)).toMatch(/^ entrou no grupo/);
    });
});

describe('memberRemovalWarning — a ressalva de número defasado, que faltava', () => {
    it('sem ressalva o texto continua o de antes', () => {
        const aviso = memberRemovalWarning({ grant_count: 2, atlas_share_count: 1 });
        expect(aviso).toContain('2 recursos e 1 atlas');
        expect(aviso).not.toContain(STALE_COUNTS_NOTICE);
    });

    it('com a releitura falhada, o número sai com a ressalva colada', () => {
        // Número velho apresentado como fresco é a verificação fantasma que cabe numa confirmação
        // destrutiva: a frase é precisa, e está errada.
        const aviso = memberRemovalWarning(
            { grant_count: 2, atlas_share_count: 1 }, { countsStale: true },
        );
        expect(aviso).toContain(STALE_COUNTS_NOTICE);
        expect(aviso).toContain('2 recursos e 1 atlas');
    });

    it('a ressalva alcança TAMBÉM o ramo sem alcance nenhum', () => {
        // O ramo que diz "nada muda para ela agora" é justamente o que mais custa se o número
        // estiver velho: ele afirma que o ato é inócuo.
        const aviso = memberRemovalWarning({ grant_count: 0, atlas_share_count: 0 }, { countsStale: true });
        expect(aviso).toMatch(/nada muda para ela agora/);
        expect(aviso).toContain(STALE_COUNTS_NOTICE);
    });

    it('a cascata continua presa ao eixo de RECURSO, e a ressalva não a inventa', () => {
        // `atlas_shares` não tem subárvore: prometer queda de repasse ali seria prometer um efeito
        // impossível. A opção nova não pode ter mexido nisso.
        const soAtlas = memberRemovalWarning({ grant_count: 0, atlas_share_count: 3 }, { countsStale: true });
        expect(soAtlas).not.toMatch(/repassou/);
        expect(memberRemovalWarning({ grant_count: 1, atlas_share_count: 0 })).toMatch(/repassou/);
    });
});

describe('as duas notas que ocupam o lugar do botão "Sair"', () => {
    it('a recusa ao DONO tem uma versão curta com a SAÍDA dentro', () => {
        const curta = groupOwnerCannotLeaveShort();
        // A metade que sobrevive ao corte é a acionável: `title` não existe no toque nem para quem
        // navega por teclado, então o texto visível tem de dizer o que fazer.
        expect(curta).toMatch(/apague o grupo/i);
        expect(curta).toContain('dono');
        // Curta de verdade: ela vive dentro de uma célula de ações, ao lado de botões.
        expect(curta.length).toBeLessThan(60);
        // E a longa continua existindo, para o `title`: as duas não são a mesma string.
        expect(curta).not.toBe(groupOwnerCannotLeaveNotice());
        expect(groupOwnerCannotLeaveNotice().length).toBeGreaterThan(curta.length);
    });

    it('a longa NÃO oferece transferência de posse, que não existe no servidor', () => {
        // Uma saída inexistente é pior que um muro. Não há rota de transferência de grupo.
        expect(groupOwnerCannotLeaveNotice()).not.toMatch(/transfir|transfer/i);
    });

    it('o ramo INDETERMINADO não acusa posse nem promete o ato', () => {
        const nota = leaveAvailabilityUnknownNotice();
        // Dizer "você é o dono" afirmaria uma posse que ninguém mediu; oferecer o botão terminaria
        // num 409 na cara de quem clicou. A tela sabe que não sabe, e diz.
        expect(nota).not.toMatch(/^Você é o dono/);
        expect(nota).toMatch(/não conseguiu ler quem é você/);
        // E oferece a saída real, que é recarregar.
        expect(nota).toMatch(/[Rr]ecarregue/);
        expect(nota).not.toBe(groupOwnerCannotLeaveNotice());
    });
});

describe('groupTableColumns — a coluna "Dono" é do administrador', () => {
    it('o administrador vê a coluna, porque só ele vê grupo alheio', () => {
        expect(groupTableColumns({ isAdmin: true }))
            .toEqual(['Grupo', 'Membros', 'Recursos', 'Atlas', 'Dono', '']);
    });

    it('quem não é administrador não vê: a resposta seria "eu" em toda linha', () => {
        expect(groupTableColumns({ isAdmin: false }))
            .toEqual(['Grupo', 'Membros', 'Recursos', 'Atlas', '']);
        // Falha FECHADO: sem argumento nenhum, a coluna não aparece.
        expect(groupTableColumns()).toEqual(groupTableColumns({ isAdmin: false }));
    });

    it('a diferença é EXATAMENTE uma coluna, e é a do dono', () => {
        // Asserção de discriminação: um recorte quebrado que devolvesse a mesma lista para os dois
        // passaria verde nas duas asserções acima se elas fossem só `toContain`.
        const admin = groupTableColumns({ isAdmin: true });
        const comum = groupTableColumns({ isAdmin: false });
        expect(admin).toHaveLength(comum.length + 1);
        expect(admin.filter((c) => !comum.includes(c) || c === 'Dono')).toEqual(['Dono']);
    });

    it('a última coluna é a de AÇÕES, sem rótulo, nos dois recortes', () => {
        // O cabeçalho de uma coluna de botões é ruído para leitor de tela; o que não pode é a
        // contagem do cabeçalho divergir da das células, e é por isso que a lista sai daqui inteira.
        for (const isAdmin of [true, false]) {
            expect(groupTableColumns({ isAdmin }).at(-1), String(isAdmin)).toBe('');
        }
    });

    it('cada chamada devolve um array próprio: filtrar o de um chamador não contamina o outro', () => {
        const primeiro = groupTableColumns({ isAdmin: true });
        primeiro.length = 0;
        expect(groupTableColumns({ isAdmin: true })).toHaveLength(6);
    });
});
