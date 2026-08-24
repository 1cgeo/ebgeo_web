// Path: tests/unit/revogar-concessao-quem-pode.test.js
//
// QUEM PODE REMOVER UMA CONCESSÃO, E POR QUE A TELA PRECISA SABER ANTES DO CLIQUE.
//
// `_renderGrantItem` (`js/catalog/resource-share.modal.js`) emitia o botão "Remover acesso"
// INCONDICIONALMENTE, em toda linha da árvore. O servidor só aceita duas situações
// (`GRANT_REVOKER_ACTOR`, `backend/src/middleware/resource-access.js`): quem CONCEDEU aquela
// linha, e o administrador GLOBAL. O caminho que isso produzia é o pior possível para um ato
// irreversível: a pessoa clica, recebe o diálogo destrutivo COMPLETO (que nomeia quem perde
// acesso e conta a queda da subárvore), confirma, e só então toma 403. Ela atravessa inteiro
// um aviso sobre uma consequência que nunca teve como causar.
//
// A DIREÇÃO DO ERRO AQUI É O CONTRÁRIO DA DE `fallenGrants`, e as duas estão certas. Lá o
// aviso SUPERESTIMA de propósito (assustar a mais custa menos que derrubar sem avisar); aqui
// a oferta do ato SUBESTIMA de propósito (esconder um botão que funcionaria custa um pedido a
// quem concedeu, mostrar um que não funciona custa o diálogo acima). Nos dois casos o lado
// escolhido é o que não produz surpresa depois do clique.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA: a decisão do servidor. Ele redecide a cada requisição, e
// isto não é fronteira de segurança nenhuma; é o que impede a tela de prometer o que ele nega.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    revokeAvailability,
    revokeBlockedNotice,
    REVOKE_AVAILABILITY,
} from '../../src/js/catalog/grant-tree.js';

const { PODE, NAO_CONCEDEU } = REVOKE_AVAILABILITY;

/** Uma concessão como a listagem a devolve, no recorte que este gate lê. */
const conc = (grantedBy, extra = {}) => ({
    id: 'g1',
    parent_grant_id: null,
    granted_by: grantedBy,
    ...extra,
});

const ANA = { userId: 'u-ana', isAdmin: false };
const BRUNO = { userId: 'u-bruno', isAdmin: false };
const ADMIN = { userId: 'u-adm', isAdmin: true };

describe('revokeAvailability — as duas situações que o servidor aceita', () => {
    it('QUEM CONCEDEU aquela linha pode remover', () => {
        expect(revokeAvailability(conc('u-ana'), ANA)).toBe(PODE);
    });

    it('QUEM NÃO CONCEDEU não pode, mesmo tendo acesso ao recurso', () => {
        // Ter `view_share` no recurso é o que deixa REPASSAR, não o que deixa desfazer a
        // concessão de outra pessoa. São gates diferentes do lado de lá.
        expect(revokeAvailability(conc('u-ana'), BRUNO)).toBe(NAO_CONCEDEU);
    });

    it('o ADMINISTRADOR GLOBAL pode remover qualquer linha, inclusive a de terceiros', () => {
        expect(revokeAvailability(conc('u-ana'), ADMIN)).toBe(PODE);
        expect(revokeAvailability(conc('u-bruno'), ADMIN)).toBe(PODE);
    });

    it('o administrador pode remover TAMBÉM a concessão sem concedente', () => {
        // É a raiz da administração, e ela existe: `granted_by` nulo. Se o ramo largo não a
        // alcançasse, ela seria irremovível por qualquer superfície do produto.
        expect(revokeAvailability(conc(null), ADMIN)).toBe(PODE);
    });
});

