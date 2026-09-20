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
    ADMIN_ONLY_RECOVERY_TEXT,
    ADMIN_RECOVERY_TEXT,
    CODE_REQUESTED_TEXT,
    EMAIL_RECOVERY_INTRO,
    LoginFocus,
    LoginView,
    LoginViewAction,
    MAX_PASSWORD_BYTES,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_HEAVY_TEXT,
    PASSWORD_LONG_TEXT,
    PASSWORD_RULE_TEXT,
    PASSWORD_SHORT_TEXT,
    RESET_SESSION_WARNING,
    RecoveryStep,
    emailRecoveryEnabled,
    nextLoginView,
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
        const maxima = 'a'.repeat(MAX_PASSWORD_BYTES);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: minima, confirmPassword: minima }).valid).toBe(true);
        expect(validateRecoveryReset({ code: CODIGO, newPassword: maxima, confirmPassword: maxima }).valid).toBe(true);
        for (const password of ['a'.repeat(MAX_PASSWORD_BYTES + 1), 'á'.repeat(37)]) {
            expect(validateRecoveryReset({ code: CODIGO, newPassword: password, confirmPassword: password }).valid).toBe(false);
        }
    });

    /**
     * CADA LIMITE FALA SOZINHO, desde 2026-09-20. A recusa era UMA frase para os três casos, e
     * por isso ela recitava o teto de bytes do bcrypt ("no máximo 72 bytes em UTF-8, acentos
     * ocupam mais de um byte") para quem tinha apenas digitado uma senha curta. As igualdades
     * abaixo são o controle: um validador que devolvesse de novo uma frase única reprova em dois
     * dos três casos, qualquer que fosse a frase escolhida.
     */
    it('cada teto recusa com a SUA frase, e a dos bytes não cita número nenhum', () => {
        const caso = (senha) => validateRecoveryReset({
            code: CODIGO, newPassword: senha, confirmPassword: senha,
        }).message;

        expect(caso('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(PASSWORD_SHORT_TEXT);
        expect(caso('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(PASSWORD_LONG_TEXT);
        // Menos caracteres que o teto de caracteres, e mesmo assim pesada demais: é o único caso
        // em que a contagem que a pessoa enxerga não explica a recusa.
        expect('á'.repeat(37).length).toBeLessThan(MAX_PASSWORD_LENGTH);
        expect(caso('á'.repeat(37))).toBe(PASSWORD_HEAVY_TEXT);

        expect(PASSWORD_SHORT_TEXT).toContain(String(MIN_PASSWORD_LENGTH));
        expect(PASSWORD_LONG_TEXT).toContain(String(MAX_PASSWORD_LENGTH));
        expect(PASSWORD_HEAVY_TEXT).not.toMatch(/\d/);
        for (const frase of [PASSWORD_SHORT_TEXT, PASSWORD_LONG_TEXT, PASSWORD_HEAVY_TEXT]) {
            expect(frase).not.toMatch(/byte|utf-?8/i);
        }
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

/**
 * A TROCA DE VISÃO, que nasceu de um defeito de tela: "Esqueci minha senha" EXPANDIA o painel
 * abaixo do formulário de login, então as duas coisas ficavam juntas e o diálogo passava a rolar.
 * As duas viraram visões mutuamente exclusivas, e o que é decidível disso mora aqui.
 *
 * As três propriedades que estes casos prendem, cada uma com o controle na direção oposta:
 *   1. `Escape` FECHA na visão de login e VOLTA na de recuperação. As duas asserções andam juntas
 *      de propósito: uma implementação que devolvesse sempre o mesmo `closesModal` passaria em
 *      metade delas e reprovaria na outra, qualquer que fosse a constante.
 *   2. Onde não há recuperação por e-mail não há passo de redefinição, nem por transição nem por
 *      estado de entrada: oferecer o formulário ali é oferecer uma rota que responde 404.
 *   3. Uma resposta tardia do servidor não sequestra a visão de quem já voltou a digitar a senha.
 */
describe('nextLoginView — a troca entre "Entrar" e "Recuperar senha"', () => {
    const COM_EMAIL = { emailEnabled: true };
    const SEM_EMAIL = { emailEnabled: false };
    const LOGIN = { view: LoginView.LOGIN, step: RecoveryStep.REQUEST };
    const PEDIDO = { view: LoginView.RECOVERY, step: RecoveryStep.REQUEST };
    const REDEFINIR = { view: LoginView.RECOVERY, step: RecoveryStep.RESET };

    it('abre a recuperação no passo de pedir, com o foco no e-mail', () => {
        const r = nextLoginView(LOGIN, LoginViewAction.OPEN_RECOVERY, COM_EMAIL);
        expect(r).toEqual({
            view: LoginView.RECOVERY,
            step: RecoveryStep.REQUEST,
            focus: LoginFocus.RECOVERY_EMAIL,
            closesModal: false,
        });
    });

    it('sem caminho de e-mail, abre a mesma visão e manda o foco para a saída', () => {
        const r = nextLoginView(LOGIN, LoginViewAction.OPEN_RECOVERY, SEM_EMAIL);
        expect(r.view).toBe(LoginView.RECOVERY);
        expect(r.step).toBe(RecoveryStep.REQUEST);
        // Não há campo para focar, e deixar o foco no botão que acabou de sumir o derrubaria
        // para o corpo do documento.
        expect(r.focus).toBe(LoginFocus.RECOVERY_BACK);
    });

    it('sem caminho de e-mail NÃO existe passo de redefinição, nem por ação nem por estado', () => {
        for (const acao of [LoginViewAction.CODE_REQUESTED, LoginViewAction.HAVE_CODE]) {
            const r = nextLoginView(PEDIDO, acao, SEM_EMAIL);
            expect(r.step).toBe(RecoveryStep.REQUEST);
            expect(r.focus).toBeNull();
        }
        // E um estado que CHEGA em 'reset' é normalizado, em vez de desenhar o formulário.
        expect(nextLoginView(REDEFINIR, 'nada-disso', SEM_EMAIL).step).toBe(RecoveryStep.REQUEST);
    });

    it('o pedido atendido e o "já tenho um código" levam ao mesmo passo, com o foco no código', () => {
        for (const acao of [LoginViewAction.CODE_REQUESTED, LoginViewAction.HAVE_CODE]) {
            expect(nextLoginView(PEDIDO, acao, COM_EMAIL)).toEqual({
                view: LoginView.RECOVERY,
                step: RecoveryStep.RESET,
                focus: LoginFocus.RECOVERY_CODE,
                closesModal: false,
            });
        }
    });

    it('"pedir outro código" volta ao passo de pedir, sem sair da recuperação', () => {
        const r = nextLoginView(REDEFINIR, LoginViewAction.ASK_AGAIN, COM_EMAIL);
        expect(r.view).toBe(LoginView.RECOVERY);
        expect(r.step).toBe(RecoveryStep.REQUEST);
        expect(r.focus).toBe(LoginFocus.RECOVERY_EMAIL);
    });

    it('uma resposta tardia não sequestra a visão de quem já voltou ao login', () => {
        for (const acao of [
            LoginViewAction.CODE_REQUESTED,
            LoginViewAction.HAVE_CODE,
            LoginViewAction.ASK_AGAIN,
        ]) {
            expect(nextLoginView(LOGIN, acao, COM_EMAIL)).toEqual({
                view: LoginView.LOGIN,
                step: RecoveryStep.REQUEST,
                focus: null,
                closesModal: false,
            });
        }
    });

    it('voltar devolve a visão de login e o foco ao comando que trouxe a pessoa até aqui', () => {
        for (const estado of [PEDIDO, REDEFINIR]) {
            expect(nextLoginView(estado, LoginViewAction.BACK_TO_LOGIN, COM_EMAIL)).toEqual({
                view: LoginView.LOGIN,
                step: RecoveryStep.REQUEST,
                focus: LoginFocus.LOGIN_FORGOT,
                closesModal: false,
            });
        }
    });

    it('Esc FECHA o diálogo na visão de login e apenas VOLTA na de recuperação', () => {
        expect(nextLoginView(LOGIN, LoginViewAction.ESCAPE, COM_EMAIL)).toEqual({
            view: LoginView.LOGIN,
            step: RecoveryStep.REQUEST,
            focus: null,
            closesModal: true,
        });
        for (const estado of [PEDIDO, REDEFINIR]) {
            const r = nextLoginView(estado, LoginViewAction.ESCAPE, COM_EMAIL);
            expect(r.closesModal).toBe(false);
            expect(r.view).toBe(LoginView.LOGIN);
            expect(r.focus).toBe(LoginFocus.LOGIN_FORGOT);
        }
    });

    it('estado ausente ou irreconhecível lê como login, e Esc continua fechando', () => {
        for (const estado of [null, undefined, {}, { view: 'seja-la-o-que-for' }, { view: 42 }]) {
            expect(nextLoginView(estado, LoginViewAction.ESCAPE, COM_EMAIL).closesModal).toBe(true);
        }
    });

    it('ação desconhecida não mexe em nada, e não inventa foco', () => {
        for (const acao of ['', null, undefined, 'open-recovery-2']) {
            expect(nextLoginView(REDEFINIR, acao, COM_EMAIL)).toEqual({
                view: LoginView.RECOVERY,
                step: RecoveryStep.RESET,
                focus: null,
                closesModal: false,
            });
        }
    });

    it('a ausência de opções não liga o caminho de e-mail por engano', () => {
        expect(nextLoginView(LOGIN, LoginViewAction.OPEN_RECOVERY).focus)
            .toBe(LoginFocus.RECOVERY_BACK);
        expect(nextLoginView(PEDIDO, LoginViewAction.CODE_REQUESTED, { emailEnabled: 'sim' }).step)
            .toBe(RecoveryStep.REQUEST);
    });
});

/**
 * AS SENTENÇAS, reescritas em 2026-09-20 a pedido do dono ("esse texto está horrível para o
 * usuário"). O que mudou de lugar é tão importante quanto o que mudou de palavra: a tela ABRE
 * dizendo o que fazer e FECHA dizendo a quem recorrer, e não o contrário.
 */
describe('as sentenças da recuperação', () => {
    it('a abertura diz uma coisa só: informe o e-mail, o código chega', () => {
        expect(EMAIL_RECOVERY_INTRO).toMatch(/e-mail/i);
        expect(EMAIL_RECOVERY_INTRO).toMatch(/código/i);
        // A saída do administrador saiu daqui: ela é o que se lê DEPOIS, quando nada chegou.
        expect(EMAIL_RECOVERY_INTRO).not.toMatch(/administrador/i);
        expect(EMAIL_RECOVERY_INTRO.length).toBeLessThan(120);
    });

    it('o caminho do administrador é dito como SAÍDA, sem depender de a conta existir', () => {
        expect(ADMIN_RECOVERY_TEXT).toMatch(/administrador/i);
        expect(ADMIN_RECOVERY_TEXT).toMatch(/não recebeu/i);
        // Neutralidade: ela fala com quem NÃO recebeu, e portanto não afirma que algo foi enviado.
        expect(ADMIN_RECOVERY_TEXT).not.toMatch(/enviamos|e-mail enviado|código enviado/i);
    });

    it('onde não há e-mail, a tela inteira é o administrador, e não fala em código', () => {
        expect(ADMIN_ONLY_RECOVERY_TEXT).toMatch(/administrador/i);
        // Prometer um código onde a rota não está montada é a promessa que ninguém cumpre.
        expect(ADMIN_ONLY_RECOVERY_TEXT).not.toMatch(/código/i);
    });

    it('o pedido de código é CONDICIONAL: nunca anuncia que enviou', () => {
        expect(CODE_REQUESTED_TEXT.length).toBeGreaterThan(40);
        expect(CODE_REQUESTED_TEXT).toMatch(/\bSe\b/);
        expect(CODE_REQUESTED_TEXT).not.toMatch(/enviamos|e-mail enviado|código enviado/i);
    });

    it('a dica da senha diz o piso e NADA de jargão', () => {
        expect(PASSWORD_RULE_TEXT).toContain(String(MIN_PASSWORD_LENGTH));
        expect(PASSWORD_RULE_TEXT).not.toMatch(/byte|utf-?8/i);
        // Os dois tetos só aparecem como recusa: na dica eles seriam ruído para todo mundo.
        expect(PASSWORD_RULE_TEXT).not.toContain(String(MAX_PASSWORD_LENGTH));
        expect(PASSWORD_RULE_TEXT).not.toContain(String(MAX_PASSWORD_BYTES));
        expect(PASSWORD_RULE_TEXT.length).toBeLessThan(60);
    });

    it('o custo da redefinição é dito ANTES do clique, na língua de quem usa', () => {
        expect(RESET_SESSION_WARNING).toMatch(/dispositivos/i);
        expect(RESET_SESSION_WARNING).toMatch(/senha nova/i);
        // "Sessões encerradas" é a palavra do servidor, não a de quem perdeu a senha.
        expect(RESET_SESSION_WARNING).not.toMatch(/sessõ|token/i);
        expect(RESET_SESSION_WARNING.length).toBeLessThan(100);
    });
});
