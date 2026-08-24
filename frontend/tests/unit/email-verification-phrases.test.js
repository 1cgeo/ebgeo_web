// Path: tests/unit/email-verification-phrases.test.js
//
// A CONFIRMAÇÃO DE E-MAIL DIZIA A MESMA COISA PARA QUATRO CAUSAS, E CHUTAVA.
//
// `handleEmailVerificationFromUrl` (`src/js/index.js`) tinha `catch {` sem parâmetro e uma
// frase única: "Não foi possível confirmar o e-mail. O link pode ter expirado." O servidor
// distingue link inválido, link expirado, endereço já tomado e conta desativada; três das
// quatro liam como expiração, e "pode ter expirado" faz a pessoa esperar que um link novo
// resolva, quando para três delas nenhum link novo resolve.
//
// O sucesso mentia junto, e é o caso que se esquece: a frase era "Faça login para entrar", e
// o MESMO link serve à troca de endereço, feita por quem já está logado.
//
// ================= O QUE ESTE ARQUIVO PRENDE ================================
//
// Duas coisas, e a segunda é a que envelhece sozinha se não for mecânica:
//
//   1. O comportamento da função pura, incluindo o RAMO PADRÃO, que é onde a mentira morava.
//   2. QUE A TABELA COBRE O SERVIDOR, lendo os códigos do próprio `auth.service.js` em vez de
//      de uma lista escrita aqui. Uma recusa nova no servidor reprova este arquivo, que é o
//      oposto de cair calada no genérico.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    emailVerificationNotice,
    codigosComFrase,
    CONFIRMACAO_INDEFINIDA,
    SUCESSO_INDEFINIDO
} from '../../src/js/session/email-verification-phrases.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const AUTH_SERVICE = resolve(RAIZ, 'backend/src/modules/auth/auth.service.js');

/**
 * Os códigos de `AppError` lançados DENTRO de `verifyEmail`, lidos da fonte do backend.
 *
 * O recorte é da assinatura até a próxima declaração de topo, porque o arquivo inteiro tem
 * dezenas de códigos e comparar contra todos eles cobraria frases para recusas de login.
 * @returns {string[]}
 */
function codigosDoServidor() {
    const fonte = readFileSync(AUTH_SERVICE, 'utf8');
    const inicio = fonte.indexOf('export async function verifyEmail(');
    expect(inicio, 'a função `verifyEmail` do backend não foi encontrada').toBeGreaterThan(-1);
    const resto = fonte.slice(inicio);
    const fim = resto.indexOf('\nexport ', 1);
    const corpo = fim === -1 ? resto : resto.slice(0, fim);

    const achados = [...corpo.matchAll(/new AppError\([^)]*?,\s*\d{3},\s*'([A-Z_]+)'\s*\)/g)]
        .map((m) => m[1]);
    // PISO: cobertura vazia passa verde. Se o regex parar de casar (a forma do `throw` mudou),
    // este teste compararia vazio com vazio e reportaria sucesso sem verificar nada.
    expect(achados.length, 'a extração não achou os códigos de recusa de `verifyEmail`')
        .toBeGreaterThanOrEqual(4);
    return [...new Set(achados)].sort();
}

