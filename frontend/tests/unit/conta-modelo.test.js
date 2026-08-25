// Path: tests/unit/conta-modelo.test.js

/**
 * @fileoverview AS REGRAS E AS FRASES DA TELA "MINHA CONTA", que é onde o titular lê o próprio
 * registro, troca a própria senha e pede a troca do próprio e-mail.
 *
 * A METADE DE CHAVE DE API SAIU DAQUI EM 2026-08-25, com os dois `describe` que a mediam
 * (`apiKeySectionState` e `hasUncopiedKey`) e os quatro casos das frases dela. Não foi poda de
 * teste velho: as funções e as frases deixaram de existir, por decisão do chefe. A chave é
 * credencial INTERNA, gerenciada pelo sistema para a subrequisição do nginx (cláusula 10.7 de
 * `CONSTITUICAO.md`), e o usuário final não a vê nem a gerencia. As ROTAS do servidor continuam de
 * pé e continuam com prova própria no backend.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que cada bloco existe:
 *
 *   - `profilePatch` manda SÓ o que mudou. Um PUT sem mudança nenhuma não é inócuo: `updateProfile`
 *     (`backend/src/modules/users/users.service.js`) escreve uma linha `USER_UPDATE` na trilha de
 *     auditoria a cada chamada, então o no-op suja o registro de atos da conta.
 *   - `validatePasswordForm` é o espelho local do schema, e a ORDEM das queixas é contrato de
 *     leitura: a primeira reclamação tem de ser sobre a primeira coisa errada do formulário.
 *   - AS FRASES SÃO ASSERIDAS PELO CONTEÚDO, não pela existência. Um aviso que existe e não nomeia
 *     a consequência é o mesmo que aviso nenhum, e é a forma que a constituição chama de
 *     verificação fantasma: `expect(FRASE).toBeTruthy()` passaria com a string errada.
 */

import { describe, it, expect } from 'vitest';
import {
    ADMIN_ONLY_FIELDS_NOTE,
    EDITABLE_PROFILE_FIELDS,
    MAX_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_RULE_TEXT,
    PASSWORD_SESSION_WARNING,
    accountErrorMessage,
    profilePatch,
    validatePasswordForm,
    validateProfileDraft,
} from '../../src/js/admin/account-model.js';

describe('profilePatch', () => {
    const original = { nome: 'Ana Souza', rank_id: 'aaaa-1111' };

    it('devolve null quando nada mudou', () => {
        expect(profilePatch(original, { nome: 'Ana Souza', rank_id: 'aaaa-1111' })).toBeNull();
    });

    it('ignora diferença que é só espaço em branco', () => {
        expect(profilePatch(original, { nome: '  Ana Souza  ', rank_id: 'aaaa-1111' })).toBeNull();
    });

    it('manda só o campo que mudou', () => {
        expect(profilePatch(original, { nome: 'Ana S. Souza', rank_id: 'aaaa-1111' }))
            .toEqual({ nome: 'Ana S. Souza' });
    });

    it('limpar o posto vira null explícito, não campo ausente', () => {
        expect(profilePatch(original, { nome: 'Ana Souza', rank_id: '' }))
            .toEqual({ rank_id: null });
    });

    it('null e string vazia significam a mesma coisa, então trocar um pelo outro não é mudança', () => {
        const semPosto = { nome: 'Ana Souza', rank_id: null };
        expect(profilePatch(semPosto, { nome: 'Ana Souza', rank_id: '' })).toBeNull();
    });

    it('original ausente é tratado como tudo vazio, e o rascunho inteiro vira patch', () => {
        expect(profilePatch(undefined, { nome: 'Ana', rank_id: 'x' }))
            .toEqual({ nome: 'Ana', rank_id: 'x' });
    });

    it('nunca inventa campo fora da lista aceita pelo servidor', () => {
        const patch = profilePatch(original, {
            nome: 'Outro Nome',
            rank_id: 'aaaa-1111',
            role: 'admin',
            organization_id: 'bbbb-2222',
        });
        expect(Object.keys(patch)).toEqual(['nome']);
        for (const chave of Object.keys(patch)) {
            expect(EDITABLE_PROFILE_FIELDS).toContain(chave);
        }
    });
});

