// Path: tests/unit/transferencia-de-posse-frase.test.js
//
// A FRASE DE "TORNAR DONO", QUE DESCREVE QUEM CLICA E TEM DOIS QUEM.
//
// O botão é oferecido por `serverTreatsAsAtlasOwner`, que responde por DOIS principais: o
// dono do atlas e o administrador GLOBAL, que `requireAtlasPermission` resolve como dono de
// qualquer atlas sem share nenhum. O gate ganhou o segundo em 2026-08-22 e a frase de
// confirmação NÃO foi tocada: ela continuava literal, "Você deixará de ser o dono e passará
// a Gestor". Para o administrador global isso é falso em cada palavra — ele nunca foi dono
// daquele atlas, não deixa de ser nada e não vira Gestor.
//
// A CLASSE DO DEFEITO é a tela descrever um efeito sobre quem clica quando o efeito é sobre
// um terceiro, num ato que a mesma tela não desfaz. O verde de antes não provava nada porque
// ninguém testava a frase; este arquivo a prende nos dois ramos e no ramo fechado.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA: que o diálogo APAREÇA, e que o servidor aceite a
// transferência. O primeiro é Playwright, o segundo é o e2e de contrato. Aqui é a redação,
// que é pura e por isso testável em node.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ownershipTransferWarning } from '../../src/js/modals/sharing.modal.core.js';
import { UserRole, GlobalRole } from '../../src/js/store/sync/session-context.js';

/** O trecho que só pode aparecer para quem de fato PERDE a posse. */
const PERDA = 'Você deixará de ser o dono e passará a Gestor.';

describe('ownershipTransferWarning — o DONO transferindo', () => {
    it('diz que ele perde a posse e vira Gestor', () => {
        const frase = ownershipTransferWarning(UserRole.OWNER, 'Ana');
        expect(frase).toBe(`Tornar Ana o novo dono do atlas? ${PERDA}`);
    });

    it('vale também para a `permission` CRUA do servidor, que é o outro vocabulário', () => {
        // `toAtlasPermission` aceita os dois, e a frase precisa aceitar os dois pelo mesmo
        // motivo do gate: a mesma tela é alcançada com um `UserRole` e com um `permission`.
        expect(ownershipTransferWarning('owner', 'Ana')).toContain(PERDA);
    });

    it('nome vazio degrada para um sujeito genérico, nunca para um espaço', () => {
        expect(ownershipTransferWarning(UserRole.OWNER, '')).toBe(
            `Tornar este membro o novo dono do atlas? ${PERDA}`,
        );
        expect(ownershipTransferWarning(UserRole.OWNER, null)).toContain('este membro');
        expect(ownershipTransferWarning(UserRole.OWNER, '   ')).toContain('este membro');
    });
});

describe('ownershipTransferWarning — o ADMINISTRADOR GLOBAL transferindo', () => {
    it('NÃO afirma que ele perde uma posse que não tem', () => {
        const frase = ownershipTransferWarning(UserRole.ADMIN, 'Ana');
        expect(frase).not.toContain(PERDA);
        expect(frase).not.toContain('deixará de ser');
        expect(frase).not.toContain('Gestor');
    });

    it('diz para onde a posse vai e por que o acesso DELE não muda', () => {
        const frase = ownershipTransferWarning(UserRole.ADMIN, 'Ana');
        expect(frase).toBe(
            'Tornar Ana o novo dono do atlas? A posse sai de quem é dono hoje e passa para Ana. '
            + 'Seu acesso a este atlas não muda: ele vem do seu papel de administrador, não da posse.',
        );
    });

    it('as duas afirmações continuam verdadeiras se ele TAMBÉM for o dono', () => {
        // `toFrontendRole` devolve o papel global ANTES de olhar a posse, então um
        // administrador dono do atlas chega aqui indistinguível de um que não é. Por isso a
        // frase não pode dizer "você não é o dono": ela diz só o que vale nos dois casos.
        const frase = ownershipTransferWarning(UserRole.ADMIN, 'Ana');
        expect(frase).not.toContain('você não é o dono');
        expect(frase).toContain('A posse sai de quem é dono hoje');
    });

    it('`UserRole.ADMIN` e `GlobalRole.ADMIN` são a mesma string, e a frase é a do eixo por atlas', () => {
        // Os dois vocabulários compartilham a palavra; aqui ela chega pelo eixo POR ATLAS,
        // dobrada por `toFrontendRole`. O caso existe para que a coincidência fique escrita.
        expect(String(UserRole.ADMIN)).toBe(String(GlobalRole.ADMIN));
        expect(ownershipTransferWarning(GlobalRole.ADMIN, 'Ana'))
            .toBe(ownershipTransferWarning(UserRole.ADMIN, 'Ana'));
    });
});