describe('revokeAvailability — `granted_by` ausente ou nulo FECHA', () => {
    // A DECISÃO, e a razão: no servidor `g.granted_by = $2::uuid` com `granted_by` nulo
    // devolve NULL, que não é `true`, então `requireGrantRevoker` recusa. Fechar aqui é
    // REPRODUZIR o servidor, não ser conservador com ele. E mesmo que o servidor fosse
    // omisso, a direção fechada é a segura para um ato irreversível.
    it('nulo, para quem não administra', () => {
        expect(revokeAvailability(conc(null), ANA)).toBe(NAO_CONCEDEU);
    });

    it('ausente (a chave nem veio no payload)', () => {
        expect(revokeAvailability({ id: 'g1' }, ANA)).toBe(NAO_CONCEDEU);
    });

    it('`undefined` explícito', () => {
        expect(revokeAvailability(conc(undefined), ANA)).toBe(NAO_CONCEDEU);
    });

    it('e nulo NÃO casa com visitante sem sessão: `null === null` não abre o gate', () => {
        // O erro barato de cometer: comparar os dois nus faria a concessão da administração
        // ficar revogável por QUALQUER anônimo, porque os dois lados são nulos.
        expect(revokeAvailability(conc(null), { userId: null, isAdmin: false })).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(conc(null), {})).toBe(NAO_CONCEDEU);
    });
});

describe('revokeAvailability — entrada suja falha FECHADA', () => {
    it('sem ator, sem concessão, sem nada', () => {
        expect(revokeAvailability(null, null)).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(undefined, undefined)).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(conc('u-ana'), null)).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(null, ANA)).toBe(NAO_CONCEDEU);
    });

    it('`isAdmin` só abre quando é `true` ESTRITO', () => {
        // Um dia em que `sessionContext.isAdmin()` devolva outra coisa (sessão ainda não
        // lida), a comparação frouxa promoveria um visitante comum a revogador universal.
        for (const quase of ['true', 1, 'admin', {}, [], 'sim']) {
            expect(revokeAvailability(conc('u-ana'), { userId: 'u-bruno', isAdmin: quase }), String(quase))
                .toBe(NAO_CONCEDEU);
        }
        expect(revokeAvailability(conc('u-ana'), { userId: 'u-bruno', isAdmin: false })).toBe(NAO_CONCEDEU);
    });

    it('id numérico de um lado e string do outro ainda casa', () => {
        // O id da concessão vem do JSON da rede e o do visitante vem da sessão; uma
        // comparação estrita entre tipos diferentes esconderia o botão de quem concedeu.
        expect(revokeAvailability(conc(7), { userId: '7', isAdmin: false })).toBe(PODE);
        expect(revokeAvailability(conc('7'), { userId: 7, isAdmin: false })).toBe(PODE);
    });

    it('id vazio ou estranho não abre para OUTRO ator', () => {
        // `''` e `0` não são ids que o servidor emita; o que importa é que nenhum deles vira
        // uma chave que case com o visitante errado.
        expect(revokeAvailability(conc(''), ANA)).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(conc(0), ANA)).toBe(NAO_CONCEDEU);
        expect(revokeAvailability(conc('u-ana'), { userId: 0, isAdmin: false })).toBe(NAO_CONCEDEU);
    });
});

describe('revokeBlockedNotice — a nota que ocupa o lugar do botão', () => {
    it('nomeia QUEM concedeu, porque o nome viaja no payload', () => {
        const nota = revokeBlockedNotice(conc('u-ana', { granted_by_nome: 'Ana Lima' }));
        expect(nota.label).toBe('só quem concedeu remove');
        expect(nota.title).toContain('Ana Lima');
        expect(nota.title).toContain('Peça a remoção a essa pessoa.');
    });

    it('cai no `username` quando não há nome, como `grantOriginLabel`', () => {
        const nota = revokeBlockedNotice(conc('u-ana', { granted_by_username: 'ana.lima' }));
        expect(nota.title).toContain('ana.lima');
    });

    it('nome VAZIO é ausência, não nome', () => {
        const nota = revokeBlockedNotice(conc('u-ana', { granted_by_nome: '', granted_by_username: '' }));
        expect(nota.title).toContain('administração');
    });

    it('sem concedente é OUTRA frase, não a mesma com um buraco', () => {
        // Mandar procurar "quem concedeu" numa concessão da administração é mandar procurar
        // ninguém.
        const nota = revokeBlockedNotice(conc(null));
        expect(nota.label).toBe('só quem concedeu remove');
        expect(nota.title).toContain('feita pela administração');
        expect(nota.title).not.toContain('Peça a remoção a essa pessoa.');
    });

    it('sempre devolve rótulo e dica, nunca `null`', () => {
        // Ao contrário de `deadGrantorChip`, que devolve nulo para a linha viva: aqui a
        // função só é chamada no ramo em que a nota EXISTE, e devolver nulo produziria o
        // espaço vazio que ela existe para preencher.
        for (const entrada of [null, undefined, {}, conc(null)]) {
            const nota = revokeBlockedNotice(entrada);
            expect(typeof nota.label).toBe('string');
            expect(nota.label.length).toBeGreaterThan(0);
            expect(nota.title.length).toBeGreaterThan(20);
        }
    });
});