describe('validateProfileDraft', () => {
    it('recusa nome vazio', () => {
        expect(validateProfileDraft({ nome: '   ' }).valid).toBe(false);
    });

    it('recusa rascunho sem nome nenhum', () => {
        expect(validateProfileDraft({}).valid).toBe(false);
        expect(validateProfileDraft(null).valid).toBe(false);
    });

    it('recusa nome acima do teto do servidor, e a mensagem diz o teto', () => {
        const resultado = validateProfileDraft({ nome: 'a'.repeat(MAX_NAME_LENGTH + 1) });
        expect(resultado.valid).toBe(false);
        expect(resultado.message).toContain(String(MAX_NAME_LENGTH));
    });

    it('aceita nome exatamente no teto (fronteira)', () => {
        expect(validateProfileDraft({ nome: 'a'.repeat(MAX_NAME_LENGTH) }).valid).toBe(true);
    });
});

describe('validatePasswordForm', () => {
    const senhaBoa = 'senha-nova-123';

    it('cobra a senha atual antes de qualquer outra coisa', () => {
        const resultado = validatePasswordForm({
            currentPassword: '',
            newPassword: 'x',
            confirmPassword: 'y',
        });
        expect(resultado.valid).toBe(false);
        expect(resultado.message).toMatch(/senha atual/i);
    });

    it('recusa senha curta demais (fronteira do min)', () => {
        const curta = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
        const resultado = validatePasswordForm({
            currentPassword: 'antiga',
            newPassword: curta,
            confirmPassword: curta,
        });
        expect(resultado.valid).toBe(false);
        expect(resultado.message).toContain(String(MIN_PASSWORD_LENGTH));
    });

    it('aceita senha exatamente no min (fronteira)', () => {
        const minima = 'a'.repeat(MIN_PASSWORD_LENGTH);
        expect(validatePasswordForm({
            currentPassword: 'antiga',
            newPassword: minima,
            confirmPassword: minima,
        }).valid).toBe(true);
    });

    it('recusa senha longa demais (fronteira do max)', () => {
        const longa = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
        expect(validatePasswordForm({
            currentPassword: 'antiga',
            newPassword: longa,
            confirmPassword: longa,
        }).valid).toBe(false);
    });

    it('recusa confirmação que não confere', () => {
        const resultado = validatePasswordForm({
            currentPassword: 'antiga',
            newPassword: senhaBoa,
            confirmPassword: `${senhaBoa}x`,
        });
        expect(resultado.valid).toBe(false);
        expect(resultado.message).toMatch(/confirma/i);
    });

    it('recusa senha nova igual à atual', () => {
        expect(validatePasswordForm({
            currentPassword: senhaBoa,
            newPassword: senhaBoa,
            confirmPassword: senhaBoa,
        }).valid).toBe(false);
    });

    it('aceita o formulário completo e coerente', () => {
        const resultado = validatePasswordForm({
            currentPassword: 'antiga-123',
            newPassword: senhaBoa,
            confirmPassword: senhaBoa,
        });
        expect(resultado).toEqual({ valid: true, message: '' });
    });

    it('formulário ausente ou com campos não-string não explode', () => {
        expect(validatePasswordForm(undefined).valid).toBe(false);
        expect(validatePasswordForm({ currentPassword: 42, newPassword: null }).valid).toBe(false);
    });
});

describe('accountErrorMessage', () => {
    it('prefere a explicação do servidor', () => {
        expect(accountErrorMessage(new Error('A senha atual está incorreta.'), 'genérica'))
            .toBe('A senha atual está incorreta.');
    });

    it('descarta o placeholder de console "HTTP <status>"', () => {
        expect(accountErrorMessage(new Error('HTTP 500'), 'genérica')).toBe('genérica');
    });

    it('erro sem mensagem cai na frase genérica', () => {
        expect(accountErrorMessage(null, 'genérica')).toBe('genérica');
        expect(accountErrorMessage({ message: '   ' }, 'genérica')).toBe('genérica');
    });
});

describe('as frases nomeiam a consequência, não só existem', () => {
    it('o aviso da senha diz que a sessão ATUAL também cai', () => {
        expect(PASSWORD_SESSION_WARNING).toMatch(/inclusive esta/i);
        expect(PASSWORD_SESSION_WARNING).toMatch(/entrar de novo/i);
    });

    it('a nota dos campos travados diz quem os muda', () => {
        expect(ADMIN_ONLY_FIELDS_NOTE).toMatch(/administrador/i);
    });

    it('nenhuma frase da tela usa em-dash', () => {
        const frases = [
            ADMIN_ONLY_FIELDS_NOTE,
            PASSWORD_RULE_TEXT,
            PASSWORD_SESSION_WARNING,
        ];
        expect(frases.length).toBeGreaterThan(0);
        for (const frase of frases) {
            expect(frase).not.toContain('—');
        }
    });
});
