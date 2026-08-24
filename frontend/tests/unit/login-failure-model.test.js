// Path: tests/unit/login-failure-model.test.js
//
// O LOGIN MOSTRAVA "HTTP 502" E "Failed to fetch" LOGO ABAIXO DO CAMPO DE SENHA.
//
// `LoginModal._handleSubmit` fazia `error?.message || 'Falha ao entrar'`, e as duas metades
// falham no mesmo ponto: `buildApiErrorMessage` cai no código HTTP cru quando o corpo não
// traz mensagem, e o erro de rede do navegador nem passa por lá. No contexto, um código HTTP
// embaixo de um campo de senha lê como "errei a senha", que é a conclusão mais cara possível
// — a pessoa tenta de novo, erra de novo, e passa a duvidar da própria credencial.
//
// A REGRA QUE ESTE ARQUIVO PRENDE: a recusa do servidor SOBRE A IDENTIDADE continua vindo do
// servidor palavra por palavra (senha inválida, conta desativada, e-mail não confirmado, OM
// inativa já são distinguíveis e já estão em português); tudo o que NÃO é sobre a identidade
// de quem pede ganha frase local dizendo que a senha não está em questão.

import { describe, it, expect } from 'vitest';
import { loginFailureMessage, FALHA_INDEFINIDA } from '../../src/js/modals/login-failure.model.js';

/** Um erro no formato do `ApiError` de `store/sync/api-client.js`. */
const apiError = (status, message, code = null) =>
    Object.assign(new Error(message), { status, code });

describe('loginFailureMessage: a recusa sobre a identidade é do servidor', () => {
    it('401 com mensagem do servidor mostra a mensagem do servidor', () => {
        expect(loginFailureMessage(apiError(401, 'Usuário ou senha inválidos')))
            .toBe('Usuário ou senha inválidos');
    });

    it('as quatro recusas distinguíveis chegam inteiras', () => {
        const recusas = [
            'Usuário ou senha inválidos',
            'Conta desativada',
            'Confirme seu e-mail para entrar.',
            'Organização inativa'
        ];
        for (const texto of recusas) {
            // 401 e 403 são as duas que a classificação chama de credencial.
            expect(loginFailureMessage(apiError(401, texto)), texto).toBe(texto);
            expect(loginFailureMessage(apiError(403, texto)), texto).toBe(texto);
        }
    });
});

describe('loginFailureMessage: o que NÃO é sobre a identidade ganha frase local', () => {
    it('O DEFEITO MEDIDO: um 502 não vira "HTTP 502" na tela', () => {
        const msg = loginFailureMessage(apiError(502, 'HTTP 502'));
        expect(msg).not.toMatch(/HTTP|502/);
        expect(msg).toMatch(/senha não está em questão/i);
    });

    it('O OUTRO DEFEITO MEDIDO: o erro de rede do navegador não vaza em inglês', () => {
        // `fetch` rejeita com um `TypeError` sem status nenhum.
        const msg = loginFailureMessage(new TypeError('Failed to fetch'));
        expect(msg).not.toMatch(/Failed to fetch/);
        expect(msg).toMatch(/conexão/i);
        expect(msg).toMatch(/senha não está em questão/i);
    });

    it('as variantes do erro de rede entre navegadores também são recusadas', () => {
        // Firefox e Safari escrevem outra coisa, e uma checagem que só conheça o Chrome deixa
        // metade dos usuários vendo inglês.
        for (const texto of ['NetworkError when attempting to fetch resource.', 'Load failed']) {
            expect(loginFailureMessage(new TypeError(texto)), texto).not.toContain(texto);
        }
    });

    it('429 fala em esperar, e não em conexão', () => {
        const msg = loginFailureMessage(apiError(429, 'HTTP 429'));
        expect(msg).toMatch(/tentativas|espere/i);
        expect(msg).not.toMatch(/conexão/i);
    });

    it('rede, servidor e limite têm frases DISTINTAS', () => {
        const rede = loginFailureMessage(new TypeError('Failed to fetch'));
        const servidor = loginFailureMessage(apiError(500, 'HTTP 500'));
        const limite = loginFailureMessage(apiError(429, 'HTTP 429'));
        expect(new Set([rede, servidor, limite]).size).toBe(3);
    });

    it('nenhuma frase local promete que a senha está errada', () => {
        for (const erro of [new TypeError('Failed to fetch'), apiError(500, 'x'), apiError(429, 'x')]) {
            expect(loginFailureMessage(erro)).not.toMatch(/senha inválida|usuário ou senha inv/i);
        }
    });
});

describe('loginFailureMessage: bordas', () => {
    it('status desconhecido COM mensagem legível usa a do servidor', () => {
        expect(loginFailureMessage(apiError(418, 'O servidor é um bule')))
            .toBe('O servidor é um bule');
    });

    it('status desconhecido SEM mensagem legível cai na última linha', () => {
        expect(loginFailureMessage(apiError(418, 'HTTP 418'))).toBe(FALHA_INDEFINIDA);
    });

    it('erro sem nada dentro não lança e não mostra vazio', () => {
        for (const entrada of [undefined, null, {}, new Error(''), 'texto solto']) {
            const msg = loginFailureMessage(entrada);
            expect(typeof msg, String(entrada)).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    it('a última linha não culpa a senha nem a conexão', () => {
        expect(FALHA_INDEFINIDA).not.toMatch(/senha inválida|conexão/i);
    });
});
