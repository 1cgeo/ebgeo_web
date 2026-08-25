// Path: tests/unit/recuperacao-e-email-espelham-servidor.test.js

/**
 * @fileoverview OS LIMITES QUE A TELA ANUNCIA SÃO OS DO SERVIDOR, e a fonte da comparação é o
 * arquivo Joi do backend, nunca uma lista escrita aqui.
 *
 * É o mesmo guarda de `conta-regra-de-senha-espelha-servidor.test.js`, estendido às duas
 * superfícies que nasceram em 2026-08-23: a troca de e-mail (`changeEmailSchema`,
 * `backend/src/modules/users/users.schemas.js`) e a redefinição por código
 * (`resetPasswordWithTokenSchema`, `backend/src/modules/auth/auth.schemas.js`).
 *
 * O MODO DE FALHA É O DE SEMPRE, nas duas direções e nenhuma delas quebra nada na hora: o cliente
 * que afrouxa promete que o valor serve, manda, e leva um 422 sobre um formulário que ele mesmo
 * aprovou; o cliente que aperta recusa um valor legítimo, e a pessoa não tem como saber que a
 * recusa é do próprio navegador.
 *
 * O PISO: cada extração afirma primeiro que ACHOU o bloco. Sem isso, um `export const` renomeado
 * do outro lado faria o regex parar de casar e o teste compararia vazio com vazio, que é a
 * cobertura vazia da constituição.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
} from '../../src/js/modals/password-recovery.model.js';
import { MAX_EMAIL_LENGTH } from '../../src/js/admin/account-model.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const USERS_SCHEMAS = resolve(RAIZ, 'backend/src/modules/users/users.schemas.js');
const AUTH_SCHEMAS = resolve(RAIZ, 'backend/src/modules/auth/auth.schemas.js');

/**
 * O corpo de um `export const <nome> = Joi.object({ ... });`, sem comentário de linha.
 * @param {string} fonte
 * @param {string} nome
 * @returns {string}
 */
function corpoDoSchema(fonte, nome) {
    const inicio = fonte.indexOf(`export const ${nome} = Joi.object({`);
    if (inicio === -1) return '';
    const fim = fonte.indexOf('});', inicio);
    if (fim === -1) return '';
    return fonte
        .slice(inicio, fim)
        .split('\n')
        .filter((linha) => !linha.trim().startsWith('//'))
        .join('\n');
}

/**
 * O valor numérico de `.min(n)` / `.max(n)` aplicado a um campo dentro de um corpo de schema.
 * @param {string} corpo
 * @param {string} campo
 * @param {'min'|'max'} regra
 * @returns {number|null}
 */
function limiteDoCampo(corpo, campo, regra) {
    const linha = corpo
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${campo}:`));
    if (!linha) return null;
    const achado = new RegExp(`\\.${regra}\\((\\d+)\\)`).exec(linha);
    return achado ? Number(achado[1]) : null;
}

describe('a redefinição por código espelha resetPasswordWithTokenSchema', () => {
    const FONTE = readFileSync(AUTH_SCHEMAS, 'utf8');
    const corpo = corpoDoSchema(FONTE, 'resetPasswordWithTokenSchema');

    it('o schema do servidor foi encontrado (piso contra comparação vazia)', () => {
        expect(corpo.length).toBeGreaterThan(0);
        expect(corpo).toContain('newPassword');
        expect(corpo).toContain('token');
    });

    it('os limites de senha são os mesmos dos dois lados', () => {
        const min = limiteDoCampo(corpo, 'newPassword', 'min');
        const max = limiteDoCampo(corpo, 'newPassword', 'max');
        expect(min).not.toBeNull();
        expect(max).not.toBeNull();
        expect(MIN_PASSWORD_LENGTH).toBe(min);
        expect(MAX_PASSWORD_LENGTH).toBe(max);
    });

    it('o código é validado como uuid do lado do servidor, que é o que o cliente checa', () => {
        // O cliente recusa um código truncado ANTES de gastar a ida ao servidor, e só pode fazer
        // isso enquanto o formato for este. Se o token deixar de ser uuid, o padrão do cliente
        // passa a recusar um código válido, em silêncio.
        const linha = corpo
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('token:'));
        expect(linha).toBeTruthy();
        expect(linha).toContain('.uuid()');
    });
});

describe('a troca de e-mail espelha changeEmailSchema', () => {
    const FONTE = readFileSync(USERS_SCHEMAS, 'utf8');
    const corpo = corpoDoSchema(FONTE, 'changeEmailSchema');

    it('o schema do servidor foi encontrado (piso contra comparação vazia)', () => {
        expect(corpo.length).toBeGreaterThan(0);
    });

    it('o comprimento máximo do endereço é o mesmo dos dois lados', () => {
        const max = limiteDoCampo(corpo, 'email', 'max');
        expect(max).not.toBeNull();
        expect(MAX_EMAIL_LENGTH).toBe(max);
    });

    it('a senha atual é EXIGIDA pelo servidor, e é por isso que a tela a pede', () => {
        // O campo não é uma cortesia da tela: se o servidor deixar de exigi-lo, a tela estaria
        // pedindo uma credencial sem necessidade, e alguém a removeria sem perceber que a
        // proteção do canal de recuperação foi junto.
        const linha = corpo
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('currentPassword:'));
        expect(linha).toBeTruthy();
        expect(linha).toContain('.required()');
    });
});
