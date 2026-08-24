// Path: tests/unit/login-recuperacao-modelo.test.js

/**
 * @fileoverview O QUE A TELA DE LOGIN PODE DIZER A QUEM PERDEU A SENHA.
 *
 * Duas propriedades, e as duas nasceram de uma medição:
 *
 *   1. O CAMINHO DO ADMINISTRADOR É O QUE SEMPRE EXISTE. `POST /users/:userId/reset-password`
 *      está montado em toda instalação, e até 2026-08-23 a ÚNICA orientação do produto sobre isso
 *      vivia dentro de um e-mail (`sendAccountExistsEmail`, `backend/src/utils/mailer.js`), que é
 *      o lugar que ninguém abre depois de perder uma senha. A sentença tem de estar no painel, e
 *      tem de estar lá mesmo onde a recuperação por e-mail funciona.
 *   2. A RECUPERAÇÃO POR E-MAIL PODE NÃO EXISTIR. As rotas são montadas só onde o servidor
 *      consegue entregar mensagem de conta, e `GET /api/config` reporta isso como
 *      `features.password_reset_email`. O gate é a bandeira, nunca um 404 capturado.
 *
 * O `emailRecoveryEnabled` falha FECHADO de propósito: bandeira ausente (servidor mais antigo)
 * significa "não ofereça", porque oferecer o que responde 404 é pior que oferecer só o caminho que
 * sempre funciona.
 */

import { describe, it, expect } from 'vitest';
import {
    ADMIN_RECOVERY_TEXT,
    CODE_REQUESTED_TEXT,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    RESET_SESSION_WARNING,
    emailRecoveryEnabled,
    normalizeRecoveryCode,
    recoveryErrorMessage,
    validateRecoveryRequest,
    validateRecoveryReset,
} from '../../src/js/modals/password-recovery.model.js';

const CODIGO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('emailRecoveryEnabled — falha fechado', () => {
    it('só liga com a bandeira explicitamente verdadeira', () => {
        expect(emailRecoveryEnabled({ features: { password_reset_email: true } })).toBe(true);
    });

    it('desliga para ausente, falso, e para qualquer truthy que não seja o booleano', () => {
        expect(emailRecoveryEnabled({ features: { password_reset_email: false } })).toBe(false);
        expect(emailRecoveryEnabled({ features: {} })).toBe(false);
        expect(emailRecoveryEnabled({})).toBe(false);
        expect(emailRecoveryEnabled(null)).toBe(false);
        expect(emailRecoveryEnabled(undefined)).toBe(false);
        expect(emailRecoveryEnabled({ features: { password_reset_email: 'true' } })).toBe(false);
        expect(emailRecoveryEnabled({ features: { password_reset_email: 1 } })).toBe(false);
    });
});

describe('validateRecoveryRequest', () => {
    it('exige um endereço', () => {
        expect(validateRecoveryRequest({ email: '   ' }).valid).toBe(false);
        expect(validateRecoveryRequest({}).valid).toBe(false);
    });

    it('recusa o que não tem forma de endereço', () => {
        for (const ruim of ['sem-arroba', 'a@b', 'a b@c.mil']) {
            expect(validateRecoveryRequest({ email: ruim }).valid).toBe(false);
        }
    });

    it('aceita um endereço plausível', () => {
        const r = validateRecoveryRequest({ email: '  alguem@example.mil ' });
        expect(r.valid).toBe(true);
        expect(r.message).toBe('');
    });
});

describe('validateRecoveryReset', () => {
    const senhaBoa = 'Senha-Nova-1';

    it('exige o código antes de olhar a senha', () => {
        const r = validateRecoveryReset({ code: '', newPassword: 'x', confirmPassword: 'y' });
        expect(r.valid).toBe(false);
        expect(r.message).toMatch(/código/i);
    });

    it('recusa um código truncado ou colado com lixo em volta', () => {
        for (const ruim of [
            '3f2504e0',
            `${CODIGO}extra`,
            'não-é-um-uuid-de-jeito-nenhum-nao',
            `Use este código: ${CODIGO}`,
        ]) {
            const r = validateRecoveryReset({
                code: ruim,
                newPassword: senhaBoa,
                confirmPassword: senhaBoa,
            });
            expect(r.valid).toBe(false);
            expect(r.message).toMatch(/código/i);
        }
    });

    it('espelha os limites de comprimento do servidor, nas duas pontas', () => {
        const curta = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
        const longa = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: curta, confirmPassword: curta }).valid).toBe(false);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: longa, confirmPassword: longa }).valid).toBe(false);

        // E as pontas EXATAS passam: sem isto, um validador que recusasse tudo passaria verde.
        const minima = 'a'.repeat(MIN_PASSWORD_LENGTH);
        const maxima = 'a'.repeat(MAX_PASSWORD_LENGTH);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: minima, confirmPassword: minima }).valid).toBe(true);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: maxima, confirmPassword: maxima }).valid).toBe(true);
    });

    it('cobra a confirmação', () => {
        const r = validateRecoveryReset({
            code: CODIGO,
            newPassword: senhaBoa,
            confirmPassword: 'outra-coisa',
        });
        expect(r.valid).toBe(false);
        expect(r.message).toMatch(/confirmação/i);
    });
});

describe('normalizeRecoveryCode', () => {
    it('tira espaço e caixa, porque um uuid é hexadecimal', () => {
        expect(normalizeRecoveryCode(`  ${CODIGO.toUpperCase()}\n`)).toBe(CODIGO);
    });

    it('devolve string vazia para o que não é string', () => {
        expect(normalizeRecoveryCode(null)).toBe('');
        expect(normalizeRecoveryCode(42)).toBe('');
        expect(normalizeRecoveryCode(undefined)).toBe('');
    });
});

describe('recoveryErrorMessage', () => {
    it('prefere a explicação do servidor', () => {
        expect(recoveryErrorMessage({ message: 'Código expirado.' }, 'genérica')).toBe('Código expirado.');
    });

    it('descarta o "HTTP nnn" que o cliente inventa quando não há mensagem', () => {
        expect(recoveryErrorMessage({ message: 'HTTP 500' }, 'genérica')).toBe('genérica');
        expect(recoveryErrorMessage({ message: '   ' }, 'genérica')).toBe('genérica');
        expect(recoveryErrorMessage(null, 'genérica')).toBe('genérica');
    });
});

describe('as sentenças do painel', () => {
    it('o caminho do administrador é dito, e é o que sempre vale', () => {
        expect(ADMIN_RECOVERY_TEXT.length).toBeGreaterThan(40);
        expect(ADMIN_RECOVERY_TEXT).toMatch(/administrador/i);
    });

    it('o pedido de código é CONDICIONAL: nunca anuncia que enviou', () => {
        expect(CODE_REQUESTED_TEXT.length).toBeGreaterThan(40);
        expect(CODE_REQUESTED_TEXT).toMatch(/\bSe\b/);
        expect(CODE_REQUESTED_TEXT).not.toMatch(/enviamos|e-mail enviado|código enviado/i);
    });

    it('o custo da redefinição é dito ANTES do clique', () => {
        expect(RESET_SESSION_WARNING).toMatch(/sessões/i);
        expect(RESET_SESSION_WARNING).toMatch(/encerrad/i);
    });
});
