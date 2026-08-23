// Path: tests/unit/atlas-drive-acesso.test.js

/**
 * @fileoverview As partes PURAS do cartão de atlas que decidem acesso: quais ações o menu
 * oferece por nível, como o rodapé descreve quem participa, e como o painel "Quem tem acesso"
 * reparte o payload de `GET /atlas/:atlasId/sharing`.
 *
 * O gate do menu morava dentro de `_openCardMenu`, entre `document.createElement` e
 * `getBoundingClientRect`, num ambiente de teste que é node puro: a única propriedade que
 * importa ali (quem vê o quê) não tinha como ser asserida. Extraí-la é o que torna
 * verificável a parte verificável desta tela.
 *
 * O CONTROLE NEGATIVO É A METADE QUE PRENDE. Uma lista fechada `perm === 'write' ||
 * perm === 'owner'` passa em todo teste que só confira `owner` e `write`; o que a reprova é
 * afirmar que `manage` VÊ o que write vê e NÃO vê o que só o dono vê. Por isso cada gate
 * aqui leva as duas asserções, e há um caso que confirma que a matriz discrimina (um nível
 * desconhecido não abre nada).
 */

import { describe, it, expect } from 'vitest';
import {
    accessPersonLabel,
    accessRowsFromSharing,
    cardMenuActions,
    describeCardAccess,
} from '@js/projects/atlas-drive.js';

/** Os ids das ações, na ordem em que o menu as desenha. */
const ids = (options) => cardMenuActions(options).map((a) => a.id);

describe('cardMenuActions — o menu do cartão por nível', () => {
    // `leave` entrou em 2026-08-23 (cláusula 5.8) e aparece para TODO nível conhecido que não
    // seja o topo, por isso ele acompanha as quatro listas abaixo. O gate dele, com o dono e o
    // desconhecido, é asserido nos dois sentidos em `atlas-drive-sair.test.js`.
    it('não oferece NADA além de copiar e sair a quem só lê', () => {
        expect(ids({ permission: 'read' })).toEqual(['duplicate', 'leave']);
    });

    it('não promove o comentarista: comment fica onde read está', () => {
        expect(ids({ permission: 'comment' })).toEqual(['duplicate', 'leave']);
    });

    it('abre renomear e imagem no editor', () => {
        expect(ids({ permission: 'write' })).toEqual(['rename', 'cover', 'duplicate', 'leave']);
    });

    it('dá ao co-Gestor (manage) tudo o que o editor tem MAIS o acesso', () => {
        // A escada é read < comment < write < manage < owner. Uma lista fechada
        // `=== 'write' || === 'owner'` deixaria `manage` sem renomear, que é o bug que
        // esta casa já embarcou duas vezes.
        expect(ids({ permission: 'manage' })).toEqual([
            'rename', 'cover', 'access', 'duplicate', 'leave',
        ]);
    });

    it('NÃO dá a lixeira ao co-Gestor: excluir é do dono', () => {
        // O outro lado do mesmo gate. Sem esta linha, um `hasAtLeast(perm, 'read')` na
        // lixeira passaria despercebido.
        expect(ids({ permission: 'manage' })).not.toContain('trash');
    });

    it('dá tudo ao dono, com a lixeira por último e marcada como destrutiva', () => {
        expect(ids({ permission: 'owner' })).toEqual([
            'rename', 'cover', 'access', 'duplicate', 'trash',
        ]);
        const trash = cardMenuActions({ permission: 'owner' }).find((a) => a.id === 'trash');
        expect(trash.danger).toBe(true);
        // Só a lixeira é destrutiva: um `danger` genérico pintaria o menu inteiro de vermelho.
        expect(cardMenuActions({ permission: 'owner' }).filter((a) => a.danger)).toHaveLength(1);
    });

    it('esconde o acesso de quem o servidor recusaria (o GET /sharing é gateado em manage)', () => {
        for (const perm of ['read', 'comment', 'write']) {
            expect(ids({ permission: perm })).not.toContain('access');
        }
        for (const perm of ['manage', 'owner']) {
            expect(ids({ permission: perm })).toContain('access');
        }
    });

    it('troca o rótulo da imagem conforme já exista capa, e só então oferece remover', () => {
        const semCapa = cardMenuActions({ permission: 'write', hasCover: false });
        expect(semCapa.find((a) => a.id === 'cover').label).toBe('Escolher imagem');
        expect(semCapa.map((a) => a.id)).not.toContain('cover-remove');

        const comCapa = cardMenuActions({ permission: 'write', hasCover: true });
        expect(comCapa.find((a) => a.id === 'cover').label).toBe('Trocar imagem');
        expect(comCapa.map((a) => a.id)).toContain('cover-remove');
    });

    it('falha FECHADO para nível desconhecido, ausente e não-string (guarda a própria matriz)', () => {
        // Sem este caso, uma implementação que devolvesse a lista inteira sempre passaria
        // em cinco dos testes acima.
        for (const perm of ['superuser', '', null, undefined, 3, {}]) {
            expect(ids({ permission: perm })).toEqual(['duplicate']);
        }
        expect(ids(undefined)).toEqual(['duplicate']);
    });

    it('carrega o testid por extenso, igual ao que os specs de navegador miram', () => {
        // Montá-lo como `project-picker-${id}` foi tentado e reprovou
        // `tests/unit/e2e-testids-existem.test.js`: aquele guarda procura o literal ENTRE
        // ASPAS em src/, e um testid montado em runtime não é literal nenhum. Esta asserção
        // é o par local dele, para que a próxima refatoração descubra isso aqui, em 250 ms,
        // e não na suíte de navegador que roda fora do `npm test`.
        const porId = Object.fromEntries(
            cardMenuActions({ permission: 'owner', hasCover: true }).map((a) => [a.id, a.testid]),
        );
        expect(porId).toEqual({
            rename: 'project-picker-rename',
            cover: 'project-picker-cover',
            'cover-remove': 'project-picker-cover-remove',
            access: 'project-picker-access',
            duplicate: 'project-picker-duplicate',
            trash: 'project-picker-trash',
        });
    });

    it('devolve um array NOVO a cada chamada', () => {
        const a = cardMenuActions({ permission: 'owner' });
        const b = cardMenuActions({ permission: 'owner' });
        expect(a).not.toBe(b);
        a.length = 0;
        expect(b.length).toBeGreaterThan(0);
    });
});