describe('a tela consome a regra, e a linha continua inteira', () => {
    const MODAL = readFileSync(
        fileURLToPath(new URL('../../src/js/catalog/resource-share.modal.js', import.meta.url)),
        'utf8',
    );

    it('o botão de revogar nasce DENTRO do ramo permitido', () => {
        expect(MODAL).toMatch(/revokeAvailability\(grant, \{/);
        expect(MODAL).toMatch(/const acao = podeRevogar[\s\S]{0,400}?data-action="revoke"/);
    });

    it('e a NOTA ocupa o outro ramo, com `data-testid` literal', () => {
        expect(MODAL).toContain('data-testid="resource-share-revoke-blocked"');
        expect(MODAL).toMatch(/revokeBlockedNotice\(grant\)/);
    });

    it('a LINHA não é escondida: só a oferta do ato muda', () => {
        // Ver quem tem acesso é o ponto desta lista. Filtrar a linha resolveria o 403 e
        // quebraria a tela inteira.
        expect(MODAL).toMatch(/this\._grants\.map\(\(g\) => this\._renderGrantItem\(g\)\)/);
        expect(MODAL).not.toMatch(/_grants\.filter\([^)]*revoke/i);
    });

    it('controle negativo: a busca acha de fato a forma INCONDICIONAL de antes', () => {
        // Sem este controle, uma regex que não casasse com nada reportaria verde para um
        // arquivo que ainda emitisse o botão em toda linha.
        const isca = '<button type="button" class="sharing-member__remove" data-action="revoke"';
        expect(isca).toContain('data-action="revoke"');
        // A forma antiga: o botão logo depois do `<span>` do nível, sem ternário nenhum.
        const antigo = `<span class="resource-share__level"></span>\n${isca}`;
        expect(antigo).not.toMatch(/const acao = podeRevogar[\s\S]{0,400}?data-action="revoke"/);
    });
});

describe('controle negativo: o espelho do servidor continua com DOIS ramos', () => {
    const GATE = readFileSync(
        fileURLToPath(new URL('../../../backend/src/middleware/resource-access.js', import.meta.url)),
        'utf8',
    );

    it('`GRANT_REVOKER_ACTOR` pergunta por AUTORIA e por UM papel de administração', () => {
        // Se o servidor alargar ou estreitar o gate, esta asserção reprova e obriga a mexer
        // aqui: a regra do cliente é uma CÓPIA dele, e cópia sem guarda diverge calada.
        expect(GATE).toContain('GRANT_REVOKER_ACTOR');
        expect(GATE).toMatch(/g\.granted_by = \$2::uuid\) AS concedeu/);
        expect(GATE).toMatch(/u\.role = 'admin'\) AS administra/);
    });

    it('e o credenciado NÃO está no ramo largo (ele saiu na fase F9)', () => {
        expect(GATE).not.toMatch(/AS administra[\s\S]{0,200}credenciado/);
    });

    it('a busca acha de fato os padrões (controle do matcher)', () => {
        const isca = "AND u.role = 'admin') AS administra";
        expect(isca).toMatch(/u\.role = 'admin'\) AS administra/);
        expect('AS concedeu').not.toMatch(/g\.granted_by = \$2::uuid\) AS concedeu/);
    });
});
