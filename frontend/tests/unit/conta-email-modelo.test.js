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
 *   - o endereço tem TRÊS estados e não dois. Uma conta criada por `POST /api/v1/users` não tem
 *     e-mail nenhum, e desenhar "não confirmado" sobre ela seria acusar de pendência quem não
 *     tem o que confirmar.
 *
 * O PISO DE CADA CASO: as asserções de prosa afirmam PRESENÇA de conteúdo antes de julgar o
 * conteúdo, senão uma constante esvaziada do outro lado passaria verde contra `''`.
 */

import { describe, it, expect } from 'vitest';
import {
    EMAIL_ABSENT_TEXT,
    EMAIL_CHANGE_SENT_TEXT,
    EMAIL_CHANGE_WARNING,
    MAX_EMAIL_LENGTH,
    emailPresentation,
    validateEmailChangeForm,
} from '../../src/js/modals/account-settings.model.js';

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

    it('a sentença do pedido é CONDICIONAL, e não anuncia envio', () => {
        expect(EMAIL_CHANGE_SENT_TEXT.length).toBeGreaterThan(40);
        // "Se o endereço puder ser usado…" — a resposta é a mesma nos dois desfechos, então
        // afirmar o envio seria remontar, na tela, o oráculo que o 200 uniforme fecha.
        expect(EMAIL_CHANGE_SENT_TEXT).toMatch(/\bSe\b/);
        expect(EMAIL_CHANGE_SENT_TEXT).not.toMatch(/e-mail (foi )?enviado|enviamos o link/i);
        expect(EMAIL_CHANGE_SENT_TEXT).not.toMatch(/e-mail trocado|endereço trocado/i);
    });
});
