// Path: tests/unit/sharing-modal-grupos.test.js
//
// A PARTE VERIFICÁVEL EM NODE do modal de compartilhar atlas depois que ele ganhou o eixo
// de GRUPO: a forma do payload e as três frases puras.
//
// POR QUE ELAS FORAM EXTRAÍDAS. `_load()` fazia parse e render juntos, então NADA da forma
// do payload tinha cobertura — e o payload acabou de ganhar um segundo array. Um cliente
// novo também pode falar com um servidor que ainda não conhece o eixo (implantação em duas
// etapas), e é a ausência da chave `groups` que precisa degradar para lista vazia em vez de
// derrubar a tela.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA, e está dito aqui para ninguém confundir verde com pronto:
// render, listeners, o seletor e a ordem das seções só se verificam por captura do
// Playwright, que fica FORA do `npm test`.

import { describe, it, expect } from 'vitest';
import {
    partitionSharingConfig,
    sharingGroupOwnerLabel,
    sharingGroupSizeLabel,
    selectableGroups,
    groupLevelOptions,
} from '../../src/js/modals/sharing.modal.js';

const pessoa = { userId: 'u1', username: 'ana', nome: 'Ana Lima', permission: 'write', addedAt: 'x' };
const grupo = {
    groupId: 'g1', name: 'Equipe Alfa', permission: 'read', addedAt: 'x',
    memberCount: 3, ownerId: 'u9', ownerUsername: 'bruno', ownerNome: 'Bruno Sá',
};

describe('partitionSharingConfig', () => {
    it('PISO: separa os dois arrays de um payload novo', () => {
        const out = partitionSharingConfig({
            isPublic: true, publicLink: 'https://x/y', owner: { userId: 'u0' },
            shares: [pessoa], groups: [grupo],
        });
        expect(out.isPublic).toBe(true);
        expect(out.publicLink).toBe('https://x/y');
        expect(out.owner).toEqual({ userId: 'u0' });
        expect(out.shares).toHaveLength(1);
        expect(out.groups).toHaveLength(1);
        expect(out.groups[0].groupId).toBe('g1');
    });

    it('servidor ANTIGO (sem a chave `groups`) devolve [] e preserva `shares` intacto', () => {
        const cfg = { isPublic: false, publicLink: null, shares: [pessoa] };
        const out = partitionSharingConfig(cfg);
        expect(out.groups).toEqual([]);
        // VERBATIM: a mesma referência de item, sem filtrar e sem reordenar. Se algum dia
        // alguém ordenar aqui, cria-se uma segunda ordem que a próxima tela terá de repetir.
        expect(out.shares).toEqual([pessoa]);
        expect(out.shares[0]).toBe(pessoa);
    });

    it('DISCRIMINAÇÃO: `owner` ausente continua null, e não vira {}', () => {
        expect(partitionSharingConfig({ shares: [], groups: [] }).owner).toBeNull();
        expect(partitionSharingConfig(null).owner).toBeNull();
    });

    it('DISCRIMINAÇÃO: valor não-array em qualquer dos dois vira [], nunca lança', () => {
        const out = partitionSharingConfig({ shares: 'nao-e-array', groups: { g: 1 } });
        expect(out.shares).toEqual([]);
        expect(out.groups).toEqual([]);
        expect(partitionSharingConfig(undefined)).toEqual({
            isPublic: false, publicLink: null, owner: null, shares: [], groups: [],
        });
    });

    it('`isPublic` é BOOLEANO mesmo quando o servidor manda outra coisa', () => {
        expect(partitionSharingConfig({ isPublic: 1 }).isPublic).toBe(true);
        expect(partitionSharingConfig({ isPublic: null }).isPublic).toBe(false);
    });
});

describe('sharingGroupOwnerLabel — a mitigação que torna a delegação visível', () => {
    it('nome e usuário juntos', () => {
        expect(sharingGroupOwnerLabel(grupo)).toBe('Dono: Bruno Sá (@bruno)');
    });

    it('cada metade sozinha ainda informa', () => {
        expect(sharingGroupOwnerLabel({ ownerNome: 'Bruno Sá' })).toBe('Dono: Bruno Sá');
        expect(sharingGroupOwnerLabel({ ownerUsername: 'bruno' })).toBe('Dono: @bruno');
    });

    it('grupo ÓRFÃO diz isso por extenso, e não vira frase vazia', () => {
        // Estado real: o backfill da migração adota `created_by`, que pode ser nulo em linha
        // antiga. Um órfão não entrega acesso a ninguém (a resolução exige dono vivo), e uma
        // célula em branco leria como "carregando".
        expect(sharingGroupOwnerLabel({ groupId: 'g2', name: 'Órfão' })).toBe('Sem dono definido');
        expect(sharingGroupOwnerLabel({ ownerNome: '   ', ownerUsername: '  ' })).toBe('Sem dono definido');
        expect(sharingGroupOwnerLabel(null)).toBe('Sem dono definido');
    });
});

