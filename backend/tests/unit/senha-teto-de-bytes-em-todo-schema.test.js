// Path: tests/unit/senha-teto-de-bytes-em-todo-schema.test.js
// O teto de 72 bytes da senha vale em TODO schema que define uma senha, e não só nos dois
// fluxos auditados em 2026-09-19.
//
// O que aconteceu: a auditoria do autocadastro e da recuperação pôs o teto em
// `auth.schemas.js` (cadastro e redefinição por e-mail) e declarou por escrito que "outros
// fluxos de definição de senha ainda precisam da mesma revisão". Eram três, todos em
// `users.schemas.js`: a criação administrativa, a troca pelo próprio usuário e o reset por
// administrador, cada um com `.max(100)` cru. O bcrypt lê os primeiros 72 bytes e ignora o
// resto em silêncio, então um administrador podia cadastrar uma senha de 100 caracteres da
// qual só 72 bytes contavam, e duas senhas diferentes depois do 72º byte eram a mesma.
//
// A regra passou a morar num lugar só (`src/modules/auth/password-rule.js`), e este teste
// cobra as DUAS metades: cada schema conhecido recusa a senha de 74 bytes com a mensagem da
// regra; e nenhum campo de senha NOVO nasce sem ela, porque o censo abaixo é derivado dos
// próprios schemas (todo campo cujo nome contenha "password" e que não seja a senha ATUAL de
// uma troca nem a senha de LOGIN), e não de uma lista escrita à mão.
//
// Controle negativo, medido antes de a regra ser compartilhada: com o `.max(100)` cru em
// `users.schemas.js`, os três casos daquele arquivo passavam a senha de 74 bytes como válida.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../../src/modules/auth/auth.schemas.js';
import * as users from '../../src/modules/users/users.schemas.js';
import { PASSWORD_BYTES_MESSAGE, PASSWORD_MAX_BYTES } from '../../src/modules/auth/password-rule.js';

// 37 letras acentuadas: 37 caracteres, 74 bytes em UTF-8. Passa no `.max(100)` de caracteres
// e estoura o teto de bytes, que é exatamente o par que distingue a regra certa da crua.
const SENHA_DE_74_BYTES = 'á'.repeat(37);
const SENHA_DE_72_BYTES = 'á'.repeat(36);

// Campos que carregam uma senha SEM defini-la: a atual de uma troca e a do login. Eles não
// levam a regra de propósito (ver o comentário sobre `loginSchema` em `auth.schemas.js`).
const CAMPOS_QUE_NAO_DEFINEM_SENHA = new Set(['currentPassword']);
const SCHEMAS_QUE_NAO_DEFINEM_SENHA = new Set(['loginSchema']);

function camposDeSenha(modulo, nomeDoModulo) {
    const achados = [];
    for (const [nome, schema] of Object.entries(modulo)) {
        if (!schema || typeof schema.describe !== 'function') continue;
        if (SCHEMAS_QUE_NAO_DEFINEM_SENHA.has(nome)) continue;
        const desc = schema.describe();
        for (const chave of Object.keys(desc.keys ?? {})) {
            if (!/password/i.test(chave)) continue;
            if (CAMPOS_QUE_NAO_DEFINEM_SENHA.has(chave)) continue;
            achados.push({ modulo: nomeDoModulo, schema: nome, chave, joi: schema });
        }
    }
    return achados;
}

function validarSo(joi, chave, valor) {
    // Valida SÓ a chave em questão: os outros campos obrigatórios do schema ficam de fora,
    // senão a recusa poderia vir de `username` ausente e não da senha.
    const so = joi.extract(chave);
    return so.validate(valor);
}

describe('senha: o teto de 72 bytes vale em todo schema que define uma senha', () => {
    const campos = [
        ...camposDeSenha(auth, 'auth.schemas.js'),
        ...camposDeSenha(users, 'users.schemas.js'),
    ];

    it('o censo acha os cinco campos conhecidos, e acusa campo novo', () => {
        const nomes = campos.map((c) => `${c.schema}.${c.chave}`).sort();
        assert.deepEqual(nomes, [
            'createUserAdminSchema.password',
            'registerSchema.password',
            'resetPasswordSchema.newPassword',
            'resetPasswordWithTokenSchema.newPassword',
            'updatePasswordSchema.newPassword',
        ], 'campo de senha novo: acrescente-o aqui DEPOIS de lhe dar a regra compartilhada');
    });

    it('cada campo recusa 74 bytes com a mensagem da regra, e aceita 72', () => {
        assert.equal(PASSWORD_MAX_BYTES, 72);
        assert.equal(Buffer.byteLength(SENHA_DE_74_BYTES, 'utf8'), 74);
        assert.equal(Buffer.byteLength(SENHA_DE_72_BYTES, 'utf8'), 72);
        for (const campo of campos) {
            const rotulo = `${campo.modulo} ${campo.schema}.${campo.chave}`;
            const recusa = validarSo(campo.joi, campo.chave, SENHA_DE_74_BYTES);
            assert.ok(recusa.error, `${rotulo} aceitou uma senha de 74 bytes`);
            assert.equal(recusa.error.message, PASSWORD_BYTES_MESSAGE, rotulo);
            const aceite = validarSo(campo.joi, campo.chave, SENHA_DE_72_BYTES);
            assert.equal(aceite.error, undefined, `${rotulo} recusou uma senha de 72 bytes`);
        }
    });

    it('CONTROLE NEGATIVO: a regra crua que estava em users.schemas.js aceita os 74 bytes', async () => {
        const { default: Joi } = await import('joi');
        const crua = Joi.string().required().min(6).max(100);
        assert.equal(crua.validate(SENHA_DE_74_BYTES).error, undefined,
            'se a regra crua passou a recusar, o par de senhas deste teste deixou de discriminar');
    });

    it('login e senha atual continuam SEM a regra, de propósito', () => {
        assert.equal(auth.loginSchema.extract('password').validate('a'.repeat(100)).error, undefined);
        assert.equal(users.updatePasswordSchema.extract('currentPassword').validate('á'.repeat(37)).error, undefined);
    });
});
