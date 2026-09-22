// Path: tests/unit/conta-email-modelo.test.js

/**
 * @fileoverview O QUE A TELA "MINHA CONTA" PODE DIZER SOBRE O E-MAIL, e o que ela não pode.
 *
 * As duas coisas que este arquivo prende são de prosa e de estado, e as duas foram medidas contra
 * o servidor antes de virarem sentença:
 *
 *   - `requestEmailChange` (`backend/src/modules/users/users.service.js`) NÃO escreve na conta.
 *     Ela cunha um convite para o endereço novo e devolve o MESMO 200 quando o endereço pertence
 *     a outra conta. Logo, nenhuma frase da tela pode dizer que o e-mail foi trocado, e nenhuma
 *     pode prometer que uma confirmação está a caminho.
 *   - o endereço tem TRÊS estados e não dois. Uma conta criada por `POST /api/v1/users` sem
 *     endereço no corpo não tem e-mail nenhum, e desenhar "não confirmado" sobre ela seria acusar
 *     de pendência quem não tem o que confirmar.
 *   - e é por esse terceiro estado que a seção muda de nome (2026-09-22, pedido do dono): sobre a
 *     conta sem endereço ela é "Cadastrar um e-mail", porque "Trocar" sobre nada parece tela que
 *     não carregou.
 *
 * O PISO DE CADA CASO: as asserções de prosa afirmam PRESENÇA de conteúdo antes de julgar o
 * conteúdo, senão uma constante esvaziada do outro lado passaria verde contra `''`.
 */

import { describe, it, expect } from 'vitest';
import {
    EMAIL_ABSENT_TEXT,
    EMAIL_ADMIN_ONLY_NOTE,
    EMAIL_CHANGE_SENT_TEXT,
    EMAIL_CHANGE_WARNING,
    EMAIL_SET_WARNING,
    MAX_EMAIL_LENGTH,
    emailAddressProblem,
    emailPresentation,
    emailSectionCopy,
    validateEmailChangeForm,
} from '../../src/js/admin/account-model.js';

describe('emailPresentation — três estados, não dois', () => {
    it('endereço confirmado', () => {
        const p = emailPresentation({ email: 'alguem@example.mil', email_verified: true });
        expect(p.state).toBe('verified');
        expect(p.address).toBe('alguem@example.mil');
        expect(p.status).toBe('confirmado');
    });

    it('endereço presente e NÃO confirmado', () => {
        const p = emailPresentation({ email: 'alguem@example.mil', email_verified: false });
        expect(p.state).toBe('unverified');
        expect(p.address).toBe('alguem@example.mil');
        expect(p.status).toBe('não confirmado');
    });

    it('conta SEM endereço não é "não confirmado": é ausência', () => {
        const p = emailPresentation({ email: null, email_verified: false });
        expect(p.state).toBe('absent');
        expect(p.address).toBe('');
        expect(p.status).toBe(EMAIL_ABSENT_TEXT);
    });

    it('string vazia e espaços contam como ausência, não como endereço', () => {
        expect(emailPresentation({ email: '   ', email_verified: true }).state).toBe('absent');
        expect(emailPresentation({}).state).toBe('absent');
        expect(emailPresentation(null).state).toBe('absent');
    });

    it('`email_verified` só confirma quando é o booleano verdadeiro', () => {
        // O servidor devolve booleano; um cliente que aceitasse qualquer valor truthy passaria a
        // desenhar "confirmado" sobre a string 'false' de um serializador desatento.
        expect(emailPresentation({ email: 'a@b.mil', email_verified: 'true' }).state).toBe('unverified');
        expect(emailPresentation({ email: 'a@b.mil', email_verified: 1 }).state).toBe('unverified');
        expect(emailPresentation({ email: 'a@b.mil' }).state).toBe('unverified');
    });
});

