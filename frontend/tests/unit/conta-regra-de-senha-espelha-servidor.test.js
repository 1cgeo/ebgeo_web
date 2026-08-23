// Path: tests/unit/conta-regra-de-senha-espelha-servidor.test.js

/**
 * @fileoverview A TELA DE "MINHA CONTA" NÃO PODE DIVERGIR DO SCHEMA DO SERVIDOR, e a fonte da
 * comparação é o arquivo Joi do backend, nunca uma lista escrita aqui.
 *
 * O modo de falha que este guarda existe para impedir tem duas direções, e as duas passam
 * despercebidas porque nenhuma quebra nada na hora:
 *
 *   - o cliente afrouxa (aceita menos que o `min` do servidor): a tela promete que a senha
 *     serve, manda, e o servidor devolve 422 sobre um formulário que o próprio aplicativo
 *     acabou de aprovar;
 *   - o cliente aperta (exige mais que o servidor): a tela recusa uma senha legítima, e o
 *     usuário não tem como saber que a recusa é do cliente.
 *
 * A MESMA COMPARAÇÃO VALE PARA A LISTA DE CAMPOS EDITÁVEIS. `updateProfileSchema` aceita DOIS
 * campos e o `validate` do backend roda com `stripUnknown: true`, então um campo a mais na tela
 * não vira erro: vira 200 sem efeito. Um campo a menos some sem aviso. Os dois casos são
 * silenciosos, e é por isso que a lista é cobrada estruturalmente.
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
    EDITABLE_PROFILE_FIELDS,
    MAX_NAME_LENGTH,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_RULE_TEXT,
} from '../../src/js/modals/account-settings.model.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCHEMAS = resolve(RAIZ, 'backend/src/modules/users/users.schemas.js');

const FONTE = readFileSync(SCHEMAS, 'utf8');

/**
 * O corpo de um `export const <nome> = Joi.object({ ... });`, sem comentário de linha.
 * @param {string} nome
 * @returns {string}
 */
function corpoDoSchema(nome) {
    const inicio = FONTE.indexOf(`export const ${nome} = Joi.object({`);
    if (inicio === -1) return '';
    const fim = FONTE.indexOf('\n});', inicio);
    if (fim === -1) return '';
    return FONTE.slice(inicio, fim)
        .split('\n')
        .filter((linha) => !linha.trim().startsWith('//'))
        .join('\n');
}

/**
 * O valor numérico de `.min(N)` / `.max(N)` da declaração de um campo.
 * @param {string} corpo
 * @param {string} campo
 * @param {'min'|'max'} limite
 * @returns {number|null}
 */
function limiteDoCampo(corpo, campo, limite) {
    const declaracao = new RegExp(`\\b${campo}:\\s*Joi[^\\n]*`).exec(corpo);
    if (!declaracao) return null;
    const achado = new RegExp(`\\.${limite}\\((\\d+)\\)`).exec(declaracao[0]);
    return achado ? Number(achado[1]) : null;
}

/**
 * Os nomes de campo de um corpo de schema, na ordem em que aparecem.
 * @param {string} corpo
 * @returns {string[]}
 */
function camposDoSchema(corpo) {
    const nomes = [];
    for (const linha of corpo.split('\n')) {
        const achado = /^\s{2}([a-zA-Z_][\w]*):\s*Joi\./.exec(linha);
        if (achado) nomes.push(achado[1]);
    }
    return nomes;
}

describe('a regra de senha do cliente espelha updatePasswordSchema', () => {
    const corpo = corpoDoSchema('updatePasswordSchema');

    it('acha o schema no backend (piso: sem isto a comparação seria vazia)', () => {
        expect(corpo.length).toBeGreaterThan(0);
        expect(corpo).toContain('newPassword');
        expect(corpo).toContain('currentPassword');
    });

    it('o mínimo do cliente é EXATAMENTE o do servidor', () => {
        const min = limiteDoCampo(corpo, 'newPassword', 'min');
        expect(min).not.toBeNull();
        expect(MIN_PASSWORD_LENGTH).toBe(min);
    });

    it('o máximo do cliente é EXATAMENTE o do servidor', () => {
        const max = limiteDoCampo(corpo, 'newPassword', 'max');
        expect(max).not.toBeNull();
        expect(MAX_PASSWORD_LENGTH).toBe(max);
    });

    it('a frase mostrada ao usuário cita os DOIS limites, em número', () => {
        expect(PASSWORD_RULE_TEXT).toContain(String(MIN_PASSWORD_LENGTH));
        expect(PASSWORD_RULE_TEXT).toContain(String(MAX_PASSWORD_LENGTH));
    });

    it('a senha atual continua obrigatória no servidor, que é o que a tela pede primeiro', () => {
        expect(corpo).toMatch(/currentPassword:\s*Joi\.string\(\)\.required\(\)/);
    });
});

describe('os campos editáveis do cliente espelham updateProfileSchema', () => {
    const corpo = corpoDoSchema('updateProfileSchema');

    it('acha o schema no backend (piso)', () => {
        expect(corpo.length).toBeGreaterThan(0);
    });

    it('a lista do cliente é a lista do servidor, sem sobra e sem falta', () => {
        const campos = camposDoSchema(corpo);
        expect(campos.length).toBeGreaterThan(0);
        expect([...EDITABLE_PROFILE_FIELDS].sort()).toEqual([...campos].sort());
    });

    it('a lotação e o escopo de produção NÃO estão entre eles (são de administrador)', () => {
        expect(EDITABLE_PROFILE_FIELDS).not.toContain('organization_id');
        expect(EDITABLE_PROFILE_FIELDS).not.toContain('producer_org_id');
        expect(EDITABLE_PROFILE_FIELDS).not.toContain('role');
    });

    it('o teto do nome no cliente é o do servidor', () => {
        const max = limiteDoCampo(corpo, 'nome', 'max');
        expect(max).not.toBeNull();
        expect(MAX_NAME_LENGTH).toBe(max);
    });
});