describe('sharingGroupSizeLabel', () => {
    it('concorda em número', () => {
        expect(sharingGroupSizeLabel({ memberCount: 1 })).toBe('1 pessoa');
        expect(sharingGroupSizeLabel({ memberCount: 3 })).toBe('3 pessoas');
    });

    it('grupo VAZIO e contagem ausente caem na mesma frase, e não em "0 pessoas"', () => {
        expect(sharingGroupSizeLabel({ memberCount: 0 })).toBe('sem membros');
        expect(sharingGroupSizeLabel({})).toBe('sem membros');
        expect(sharingGroupSizeLabel({ memberCount: 'três' })).toBe('sem membros');
        expect(sharingGroupSizeLabel(null)).toBe('sem membros');
    });
});

describe('selectableGroups — o seletor não oferece o que já está no atlas', () => {
    const meus = [{ id: 'g1', name: 'Alfa' }, { id: 'g2', name: 'Bravo' }, { id: 'g3', name: 'Charlie' }];

    it('PISO: sem nada no atlas, todos os administrados são oferecidos', () => {
        expect(selectableGroups(meus, []).map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    });

    it('subtrai os que já estão, comparando por String (o id vem do JSON da rede)', () => {
        expect(selectableGroups(meus, [{ groupId: 'g2' }]).map((g) => g.id)).toEqual(['g1', 'g3']);
    });

    it('DISCRIMINAÇÃO: um grupo do atlas que NÃO é meu não some da minha lista nem entra nela', () => {
        // O grupo alheio compartilhado no atlas (`g9`) não está entre os administrados, então
        // a subtração não pode nem escondê-lo (ele nunca esteve) nem inventá-lo.
        const oferecidos = selectableGroups(meus, [{ groupId: 'g9' }]);
        expect(oferecidos.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    });

    it('entradas ausentes degradam para lista vazia, sem lançar', () => {
        expect(selectableGroups(null, null)).toEqual([]);
        expect(selectableGroups(undefined, [{ groupId: 'g1' }])).toEqual([]);
    });
});

describe('groupLevelOptions', () => {
    const sessaoDe = (userId, isAdmin = false) => ({ userId, isAdmin });
    const nomes = (opts) => opts.map((o) => o.value);
    const bloqueados = (opts) => opts.filter((o) => o.disabled).map((o) => o.value);

    it('PISO: o DONO do grupo recebe os quatro níveis, todos habilitados', () => {
        const opts = groupLevelOptions({ ...grupo, ownerId: 'u9', permission: 'read' }, sessaoDe('u9'));
        // A LISTA INTEIRA, em asserção ABSOLUTA: uma implementação que devolvesse só o
        // nível atual passaria em qualquer verificação relativa.
        expect(nomes(opts)).toEqual(['read', 'comment', 'write', 'manage']);
        expect(bloqueados(opts)).toEqual([]);
        expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(['read']);
    });

    it('quem NÃO administra o grupo pode REBAIXAR e não pode SUBIR', () => {
        // A regra do servidor, espelhada: `PUT` que sobe exige posse (404 sem ela); `PUT`
        // que rebaixa e `DELETE` não exigem nada além de `manage` no atlas.
        const opts = groupLevelOptions({ ...grupo, ownerId: 'u9', permission: 'write' }, sessaoDe('u1'));
        expect(bloqueados(opts)).toEqual(['manage']);
        // E as três de baixo (inclusive a vigente) continuam clicáveis — sem isso o gestor
        // do atlas ficaria só com a ação mais destrutiva sobre uma composição alheia.
        expect(opts.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['read', 'comment', 'write']);
    });

    it('o ADMINISTRADOR global administra qualquer grupo, inclusive o órfão', () => {
        expect(bloqueados(groupLevelOptions({ permission: 'read' }, sessaoDe('u1', true)))).toEqual([]);
        // DISCRIMINAÇÃO: o mesmo grupo órfão para um NÃO administrador trava tudo acima do
        // vigente — grupo sem dono vivo não é administrável por ninguém mais, e a resolução
        // no banco falha fechada do mesmo jeito.
        expect(bloqueados(groupLevelOptions({ permission: 'read' }, sessaoDe('u1'))))
            .toEqual(['comment', 'write', 'manage']);
    });

    it('nível desconhecido ou ausente normaliza para `read`, e não deixa o select sem seleção', () => {
        for (const permission of [undefined, null, '', 'owner', 'superuser']) {
            const opts = groupLevelOptions({ ...grupo, permission, ownerId: 'u9' }, sessaoDe('u9'));
            expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(['read']);
        }
    });

    it('o dono compara por String, e sessão anônima não vira dono de grupo órfão', () => {
        // O id vem do JSON da rede: comparar por identidade estrita faria o dono perder o
        // próprio grupo por causa do tipo.
        expect(bloqueados(groupLevelOptions({ permission: 'read', ownerId: 42 }, sessaoDe('42')))).toEqual([]);
        // DISCRIMINAÇÃO: os dois nulos NÃO se encontram. Sem esta linha, `null === null`
        // entregaria a subida a uma sessão sem identidade num grupo sem dono.
        expect(bloqueados(groupLevelOptions({ permission: 'read', ownerId: null }, sessaoDe(null))))
            .toEqual(['comment', 'write', 'manage']);
    });
});