describe('accessPersonLabel — como uma pessoa é nomeada', () => {
    it('põe o posto na frente do nome', () => {
        expect(accessPersonLabel({ nome: 'Silva', posto_graduacao: 'Cap' })).toBe('Cap Silva');
    });

    it('usa o nome sozinho quando não há posto', () => {
        expect(accessPersonLabel({ nome: 'Silva' })).toBe('Silva');
        expect(accessPersonLabel({ nome: 'Silva', posto_graduacao: '   ' })).toBe('Silva');
    });

    it('cai no @usuário antes de desistir', () => {
        expect(accessPersonLabel({ username: 'msilva' })).toBe('@msilva');
    });

    it('NUNCA devolve vazio: uma linha sem nome ainda é uma pessoa com acesso', () => {
        // Devolver '' encurtaria a lista de nomes sem baixar a contagem ao lado, e a tela
        // se contradiria sozinha.
        for (const entrada of [{}, null, undefined, { nome: '  ' }, { nome: 42 }]) {
            expect(accessPersonLabel(entrada)).not.toBe('');
        }
        expect(accessPersonLabel(null)).toBe('Alguém');
    });
});

describe('describeCardAccess — o rodapé de quem tem acesso', () => {
    it('desenha NADA quando não há linha de overview (falha do pedido de extras)', () => {
        // O ramo caro: um rodapé que dissesse "Só você" aqui afirmaria em silêncio que o
        // projeto é privado.
        expect(describeCardAccess(null, { is_public: false })).toBeNull();
        expect(describeCardAccess(undefined, {})).toBeNull();
    });

    it('diz a solidão em voz alta', () => {
        const r = describeCardAccess({ member_count: 1, members: [{ nome: 'Eu' }] }, {});
        expect(r.summary).toBe('Só você');
        expect(r.detail).toBe('');
        expect(r.title).toBe('Só você');
    });

    it('não chama de privado o atlas solitário com link público', () => {
        const r = describeCardAccess({ member_count: 1, members: [] }, { is_public: true });
        expect(r.summary).toBe('Só você e o link público');
    });

    it('trata zero e contagem inválida como o caso solitário, sem quebrar', () => {
        for (const count of [0, -3, Number.NaN, 'quatro', null, undefined]) {
            const r = describeCardAccess({ member_count: count, members: [] }, {});
            expect(r.count).toBe(0);
            expect(r.summary).toBe('Só você');
        }
    });

    it('escreve os nomes COM POSTO, visíveis, e repete no title como reforço', () => {
        const r = describeCardAccess({
            member_count: 3,
            members: [
                { nome: 'Silva', posto_graduacao: 'Cap' },
                { nome: 'Souza', posto_graduacao: 'Ten' },
                { nome: 'Lima' },
            ],
        }, {});
        expect(r.summary).toBe('3 pessoas');
        expect(r.detail).toBe('Cap Silva, Ten Souza, Lima');
        expect(r.title).toBe('Com acesso: Cap Silva, Ten Souza, Lima');
    });

    it('conta o excedente quando o servidor corta a lista (json_agg LIMIT 10)', () => {
        const members = Array.from({ length: 10 }, (_, i) => ({ nome: `P${i}` }));
        const r = describeCardAccess({ member_count: 14, members }, {});
        expect(r.summary).toBe('14 pessoas');
        expect(r.detail.endsWith(' e mais 4')).toBe(true);
        expect(r.title).toBe(`Com acesso: ${r.detail}`);
    });

    it('nunca inventa "e mais -1" quando a lista supera a contagem', () => {
        const r = describeCardAccess({
            member_count: 2,
            members: [{ nome: 'A' }, { nome: 'B' }, { nome: 'C' }],
        }, {});
        expect(r.detail).toBe('A, B, C');
        expect(r.detail).not.toContain('e mais');
    });

    it('diz só o número quando veio contagem sem lista', () => {
        const r = describeCardAccess({ member_count: 6, members: [] }, {});
        expect(r.summary).toBe('6 pessoas');
        expect(r.detail).toBe('');
        expect(r.title).toBe('6 pessoas');
    });

    it('deriva a contagem da lista quando member_count não veio', () => {
        const r = describeCardAccess({ members: [{ nome: 'A' }, { nome: 'B' }] }, {});
        expect(r.count).toBe(2);
        expect(r.summary).toBe('2 pessoas');
    });
});