describe('emailVerificationNotice: recusa', () => {
    it('ESPELHA O SERVIDOR: todo código que `verifyEmail` lança tem frase própria', () => {
        const semFrase = codigosDoServidor()
            .filter((codigo) => emailVerificationNotice({ ok: false, code: codigo }).message
                === CONFIRMACAO_INDEFINIDA);
        expect(semFrase, `códigos sem frase: ${semFrase.join(', ')}`).toEqual([]);
    });

    it('CONTROLE DE VÁCUO: a tabela não é maior que o que o servidor lança', () => {
        // Sem isto, o caso acima passaria com uma tabela cheia de códigos inventados.
        expect(codigosComFrase().sort()).toEqual(codigosDoServidor());
    });

    it('cada código tem uma frase DISTINTA', () => {
        const frases = codigosComFrase()
            .map((c) => emailVerificationNotice({ ok: false, code: c }).message);
        expect(new Set(frases).size).toBe(frases.length);
    });

    it('A MENTIRA ESPECÍFICA: só o código de EXPIRAÇÃO fala em expirar', () => {
        // Este é o defeito medido. Um link inválido, um endereço tomado e uma conta desativada
        // liam todos como "pode ter expirado", e nos três casos um link novo não resolve nada.
        const falamEmExpirar = codigosComFrase()
            .filter((c) => /expir/i.test(emailVerificationNotice({ ok: false, code: c }).message));
        expect(falamEmExpirar).toEqual(['EMAIL_TOKEN_EXPIRED']);
    });

    it('o endereço tomado diz o que aconteceu com a conta de quem lê', () => {
        // A pergunta seguinte de quem lê é "e a minha conta, ficou sem e-mail?".
        expect(emailVerificationNotice({ ok: false, code: 'EMAIL_TAKEN' }).message)
            .toMatch(/endereço anterior/i);
    });

    it('o ramo padrão não nomeia causa nenhuma', () => {
        for (const entrada of [undefined, null, '', 'CODIGO_QUE_NAO_EXISTE', 42, {}]) {
            const { message, tone } = emailVerificationNotice({ ok: false, code: entrada });
            expect(message, String(entrada)).toBe(CONFIRMACAO_INDEFINIDA);
            expect(tone).toBe('error');
        }
        expect(CONFIRMACAO_INDEFINIDA).not.toMatch(/expir|inválid|em uso|inativ/i);
    });

    it('toda recusa sai com tom de erro', () => {
        for (const c of codigosComFrase()) {
            expect(emailVerificationNotice({ ok: false, code: c }).tone).toBe('error');
        }
    });
});

describe('emailVerificationNotice: sucesso', () => {
    it('cadastro confirmado manda entrar', () => {
        const { message, tone } = emailVerificationNotice({ ok: true, purpose: 'verify' });
        expect(message).toMatch(/login/i);
        expect(tone).toBe('success');
    });

    it('TROCA DE ENDEREÇO NÃO manda fazer login', () => {
        // O caso que a frase única errava: quem troca o próprio e-mail JÁ está logado, e mandá-lo
        // entrar é mandá-lo desfazer o que acabou de fazer.
        const { message } = emailVerificationNotice({ ok: true, purpose: 'change_email' });
        expect(message).not.toMatch(/login|entrar/i);
        expect(message).toMatch(/alterado/i);
    });

    it('os dois propósitos do servidor têm frase, e são frases diferentes', () => {
        // Os propósitos confirmáveis são `verify` e `change_email` (`CONFIRMABLE_PURPOSES`); o
        // terceiro (`reset_password`) não é resgatável por esta rota, de propósito.
        const a = emailVerificationNotice({ ok: true, purpose: 'verify' }).message;
        const b = emailVerificationNotice({ ok: true, purpose: 'change_email' }).message;
        expect(a).not.toBe(b);
        expect(a).not.toBe(SUCESSO_INDEFINIDO);
        expect(b).not.toBe(SUCESSO_INDEFINIDO);
    });

    it('sucesso sem propósito reconhecido confirma sem instruir', () => {
        // Um propósito novo no servidor não pode produzir uma instrução inventada aqui.
        for (const p of [undefined, null, '', 'reset_password', 7]) {
            const { message, tone } = emailVerificationNotice({ ok: true, purpose: p });
            expect(message, String(p)).toBe(SUCESSO_INDEFINIDO);
            expect(tone).toBe('success');
        }
    });

    it('sem argumento nenhum não lança, e cai na recusa indefinida', () => {
        expect(() => emailVerificationNotice()).not.toThrow();
        expect(emailVerificationNotice().message).toBe(CONFIRMACAO_INDEFINIDA);
    });
});