describe('validateEmailChangeForm', () => {
    const base = { currentEmail: 'atual@example.mil' };

    it('exige o endereço novo antes de qualquer outra coisa', () => {
        const r = validateEmailChangeForm({ ...base, email: '  ', currentPassword: 'x' });
        expect(r.valid).toBe(false);
        expect(r.message.length).toBeGreaterThan(0);
    });

    it('recusa o que não tem forma de endereço', () => {
        for (const ruim of ['sem-arroba', 'a@b', 'a@@b.mil', 'com espaco@b.mil', '@b.mil']) {
            expect(validateEmailChangeForm({ ...base, email: ruim, currentPassword: 'x' }).valid).toBe(false);
        }
    });

    it('recusa o comprimento acima do que o servidor aceita', () => {
        const longo = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.mil`;
        const r = validateEmailChangeForm({ ...base, email: longo, currentPassword: 'x' });
        expect(r.valid).toBe(false);
        expect(r.message).toContain(String(MAX_EMAIL_LENGTH));
    });

    it('recusa o PRÓPRIO endereço, ignorando a caixa', () => {
        const r = validateEmailChangeForm({
            ...base,
            email: 'ATUAL@Example.MIL',
            currentPassword: 'x',
        });
        expect(r.valid).toBe(false);
        expect(r.message).toContain('já é o e-mail');
    });

    it('exige a senha atual, e só depois de o endereço estar bom', () => {
        const r = validateEmailChangeForm({ ...base, email: 'novo@example.mil', currentPassword: '' });
        expect(r.valid).toBe(false);
        expect(r.message).toContain('senha atual');
    });

    it('aceita um endereço novo com senha, e não mexe na caixa do que vai ser enviado', () => {
        const r = validateEmailChangeForm({
            ...base,
            email: 'Novo.Endereco@Example.mil',
            currentPassword: 'segredo',
        });
        expect(r.valid).toBe(true);
        expect(r.message).toBe('');
    });

    it('uma conta SEM endereço atual pode adotar um', () => {
        // `currentEmail` ausente não pode colidir com nada: o ramo do "já é o seu" compara com ''.
        const r = validateEmailChangeForm({ email: 'primeiro@example.mil', currentPassword: 'x' });
        expect(r.valid).toBe(true);
    });
});

describe('as sentenças não podem prometer o que o servidor não faz', () => {
    it('o aviso da troca diz que nada muda até a confirmação', () => {
        expect(EMAIL_CHANGE_WARNING.length).toBeGreaterThan(40);
        expect(EMAIL_CHANGE_WARNING).toMatch(/confirmação|confirmar/i);
        expect(EMAIL_CHANGE_WARNING).toMatch(/nada muda|continua/i);
    });

    it('o aviso de CADASTRAR diz o mesmo, sobre uma conta que continua sem e-mail', () => {
        expect(EMAIL_SET_WARNING.length).toBeGreaterThan(40);
        expect(EMAIL_SET_WARNING).toMatch(/confirmação/);
        expect(EMAIL_SET_WARNING).toMatch(/continua sem e-mail/);
        // O aviso de troca fala do "e-mail atual", que a conta sem endereço não tem.
        expect(EMAIL_SET_WARNING).not.toMatch(/e-mail atual/);
    });

    it('onde o servidor não entrega, a nota diz QUEM cadastra o endereço', () => {
        expect(EMAIL_ADMIN_ONLY_NOTE.length).toBeGreaterThan(30);
        expect(EMAIL_ADMIN_ONLY_NOTE).toMatch(/não envia e-mail/);
        expect(EMAIL_ADMIN_ONLY_NOTE).toMatch(/administrador/);
    });

    it('a sentença do pedido é CONDICIONAL, e não anuncia envio', () => {
        expect(EMAIL_CHANGE_SENT_TEXT.length).toBeGreaterThan(40);
        // "Se o endereço puder ser usado…" — a resposta é a mesma nos dois desfechos, então
        // afirmar o envio seria remontar, na tela, o oráculo que o 200 uniforme fecha.
        expect(EMAIL_CHANGE_SENT_TEXT).toMatch(/\bSe\b/);
        expect(EMAIL_CHANGE_SENT_TEXT).not.toMatch(/e-mail (foi )?enviado|enviamos o link/i);
        expect(EMAIL_CHANGE_SENT_TEXT).not.toMatch(/e-mail trocado|endereço trocado/i);
    });
});

describe('emailSectionCopy — a seção se chama pelo que a pessoa vai fazer', () => {
    it('conta SEM endereço: "Cadastrar", com o aviso de quem continua sem e-mail', () => {
        const c = emailSectionCopy('absent');
        expect(c.title).toBe('Cadastrar um e-mail');
        expect(c.fieldLabel).toBe('E-mail');
        expect(c.warning).toBe(EMAIL_SET_WARNING);
    });

    it('conta COM endereço, confirmado ou não: "Trocar", com o aviso de troca', () => {
        for (const state of ['verified', 'unverified']) {
            const c = emailSectionCopy(state);
            expect(c.title).toBe('Trocar o e-mail');
            expect(c.fieldLabel).toBe('Novo e-mail');
            expect(c.warning).toBe(EMAIL_CHANGE_WARNING);
        }
    });

    it('estado desconhecido (perfil ainda não lido) cai no texto de troca, que não promete nada', () => {
        expect(emailSectionCopy(null).title).toBe('Trocar o e-mail');
        expect(emailSectionCopy(undefined).title).toBe('Trocar o e-mail');
    });

    it('o estado vem de `emailPresentation`, e os dois concordam sobre a ausência', () => {
        const ausente = emailPresentation({ email: null });
        expect(emailSectionCopy(ausente.state).title).toBe('Cadastrar um e-mail');
        const presente = emailPresentation({ email: 'a@b.mil', email_verified: true });
        expect(emailSectionCopy(presente.state).title).toBe('Trocar o e-mail');
    });
});

describe('emailAddressProblem — a regra frouxa que as duas telas compartilham', () => {
    it('endereço com forma passa com frase vazia', () => {
        expect(emailAddressProblem('alguem@example.mil')).toBe('');
    });

    it('sem forma, ou acima do teto, devolve a frase da recusa', () => {
        expect(emailAddressProblem('sem-arroba')).toMatch(/não parece válido/);
        expect(emailAddressProblem(`${'a'.repeat(MAX_EMAIL_LENGTH)}@example.mil`))
            .toContain(String(MAX_EMAIL_LENGTH));
    });

    it('é a MESMA regra que a troca de e-mail aplica, na mesma ordem', () => {
        for (const ruim of ['sem-arroba', 'a@b', `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.mil`]) {
            const troca = validateEmailChangeForm({ email: ruim, currentPassword: 'x' });
            expect(troca.valid).toBe(false);
            expect(troca.message).toBe(emailAddressProblem(ruim));
        }
    });
});