describe('accessRowsFromSharing — o payload de GET /sharing na forma do painel', () => {
    const cfg = {
        isPublic: false,
        owner: { userId: 'u1', username: 'diniz', nome: 'Diniz' },
        shares: [
            { userId: 'u2', username: 'marcel', nome: 'Marcel', permission: 'read', effectivePermission: 'read' },
            { userId: 'u3', username: 'ana', nome: 'Ana', permission: 'read', effectivePermission: 'write' },
        ],
        groups: [
            { groupId: 'g1', name: 'Equipe Alfa', permission: 'write', memberCount: 4, ownerNome: 'Diniz' },
        ],
    };

    it('põe o DONO primeiro, com o nível do topo da escada', () => {
        // Posse é a coluna atlas.owner_id e chega fora de `shares`: sem esta linha, um atlas
        // recém-criado seria descrito como "ninguém ainda".
        const rows = accessRowsFromSharing(cfg);
        expect(rows[0]).toMatchObject({ kind: 'user', id: 'u1', name: 'Diniz', levelLabel: 'Proprietário' });
        expect(rows[0].meta).toBe('@diniz');
    });

    it('traz o NÍVEL por extenso de cada pessoa', () => {
        const rows = accessRowsFromSharing(cfg);
        expect(rows[1]).toMatchObject({ id: 'u2', levelLabel: 'Leitura', note: '' });
    });

    it('avisa o excedente de grupo SEM nomear o grupo (cláusula 5.3)', () => {
        const rows = accessRowsFromSharing(cfg);
        expect(rows[2].levelLabel).toBe('Leitura');
        expect(rows[2].note).toBe('Na prática, Edição, por um grupo deste atlas.');
        // O que ele NÃO pode dizer: nomear o coletivo revelaria que Ana é membro dele.
        expect(rows[2].note).not.toContain('Equipe Alfa');
    });

    it('não inventa excedente quando a efetiva é igual ou MENOR que a linha', () => {
        // Controle negativo do ramo acima: uma comparação por desigualdade simples (`!==`)
        // marcaria excedente aqui, e uma por índice sobre lista própria erraria o sinal.
        const rows = accessRowsFromSharing({
            shares: [
                { userId: 'a', permission: 'write', effectivePermission: 'write' },
                { userId: 'b', permission: 'manage', effectivePermission: 'read' },
                { userId: 'c', permission: 'write' },
            ],
        });
        expect(rows.map((r) => r.note)).toEqual(['', '', '']);
    });

    it('desenha o grupo como COLETIVO: tamanho, dono e nível', () => {
        const rows = accessRowsFromSharing(cfg);
        expect(rows[3]).toMatchObject({
            kind: 'group', id: 'g1', name: 'Equipe Alfa', levelLabel: 'Edição',
        });
        expect(rows[3].meta).toBe('4 pessoas');
        expect(rows[3].note).toBe('Grupo de Diniz.');
    });

    it('conjuga o tamanho do grupo, e o grupo órfão diz que é órfão', () => {
        const rows = accessRowsFromSharing({
            groups: [
                { groupId: 'a', name: 'Um', permission: 'read', memberCount: 1, ownerNome: 'X' },
                { groupId: 'b', name: 'Zero', permission: 'read', memberCount: 0 },
                { groupId: 'c', name: 'Lixo', permission: 'read', memberCount: 'muitos' },
            ],
        });
        expect(rows.map((r) => r.meta)).toEqual(['1 pessoa', 'sem membros', 'sem membros']);
        // Grupo sem dono é estado real (o backfill adota `created_by`, nulo em linha antiga)
        // e não entrega acesso a ninguém, porque a resolução exige dono vivo.
        expect(rows[1].note).toBe('Grupo sem dono definido.');
    });

    it('devolve lista vazia para payload ausente, vazio ou malformado', () => {
        for (const entrada of [null, undefined, {}, { shares: 'não é array', groups: 7 }]) {
            expect(accessRowsFromSharing(entrada)).toEqual([]);
        }
    });

    it('não perde uma linha só porque o nível é desconhecido', () => {
        // `getPermissionLabel` cai no valor cru: um selo escrito `superuser` é uma surpresa
        // legível, e nenhum selo seria a falha silenciosa.
        const rows = accessRowsFromSharing({
            shares: [{ userId: 'x', nome: 'X', permission: 'superuser' }],
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].levelLabel).toBe('superuser');
    });
});
