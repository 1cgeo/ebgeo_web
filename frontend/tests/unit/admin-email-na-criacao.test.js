// Path: tests/unit/admin-email-na-criacao.test.js

/**
 * @fileoverview O CAMPO DE E-MAIL DO FORMULÁRIO DO ADMINISTRADOR, na criação e na edição
 * (`admin/user-email-model.js`), pedido pelo dono em 2026-09-22.
 *
 * O que este arquivo prende são as três regras do servidor que o formulário espelha, e cada uma
 * tem um modo de falha medido no código anterior:
 *
 *   - ENDEREÇO NOVO NASCE PENDENTE. A caixa "E-mail verificado" era desenhada com o estado da
 *     linha e SEMPRE enviada, então corrigir o endereço de uma conta confirmada, sem tocar na
 *     caixa, mandava `email_verified: true` para um endereço que ninguém conferiu. O caso
 *     "trocar o endereço desmarca" é o que reprova se a caixa voltar a herdar o estado.
 *   - A MARCA SÓ VIAJA COM ENDEREÇO. Limpar o endereço com a caixa marcada mandava
 *     `{ email: '', email_verified: true }`, e o servidor gravava confirmado sobre NULL.
 *   - O MESMO ENDEREÇO NÃO VIAJA na edição, senão salvar o posto derrubaria a confirmação.
 *
 * O PISO DE CADA CASO: as frases afirmam PRESENÇA antes de julgar conteúdo, senão uma constante
 * esvaziada passaria verde contra `''`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EMAIL_VERIFIED_LABEL,
    adminEmailHint,
    adminEmailPayload,
    createdUserNotice,
    validateAdminEmail,
    verifiedBoxState,
} from '../../src/js/admin/user-email-model.js';
import { MAX_EMAIL_LENGTH } from '../../src/js/admin/account-model.js';

const FONTE = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/admin/user-email-model.js');

describe('o módulo é folha: um import só, e ele também é folha', () => {
    it('importa apenas `./account-model.js`, que não arrasta a store para `admin.html`', () => {
        const imports = readFileSync(FONTE, 'utf8')
            .split(/\r?\n/)
            .filter((linha) => /^import\s/.test(linha));
        expect(imports).toEqual(["import { emailAddressProblem } from './account-model.js';"]);
    });
});

describe('validateAdminEmail', () => {
    it('vazio é válido e significa "sem endereço"', () => {
        expect(validateAdminEmail('')).toEqual({ valid: true, message: '', email: '' });
        expect(validateAdminEmail('   ')).toEqual({ valid: true, message: '', email: '' });
        expect(validateAdminEmail(null)).toEqual({ valid: true, message: '', email: '' });
        expect(validateAdminEmail(undefined).valid).toBe(true);
    });

    it('apara o endereço e não mexe na caixa do que vai ser gravado', () => {
        const r = validateAdminEmail('  Nome.Sobrenome@Example.mil ');
        expect(r.valid).toBe(true);
        expect(r.email).toBe('Nome.Sobrenome@Example.mil');
    });

    it('recusa o que não tem forma de endereço, com frase', () => {
        for (const ruim of ['sem-arroba', 'a@b', 'a@@b.mil', 'com espaco@b.mil', '@b.mil']) {
            const r = validateAdminEmail(ruim);
            expect(r.valid).toBe(false);
            expect(r.message.length).toBeGreaterThan(0);
        }
    });

    it('recusa acima do teto do servidor, dizendo o número', () => {
        const r = validateAdminEmail(`${'a'.repeat(MAX_EMAIL_LENGTH)}@example.mil`);
        expect(r.valid).toBe(false);
        expect(r.message).toContain(String(MAX_EMAIL_LENGTH));
    });

    it('na edição, o endereço GUARDADO passa como está, e só o alterado é julgado', () => {
        // Um endereço legado que a regra frouxa recusaria não pode travar a edição do posto.
        expect(validateAdminEmail('legado@intranet', 'legado@intranet').valid).toBe(true);
        expect(validateAdminEmail('outro@intranet', 'legado@intranet').valid).toBe(false);
    });
});

describe('verifiedBoxState — a caixa segue o endereço do campo', () => {
    it('sem endereço no campo a caixa some, desmarcada', () => {
        expect(verifiedBoxState({ typedEmail: '' })).toEqual({ visible: false, checked: false });
        expect(verifiedBoxState({ originalEmail: 'a@b.mil', originalVerified: true, typedEmail: '  ' }))
            .toEqual({ visible: false, checked: false });
        expect(verifiedBoxState()).toEqual({ visible: false, checked: false });
    });

    it('na criação, endereço digitado mostra a caixa DESMARCADA', () => {
        expect(verifiedBoxState({ typedEmail: 'novo@example.mil' }))
            .toEqual({ visible: true, checked: false });
    });

    it('na edição, o endereço guardado mantém o estado guardado', () => {
        expect(verifiedBoxState({
            originalEmail: 'a@b.mil', originalVerified: true, typedEmail: 'a@b.mil',
        })).toEqual({ visible: true, checked: true });
        expect(verifiedBoxState({
            originalEmail: 'a@b.mil', originalVerified: false, typedEmail: 'a@b.mil',
        })).toEqual({ visible: true, checked: false });
    });

    it('trocar o endereço DESMARCA, mesmo de uma conta confirmada (a regra de `resolveAdminEmail`)', () => {
        expect(verifiedBoxState({
            originalEmail: 'a@b.mil', originalVerified: true, typedEmail: 'c@d.mil',
        })).toEqual({ visible: true, checked: false });
    });

    it('trocar só a caixa das letras não é endereço novo, como no servidor (`mesmoEmail`)', () => {
        expect(verifiedBoxState({
            originalEmail: 'a@b.mil', originalVerified: true, typedEmail: ' A@B.MIL ',
        })).toEqual({ visible: true, checked: true });
    });

    it('só o booleano verdadeiro conta como confirmado', () => {
        expect(verifiedBoxState({
            originalEmail: 'a@b.mil', originalVerified: 'true', typedEmail: 'a@b.mil',
        }).checked).toBe(false);
    });
});

describe('adminEmailPayload — o que viaja', () => {
    it('criação sem endereço não manda nada, nem a marca', () => {
        expect(adminEmailPayload({ isEdit: false, typedEmail: '', verifiedChecked: true })).toEqual({});
        expect(adminEmailPayload({ isEdit: false, typedEmail: '   ', verifiedChecked: false })).toEqual({});
    });

    it('criação com endereço manda o endereço aparado e a marca como booleano', () => {
        expect(adminEmailPayload({ isEdit: false, typedEmail: ' n@e.mil ', verifiedChecked: false }))
            .toEqual({ email: 'n@e.mil', email_verified: false });
        expect(adminEmailPayload({ isEdit: false, typedEmail: 'n@e.mil', verifiedChecked: true }))
            .toEqual({ email: 'n@e.mil', email_verified: true });
        expect(adminEmailPayload({ isEdit: false, typedEmail: 'n@e.mil', verifiedChecked: 'sim' }))
            .toEqual({ email: 'n@e.mil', email_verified: false });
    });

    it('edição com o MESMO endereço não o reenvia, e manda a marca (aprovar pela edição)', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: 'a@b.mil', typedEmail: 'a@b.mil', verifiedChecked: true,
        })).toEqual({ email_verified: true });
    });

    it('edição que troca o endereço manda os dois', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: 'a@b.mil', typedEmail: 'c@d.mil', verifiedChecked: false,
        })).toEqual({ email: 'c@d.mil', email_verified: false });
    });

    it('edição que troca só a caixa das letras grava a caixa nova', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: 'a@b.mil', typedEmail: 'A@b.mil', verifiedChecked: true,
        })).toEqual({ email: 'A@b.mil', email_verified: true });
    });

    it('edição que LIMPA o endereço não manda a marca, mesmo com a caixa marcada', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: 'a@b.mil', typedEmail: '', verifiedChecked: true,
        })).toEqual({ email: '' });
    });

    it('edição de conta sem endereço, com o campo vazio, não manda nada', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: '', typedEmail: '', verifiedChecked: false,
        })).toEqual({});
        expect(adminEmailPayload({
            isEdit: true, originalEmail: null, typedEmail: '', verifiedChecked: false,
        })).toEqual({});
    });

    it('edição que dá o PRIMEIRO endereço a uma conta manda a marca junto', () => {
        expect(adminEmailPayload({
            isEdit: true, originalEmail: null, typedEmail: 'primeiro@e.mil', verifiedChecked: false,
        })).toEqual({ email: 'primeiro@e.mil', email_verified: false });
    });
});

describe('as frases dizem o que vai acontecer antes do clique', () => {
    it('o rótulo da caixa existe e nomeia o ato', () => {
        expect(EMAIL_VERIFIED_LABEL.length).toBeGreaterThan(0);
        expect(EMAIL_VERIFIED_LABEL).toMatch(/E-mail verificado/);
    });

    it('na criação, a dica diz que o campo é opcional e que sem ele a conta entra na hora', () => {
        for (const canDeliver of [true, false]) {
            const texto = adminEmailHint({ isEdit: false, canDeliver });
            expect(texto.length).toBeGreaterThan(40);
            expect(texto).toMatch(/Opcional/);
            expect(texto).toMatch(/entra na hora/);
            expect(texto).toContain('E-mail verificado');
        }
    });

    it('com entrega, a dica da criação promete o link; sem entrega, diz que não há envio', () => {
        expect(adminEmailHint({ isEdit: false, canDeliver: true })).toMatch(/link de confirmação/);
        const semEntrega = adminEmailHint({ isEdit: false, canDeliver: false });
        expect(semEntrega).toMatch(/não envia e-mail/);
        expect(semEntrega).not.toMatch(/link/);
    });

    it('na edição, a dica diz que trocar o endereço desmarca a caixa', () => {
        for (const canDeliver of [true, false]) {
            const texto = adminEmailHint({ isEdit: true, canDeliver });
            expect(texto.length).toBeGreaterThan(40);
            expect(texto).toMatch(/desmarca/);
        }
        expect(adminEmailHint({ isEdit: true, canDeliver: false })).toMatch(/não envia e-mail/);
    });

    it('o aviso depois de criar vem do que o SERVIDOR gravou, em quatro desfechos', () => {
        const sem = createdUserNotice({ email: null, email_verified: false }, { canDeliver: true });
        expect(sem).toEqual({ tone: 'success', text: 'Usuário criado.' });

        const conferido = createdUserNotice({ email: 'a@b.mil', email_verified: true }, { canDeliver: false });
        expect(conferido.tone).toBe('success');
        expect(conferido.text).toMatch(/já pode entrar/);

        const comLink = createdUserNotice({ email: 'a@b.mil', email_verified: false }, { canDeliver: true });
        expect(comLink.tone).toBe('success');
        expect(comLink.text).toMatch(/link de confirmação/);

        const travada = createdUserNotice({ email: 'a@b.mil', email_verified: false }, { canDeliver: false });
        expect(travada.tone).toBe('warning');
        expect(travada.text).toContain('E-mail verificado');
    });

    it('resposta sem linha (servidor antigo, ou nada) cai no aviso de sempre', () => {
        expect(createdUserNotice(undefined)).toEqual({ tone: 'success', text: 'Usuário criado.' });
        expect(createdUserNotice(null, { canDeliver: true })).toEqual({ tone: 'success', text: 'Usuário criado.' });
    });
});