describe('ownershipTransferWarning — papel que não alcança a posse', () => {
    it('pergunta e CALA: sem promessa de efeito nenhum sobre quem clica', () => {
        // A tela não desenha o botão para estes, então este ramo não é alcançável por ela.
        // Ele existe para a função não INVENTAR um efeito se for chamada de outro lugar.
        for (const papel of [UserRole.MANAGER, UserRole.EDITOR, UserRole.COMMENTER, UserRole.VIEWER]) {
            const frase = ownershipTransferWarning(papel, 'Ana');
            expect(frase, papel).toBe('Tornar Ana o novo dono do atlas?');
        }
    });

    it('papel DESCONHECIDO cai no mesmo ramo fechado', () => {
        // Falha fechada nos dois sentidos: nem a frase do dono, nem a do administrador.
        for (const lixo of [null, undefined, '', 'superuser', 42, {}, [], 'constructor', 'toString']) {
            const frase = ownershipTransferWarning(lixo, 'Ana');
            expect(frase, String(lixo)).toBe('Tornar Ana o novo dono do atlas?');
        }
    });

    it('os quatro papéis GLOBAIS que não atravessam também calam', () => {
        for (const papel of [GlobalRole.USER, GlobalRole.PRODUCER, GlobalRole.CREDENCIADO]) {
            expect(ownershipTransferWarning(papel, 'Ana'), papel)
                .toBe('Tornar Ana o novo dono do atlas?');
        }
    });
});

describe('controle negativo: a frase de antes reprovaria', () => {
    const NUCLEO = fileURLToPath(new URL('../../src/js/modals/sharing.modal.core.js', import.meta.url));
    const CODIGO = readFileSync(NUCLEO, 'utf8');

    it('o literal incondicional saiu do handler', () => {
        // O defeito era UMA string colada no `showConfirm`. Se ela voltar, volta para todo
        // principal, que é exatamente o que este arquivo existe para impedir.
        expect(CODIGO).toMatch(/ownershipTransferWarning\(sessionContext\.role, nome\)/);
        expect(CODIGO).not.toMatch(/showConfirm\(\s*`Tornar \$\{nome/);
    });

    it('e a regressão seria PEGA: a versão buggy falha os dois ramos deste arquivo', () => {
        // O controle: a implementação ERRADA, escrita aqui, atravessando as MESMAS asserções
        // dos ramos acima. Sem isto, um verde só provaria que a função existe.
        const buggy = (_role, nome) =>
            `Tornar ${nome || 'este membro'} o novo dono do atlas? ${PERDA}`;

        // Ela passaria o ramo do dono...
        expect(buggy(UserRole.OWNER, 'Ana')).toBe(ownershipTransferWarning(UserRole.OWNER, 'Ana'));
        // ...e reprovaria o do administrador e o fechado, que é onde o defeito vivia.
        expect(buggy(UserRole.ADMIN, 'Ana')).toContain(PERDA);
        expect(ownershipTransferWarning(UserRole.ADMIN, 'Ana')).not.toContain(PERDA);
        expect(buggy(UserRole.VIEWER, 'Ana')).not.toBe(ownershipTransferWarning(UserRole.VIEWER, 'Ana'));
    });

    it('o gate do botão continua sendo o predicado nomeado, e não uma lista própria', () => {
        // A frase bifurca pelo mesmo insumo do botão. Se o gate voltasse a ser uma comparação
        // local, a frase e o botão poderiam divergir de novo sem nada ficar vermelho.
        expect(CODIGO).toMatch(/serverTreatsAsAtlasOwner\(sessionContext\.role\)/);
        expect(CODIGO).not.toMatch(/sessionContext\.role\s*===\s*'owner'/);
    });
});
