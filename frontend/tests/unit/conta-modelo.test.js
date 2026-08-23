// Path: tests/unit/conta-modelo.test.js

/**
 * @fileoverview AS REGRAS E AS FRASES DA TELA "MINHA CONTA", que é onde o usuário troca a própria
 * senha e obtém a chave de API.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que cada bloco existe:
 *
 *   - `profilePatch` manda SÓ o que mudou. Um PUT sem mudança nenhuma não é inócuo: `updateProfile`
 *     (`backend/src/modules/users/users.service.js`) escreve uma linha `USER_UPDATE` na trilha de
 *     auditoria a cada chamada, então o no-op suja o registro de atos da conta.
 *   - `validatePasswordForm` é o espelho local do schema, e a ORDEM das queixas é contrato de
 *     leitura: a primeira reclamação tem de ser sobre a primeira coisa errada do formulário.
 *   - `apiKeySectionState` decide o que a seção da chave desenha. `idle` NÃO significa "não existe
 *     chave": o servidor não tem rota nenhuma que responda essa pergunta, e uma tela que fingisse
 *     saber estaria inventando. A precedência (rotating > error > revealed) é o que impede a tela
 *     de mostrar como nova uma chave de tentativa anterior depois de uma falha.
 *   - `hasUncopiedKey` é o que segura o fechamento distraído. A chave aparece uma vez só; fechar
 *     sem copiar a perde para sempre.
 *   - AS FRASES SÃO ASSERIDAS PELO CONTEÚDO, não pela existência. Um aviso que existe e não nomeia
 *     a consequência é o mesmo que aviso nenhum, e é a forma que a constituição chama de
 *     verificação fantasma: `expect(FRASE).toBeTruthy()` passaria com a string errada.
 */

import { describe, it, expect } from 'vitest';
import {
    ADMIN_ONLY_FIELDS_NOTE,
    API_KEY_COPY_NOW_TEXT,
    API_KEY_DISCARD_CONFIRM_MESSAGE,
    API_KEY_ONE_TIME_WARNING,
    API_KEY_ROTATE_CONFIRM_MESSAGE,
    API_KEY_UNKNOWN_STATE_TEXT,
    EDITABLE_PROFILE_FIELDS,
    MAX_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_SESSION_WARNING,
    accountErrorMessage,
    apiKeySectionState,
    hasUncopiedKey,
    profilePatch,
    validatePasswordForm,
    validateProfileDraft,
} from '../../src/js/modals/account-settings.model.js';

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

describe('apiKeySectionState', () => {
    it('sem nada na mão, é idle (que NÃO quer dizer "não existe chave")', () => {
        expect(apiKeySectionState({})).toBe('idle');
        expect(apiKeySectionState(undefined)).toBe('idle');
        expect(apiKeySectionState({ apiKey: '' })).toBe('idle');
    });

    it('com a chave na mão, é revealed', () => {
        expect(apiKeySectionState({ apiKey: 'uuid-da-chave' })).toBe('revealed');
    });

    it('a falha vence a chave de uma tentativa anterior', () => {
        expect(apiKeySectionState({ apiKey: 'antiga', error: 'falhou' })).toBe('error');
    });

    it('a rotação em voo vence tudo', () => {
        expect(apiKeySectionState({ rotating: true, apiKey: 'antiga', error: 'x' }))
            .toBe('rotating');
    });
});

describe('hasUncopiedKey', () => {
    it('chave na tela e não copiada segura o fechamento', () => {
        expect(hasUncopiedKey({ apiKey: 'abc', copied: false })).toBe(true);
        expect(hasUncopiedKey({ apiKey: 'abc' })).toBe(true);
    });

    it('chave copiada não segura nada', () => {
        expect(hasUncopiedKey({ apiKey: 'abc', copied: true })).toBe(false);
    });

    it('sem chave na tela, não há o que perder', () => {
        expect(hasUncopiedKey({ apiKey: '', copied: false })).toBe(false);
        expect(hasUncopiedKey({})).toBe(false);
    });

    it('uma cópia que falhou continua segurando (copied só vira true no sucesso)', () => {
        expect(hasUncopiedKey({ apiKey: 'abc', copied: 'talvez' })).toBe(true);
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

    it('o aviso da chave diz que ela aparece uma vez só', () => {
        expect(API_KEY_ONE_TIME_WARNING).toMatch(/uma única vez/i);
        expect(API_KEY_ONE_TIME_WARNING).toMatch(/gerar outra/i);
    });

    it('a confirmação da rotação nomeia a integração que para de funcionar', () => {
        expect(API_KEY_ROTATE_CONFIRM_MESSAGE).toMatch(/integração/i);
        expect(API_KEY_ROTATE_CONFIRM_MESSAGE).toMatch(/deixa de funcionar/i);
    });

    it('a tela admite que não sabe se já existe chave, em vez de fingir', () => {
        expect(API_KEY_UNKNOWN_STATE_TEXT).toMatch(/não informa/i);
    });

    it('o aviso ao fechar diz que a chave não pode ser lida de novo', () => {
        expect(API_KEY_DISCARD_CONFIRM_MESSAGE).toMatch(/não pode ser lida de novo/i);
        expect(API_KEY_COPY_NOW_TEXT).toMatch(/copie a chave agora/i);
    });

    it('a nota dos campos travados diz quem os muda', () => {
        expect(ADMIN_ONLY_FIELDS_NOTE).toMatch(/administrador/i);
    });

    it('nenhuma frase da tela usa em-dash', () => {
        const frases = [
            ADMIN_ONLY_FIELDS_NOTE,
            API_KEY_COPY_NOW_TEXT,
            API_KEY_DISCARD_CONFIRM_MESSAGE,
            API_KEY_ONE_TIME_WARNING,
            API_KEY_ROTATE_CONFIRM_MESSAGE,
            API_KEY_UNKNOWN_STATE_TEXT,
            PASSWORD_SESSION_WARNING,
        ];
        expect(frases.length).toBeGreaterThan(0);
        for (const frase of frases) {
            expect(frase).not.toContain('—');
        }
    });
});
